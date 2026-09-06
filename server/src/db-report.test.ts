// The SQL side, against an in-memory database: from stored rows to the
// report a reader sees, and the scheduler's claim rules.

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, useDb, getDb, newId, nowIso } from './db.js';
import { buildCompanyReport } from './company-report.js';
import { loadRunMetrics, promptStatsForRun, runningRun } from './report.js';
import { buildStanding } from './standing.js';
import { claimDuePanels, reclaimStaleRuns } from './scheduler.js';

process.env.AEO_DB_FILE = ':memory:';

const T0 = Date.parse('2026-08-01T00:00:00.000Z');
const HOUR = 3_600_000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

interface Fixture {
  companyId: string;
  panelId: string;
  promptIds: string[];
}

function seedCompany(name = 'Acme', competitors: string[] = ['Rival']): Fixture {
  const db = getDb();
  const companyId = newId();
  const panelId = newId();
  db.prepare(`insert into companies (id, name, domain, url, canonical_url, aliases, competitors, created_at, updated_at) values (?, ?, ?, ?, ?, '[]', ?, ?, ?)`)
    .run(companyId, name, 'acme.com', 'https://acme.com', 'https://acme.com', JSON.stringify(competitors), nowIso(), nowIso());
  db.prepare(`insert into panels (id, company_id, version, is_active, cadence_hours, repeats, created_at) values (?, ?, 1, 1, 240, 1, ?)`)
    .run(panelId, companyId, nowIso());
  const promptIds = ['discovery', 'comparison', 'validation', 'implementation'].map((intent, i) => {
    const id = newId();
    db.prepare(`insert into prompts (id, panel_id, text, intent, position, created_at) values (?, ?, ?, ?, ?, ?)`)
      .run(id, panelId, `question ${i} about the market`, intent, i, nowIso());
    return id;
  });
  return { companyId, panelId, promptIds };
}

function seedRun(f: Fixture, startedAt: string, hits: { prompt: number; engine: string; mention?: boolean; cite?: boolean; competitor?: string }[]): string {
  const db = getDb();
  const runId = newId();
  db.prepare(`insert into runs (id, panel_id, status, started_at, completed_at, answers_expected, answers_ok, answers_failed) values (?, ?, 'completed', ?, ?, ?, ?, 0)`)
    .run(runId, f.panelId, startedAt, startedAt, hits.length, hits.length);
  for (const h of hits) {
    const answerId = newId();
    db.prepare(`insert into answers (id, run_id, prompt_id, engine, repeat_index, answer_text, status, created_at) values (?, ?, ?, ?, 0, 'text', 'ok', ?)`)
      .run(answerId, runId, f.promptIds[h.prompt], h.engine, startedAt);
    const insert = db.prepare(`insert into observations (answer_id, company_id, kind, subject, matched_on, label, context, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)`);
    if (h.mention) insert.run(answerId, f.companyId, 'unlinked_mention', 'company', 'brand_name', 'Acme', 'recommended', startedAt);
    if (h.cite) insert.run(answerId, f.companyId, 'cited', 'company', 'domain', 'Acme', null, startedAt);
    if (h.competitor) insert.run(answerId, f.companyId, 'unlinked_mention', 'competitor', 'brand_name', h.competitor, 'compared', startedAt);
  }
  return runId;
}

describe('report from stored rows', () => {
  before(() => useDb(openDb(':memory:')));

  test('metrics, standing, per-question stats and the trend agree with the rows', () => {
    const f = seedCompany();
    const runId = seedRun(f, iso(T0), [
      { prompt: 0, engine: 'openai', mention: true, cite: true, competitor: 'Rival' },
      { prompt: 1, engine: 'openai', competitor: 'Rival' },
      { prompt: 2, engine: 'perplexity', mention: true },
      { prompt: 3, engine: 'perplexity' },
    ]);

    const m = loadRunMetrics(runId);
    assert.equal(m.answers, 4);
    assert.equal(m.mentionRate.hits, 2);
    assert.equal(m.citationRate.hits, 1);
    assert.equal(m.shareOfVoice.value, 2 / 4);
    assert.equal(m.byEngine.openai.hits, 1);
    assert.equal(m.byIntent.discovery.value, 1);
    assert.equal(m.byIntent.implementation.value, 0);

    const standing = buildStanding(runId, 'Acme', 4);
    assert.ok(standing);
    assert.equal(standing!.entries[0].name, 'Acme');
    assert.equal(standing!.entries[0].questions, 2);
    assert.equal(standing!.entries[0].recommended, 2);
    assert.equal(standing!.entries[1].name, 'Rival');
    assert.equal(standing!.companyRank, 1);

    const stats = promptStatsForRun(runId);
    assert.deepEqual(stats.get(f.promptIds[0]), { answers: 1, mentioned: 1, cited: 1 });
    assert.deepEqual(stats.get(f.promptIds[3]), { answers: 1, mentioned: 0, cited: 0 });

    const report = buildCompanyReport(f.companyId)!;
    assert.equal(report.runsMeasured, 1);
    assert.equal(report.latest!.runId, runId);
    assert.equal(report.trend.length, 1);
    assert.equal(report.trend[0].questionsMentioned, 2);
    assert.equal(report.trend[0].totalQuestions, 4);
    assert.equal(report.trend[0].panelVersion, 1);
    assert.ok(report.caveats.some((c) => c.includes('One reading so far')));
    assert.ok(report.caveats.some((c) => c.includes('thin')));
  });

  test('a company with no readings reports nulls, not zeros', () => {
    const f = seedCompany('Fresh', []);
    const report = buildCompanyReport(f.companyId)!;
    assert.equal(report.latest, null);
    assert.equal(report.standing, null);
    assert.deepEqual(report.trend, []);
    assert.ok(report.caveats.some((c) => c.includes('No competitors declared')));
  });

  test('a running run is reported as in progress and excluded from the latest', () => {
    const f = seedCompany('Busy');
    const done = seedRun(f, iso(T0), [{ prompt: 0, engine: 'openai', mention: true }]);
    getDb().prepare(`insert into runs (id, panel_id, status, started_at, answers_expected) values (?, ?, 'running', ?, 8)`).run(newId(), f.panelId, iso(T0 + HOUR));
    const progress = runningRun(f.companyId);
    assert.ok(progress);
    assert.equal(progress!.answersExpected, 8);
    const report = buildCompanyReport(f.companyId)!;
    assert.equal(report.latest!.runId, done);
    assert.ok(report.caveats.some((c) => c.includes('running now')));
  });

  test('an unknown company is null', () => {
    assert.equal(buildCompanyReport('nope'), null);
  });
});

describe('scheduler claims', () => {
  before(() => useDb(openDb(':memory:')));

  test('a never-run panel is due immediately and is stamped when claimed', () => {
    const f = seedCompany('New');
    const claimed = claimDuePanels(5, T0);
    assert.ok(claimed.some((p) => p.id === f.panelId));
    assert.deepEqual(claimDuePanels(5, T0).filter((p) => p.id === f.panelId), [], 'a claimed panel is not claimed twice');
    const row = getDb().prepare(`select last_run_at from panels where id = ?`).get(f.panelId) as { last_run_at: string };
    assert.equal(row.last_run_at, iso(T0));
  });

  test('a panel is due again only after its cadence', () => {
    const f = seedCompany('Cadence');
    claimDuePanels(5, T0);
    assert.equal(claimDuePanels(5, T0 + 239 * HOUR).filter((p) => p.id === f.panelId).length, 0);
    assert.equal(claimDuePanels(5, T0 + 240 * HOUR).filter((p) => p.id === f.panelId).length, 1);
  });

  test('a panel with a run in flight is never claimed, however overdue', () => {
    const f = seedCompany('InFlight');
    getDb().prepare(`insert into runs (id, panel_id, status, started_at) values (?, ?, 'running', ?)`).run(newId(), f.panelId, iso(T0));
    assert.equal(claimDuePanels(5, T0 + 1000 * HOUR).filter((p) => p.id === f.panelId).length, 0);
  });

  test('an inactive panel is never claimed', () => {
    const f = seedCompany('Retired');
    getDb().prepare(`update panels set is_active = 0 where id = ?`).run(f.panelId);
    assert.equal(claimDuePanels(5, T0).filter((p) => p.id === f.panelId).length, 0);
  });

  test('the limit caps how many are claimed per tick', () => {
    seedCompany('A');
    seedCompany('B');
    seedCompany('C');
    assert.ok(claimDuePanels(2, T0 + 5000 * HOUR).length <= 2);
  });

  test('a stale running run is closed out as failed, a fresh one is left alone', () => {
    const f = seedCompany('Stale');
    const staleId = newId();
    const freshId = newId();
    getDb().prepare(`insert into runs (id, panel_id, status, started_at) values (?, ?, 'running', ?)`).run(staleId, f.panelId, iso(T0));
    getDb().prepare(`insert into runs (id, panel_id, status, started_at) values (?, ?, 'running', ?)`).run(freshId, f.panelId, iso(T0 + 7 * HOUR));
    // Earlier tests left their own old running rows behind, so the count is
    // at least one rather than exactly one; the rows below are the claim.
    assert.ok(reclaimStaleRuns(360, T0 + 8 * HOUR) >= 1);
    const rows = getDb().prepare(`select id, status, error from runs where id in (?, ?)`).all(staleId, freshId) as { id: string; status: string; error: string | null }[];
    assert.equal(rows.find((r) => r.id === staleId)!.status, 'failed');
    assert.match(rows.find((r) => r.id === staleId)!.error ?? '', /reclaimed/);
    assert.equal(rows.find((r) => r.id === freshId)!.status, 'running');
  });
});
