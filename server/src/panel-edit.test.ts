import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePanelEdit, EDIT_MIN, EDIT_MAX } from './panel-edit.js';

const q = (n: number, prefix = 'best way to plan healthy meals for a week') =>
  Array.from({ length: n }, (_u, i) => ({ text: `${prefix} number ${i}`, intent: 'discovery' }));

describe('validatePanelEdit', () => {
  test('accepts a plain edited panel', () => {
    const result = validatePanelEdit(q(EDIT_MIN));
    assert.deepEqual(result.errors, []);
    assert.equal(result.accepted.length, EDIT_MIN);
  });

  test('refuses a panel too small for a rate to mean anything', () => {
    const result = validatePanelEdit(q(EDIT_MIN - 1));
    assert.ok(result.errors.some((e) => e.includes(`at least ${EDIT_MIN}`)));
  });

  test('refuses a panel big enough to be a surprise on the bill', () => {
    assert.ok(validatePanelEdit(q(EDIT_MAX + 1)).errors.some((e) => e.includes(`at most ${EDIT_MAX}`)));
  });

  test('names the position of a bad question rather than quoting it back', () => {
    const result = validatePanelEdit([...q(EDIT_MIN), { text: '   ', intent: 'discovery' }]);
    assert.ok(result.errors.some((e) => e.startsWith(`Question ${EDIT_MIN + 1}`)));
  });

  test('refuses an unknown kind and says which kinds exist', () => {
    const result = validatePanelEdit([...q(EDIT_MIN), { text: 'how do i pick a meal plan service', intent: 'vibes' }]);
    const error = result.errors.find((e) => e.includes('unknown kind'));
    assert.ok(error);
    assert.match(error!, /discovery, comparison, validation, implementation/);
  });

  test('refuses a keyword string, which behaves differently from a question', () => {
    assert.ok(validatePanelEdit([...q(EDIT_MIN), { text: 'meal plan', intent: 'discovery' }]).errors.some((e) => e.includes('too short')));
  });

  test('refuses a duplicate, ignoring case, spacing and trailing punctuation', () => {
    const result = validatePanelEdit([
      ...q(EDIT_MIN),
      { text: 'how do i pick a meal plan service', intent: 'discovery' },
      { text: '  How do I pick a Meal   Plan service?  ', intent: 'comparison' },
    ]);
    assert.ok(result.errors.some((e) => e.includes('duplicates')));
  });

  test('a branded question WARNS and is still accepted - the owner of the panel decides', () => {
    const result = validatePanelEdit([...q(EDIT_MIN), { text: 'is Acme a good meal plan service', intent: 'validation' }], { brandTerms: ['Acme'] });
    assert.deepEqual(result.errors, []);
    assert.equal(result.accepted.length, EDIT_MIN + 1);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /without measuring one/);
  });

  test('trims the text it accepts', () => {
    const result = validatePanelEdit([...q(EDIT_MIN - 1), { text: '   how do i pick a meal plan service   ', intent: 'discovery' }]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.accepted[EDIT_MIN - 1].text, 'how do i pick a meal plan service');
  });

  test('an empty submission fails on size rather than throwing', () => {
    const result = validatePanelEdit([]);
    assert.equal(result.accepted.length, 0);
    assert.ok(result.errors.length > 0);
  });
});
