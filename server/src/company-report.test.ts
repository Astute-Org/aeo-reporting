import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleTrend, type CompanyTrendPoint } from './company-report.js';
import type { Standing, StandingEntry } from './standing.js';

function entry(name: string, isCompany: boolean, questions: number): StandingEntry {
  return { name, isCompany, questions, mentions: questions, recommended: 0, compared: 0, dismissed: 0, passing: 0 };
}

function standing(opts: { runId: string; companyQuestions: number | null; rivals?: number; totalQuestions?: number }): Standing {
  const entries: StandingEntry[] = [];
  for (let i = 0; i < (opts.rivals ?? 1); i += 1) entries.push(entry(`Rival ${i}`, false, 9));
  if (opts.companyQuestions !== null) entries.push(entry('Acme', true, opts.companyQuestions));
  return {
    runId: opts.runId,
    totalQuestions: opts.totalQuestions ?? 20,
    entries,
    companyRank: opts.companyQuestions === null ? null : entries.findIndex((e) => e.isCompany) + 1,
    companyName: 'Acme',
  };
}

const run = (id: string, startedAt: string, panelId: string) => ({ id, started_at: startedAt, panel_id: panelId });

describe('assembleTrend', () => {
  test('is empty when nothing has been measured', () => {
    assert.deepEqual(assembleTrend([], new Map(), new Map(), new Map()), []);
  });

  test('orders points oldest first, whatever order the runs arrived in', () => {
    const runs = [
      run('r2', '2026-08-11T00:00:00.000Z', 'p1'),
      run('r1', '2026-08-01T00:00:00.000Z', 'p1'),
      run('r3', '2026-08-21T00:00:00.000Z', 'p1'),
    ];
    const points = assembleTrend(runs, new Map([['p1', 1]]), new Map(), new Map([['p1', 20]]));
    assert.deepEqual(points.map((p) => p.runId), ['r1', 'r2', 'r3']);
  });

  test('carries the panel version onto every point, so a chart can mark where the questions changed', () => {
    const runs = [run('r1', '2026-08-01T00:00:00.000Z', 'p1'), run('r2', '2026-08-11T00:00:00.000Z', 'p2')];
    const points = assembleTrend(runs, new Map([['p1', 3], ['p2', 4]]), new Map(), new Map([['p1', 20], ['p2', 25]]));
    assert.deepEqual(points.map((p) => p.panelVersion), [3, 4]);
    assert.deepEqual(points.map((p) => p.totalQuestions), [20, 25]);
  });

  test('an unknown panel version is 0, which draws no boundary rather than inventing one', () => {
    const [point] = assembleTrend([run('r1', '2026-08-01T00:00:00.000Z', 'ghost')], new Map(), new Map(), new Map());
    assert.equal(point.panelVersion, 0);
  });

  test('a run where nobody was named still yields a point - measured and absent is a result', () => {
    const runs = [run('r1', '2026-08-01T00:00:00.000Z', 'p1')];
    const points = assembleTrend(runs, new Map([['p1', 1]]), new Map([['r1', null]]), new Map([['p1', 20]]));
    assert.equal(points.length, 1);
    assert.equal(points[0].questionsMentioned, 0);
    assert.equal(points[0].companyRank, null);
    assert.equal(points[0].entrants, 0);
    assert.equal(points[0].totalQuestions, 20);
  });

  test('an unmentioned company is rank null, not last place', () => {
    const runs = [run('r1', '2026-08-01T00:00:00.000Z', 'p1')];
    const s = standing({ runId: 'r1', companyQuestions: null, rivals: 3 });
    const [point] = assembleTrend(runs, new Map([['p1', 1]]), new Map([['r1', s]]), new Map([['p1', 20]]));
    assert.equal(point.companyRank, null);
    assert.equal(point.questionsMentioned, 0);
    assert.equal(point.entrants, 3);
  });

  test("reads the company's own question count off the standing, not the leader's", () => {
    const runs = [run('r1', '2026-08-01T00:00:00.000Z', 'p1')];
    const s = standing({ runId: 'r1', companyQuestions: 4, rivals: 2 });
    const [point] = assembleTrend(runs, new Map([['p1', 1]]), new Map([['r1', s]]), new Map([['p1', 20]]));
    assert.equal(point.questionsMentioned, 4);
    assert.equal(point.entrants, 3);
    assert.equal(point.companyRank, 3);
  });

  test("falls back to the standing's own total when the panel size is not known", () => {
    const s = standing({ runId: 'r1', companyQuestions: 2, totalQuestions: 17 });
    const [point] = assembleTrend([run('r1', '2026-08-01T00:00:00.000Z', 'p1')], new Map(), new Map([['r1', s]]), new Map());
    assert.equal(point.totalQuestions, 17);
  });

  test('does not mutate the runs it was given', () => {
    const runs = [run('r2', '2026-08-11T00:00:00.000Z', 'p1'), run('r1', '2026-08-01T00:00:00.000Z', 'p1')];
    assembleTrend(runs, new Map(), new Map(), new Map());
    assert.deepEqual(runs.map((r) => r.id), ['r2', 'r1']);
  });

  test('every point carries what a chart needs, with no undefined fields', () => {
    const [point] = assembleTrend([run('r1', '2026-08-01T00:00:00.000Z', 'p1')], new Map([['p1', 2]]), new Map(), new Map([['p1', 20]]));
    const expected: (keyof CompanyTrendPoint)[] = ['runId', 'startedAt', 'panelVersion', 'companyRank', 'entrants', 'questionsMentioned', 'totalQuestions'];
    for (const key of expected) assert.ok(key in point, `missing ${key}`);
  });
});
