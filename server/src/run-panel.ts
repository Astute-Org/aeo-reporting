// Execute one panel: every question, on every configured engine, N times over,
// then score what came back.
//
// The expensive invariant this file protects is that an answer is paid for
// once. Every engine call is persisted with its raw payload before anything
// is scored, so a scoring bug is a re-scoring job over stored rows rather
// than a second bill.

import { config } from './config.js';
import { getDb, newId, nowIso, parseList } from './db.js';
import { activeEngines, type AeoEngine, type EngineAnswer } from './engines/index.js';
import { pooled } from './pool.js';
import { scoreAnswer, type ObservationInsert, type ScorableCompany } from './score-answer.js';
import { scoreRunWithLlm } from './score-answer-llm.js';

/**
 * Run ids this process currently has in flight, so shutdown can close them
 * out itself rather than leaving them in 'running' for the stale sweep to
 * find hours later.
 */
const liveRuns = new Set<string>();

export function liveRunIds(): string[] {
  return [...liveRuns];
}

export interface PanelToRun {
  id: string;
  company_id: string;
  repeats: number;
}

interface PromptRow {
  id: string;
  text: string;
  intent: string;
}

interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  aliases: string;
  canonical_url: string | null;
  url: string | null;
}

function insertObservations(rows: ObservationInsert[]): void {
  if (!rows.length) return;
  const db = getDb();
  const stmt = db.prepare(
    `insert into observations (answer_id, company_id, kind, subject, matched_on, label, url, domain, created_at)
     values (@answer_id, @company_id, @kind, @subject, @matched_on, @label, @url, @domain, @created_at)`,
  );
  const now = nowIso();
  db.transaction(() => {
    for (const r of rows) {
      stmt.run({ label: null, url: null, domain: null, ...r, created_at: now });
    }
  })();
}

/**
 * One question, one engine, one repeat: ask, persist, score.
 *
 * A thrown engine error is recorded as a failed answer row rather than
 * propagated. One vendor refusing a single question must not abandon a
 * reading that has already been paid for up to that point.
 */
async function askAndRecord(
  runId: string,
  company: ScorableCompany,
  prompt: PromptRow,
  engine: AeoEngine,
  repeatIndex: number,
  signal?: AbortSignal,
): Promise<boolean> {
  let answer: EngineAnswer | null = null;
  let errorText: string | null = null;

  try {
    answer = await engine.ask(prompt.text, signal);
  } catch (err) {
    errorText = err instanceof Error ? err.message : String(err);
  }

  const answerId = newId();
  try {
    getDb()
      .prepare(
        `insert into answers (id, run_id, prompt_id, engine, repeat_index, answer_text, raw, input_tokens, output_tokens, search_count, status, error, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        answerId,
        runId,
        prompt.id,
        engine.id,
        repeatIndex,
        answer?.answerText ?? null,
        answer ? JSON.stringify(answer.raw ?? null) : null,
        answer?.usage.inputTokens ?? null,
        answer?.usage.outputTokens ?? null,
        answer?.usage.searchCount ?? null,
        answer ? 'ok' : 'failed',
        errorText,
        nowIso(),
      );
  } catch (err) {
    console.error(`[aeo] answer insert failed (${engine.id}/${prompt.id}):`, err instanceof Error ? err.message : err);
    return false;
  }
  if (!answer) {
    console.warn(`[aeo] ${engine.id} failed on a question: ${errorText}`);
    return false;
  }

  // Scoring is fenced off from the paid part: the answer is already bought
  // and persisted, so a scoring bug has to be a re-scoring job over stored
  // rows, never a reason to abandon the rest of the reading.
  try {
    insertObservations(scoreAnswer(answerId, company, answer));
  } catch (err) {
    console.error(`[aeo] scoring threw for answer ${answerId} (${engine.id}):`, err);
  }

  // True means "an answer was bought and stored", not "it was scored".
  return true;
}

/**
 * Run one panel end to end.
 *
 * The run row is created before any engine is called and closed out in a
 * finally, so a crash leaves a row in 'running' that the stale sweep can find.
 * A reading that failed silently and left nothing behind would read
 * downstream as a reading where the company earned nothing.
 */
export async function runPanel(panel: PanelToRun, signal?: AbortSignal): Promise<{ ok: number; failed: number }> {
  const db = getDb();
  const engines = activeEngines();
  if (!engines.length) {
    console.warn('[aeo] no engines configured, skipping panel', panel.id);
    return { ok: 0, failed: 0 };
  }

  const prompts = db
    .prepare(`select id, text, intent from prompts where panel_id = ? order by position, id`)
    .all(panel.id) as PromptRow[];
  const companyRow = db
    .prepare(`select id, name, domain, aliases, canonical_url, url from companies where id = ?`)
    .get(panel.company_id) as CompanyRow | undefined;

  if (!companyRow) {
    console.error('[aeo] company missing for panel', panel.id);
    return { ok: 0, failed: 0 };
  }
  if (!prompts.length) {
    console.warn('[aeo] panel has no questions', panel.id);
    return { ok: 0, failed: 0 };
  }

  const company: ScorableCompany = {
    id: companyRow.id,
    name: companyRow.name,
    domain: companyRow.domain,
    aliases: parseList(companyRow.aliases),
    canonical_url: companyRow.canonical_url,
    url: companyRow.url,
  };

  const runId = newId();
  const jobs = prompts.flatMap((prompt) =>
    engines.flatMap((engine) =>
      Array.from({ length: panel.repeats }, (_unused, repeatIndex) => ({ prompt, engine, repeatIndex })),
    ),
  );

  db.prepare(`insert into runs (id, panel_id, status, started_at, answers_expected) values (?, ?, 'running', ?, ?)`).run(
    runId,
    panel.id,
    nowIso(),
    jobs.length,
  );
  console.log(`[aeo] run ${runId}: ${prompts.length} questions x ${engines.map((e) => e.id).join('+')} x ${panel.repeats}`);

  liveRuns.add(runId);
  let ok = 0;
  let failed = 0;
  // Distinguishes "the fan-out finished" from "the fan-out died partway".
  // Without it a run that crashed on its first job would be closed as
  // COMPLETED with zero answers, which reads downstream as a reading where
  // the company was measured and found absent.
  let crashed: unknown = null;
  try {
    const results = await pooled(jobs, config.concurrency, (job) =>
      askAndRecord(runId, company, job.prompt, job.engine, job.repeatIndex, signal),
    );
    ok = results.filter(Boolean).length;
    failed = results.length - ok;

    // Enrichment pass. Runs after every answer is persisted, so a failure here
    // costs a judge call and leaves nulls, never the paid engine answers.
    if (config.llmScoring && ok > 0) {
      try {
        const { assessed } = await scoreRunWithLlm(runId);
        console.log(`[aeo] run ${runId}: judge assessed ${assessed} answers`);
      } catch (err) {
        console.error(`[aeo] judge pass failed for run ${runId}:`, err);
      }
    }
  } catch (err) {
    crashed = err;
  } finally {
    liveRuns.delete(runId);
    db.prepare(`update runs set status = ?, completed_at = ?, answers_ok = ?, answers_failed = ?, error = ? where id = ?`).run(
      crashed || failed === jobs.length ? 'failed' : 'completed',
      nowIso(),
      ok,
      failed,
      crashed ? `run aborted: ${crashed instanceof Error ? crashed.message : String(crashed)}` : null,
      runId,
    );
  }

  if (crashed) throw crashed;
  console.log(`[aeo] run ${runId}: ${ok} answers, ${failed} failed`);
  return { ok, failed };
}
