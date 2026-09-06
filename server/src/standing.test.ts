import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rankStanding, type StandingObservation } from './standing.js';

const obs = (
  label: string | null,
  subject: 'company' | 'competitor',
  promptId: string,
  context: string | null = null,
): StandingObservation => ({ label, subject, promptId, context });

describe('rankStanding', () => {
  test('ranks by distinct questions, not raw mention count', () => {
    // A brand named five times in one answer has not out-reached a brand named
    // once in three different questions.
    const s = rankStanding(
      [
        obs('Acme', 'company', 'q1'),
        obs('Acme', 'company', 'q1'),
        obs('Acme', 'company', 'q1'),
        obs('Acme', 'company', 'q1'),
        obs('Acme', 'company', 'q1'),
        obs('Rival', 'competitor', 'q1'),
        obs('Rival', 'competitor', 'q2'),
        obs('Rival', 'competitor', 'q3'),
      ],
      'Acme',
      20,
    );
    assert.equal(s!.entries[0].name, 'Rival');
    assert.equal(s!.entries[0].questions, 3);
    assert.equal(s!.entries[1].name, 'Acme');
    assert.equal(s!.entries[1].questions, 1);
    assert.equal(s!.entries[1].mentions, 5);
    assert.equal(s!.companyRank, 2);
  });

  test('splits stance into the commercial outcomes', () => {
    const s = rankStanding(
      [
        obs('Acme', 'company', 'q1', 'recommended'),
        obs('Acme', 'company', 'q2', 'dismissed'),
        obs('Acme', 'company', 'q3', 'compared'),
        obs('Acme', 'company', 'q4', 'passing'),
      ],
      'Acme',
      20,
    );
    const me = s!.entries[0];
    assert.equal(me.recommended, 1);
    assert.equal(me.dismissed, 1);
    assert.equal(me.compared, 1);
    assert.equal(me.passing, 1);
  });

  test('an unclassified mention counts as a mention and no stance', () => {
    const s = rankStanding([obs('Acme', 'company', 'q1', null)], 'Acme', 20);
    const me = s!.entries[0];
    assert.equal(me.mentions, 1);
    assert.equal(me.recommended + me.compared + me.dismissed + me.passing, 0);
  });

  test('drops observations with no brand label rather than crediting the company', () => {
    const s = rankStanding([obs('Acme', 'company', 'q1'), obs(null, 'competitor', 'q2'), obs('  ', 'competitor', 'q3')], 'Acme', 20);
    assert.equal(s!.entries.length, 1);
    assert.equal(s!.entries[0].mentions, 1);
  });

  test('treats brand names case-insensitively so one rival is not two rows', () => {
    const s = rankStanding([obs('Rival', 'competitor', 'q1'), obs('rival', 'competitor', 'q2'), obs('RIVAL', 'competitor', 'q3')], 'Acme', 20);
    assert.equal(s!.entries.length, 1);
    assert.equal(s!.entries[0].questions, 3);
  });

  test('reports the company as unranked when it was never mentioned', () => {
    assert.equal(rankStanding([obs('Rival', 'competitor', 'q1')], 'Acme', 20)!.companyRank, null);
  });

  test('orders deterministically when brands tie', () => {
    const first = rankStanding([obs('Zeta', 'competitor', 'q1'), obs('Alpha', 'competitor', 'q2')], 'Acme', 20);
    const second = rankStanding([obs('Alpha', 'competitor', 'q2'), obs('Zeta', 'competitor', 'q1')], 'Acme', 20);
    assert.deepEqual(first!.entries.map((e) => e.name), second!.entries.map((e) => e.name));
    assert.equal(first!.entries[0].name, 'Alpha');
  });

  test('returns null when the run produced no attributable mentions', () => {
    assert.equal(rankStanding([], 'Acme', 20), null);
  });
});
