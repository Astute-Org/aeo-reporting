// The second scoring pass: how the answer TREATED each brand.
//
// Rule-based scoring answers "was it there". It cannot answer "was it
// recommended or dismissed", and those are different outcomes: a company
// named once in a list of things to avoid has a mention rate identical to a
// company named as the top recommendation.
//
// This pass is also where competitor mentions are created at all. Rule-based
// scoring only ever looks for OUR entities; share of voice needs the
// denominator, and finding several named brands in prose with their positions
// is the kind of judgement a model does well and a regex does badly.
//
// It reads only stored rows, so it can be re-run over a historical reading
// when the rubric changes, without re-asking any engine.

import { config } from './config.js';
import { getDb, nowIso, parseList } from './db.js';
import { stripUrlsPreserving } from './citation-match.js';
import { structuredCall } from './llm/judge.js';
import { pooled } from './pool.js';

export type Sentiment = 'positive' | 'neutral' | 'negative';
export type MentionContext = 'recommended' | 'compared' | 'dismissed' | 'passing';

export interface BrandAssessment {
  brand: string;
  mentioned: boolean;
  /** 1-indexed order of first appearance among named brands. Null if absent. */
  position: number | null;
  sentiment: Sentiment | null;
  context: MentionContext | null;
}

// No nullable types in the schema, so the same shape is accepted by every
// judge provider's structured-output mode. "none" and 0 are mapped to null
// below.
const ASSESS_SCHEMA = {
  type: 'object',
  properties: {
    brands: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          brand: { type: 'string' },
          mentioned: { type: 'boolean' },
          position: {
            type: 'integer',
            description: '1 for the first brand named in the answer, 2 for the second, and so on. 0 if not mentioned.',
          },
          sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'none'] },
          context: { type: 'string', enum: ['recommended', 'compared', 'dismissed', 'passing', 'none'] },
        },
        required: ['brand', 'mentioned', 'position', 'sentiment', 'context'],
        additionalProperties: false,
      },
    },
  },
  required: ['brands'],
  additionalProperties: false,
};

function instruction(answerText: string, brands: string[]): string {
  return [
    'Below is an answer produced by an AI search engine. For each brand in the list,',
    'report whether it appears and how it is treated.',
    '',
    'Definitions, which matter because they are not the same axis:',
    '- sentiment is how the answer talks about the brand.',
    '- context is the job the brand does in the answer: recommended (put forward as',
    '  a choice), compared (weighed against others), dismissed (named as a worse or',
    '  wrong option), passing (mentioned without a judgement).',
    'A brand can be described in neutral language while being dismissed. Report both',
    'independently rather than deriving one from the other.',
    '',
    'position is the order of FIRST appearance counting only named brands: the first',
    'brand named anywhere in the answer is 1, regardless of how many words precede it.',
    '',
    'If a brand does not appear, set mentioned false, position 0, sentiment "none" and',
    'context "none". Do not infer a brand from a generic description of its category.',
    '',
    `BRANDS: ${brands.join(', ')}`,
    '',
    '--- ANSWER ---',
    answerText.slice(0, 20_000),
  ].join('\n');
}

interface RawAssessment {
  brand?: string;
  mentioned?: boolean;
  position?: number;
  sentiment?: string;
  context?: string;
}

const SENTIMENTS = new Set(['positive', 'neutral', 'negative']);
const CONTEXTS = new Set(['recommended', 'compared', 'dismissed', 'passing']);

/**
 * Ask the judge how an answer treats a set of brands.
 *
 * Exported separately from the persistence below so the judgement can be
 * tested and evaluated against hand-labelled answers without a database.
 */
export async function assessBrands(answerText: string, brands: string[]): Promise<BrandAssessment[]> {
  if (!answerText.trim() || !brands.length) return [];

  const parsed = await structuredCall<{ brands?: RawAssessment[] }>({
    purpose: 'judge',
    tool: { name: 'assess_brands', description: 'Report how the answer treats each brand.', schema: ASSESS_SCHEMA },
    prompt: instruction(answerText, brands),
    maxTokens: 2_000,
    effort: 'low',
  });
  if (!parsed) return [];

  // Map the model's echo of each brand back onto the string WE asked about,
  // rather than requiring it back byte for byte. An exact-string filter fails
  // totally on any casing or whitespace drift, and zero competitor rows is
  // not a neutral outcome downstream: it is precisely what makes share of
  // voice read 100%.
  const canonical = new Map(brands.map((b) => [b.trim().toLowerCase(), b]));
  const mapped: BrandAssessment[] = [];
  let dropped = 0;
  for (const b of parsed.brands ?? []) {
    const match = canonical.get(String(b.brand ?? '').trim().toLowerCase());
    if (!match) {
      dropped += 1;
      continue;
    }
    const mentioned = Boolean(b.mentioned);
    const position = typeof b.position === 'number' && b.position > 0 ? Math.round(b.position) : null;
    mapped.push({
      brand: match,
      mentioned,
      position: mentioned ? position : null,
      sentiment: mentioned && SENTIMENTS.has(b.sentiment ?? '') ? (b.sentiment as Sentiment) : null,
      context: mentioned && CONTEXTS.has(b.context ?? '') ? (b.context as MentionContext) : null,
    });
  }
  if (dropped) console.warn(`[aeo] judge named ${dropped} brand(s) we did not ask about; ignored`);
  return mapped;
}

interface AnswerToScore {
  id: string;
  answer_text: string | null;
}

/**
 * Fill position, sentiment and context for one run, and create the competitor
 * rows that share of voice and the leaderboard need.
 *
 * The company's observation row already exists from rule-based scoring, so it
 * is UPDATED rather than inserted: inserting would double-count the company
 * in mention rate. A judge that disagrees with the regex about whether the
 * company is present is not allowed to delete the row - the regex is the
 * conservative, reproducible measure and stays the source of truth for
 * presence; this pass only enriches what presence means.
 */
export async function scoreRunWithLlm(runId: string): Promise<{ assessed: number }> {
  const db = getDb();
  const company = db
    .prepare(
      `select c.id, c.name, c.competitors
         from runs r
         join panels p on p.id = r.panel_id
         join companies c on c.id = p.company_id
        where r.id = ?`,
    )
    .get(runId) as { id: string; name: string; competitors: string } | undefined;
  if (!company) return { assessed: 0 };

  const competitors = parseList(company.competitors);
  const brands = [company.name, ...competitors];

  const answers = db
    .prepare(`select id, answer_text from answers where run_id = ? and status = 'ok' order by id`)
    .all(runId) as AnswerToScore[];
  if (!answers.length) return { assessed: 0 };

  // Clear this run's competitor rows before writing new ones, so a re-score
  // is idempotent. Without this every re-run doubled the competitor count
  // while the company count stayed put, and share of voice halved each time.
  const placeholders = answers.map(() => '?').join(',');
  db.prepare(`delete from observations where subject = 'competitor' and answer_id in (${placeholders})`).run(
    ...answers.map((a) => a.id),
  );

  const updateCompany = db.prepare(
    `update observations set position = ?, sentiment = ?, context = ? where answer_id = ? and subject = 'company'`,
  );
  const insertCompetitor = db.prepare(
    `insert into observations (answer_id, company_id, kind, subject, matched_on, label, position, sentiment, context, created_at)
     values (?, ?, 'unlinked_mention', 'competitor', 'brand_name', ?, ?, ?, ?, ?)`,
  );

  const scored = await pooled(answers, config.concurrency, async (answer) => {
    if (!answer.answer_text) return 0;

    let results: BrandAssessment[];
    try {
      results = await assessBrands(stripUrlsPreserving(answer.answer_text, brands), brands);
    } catch (err) {
      // One unscoreable answer must not abandon the pass. The rows it would
      // have enriched keep their nulls, which read correctly as "not assessed".
      console.error(`[aeo] judge failed for answer ${answer.id}:`, err instanceof Error ? err.message : err);
      return 0;
    }

    const write = db.transaction(() => {
      for (const r of results) {
        if (!r.mentioned) continue;
        if (r.brand === company.name) {
          updateCompany.run(r.position, r.sentiment, r.context, answer.id);
          continue;
        }
        // A competitor named without a link is the same kind of event as the
        // company named without a link, and share of voice compares like
        // with like or it compares nothing.
        insertCompetitor.run(answer.id, company.id, r.brand, r.position, r.sentiment, r.context, nowIso());
      }
    });
    write();
    return 1;
  });

  return { assessed: scored.reduce((n: number, v) => n + v, 0) };
}
