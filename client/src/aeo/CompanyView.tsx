// The company report, as pure rendering.
//
// Everything below renders from props: no fetching, no toasts, no effects
// except the editors' own draft state. That is what lets the rules worth
// pinning - null is never rendered as zero, caveats sit above the numbers
// they qualify, the cost is stated before the click - be tested with a plain
// node test and no browser.

import { useEffect, useState } from 'react';
import { Play, Plus, Trash2, ChevronDown, ChevronRight, RefreshCw, ExternalLink } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { TextInput } from '../ui/Input';
import { AssistantBars, INTENT_LABEL, QuestionStrip, StandingTrend, assistantName } from './Charts';
import { CompanyStanding } from './Standing';
import type { CompanyInfo, CompanyPanel, CompanyReport, PromptWithStats, RateValue, Status } from './types';

const INTENTS = ['discovery', 'comparison', 'validation', 'implementation'] as const;

function Tile({ label, rate, hint }: { label: string; rate: RateValue | null | undefined; hint: string }) {
  return (
    <div className="flex-1 min-w-[150px]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-mid">{label}</div>
      <div className="text-[22px] font-medium text-ink mt-1 tabular-nums">
        {/* Muted words, never a number we do not have. */}
        {rate && rate.value !== null
          ? `${(rate.value * 100).toFixed(1)}%`
          : <span className="text-[15px] text-ink-light">not measured yet</span>}
      </div>
      <div className="text-[11.5px] text-ink-light mt-0.5">
        {rate && rate.value !== null ? `${rate.hits} of ${rate.n} · ${hint}` : hint}
      </div>
    </div>
  );
}

/** Comma-separated in, trimmed list out. */
export function parseList(raw: string): string[] {
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

/** What one reading would cost, from the per-engine figures the server reports. */
export function estimateReadingUsd(status: Status | null, questions: number, repeats: number): number | null {
  if (!status || !status.engines.length || !questions) return null;
  const perAnswerSet = status.engines.reduce((sum, e) => sum + (status.costPerAnswerUsd[e] ?? 0.03), 0);
  return perAnswerSet * questions * repeats;
}

/** An inline list editor: chips, then a text field on "edit". */
function ListEditor({
  label, values, emptyText, placeholder, onSave, busy,
}: {
  label: string;
  values: string[];
  emptyText: string;
  placeholder: string;
  onSave: (values: string[]) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(values.join(', '));

  useEffect(() => { setDraft(values.join(', ')); }, [values]);

  return (
    <div className="text-[12.5px]">
      <span className="text-ink-mid">{label}: </span>
      {editing ? (
        <span className="inline-flex items-center gap-2 mt-1 flex-wrap">
          <TextInput value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} className="w-[360px]" />
          <Button onClick={() => { onSave(parseList(draft)); setEditing(false); }} disabled={busy}>Save</Button>
          <Button variant="ghost" onClick={() => { setDraft(values.join(', ')); setEditing(false); }}>Cancel</Button>
        </span>
      ) : (
        <>
          {values.length ? (
            <span className="inline-flex flex-wrap gap-1.5 align-middle">
              {values.map((v) => <span key={v} className="rounded-pill bg-bg-alt px-2 py-0.5 text-[11.5px] text-ink-mid">{v}</span>)}
            </span>
          ) : (
            <span className="text-ink-light">{emptyText}</span>
          )}
          <button type="button" onClick={() => setEditing(true)} className="ml-2 text-[12px] text-ink-light underline hover:text-ink-mid">edit</button>
        </>
      )}
    </div>
  );
}

/**
 * The panel editor. Every save is a new version, and the copy says so,
 * because an editor that looks like it is fixing a typo while silently
 * splitting the trend line in two is the most confusing thing this screen
 * could do.
 */
export function PanelEditor({
  prompts, version, onSave, onRegenerate, busy,
}: {
  prompts: { text: string; intent: string }[];
  version: number;
  onSave: (rows: { text: string; intent: string }[]) => void;
  onRegenerate?: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(prompts.length === 0);
  const [rows, setRows] = useState(() => prompts.map((p) => ({ text: p.text, intent: p.intent })));

  useEffect(() => {
    setRows(prompts.map((p) => ({ text: p.text, intent: p.intent })));
  }, [prompts]);

  const dirty = rows.length !== prompts.length || rows.some((r, i) => r.text !== prompts[i]?.text || r.intent !== prompts[i]?.intent);

  return (
    <div className="border-t border-border pt-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-[13px] font-medium text-ink hover:text-ink-mid">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        The questions ({prompts.length}) · panel v{version}
      </button>

      {open && (
        <div className="mt-3">
          <div className="text-[12px] text-ink-mid mb-2.5 leading-[1.5]">
            These are asked of every assistant, every reading. Saving creates <strong>v{version + 1}</strong>: past readings stay
            attached to v{version}, and the trend marks where the questions changed. Avoid naming the company - a question that
            names you almost always surfaces you, so it reads as a win without measuring one.
          </div>

          <div className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-[11px] tabular-nums text-ink-light">{i + 1}</span>
                <TextInput
                  value={row.text}
                  onChange={(e) => setRows(rows.map((r, n) => (n === i ? { ...r, text: e.target.value } : r)))}
                  placeholder="what a buyer would type into ChatGPT"
                  className="flex-1"
                />
                <select
                  value={row.intent}
                  onChange={(e) => setRows(rows.map((r, n) => (n === i ? { ...r, intent: e.target.value } : r)))}
                  className="h-10 rounded-input border border-border bg-surface px-2 text-[12.5px] text-ink"
                  aria-label={`Kind of question ${i + 1}`}
                >
                  {INTENTS.map((intent) => <option key={intent} value={intent}>{INTENT_LABEL[intent].title}</option>)}
                </select>
                <button
                  type="button"
                  aria-label={`Remove question ${i + 1}`}
                  onClick={() => setRows(rows.filter((_r, n) => n !== i))}
                  className="text-ink-light hover:text-error p-1"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Button variant="ghost" onClick={() => setRows([...rows, { text: '', intent: 'discovery' }])}>
              <Plus size={14} /> Add a question
            </Button>
            {onRegenerate && (
              <Button variant="ghost" onClick={onRegenerate} disabled={busy} title="Ask the model for a fresh set of questions from the website, as a new version">
                <RefreshCw size={14} /> Regenerate from the website
              </Button>
            )}
            <Button onClick={() => onSave(rows)} disabled={busy || !dirty}>
              {busy ? 'Saving...' : `Save as v${version + 1}`}
            </Button>
            {dirty && <span className="text-[12px] text-ink-light">Unsaved changes</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export interface CompanyReportViewProps {
  company: CompanyInfo;
  panel: CompanyPanel | null;
  prompts: PromptWithStats[];
  report: CompanyReport | null;
  reportLoading: boolean;
  status: Status | null;
  onRun: () => void;
  onSaveCompetitors: (competitors: string[]) => void;
  onSaveAliases: (aliases: string[]) => void;
  onSavePanel: (rows: { text: string; intent: string }[]) => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onSelectPrompt: (promptId: string) => void;
  busy: boolean;
}

/** The report, given the data. */
export function CompanyReportView({
  company, panel, prompts, report, reportLoading, status,
  onRun, onSaveCompetitors, onSaveAliases, onSavePanel, onRegenerate, onDelete, onSelectPrompt, busy,
}: CompanyReportViewProps) {
  const cadenceDays = panel ? Math.round(panel.cadenceHours / 24) : 10;
  const m = report?.latest?.metrics;
  const estimate = estimateReadingUsd(status, prompts.length, panel?.repeats ?? 1);
  const engines = status?.engines ?? [];

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[20px] font-medium text-ink" style={{ fontFamily: 'var(--font-display)' }}>{company.name}</div>
          <div className="text-[12px] text-ink-light mt-0.5 flex items-center gap-1.5 flex-wrap">
            {company.url && (
              <a href={company.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink-mid">
                {company.domain ?? company.url} <ExternalLink size={11} />
              </a>
            )}
            {company.url && <span>·</span>}
            <span>measured every {cadenceDays} days</span>
            {report && <span>· {report.runsMeasured} reading{report.runsMeasured === 1 ? '' : 's'} so far</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="danger" onClick={onDelete} disabled={busy} title="Delete this company and every reading">
            <Trash2 size={14} />
          </Button>
          <Button variant="secondary" onClick={onRun} disabled={busy || Boolean(report?.inProgress) || !engines.length}>
            <Play size={14} /> Read now
          </Button>
        </div>
      </div>

      {/* The cost, stated before the click. */}
      <div className="text-[11.5px] text-ink-light mt-1.5">
        {engines.length
          ? `A reading asks ${prompts.length} questions on ${engines.map(assistantName).join(', ')}${(panel?.repeats ?? 1) > 1 ? `, ${panel!.repeats} times each` : ''}` +
            (estimate !== null ? `, roughly $${estimate.toFixed(2)} in API calls.` : '.')
          : 'No answer engine is configured, so no reading can be taken. Set an API key on the server.'}
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        {/* Competitors are the share-of-voice denominator, so they sit on the
            face of the card rather than in a settings drawer. */}
        <ListEditor
          label="Measured against"
          values={company.competitors}
          emptyText="nobody yet - share of voice has no denominator"
          placeholder="Comma-separated competitor names"
          onSave={onSaveCompetitors}
          busy={busy}
        />
        <ListEditor
          label="Also known as"
          values={company.aliases}
          emptyText="no aliases"
          placeholder="Other names the company answers to"
          onSave={onSaveAliases}
          busy={busy}
        />
      </div>

      {report?.inProgress && (
        <div className="mt-3 rounded-input border border-accent-border bg-accent-soft px-3 py-2 text-[12.5px] text-ink-mid">
          A reading is running now - {report.inProgress.answersSoFar}
          {report.inProgress.answersExpected ? ` of ${report.inProgress.answersExpected}` : ''} answers in.
          The numbers below are the previous reading until it finishes.
        </div>
      )}

      {/* Caveats above the numbers: each one is a reason a figure below could
          be misread as a result. */}
      {report?.caveats.map((c) => (
        <div key={c} className="mt-2 text-[12px] text-ink-light leading-[1.5]">{c}</div>
      ))}

      {reportLoading && !report && <div className="mt-4 text-[12.5px] text-ink-light">Loading readings...</div>}

      {report && !report.latest && !reportLoading && !report.inProgress && (
        <div className="mt-4 text-[12.5px] text-ink-light">
          No completed reading yet. {status?.scheduler.enabled ? 'The first one runs on the next scheduler tick, or press Read now.' : 'Press Read now to take the first one.'}
        </div>
      )}

      {m && (
        <div className="flex flex-wrap gap-5 mt-5">
          <Tile label="Mentioned" rate={m.mentionRate} hint="answers naming this company" />
          <Tile label="Cited" rate={m.citationRate} hint="answers linking its site as a source" />
          <Tile label="Share of voice" rate={m.shareOfVoice} hint="of all tracked brand mentions" />
          <Tile label="Questions covered" rate={m.promptCoverage} hint="questions with any mention" />
        </div>
      )}

      {report?.standing && (
        <div className="mt-6">
          <CompanyStanding standing={report.standing} />
        </div>
      )}

      {report && report.trend.length > 0 && (
        <div className="mt-6">
          <StandingTrend points={report.trend} />
        </div>
      )}

      {m && Object.keys(m.byEngine).length > 0 && (
        <div className="mt-6">
          <AssistantBars byEngine={m.byEngine} />
        </div>
      )}

      {prompts.length > 0 && report?.latest && (
        <div className="mt-6">
          <QuestionStrip prompts={prompts} onSelect={onSelectPrompt} />
        </div>
      )}

      {panel && (
        <div className="mt-6">
          <PanelEditor prompts={prompts} version={panel.version} onSave={onSavePanel} onRegenerate={onRegenerate} busy={busy} />
        </div>
      )}
    </Card>
  );
}
