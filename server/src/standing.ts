// Where the company stands, and how it is spoken about.
//
// WHY A LEADERBOARD RATHER THAN A PERCENTAGE. "Share of voice 43%" depends
// entirely on which competitors were declared, moves when that list is edited,
// and says nothing about WHO is ahead. The same rows rendered as a named list
// - you 8, Rival A 14, Rival B 3 - is the identical data, denominated in a way
// a human argues with.
//
// WHY THE TONE SPLIT. Being named as the option to avoid counts as a mention
// in most tools. Recommended, compared and dismissed are three different
// commercial outcomes wearing one number, and separating them is the
// difference between "you were mentioned" and "you were mentioned as the one
// to avoid".

import { getDb } from './db.js';

/** Contexts the judge assigns. `passing` is a mention with no stance. */
export type MentionContext = 'recommended' | 'compared' | 'dismissed' | 'passing';

export interface StandingEntry {
  name: string;
  isCompany: boolean;
  /** Distinct panel questions this brand appeared in. The comparable unit. */
  questions: number;
  /** Total mentions across every answer. Higher than `questions` by repeats. */
  mentions: number;
  recommended: number;
  compared: number;
  dismissed: number;
  passing: number;
}

export interface Standing {
  runId: string;
  /** Questions in the panel, so an entry reads "8 of 20". */
  totalQuestions: number;
  /** Company first is NOT assumed - sorted by questions, honestly. */
  entries: StandingEntry[];
  /** 1-based. Null when the company was not mentioned at all. */
  companyRank: number | null;
  companyName: string;
}

export interface StandingObservation {
  label: string | null;
  subject: 'company' | 'competitor';
  promptId: string | null;
  context: string | null;
}

/**
 * Pure aggregation, so every claim on the leaderboard is reproducible from
 * stored rows by a test.
 */
export function rankStanding(
  observations: StandingObservation[],
  companyName: string,
  totalQuestions: number,
  runId = '',
): Standing | null {
  const byName = new Map<string, StandingEntry & { questionIds: Set<string> }>();

  for (const row of observations) {
    // An observation with no label cannot be attributed to a brand. Counting it
    // under the company would inflate exactly the number being reported.
    const name = (row.label ?? '').trim();
    if (!name) continue;

    // Case-folded: "Evite" and "evite" are one rival, not two half-strength ones.
    const key = name.toLowerCase();
    let entry = byName.get(key);
    if (!entry) {
      entry = {
        name,
        isCompany: row.subject === 'company',
        questions: 0,
        mentions: 0,
        recommended: 0,
        compared: 0,
        dismissed: 0,
        passing: 0,
        questionIds: new Set<string>(),
      };
      byName.set(key, entry);
    }

    entry.mentions += 1;
    if (row.promptId) entry.questionIds.add(row.promptId);

    switch (row.context) {
      case 'recommended': entry.recommended += 1; break;
      case 'compared': entry.compared += 1; break;
      case 'dismissed': entry.dismissed += 1; break;
      case 'passing': entry.passing += 1; break;
      // A null context is a mention the judge did not classify - counted in
      // `mentions` and in no stance bucket, so the buckets never claim a
      // judgement that was never made.
      default: break;
    }
  }

  if (byName.size === 0) return null;

  const entries = [...byName.values()]
    .map(({ questionIds, ...e }) => ({ ...e, questions: questionIds.size }))
    // Questions first, then mentions, then name. The name tiebreak is what
    // stops the board reshuffling between two reads of the same run.
    .sort((a, b) => b.questions - a.questions || b.mentions - a.mentions || a.name.localeCompare(b.name));

  const companyIndex = entries.findIndex((e) => e.isCompany);

  return {
    runId,
    totalQuestions,
    entries,
    // Null, not last place: never mentioned and mentioned-least are different
    // facts, and the second is the less bad one.
    companyRank: companyIndex === -1 ? null : companyIndex + 1,
    companyName,
  };
}

interface ObservationRow {
  label: string | null;
  subject: 'company' | 'competitor';
  context: string | null;
  prompt_id: string;
}

/** Standing for one completed run, read from stored rows. */
export function buildStanding(runId: string, companyName: string, totalQuestions: number): Standing | null {
  const rows = getDb()
    .prepare(
      `select o.label, o.subject, o.context, a.prompt_id
         from observations o
         join answers a on a.id = o.answer_id
        where a.run_id = ?
          and a.status = 'ok'
          and o.subject in ('company', 'competitor')
        order by o.id`,
    )
    .all(runId) as ObservationRow[];

  return rankStanding(
    rows.map((r) => ({ label: r.label, subject: r.subject, promptId: r.prompt_id, context: r.context })),
    companyName,
    totalQuestions,
    runId,
  );
}
