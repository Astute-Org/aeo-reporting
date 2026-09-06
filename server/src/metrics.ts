// Turning observation rows into the numbers on the report.
//
// Pure and dependency-free on purpose. These are the figures a reader will
// challenge, so every one has to be reproducible from stored rows by anyone,
// in a test, without a database or a vendor key.
//
// RATES HAVE TWO HONEST DEFINITIONS AND WE REPORT BOTH.
//   answer rate     hits / answers. A proper proportion. Adding repeats makes
//                   it more precise and does not move its expectation.
//   promptCoverage  questions where we appeared at least once / questions.
//                   This is what people mean colloquially by "we show up for
//                   40% of questions", and it RISES with the repeat count for
//                   a fixed underlying performance. Only comparable between
//                   readings at an identical repeat count.
//
// A RATE WITH NO DENOMINATOR IS NULL, NEVER ZERO.
// Every rate carries the n it was computed over, and returns null when n is 0.
// A reading where an engine was down and a reading where the company earned
// nothing are opposite facts, and a defaulted 0 makes them identical in every
// chart downstream. This is the single easiest way for this system to tell a
// reader something untrue.

export type ObservationKind = 'retrieved' | 'cited' | 'linked_mention' | 'unlinked_mention';
export type ObservationSubject = 'company' | 'competitor';
export type PromptIntent = 'discovery' | 'comparison' | 'validation' | 'implementation';

export const INTENTS: PromptIntent[] = ['discovery', 'comparison', 'validation', 'implementation'];

export interface AnswerRecord {
  id: string;
  promptId: string;
  engine: string;
  status: 'ok' | 'failed';
}

export interface ObservationRecord {
  answerId: string;
  kind: ObservationKind;
  subject: ObservationSubject;
  label?: string | null;
  position?: number | null;
}

export interface PromptRecord {
  id: string;
  intent: PromptIntent;
}

/**
 * A proportion that knows how much evidence it rests on.
 *
 * The interval is WILSON, not Wald. Wald collapses to a point at 0 and 1: the
 * standard error is sqrt(0/n) = 0, so 1-of-1 against 0-of-1 comes out as a
 * meaningful difference. Wilson gives 1/1 roughly [0.21, 1.00], which is wide
 * enough to be obviously uninformative, and stays a proper interval
 * everywhere.
 */
export interface Rate {
  value: number | null;
  hits: number;
  n: number;
  ci95: [number, number] | null;
}

const Z = 1.96;

export function rate(hits: number, n: number): Rate {
  if (n <= 0) return { value: null, hits, n, ci95: null };
  const value = hits / n;

  const denom = 1 + (Z * Z) / n;
  const centre = (value + (Z * Z) / (2 * n)) / denom;
  const spread = (Z * Math.sqrt((value * (1 - value)) / n + (Z * Z) / (4 * n * n))) / denom;

  return {
    value,
    hits,
    n,
    ci95: [Math.max(0, centre - spread), Math.min(1, centre + spread)],
  };
}

export interface Metrics {
  /** Answers that came back at all. The denominator for every rate below. */
  answers: number;
  prompts: number;

  /** The company's site cited as a source. */
  citationRate: Rate;
  /** The company named in the prose, linked or not. */
  mentionRate: Rate;
  /** The company's site fetched during research, whether or not it was used. */
  retrievalRate: Rate;
  /**
   * Of the answers that retrieved the site, how many cited it.
   *
   * A low citation rate with a high selection rate means the site is not
   * being found and the fix is indexing. A low selection rate means it is
   * found and passed over, and the fix is the content.
   */
  selectionRate: Rate;
  /** Questions where the company appeared in at least one repeat. */
  promptCoverage: Rate;
  /**
   * Company mentions as a share of all tracked brand mentions.
   *
   * Denominator is the company plus the DECLARED competitors, never every
   * brand the answer happened to name. Null, never 100%, when no competitor
   * was recorded anywhere in the run - which is what happens when the judge
   * pass is off, and a 100% share off a config flag is not a measurement.
   */
  shareOfVoice: Rate;
  /** Mean 1-indexed position of the company where the judge recorded one. */
  meanPosition: number | null;

  byIntent: Record<PromptIntent, Rate>;
  byEngine: Record<string, Rate>;
}

const MENTION_KINDS: ObservationKind[] = ['linked_mention', 'unlinked_mention'];

/**
 * Roll a run's stored rows up into the reportable figures.
 *
 * Failed answers are excluded from every denominator. A vendor 500 is not
 * evidence that the company was absent, and counting it as a miss would make
 * an unreliable engine look like a failing brand.
 */
export function computeMetrics(
  answers: AnswerRecord[],
  observations: ObservationRecord[],
  prompts: PromptRecord[],
): Metrics {
  const ok = answers.filter((a) => a.status === 'ok');
  const okIds = new Set(ok.map((a) => a.id));
  const obs = observations.filter((o) => okIds.has(o.answerId));

  const answerIndex = new Map(ok.map((a) => [a.id, a]));
  const intentByPrompt = new Map(prompts.map((p) => [p.id, p.intent]));

  // An answer counts once per category however many rows it produced. Three
  // cited URLs from one answer is one answer that cited us, not three.
  const citedAnswers = new Set<string>();
  const mentionAnswers = new Set<string>();
  const retrievedAnswers = new Set<string>();
  const positions: number[] = [];
  let companyMentions = 0;
  let competitorMentions = 0;

  for (const o of obs) {
    if (o.kind === 'cited' && o.subject === 'company') citedAnswers.add(o.answerId);
    if (o.kind === 'retrieved' && o.subject === 'company') retrievedAnswers.add(o.answerId);

    if (MENTION_KINDS.includes(o.kind)) {
      if (o.subject === 'company') {
        mentionAnswers.add(o.answerId);
        companyMentions += 1;
        if (typeof o.position === 'number') positions.push(o.position);
      }
      if (o.subject === 'competitor') competitorMentions += 1;
    }
  }

  const hitPrompts = new Set<string>();
  for (const id of [...citedAnswers, ...mentionAnswers]) {
    const a = answerIndex.get(id);
    if (a) hitPrompts.add(a.promptId);
  }
  const measuredPrompts = new Set(ok.map((a) => a.promptId));

  const byIntent = {} as Record<PromptIntent, Rate>;
  for (const intent of INTENTS) {
    const inIntent = ok.filter((a) => intentByPrompt.get(a.promptId) === intent);
    const hits = inIntent.filter((a) => citedAnswers.has(a.id) || mentionAnswers.has(a.id)).length;
    byIntent[intent] = rate(hits, inIntent.length);
  }

  const byEngine: Record<string, Rate> = {};
  for (const engine of new Set(ok.map((a) => a.engine))) {
    const inEngine = ok.filter((a) => a.engine === engine);
    const hits = inEngine.filter((a) => citedAnswers.has(a.id) || mentionAnswers.has(a.id)).length;
    byEngine[engine] = rate(hits, inEngine.length);
  }

  return {
    answers: ok.length,
    prompts: measuredPrompts.size,
    citationRate: rate(citedAnswers.size, ok.length),
    mentionRate: rate(mentionAnswers.size, ok.length),
    retrievalRate: rate(retrievedAnswers.size, ok.length),
    selectionRate: rate(
      [...citedAnswers].filter((id) => retrievedAnswers.has(id)).length,
      retrievedAnswers.size,
    ),
    promptCoverage: rate(hitPrompts.size, measuredPrompts.size),
    shareOfVoice:
      competitorMentions === 0 ? rate(companyMentions, 0) : rate(companyMentions, companyMentions + competitorMentions),
    meanPosition: positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : null,
    byIntent,
    byEngine,
  };
}
