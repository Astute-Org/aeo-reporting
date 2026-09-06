import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics, rate, type AnswerRecord, type ObservationRecord, type PromptRecord } from './metrics.js';

const prompts: PromptRecord[] = [
  { id: 'p1', intent: 'discovery' },
  { id: 'p2', intent: 'validation' },
];

function answer(id: string, promptId: string, engine = 'openai', status: 'ok' | 'failed' = 'ok'): AnswerRecord {
  return { id, promptId, engine, status };
}

describe('computeMetrics denominators', () => {
  test('a rate with no evidence is null, never zero', () => {
    const m = computeMetrics([], [], prompts);
    assert.equal(m.citationRate.value, null);
    assert.equal(m.mentionRate.value, null);
    assert.equal(m.shareOfVoice.value, null);
    assert.equal(m.meanPosition, null);
  });

  test('failed answers are excluded from denominators, so a vendor outage is not a miss', () => {
    const answers = [answer('a1', 'p1'), answer('a2', 'p1', 'openai', 'failed')];
    const obs: ObservationRecord[] = [{ answerId: 'a1', kind: 'cited', subject: 'company' }];
    const m = computeMetrics(answers, obs, prompts);
    assert.equal(m.answers, 1);
    assert.equal(m.citationRate.value, 1);
    assert.equal(m.citationRate.n, 1);
  });

  test('observations attached to a failed answer are ignored', () => {
    const m = computeMetrics([answer('a1', 'p1', 'openai', 'failed')], [{ answerId: 'a1', kind: 'cited', subject: 'company' }], prompts);
    assert.equal(m.citationRate.value, null);
  });

  test('one answer with three cited urls counts once, not three times', () => {
    const answers = [answer('a1', 'p1'), answer('a2', 'p2')];
    const obs: ObservationRecord[] = [
      { answerId: 'a1', kind: 'cited', subject: 'company' },
      { answerId: 'a1', kind: 'cited', subject: 'company' },
      { answerId: 'a1', kind: 'cited', subject: 'company' },
    ];
    const m = computeMetrics(answers, obs, prompts);
    assert.equal(m.citationRate.hits, 1);
    assert.equal(m.citationRate.value, 0.5);
  });
});

describe('selectionRate separates a findability problem from a content problem', () => {
  test('retrieved but never cited is a selection failure, not an indexing one', () => {
    const answers = [answer('a1', 'p1'), answer('a2', 'p2')];
    const obs: ObservationRecord[] = [
      { answerId: 'a1', kind: 'retrieved', subject: 'company' },
      { answerId: 'a2', kind: 'retrieved', subject: 'company' },
    ];
    const m = computeMetrics(answers, obs, prompts);
    assert.equal(m.retrievalRate.value, 1);
    assert.equal(m.citationRate.value, 0);
    assert.equal(m.selectionRate.value, 0);
  });

  test('never retrieved leaves selectionRate null rather than implying a content failure', () => {
    const m = computeMetrics([answer('a1', 'p1')], [], prompts);
    assert.equal(m.retrievalRate.value, 0);
    assert.equal(m.selectionRate.value, null);
  });
});

describe('shareOfVoice', () => {
  test('is measured against the declared competitor set only', () => {
    const obs: ObservationRecord[] = [
      { answerId: 'a1', kind: 'unlinked_mention', subject: 'company', label: 'Acme' },
      { answerId: 'a1', kind: 'unlinked_mention', subject: 'competitor', label: 'Rival A' },
      { answerId: 'a1', kind: 'unlinked_mention', subject: 'competitor', label: 'Rival B' },
    ];
    assert.equal(computeMetrics([answer('a1', 'p1')], obs, prompts).shareOfVoice.value, 1 / 3);
  });

  test('is null, never 100%, when no competitor was recorded at all', () => {
    const obs: ObservationRecord[] = [{ answerId: 'a1', kind: 'unlinked_mention', subject: 'company', label: 'Acme' }];
    assert.equal(computeMetrics([answer('a1', 'p1')], obs, prompts).shareOfVoice.value, null);
  });
});

describe('promptCoverage vs answer rate', () => {
  test('coverage counts a question once however many repeats hit', () => {
    const answers = [answer('a1', 'p1'), answer('a2', 'p1'), answer('a3', 'p2')];
    const obs: ObservationRecord[] = [
      { answerId: 'a1', kind: 'cited', subject: 'company' },
      { answerId: 'a2', kind: 'cited', subject: 'company' },
    ];
    const m = computeMetrics(answers, obs, prompts);
    assert.equal(m.citationRate.value, 2 / 3);
    assert.equal(m.promptCoverage.value, 1 / 2);
  });
});

describe('breakdowns', () => {
  test('per intent, so a discovery-only panel cannot hide a weak result', () => {
    const m = computeMetrics([answer('a1', 'p1'), answer('a2', 'p2')], [{ answerId: 'a2', kind: 'cited', subject: 'company' }], prompts);
    assert.equal(m.byIntent.discovery.value, 0);
    assert.equal(m.byIntent.validation.value, 1);
    assert.equal(m.byIntent.comparison.value, null);
  });

  test('per engine, because engines do not share an index', () => {
    const m = computeMetrics(
      [answer('a1', 'p1', 'openai'), answer('a2', 'p1', 'perplexity')],
      [{ answerId: 'a2', kind: 'cited', subject: 'company' }],
      prompts,
    );
    assert.equal(m.byEngine.openai.value, 0);
    assert.equal(m.byEngine.perplexity.value, 1);
  });

  test('mean position averages only the positions the judge recorded', () => {
    const obs: ObservationRecord[] = [
      { answerId: 'a1', kind: 'unlinked_mention', subject: 'company', position: 1 },
      { answerId: 'a2', kind: 'unlinked_mention', subject: 'company', position: 3 },
      { answerId: 'a3', kind: 'unlinked_mention', subject: 'company', position: null },
    ];
    const m = computeMetrics([answer('a1', 'p1'), answer('a2', 'p1'), answer('a3', 'p2')], obs, prompts);
    assert.equal(m.meanPosition, 2);
  });
});

describe('confidence', () => {
  test('a rate carries the n it rests on and a Wilson interval', () => {
    const answers = Array.from({ length: 100 }, (_u, i) => answer(`a${i}`, 'p1'));
    const obs: ObservationRecord[] = answers.slice(0, 40).map((a) => ({ answerId: a.id, kind: 'cited' as const, subject: 'company' as const }));
    const m = computeMetrics(answers, obs, prompts);
    assert.equal(m.citationRate.value, 0.4);
    assert.equal(m.citationRate.n, 100);
    assert.ok(m.citationRate.ci95);
    assert.ok(m.citationRate.ci95![0] > 0.3 && m.citationRate.ci95![1] < 0.5);
  });

  test('an interval at the boundary is wide, not a point', () => {
    const [lo, hi] = rate(1, 1).ci95!;
    assert.ok(hi - lo > 0.5, `1/1 interval should be wide, got [${lo}, ${hi}]`);
    const [zlo, zhi] = rate(0, 1).ci95!;
    assert.ok(zhi - zlo > 0.5);
  });

  test('more evidence means a tighter interval', () => {
    const width = (r: ReturnType<typeof rate>) => (r.ci95 ? r.ci95[1] - r.ci95[0] : 0);
    assert.ok(width(rate(2, 8)) > width(rate(50, 200)));
  });
});
