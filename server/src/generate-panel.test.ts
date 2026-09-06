import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validatePanel, INTENTS, buildInstruction, type CandidatePrompt } from './generate-panel.js';
import type { PromptIntent } from './metrics.js';

function spread(count: number, intent: PromptIntent, prefix = 'question'): CandidatePrompt[] {
  return Array.from({ length: count }, (_u, i) => ({ text: `${prefix} number ${i} about the market`, intent }));
}

function fullPanel(): CandidatePrompt[] {
  return INTENTS.flatMap((intent) => spread(6, intent, `${intent} q`));
}

describe('validatePanel rejects branded prompts', () => {
  test('a prompt naming the company is rejected, because it always surfaces them', () => {
    const result = validatePanel(
      [
        { text: 'what is Acme and how does it work', intent: 'discovery' },
        { text: 'best meal plan delivery for busy people', intent: 'discovery' },
      ],
      { brandTerms: ['Acme'], min: 1, minPerIntent: 0 },
    );
    assert.equal(result.accepted.length, 1);
    assert.equal(result.accepted[0].text, 'best meal plan delivery for busy people');
    assert.match(result.rejected[0].reason, /branded/);
  });

  test('matching is word-boundary aware, so a brand that is a common word is safe', () => {
    const result = validatePanel(
      [{ text: 'otherwise how do teams handle cross border payroll', intent: 'implementation' }],
      { brandTerms: ['Wise'], min: 1, minPerIntent: 0 },
    );
    assert.equal(result.accepted.length, 1);
  });

  test('aliases are excluded too', () => {
    const result = validatePanel(
      [
        { text: 'how does Acme Meals recommend planning a week', intent: 'implementation' },
        { text: 'what is the usual process for planning meals for a week', intent: 'implementation' },
      ],
      { brandTerms: ['Acme', 'Acme Meals'], min: 1, minPerIntent: 0 },
    );
    assert.equal(result.accepted.length, 1);
    assert.equal(result.rejected.length, 1);
  });
});

describe('validatePanel structural rules', () => {
  test('keyword strings are rejected, they are not buyer questions', () => {
    const result = validatePanel(
      [
        { text: 'best crm', intent: 'discovery' },
        { text: 'what is the best crm for a small agency', intent: 'discovery' },
      ],
      { brandTerms: [], min: 1, minPerIntent: 0 },
    );
    assert.equal(result.accepted.length, 1);
    assert.match(result.rejected[0].reason, /too short/);
  });

  test('duplicates are collapsed regardless of case, spacing and trailing punctuation', () => {
    const result = validatePanel(
      [
        { text: 'what is the best crm for a small agency', intent: 'discovery' },
        { text: 'What is the  best CRM for a small agency?', intent: 'discovery' },
      ],
      { brandTerms: [], min: 1, minPerIntent: 0 },
    );
    assert.equal(result.accepted.length, 1);
    assert.match(result.rejected[0].reason, /duplicate/);
  });

  test('an unknown intent is rejected rather than silently bucketed', () => {
    const result = validatePanel(
      [{ text: 'how do teams choose a payments provider', intent: 'pricing' as PromptIntent }],
      { brandTerms: [], min: 1, minPerIntent: 0 },
    );
    assert.equal(result.accepted.length, 0);
    assert.match(result.rejected[0].reason, /unknown intent/);
  });
});

describe('validatePanel balance', () => {
  test('a discovery-only panel is not balanced, which is the trap this exists to catch', () => {
    assert.equal(validatePanel(spread(30, 'discovery'), { brandTerms: [] }).balanced, false);
  });

  test('an even spread across all four intents is balanced and trimmed to the panel size', () => {
    const result = validatePanel(fullPanel(), { brandTerms: [] });
    assert.equal(result.balanced, true);
    assert.equal(result.accepted.length, 20);
  });

  test('too few prompts is not balanced even when every intent is present', () => {
    assert.equal(validatePanel(INTENTS.flatMap((i) => spread(2, i, `${i} q`)), { brandTerms: [] }).balanced, false);
  });

  test('a panel at the floor is accepted', () => {
    const result = validatePanel(INTENTS.flatMap((i) => spread(3, i, `${i} q`)), { brandTerms: [] });
    assert.equal(result.accepted.length, 12);
    assert.equal(result.balanced, true);
  });

  test('trimming to max keeps the intent mix instead of cutting the last intent entirely', () => {
    const candidates = INTENTS.flatMap((i) => spread(20, i, `${i} q`));
    const result = validatePanel(candidates, { brandTerms: [], max: 12 });
    assert.equal(result.accepted.length, 12);
    for (const intent of INTENTS) assert.equal(result.accepted.filter((p) => p.intent === intent).length, 3);
  });

  test('trimming still fills to max when one intent is short', () => {
    const candidates = [...spread(10, 'discovery'), ...spread(1, 'comparison', 'cmp')];
    assert.equal(validatePanel(candidates, { brandTerms: [], max: 6 }).accepted.length, 6);
  });
});

describe('buildInstruction', () => {
  test('tells the model never to name the company', () => {
    assert.match(buildInstruction('Acme', 'site text'), /Never name "Acme"/);
  });

  test('carries the company note when one is given, and not otherwise', () => {
    assert.match(buildInstruction('Acme', 'site text', 'buyers are in Riyadh'), /buyers are in Riyadh/);
    assert.doesNotMatch(buildInstruction('Acme', 'site text', '   '), /NOTE FROM THE COMPANY/);
  });
});
