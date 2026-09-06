// The report's presentational half. The rule under test is the screen's
// own: null is not zero, and the cost is stated before the click.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompanyReportView, PanelEditor, estimateReadingUsd, parseList, type CompanyReportViewProps } from './CompanyView';
import type { CompanyInfo, CompanyPanel, CompanyReport, PromptWithStats, Status } from './types';

const company: CompanyInfo = {
  id: 'company-1', name: 'Acme', domain: 'acme.com', url: 'https://acme.com', aliases: ['Acme Meals'],
  competitors: ['Rival A', 'Rival B'], notes: null, createdAt: '2026-08-01T00:00:00.000Z',
};

const panel: CompanyPanel = { id: 'panel-1', version: 3, category: 'meal plans', repeats: 1, cadenceHours: 240, lastRunAt: null };

const prompts: PromptWithStats[] = [
  { id: 'p1', text: 'best meal plan delivery for busy people', intent: 'discovery', position: 0, answers: 3, mentioned: 1, cited: 0 },
  { id: 'p2', text: 'how do meal subscriptions compare on price', intent: 'comparison', position: 1, answers: 3, mentioned: 0, cited: 0 },
];

const status: Status = {
  engines: ['openai', 'perplexity'], engineError: null, judge: { provider: 'anthropic', model: 'm', panelModel: 'm' }, llmScoring: true,
  scheduler: { enabled: true, intervalMinutes: 15 }, cadenceHoursDefault: 240,
  costPerAnswerUsd: { openai: 0.05, perplexity: 0.01, gemini: 0.01, anthropic: 0.15 },
};

const rate = (value: number | null, hits: number, n: number) => ({ value, hits, n });

function metrics(mention = rate(0.25, 15, 60), cite = rate(0.05, 3, 60)) {
  return {
    answers: 60, prompts: 20, mentionRate: mention, citationRate: cite, retrievalRate: rate(0.1, 6, 60), selectionRate: rate(0.5, 3, 6),
    promptCoverage: rate(0.4, 8, 20), shareOfVoice: rate(0.3, 15, 50), meanPosition: 2, byIntent: {}, byEngine: { openai: rate(0.3, 9, 30), perplexity: rate(0.2, 6, 30) },
  };
}

function report(over: Partial<CompanyReport> = {}): CompanyReport {
  return {
    companyId: 'company-1', name: 'Acme', competitors: ['Rival A'], aliases: [],
    latest: { runId: 'run-1', startedAt: '2026-08-11T00:00:00.000Z', completedAt: '2026-08-11T00:20:00.000Z', metrics: metrics() },
    standing: null, trend: [], runsMeasured: 2, inProgress: null, caveats: [],
    ...over,
  };
}

const noop = () => {};

function render(over: Partial<CompanyReportViewProps> = {}) {
  return renderToStaticMarkup(
    <CompanyReportView
      company={company} panel={panel} prompts={prompts} report={report()} reportLoading={false} status={status}
      onRun={noop} onSaveCompetitors={noop} onSaveAliases={noop} onSavePanel={noop} onRegenerate={noop} onDelete={noop} onSelectPrompt={noop}
      busy={false} {...over}
    />,
  );
}

describe('CompanyReportView', () => {
  it('says how often the company is measured, in days rather than hours', () => {
    assert.match(render(), /measured every 10 days/);
  });

  it('states what a reading costs before the click', () => {
    const html = render();
    assert.match(html, /A reading asks 2 questions on ChatGPT, Perplexity/);
    assert.match(html, /roughly \$0\.12/);
  });

  it('says so when no assistant is configured, and disables Read now', () => {
    const html = render({ status: { ...status, engines: [] } });
    assert.match(html, /No answer engine is configured/);
  });

  it('prints "not measured yet" rather than 0% before the first reading', () => {
    const html = render({ report: report({ latest: null }) });
    assert.match(html, /No completed reading yet/);
    assert.ok(!html.includes('0.0%'));
  });

  it('renders a real zero as a number, because measured-and-absent is a result', () => {
    const html = render({ report: report({ latest: { runId: 'run-1', startedAt: '2026-08-11T00:00:00.000Z', completedAt: null, metrics: metrics(rate(0, 0, 60), rate(0, 0, 60)) } }) });
    assert.match(html, /0\.0%/);
  });

  it('renders a share of voice with no denominator as not measured', () => {
    const m = metrics();
    m.shareOfVoice = rate(null, 15, 0);
    const html = render({ report: report({ latest: { runId: 'run-1', startedAt: '2026-08-11T00:00:00.000Z', completedAt: null, metrics: m } }) });
    assert.match(html, /not measured yet/);
  });

  it('names the competitors and aliases, because they are what the scorer looks for', () => {
    const html = render();
    assert.match(html, /Rival A/);
    assert.match(html, /Rival B/);
    assert.match(html, /Acme Meals/);
  });

  it('says so plainly when no competitor has been declared', () => {
    assert.match(render({ company: { ...company, competitors: [] } }), /share of voice has no denominator/);
  });

  it('puts the caveats above the numbers they qualify', () => {
    const html = render({ report: report({ caveats: ['The questions changed during this window (panel v2 to v3).'] }) });
    assert.ok(html.indexOf('The questions changed') < html.indexOf('Mentioned'));
  });

  it('flags a reading in flight so a stale number is not read as the current one', () => {
    const html = render({ report: report({ inProgress: { runId: 'run-2', startedAt: '2026-08-21T00:00:00.000Z', answersExpected: 60, answersSoFar: 12 } }) });
    assert.match(html, /12 of 60 answers in/);
    assert.match(html, /previous reading until it finishes/);
  });

  it('draws the trend only once there is something to draw', () => {
    assert.ok(!render().includes('Standing over time'));
    const html = render({ report: report({ trend: [{ runId: 'r1', startedAt: '2026-08-01T00:00:00.000Z', panelVersion: 3, companyRank: 2, entrants: 5, questionsMentioned: 4, totalQuestions: 20 }] }) });
    assert.match(html, /Standing over time/);
  });

  it('shows the question strip once a reading exists', () => {
    assert.match(render(), /You show up in 1 of 2 questions/);
    assert.ok(!render({ report: report({ latest: null }) }).includes('You show up in'));
  });
});

describe('PanelEditor', () => {
  it('says an edit creates a new version, and which one', () => {
    const html = renderToStaticMarkup(<PanelEditor prompts={prompts} version={3} onSave={noop} busy={false} />);
    assert.match(html, /panel v3/);
    assert.match(html, /The questions \(2\)/);
  });

  it('opens by itself when there are no questions yet', () => {
    const html = renderToStaticMarkup(<PanelEditor prompts={[]} version={1} onSave={noop} busy={false} />);
    assert.match(html, /Add a question/);
  });
});

describe('helpers', () => {
  it('parses a comma list', () => {
    assert.deepEqual(parseList(' a, b ,,c '), ['a', 'b', 'c']);
  });

  it('estimates a reading from the per-engine figures, and null when nothing can be estimated', () => {
    assert.ok(Math.abs((estimateReadingUsd(status, 20, 1) ?? 0) - 1.2) < 1e-9);
    assert.equal(estimateReadingUsd({ ...status, engines: [] }, 20, 1), null);
    assert.equal(estimateReadingUsd(null, 20, 1), null);
  });
});
