// Rule-based scoring: the function that decides what a company is told it got.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAnswer, type ScorableAnswer, type ScorableCompany } from './score-answer.js';

const company: ScorableCompany = {
  id: 'c1',
  name: 'Acme Meals',
  domain: 'acmemeals.com',
  aliases: ['Acme'],
  canonical_url: 'https://acmemeals.com',
};

function answer(partial: Partial<ScorableAnswer>): ScorableAnswer {
  return { answerText: '', cited: [], retrieved: [], ...partial };
}

describe('url matching', () => {
  test('the homepage cited is an exact hit', () => {
    const rows = scoreAnswer('a1', company, answer({ cited: [{ url: 'https://www.acmemeals.com/?utm_source=chatgpt' }] }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'cited');
    assert.equal(rows[0].subject, 'company');
    assert.equal(rows[0].matched_on, 'exact_url');
  });

  test('another page on the site is a domain hit', () => {
    const rows = scoreAnswer('a1', company, answer({ cited: [{ url: 'https://acmemeals.com/pricing' }] }));
    assert.equal(rows[0].matched_on, 'domain');
    assert.equal(rows[0].subject, 'company');
  });

  test('an unrelated citation produces nothing', () => {
    assert.equal(scoreAnswer('a1', company, answer({ cited: [{ url: 'https://someoneelse.com/post' }] })).length, 0);
  });

  test('retrieved and cited are recorded separately, because the gap is the diagnostic', () => {
    const rows = scoreAnswer('a1', company, answer({ retrieved: [{ url: 'https://acmemeals.com/menu' }] }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'retrieved');
  });

  test('the same page cited twice in one answer counts once', () => {
    const rows = scoreAnswer('a1', company, answer({
      cited: [{ url: 'https://acmemeals.com/menu' }, { url: 'https://www.acmemeals.com/menu/?utm_campaign=x' }],
    }));
    assert.equal(rows.filter((r) => r.kind === 'cited').length, 1);
  });
});

describe('company mentions', () => {
  test('named without a link is an unlinked mention', () => {
    const rows = scoreAnswer('a1', company, answer({ answerText: 'For healthy meal plans, Acme Meals is a common choice.' }));
    const mention = rows.find((r) => r.matched_on === 'brand_name');
    assert.ok(mention);
    assert.equal(mention!.kind, 'unlinked_mention');
    assert.equal(mention!.label, 'Acme Meals');
  });

  test('named with the site also cited is a linked mention', () => {
    const rows = scoreAnswer('a1', company, answer({
      answerText: 'Acme Meals handles this well.',
      cited: [{ url: 'https://acmemeals.com/plans' }],
    }));
    assert.equal(rows.find((r) => r.matched_on === 'brand_name')!.kind, 'linked_mention');
  });

  test('an alias counts, because a renamed brand is still that brand', () => {
    const rows = scoreAnswer('a1', company, answer({ answerText: 'You could use Acme for that.' }));
    const mention = rows.find((r) => r.matched_on === 'brand_name');
    assert.ok(mention);
    assert.equal(mention!.label, 'Acme');
  });

  test('a substring is not a mention', () => {
    const rows = scoreAnswer('a1', { ...company, name: 'Wise', aliases: [] }, answer({
      answerText: 'Otherwise, consider a local bank. Likewise for payroll.',
    }));
    assert.equal(rows.filter((r) => r.matched_on === 'brand_name').length, 0);
  });

  test('a company appearing only inside a link is NOT a prose mention', () => {
    const rows = scoreAnswer('a1', company, answer({
      answerText: 'A menu is at https://acmemeals.com/menu if useful.',
      cited: [{ url: 'https://acmemeals.com/menu' }],
    }));
    assert.equal(rows.filter((r) => r.matched_on === 'brand_name').length, 0);
    assert.equal(rows.filter((r) => r.kind === 'cited').length, 1);
  });

  test('the company is recorded once even when named repeatedly', () => {
    const rows = scoreAnswer('a1', company, answer({ answerText: 'Acme Meals is good. Acme Meals is cheap.' }));
    assert.equal(rows.filter((r) => r.matched_on === 'brand_name').length, 1);
  });

  test('an empty answer yields nothing rather than a phantom hit', () => {
    assert.deepEqual(scoreAnswer('a1', company, answer({})), []);
  });
});
