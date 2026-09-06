import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantBars, QuestionStrip, StandingTrend, assistantName } from './Charts';
import type { StandingTrendPoint } from './types';

function prompt(id: string, intent: string, hit = false) {
  return { id, text: `question ${id}`, intent, mentioned: hit ? 1 : 0, cited: 0 };
}

function point(over: Partial<StandingTrendPoint> = {}): StandingTrendPoint {
  return { runId: 'r1', startedAt: '2026-08-01T00:00:00.000Z', panelVersion: 1, companyRank: 2, entrants: 5, questionsMentioned: 4, totalQuestions: 20, ...over };
}

describe('assistantName', () => {
  it('says the name the reader knows', () => {
    assert.equal(assistantName('openai'), 'ChatGPT');
    assert.equal(assistantName('perplexity'), 'Perplexity');
  });

  it('passes an unknown engine through rather than blanking it', () => {
    assert.equal(assistantName('some-new-engine'), 'some-new-engine');
  });
});

describe('QuestionStrip', () => {
  it('orders the groups along the buyer journey', () => {
    const html = renderToStaticMarkup(<QuestionStrip prompts={[prompt('1', 'validation'), prompt('2', 'discovery'), prompt('3', 'comparison')]} />);
    assert.ok(html.indexOf('Finding options') < html.indexOf('Comparing options'));
    assert.ok(html.indexOf('Comparing options') < html.indexOf('Checking you out'));
  });

  it('sorts an unrecognised intent last instead of first', () => {
    const html = renderToStaticMarkup(<QuestionStrip prompts={[prompt('1', 'wildcard'), prompt('2', 'discovery')]} />);
    assert.ok(html.indexOf('Finding options') < html.indexOf('wildcard'));
  });

  it('names a total shutout as the finding it is', () => {
    const html = renderToStaticMarkup(<QuestionStrip prompts={[prompt('1', 'comparison'), prompt('2', 'comparison')]} />);
    assert.match(html, /not showing up at all/);
    assert.match(html, /0 of 2/);
  });

  it('does not call an intent a shutout when it has a hit', () => {
    const html = renderToStaticMarkup(<QuestionStrip prompts={[prompt('1', 'comparison', true), prompt('2', 'comparison')]} />);
    assert.doesNotMatch(html, /not showing up at all/);
    assert.match(html, /1 of 2/);
  });

  it('renders nothing when there are no questions', () => {
    assert.equal(renderToStaticMarkup(<QuestionStrip prompts={[]} />), '');
  });
});

describe('AssistantBars', () => {
  it('draws no bar at all for an unmeasured assistant', () => {
    const html = renderToStaticMarkup(<AssistantBars byEngine={{ gemini: { value: null, hits: 0, n: 0 } }} />);
    assert.match(html, /not measured/);
    assert.doesNotMatch(html, /width:/);
  });

  it('draws a measured zero as a real row with its denominator', () => {
    const html = renderToStaticMarkup(<AssistantBars byEngine={{ openai: { value: 0, hits: 0, n: 20 } }} />);
    assert.match(html, /0 of 20/);
    assert.doesNotMatch(html, /not measured/);
  });

  it('puts the strongest assistant first', () => {
    const html = renderToStaticMarkup(
      <AssistantBars byEngine={{ openai: { value: 0.1, hits: 2, n: 20 }, perplexity: { value: 0.6, hits: 12, n: 20 } }} />,
    );
    assert.ok(html.indexOf('Perplexity') < html.indexOf('ChatGPT'));
  });
});

describe('StandingTrend', () => {
  it('renders nothing at all when there is nothing to plot', () => {
    assert.equal(renderToStaticMarkup(<StandingTrend points={[]} />), '');
  });

  it('draws a wall where the questions changed, labelled with the new version', () => {
    const html = renderToStaticMarkup(
      <StandingTrend points={[point({ runId: 'r1', panelVersion: 1 }), point({ runId: 'r2', panelVersion: 2, startedAt: '2026-08-11T00:00:00.000Z' })]} />,
    );
    assert.match(html, /stroke-dasharray="4 3"/);
    assert.ok(html.includes('>v2</text>'));
  });

  it('draws no wall when the panel never changed', () => {
    const html = renderToStaticMarkup(<StandingTrend points={[point({ runId: 'r1' }), point({ runId: 'r2', startedAt: '2026-08-11T00:00:00.000Z' })]} />);
    assert.ok(!html.includes('stroke-dasharray="4 3"'));
  });

  it('draws no wall across a version it could not determine', () => {
    const html = renderToStaticMarkup(
      <StandingTrend points={[point({ runId: 'r1', panelVersion: 0 }), point({ runId: 'r2', panelVersion: 2, startedAt: '2026-08-11T00:00:00.000Z' })]} />,
    );
    assert.ok(!html.includes('stroke-dasharray="4 3"'));
  });

  it('puts a not-mentioned reading on the chart as a hollow point, not a gap', () => {
    const html = renderToStaticMarkup(<StandingTrend points={[point({ runId: 'r1', companyRank: null, questionsMentioned: 0, entrants: 3 })]} />);
    assert.match(html, /<circle/);
    assert.match(html, /fill="var\(--color-surface\)"/);
    assert.match(html, /not mentioned/);
  });

  it('breaks the line where the panel size is unknown, rather than drawing through it', () => {
    const html = renderToStaticMarkup(
      <StandingTrend
        points={[
          point({ runId: 'r1' }),
          point({ runId: 'r2', totalQuestions: 0, questionsMentioned: 0, startedAt: '2026-08-11T00:00:00.000Z' }),
          point({ runId: 'r3', startedAt: '2026-08-21T00:00:00.000Z' }),
        ]}
      />,
    );
    assert.equal((html.match(/<path /g) ?? []).length, 2);
  });

  it('summarises the latest reading in words under the chart', () => {
    const html = renderToStaticMarkup(
      <StandingTrend points={[point({ runId: 'r1', companyRank: 4 }), point({ runId: 'r2', companyRank: 2, entrants: 6, questionsMentioned: 7, startedAt: '2026-08-11T00:00:00.000Z' })]} />,
    );
    assert.match(html, /rank 2 of 6/);
    assert.match(html, /7 of 20 questions/);
  });

  it('survives a single reading and a flat series of zeroes without NaN', () => {
    assert.ok(!renderToStaticMarkup(<StandingTrend points={[point()]} />).includes('NaN'));
    const flat = renderToStaticMarkup(
      <StandingTrend points={[point({ runId: 'r1', questionsMentioned: 0, companyRank: null }), point({ runId: 'r2', questionsMentioned: 0, companyRank: null, startedAt: '2026-08-11T00:00:00.000Z' })]} />,
    );
    assert.ok(!flat.includes('NaN') && !flat.includes('Infinity'));
  });
});
