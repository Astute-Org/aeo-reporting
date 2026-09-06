// Loading stored rows and handing them to the pure functions in metrics.ts.
//
// Nothing here decides what a number means, so every claim in a report is
// reproducible from stored rows by a test.

import { getDb } from './db.js';
import { computeMetrics, type AnswerRecord, type Metrics, type ObservationRecord, type PromptRecord } from './metrics.js';

export interface RunReport {
  runId: string;
  startedAt: string;
  completedAt: string | null;
  metrics: Metrics;
}

export interface InProgress {
  runId: string;
  startedAt: string;
  answersExpected: number | null;
  answersSoFar: number;
}

export interface CompletedRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  panel_id: string;
}

export function loadRunMetrics(runId: string): Metrics {
  const db = getDb();
  const answers = db
    .prepare(`select id, prompt_id, engine, status from answers where run_id = ?`)
    .all(runId) as { id: string; prompt_id: string; engine: string; status: 'ok' | 'failed' }[];
  const observations = db
    .prepare(
      `select o.answer_id, o.kind, o.subject, o.label, o.position
         from observations o
         join answers a on a.id = o.answer_id
        where a.run_id = ?`,
    )
    .all(runId) as { answer_id: string; kind: ObservationRecord['kind']; subject: ObservationRecord['subject']; label: string | null; position: number | null }[];
  const prompts = db
    .prepare(`select id, intent from prompts where panel_id = (select panel_id from runs where id = ?)`)
    .all(runId) as { id: string; intent: PromptRecord['intent'] }[];

  const answerRecords: AnswerRecord[] = answers.map((a) => ({
    id: a.id,
    promptId: a.prompt_id,
    engine: a.engine,
    status: a.status,
  }));
  const observationRecords: ObservationRecord[] = observations.map((o) => ({
    answerId: o.answer_id,
    kind: o.kind,
    subject: o.subject,
    label: o.label,
    position: o.position,
  }));
  return computeMetrics(answerRecords, observationRecords, prompts);
}

/** Completed runs for a company, oldest first, with the panel each was asked on. */
export function runsForCompany(companyId: string): CompletedRun[] {
  return getDb()
    .prepare(
      `select r.id, r.started_at, r.completed_at, r.panel_id
         from runs r
         join panels p on p.id = r.panel_id
        where p.company_id = ? and r.status = 'completed'
        order by r.started_at`,
    )
    .all(companyId) as CompletedRun[];
}

/**
 * The run currently executing for this company, if any.
 *
 * Carries progress and NOT metrics: a half-finished run's rates are computed
 * over whichever answers happened to land first, which is a different
 * population every time you look.
 */
export function runningRun(companyId: string): InProgress | null {
  const db = getDb();
  const row = db
    .prepare(
      `select r.id, r.started_at, r.answers_expected
         from runs r
         join panels p on p.id = r.panel_id
        where p.company_id = ? and r.status = 'running'
        order by r.started_at desc
        limit 1`,
    )
    .get(companyId) as { id: string; started_at: string; answers_expected: number | null } | undefined;
  if (!row) return null;

  const count = db.prepare(`select count(*) as n from answers where run_id = ?`).get(row.id) as { n: number };
  return {
    runId: row.id,
    startedAt: row.started_at,
    answersExpected: row.answers_expected ?? null,
    answersSoFar: count.n,
  };
}

/** Newest completed run on one panel, or null. */
export function latestCompletedRunForPanel(panelId: string): string | null {
  const row = getDb()
    .prepare(`select id from runs where panel_id = ? and status = 'completed' order by started_at desc limit 1`)
    .get(panelId) as { id: string } | undefined;
  return row?.id ?? null;
}

export interface PromptStats {
  answers: number;
  mentioned: number;
  cited: number;
}

/** Per-question hit counts over one run. */
export function promptStatsForRun(runId: string): Map<string, PromptStats> {
  const db = getDb();
  const answers = db
    .prepare(`select id, prompt_id from answers where run_id = ? and status = 'ok'`)
    .all(runId) as { id: string; prompt_id: string }[];
  const obs = db
    .prepare(
      `select o.answer_id, o.kind, o.subject
         from observations o
         join answers a on a.id = o.answer_id
        where a.run_id = ? and o.subject = 'company'`,
    )
    .all(runId) as { answer_id: string; kind: string; subject: string }[];

  const mentioned = new Set(obs.filter((o) => o.kind === 'linked_mention' || o.kind === 'unlinked_mention').map((o) => o.answer_id));
  const cited = new Set(obs.filter((o) => o.kind === 'cited').map((o) => o.answer_id));

  const stats = new Map<string, PromptStats>();
  for (const a of answers) {
    const row = stats.get(a.prompt_id) ?? { answers: 0, mentioned: 0, cited: 0 };
    row.answers += 1;
    if (mentioned.has(a.id)) row.mentioned += 1;
    if (cited.has(a.id)) row.cited += 1;
    stats.set(a.prompt_id, row);
  }
  return stats;
}
