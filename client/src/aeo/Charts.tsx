// Three charts, one question each.
//
//   AssistantBars   who is talking about me?
//   QuestionStrip   which questions am I invisible on?
//   StandingTrend   is it moving?
//
// All plain SVG and CSS. A charting library would add a dependency for
// three shapes that are each under fifty lines.

import type { RateValue, StandingTrendPoint } from './types';

/**
 * Say the assistant's name. "openai" is our vocabulary, not the reader's:
 * everyone knows ChatGPT, and a label they have to decode gets skipped.
 */
const ASSISTANT_NAME: Record<string, string> = {
  openai: 'ChatGPT',
  perplexity: 'Perplexity',
  gemini: 'Gemini',
  anthropic: 'Claude',
};

export function assistantName(key: string): string {
  return ASSISTANT_NAME[key] ?? key;
}

export function Heading({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-mid mb-2.5">{children}</div>;
}

/**
 * Which assistants are talking about the company.
 *
 * Bars rather than a rate grid because the comparison IS the finding: the
 * assistants do not share an index, so being strong on one and absent on
 * another is the normal case and the thing worth seeing.
 */
export function AssistantBars({ byEngine }: { byEngine: Record<string, RateValue> }) {
  const rows = Object.entries(byEngine)
    .map(([key, r]) => ({ key, name: assistantName(key), r }))
    .sort((a, b) => (b.r.value ?? -1) - (a.r.value ?? -1));

  if (rows.length === 0) return null;

  return (
    <div>
      <Heading>Which assistants mention you</Heading>
      <div className="flex flex-col gap-2">
        {rows.map(({ key, name, r }) => (
          <div key={key} className="flex items-center gap-3">
            <div className="w-[86px] shrink-0 text-[13px] text-ink">{name}</div>
            <div className="flex-1 h-5 rounded-[3px] bg-bg-alt overflow-hidden">
              {/* Null is not zero: an unmeasured assistant gets no bar at all
                  rather than an empty one, which would read as "asked and
                  found nothing". */}
              {r.value !== null && (
                <div className="h-full bg-ink-mid" style={{ width: `${Math.max(r.value * 100, 1.5)}%` }} />
              )}
            </div>
            <div className="w-[92px] shrink-0 text-right text-[12px] tabular-nums text-ink-mid">
              {r.value === null ? 'not measured' : `${r.hits} of ${r.n}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Intent, in the buyer's language rather than the schema's. Grouping is what
 * turns the strip from texture into a diagnosis: "Comparing options: 0 of 5"
 * is a reader understanding in four seconds that they are invisible exactly
 * where the purchase decision happens.
 */
export const INTENT_LABEL: Record<string, { title: string; blurb: string }> = {
  discovery: { title: 'Finding options', blurb: 'People asking who does this at all.' },
  comparison: { title: 'Comparing options', blurb: 'People weighing you against a rival. Where the decision happens.' },
  validation: { title: 'Checking you out', blurb: 'People who have your name and want to know if you are any good.' },
  implementation: { title: 'Getting started', blurb: 'People working out how to actually use it.' },
};

const INTENT_ORDER = ['discovery', 'comparison', 'validation', 'implementation'];

export function QuestionStrip({
  prompts, onSelect,
}: {
  prompts: { id: string; text: string; intent: string; mentioned: number; cited: number }[];
  onSelect?: (id: string) => void;
}) {
  if (prompts.length === 0) return null;
  const hits = prompts.filter((p) => p.mentioned > 0 || p.cited > 0).length;

  const groups = new Map<string, typeof prompts>();
  for (const p of prompts) {
    const key = p.intent || 'other';
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const rank = (intent: string) => {
    const i = INTENT_ORDER.indexOf(intent);
    return i === -1 ? INTENT_ORDER.length : i;
  };
  const ordered = [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));

  return (
    <div>
      <Heading>You show up in {hits} of {prompts.length} questions</Heading>

      <div className="flex flex-col gap-4">
        {ordered.map(([intent, items]) => {
          const got = items.filter((p) => p.mentioned > 0 || p.cited > 0).length;
          const meta = INTENT_LABEL[intent];
          return (
            <div key={intent}>
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="text-[13px] font-medium text-ink">{meta?.title ?? intent}</span>
                <span className="text-[12px] tabular-nums text-ink-mid">{got} of {items.length}</span>
                {/* A zero here is the finding, not a gap in the chart. */}
                {got === 0 && items.length > 0 && <span className="text-[11px] text-error">not showing up at all</span>}
              </div>
              {meta && <div className="text-[11.5px] text-ink-light mb-1.5">{meta.blurb}</div>}
              <div className="flex flex-wrap gap-[3px]">
                {items.map((p) => {
                  const cited = p.cited > 0;
                  const mentioned = p.mentioned > 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={onSelect ? () => onSelect(p.id) : undefined}
                      title={`${p.text}\n\nClick to read the answers`}
                      className={`h-6 w-6 rounded-[3px] transition-opacity hover:opacity-70 ${
                        cited ? 'bg-green' : mentioned ? 'bg-ink-mid' : 'bg-bg-alt border border-border'
                      }`}
                      aria-label={`${p.text} - ${cited ? 'linked' : mentioned ? 'named' : 'no mention'}`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 mt-3 text-[11px] text-ink-light">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px] bg-green" /> linked your site</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px] bg-ink-mid" /> named you</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px] bg-bg-alt border border-border" /> no mention</span>
      </div>
    </div>
  );
}

/**
 * How the company's standing has moved, reading by reading.
 *
 * TWO THINGS THIS CHART REFUSES TO DO. It does not smooth over a panel edit:
 * two points either side of one were measured on different question sets,
 * so the version change is drawn as a wall. And it does not confuse "not
 * mentioned" with "not measured": a reading where the company appeared in no
 * answer is a real, bad reading and sits on the floor as a hollow dot, while
 * a reading whose panel size is unknown cannot be placed and the line BREAKS.
 */
export function StandingTrend({ points }: { points: StandingTrendPoint[] }) {
  if (points.length === 0) return null;

  const W = 640;
  const H = 168;
  const PAD = { l: 34, r: 12, t: 12, b: 34 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const rateOf = (p: StandingTrendPoint) => (p.totalQuestions > 0 ? p.questionsMentioned / p.totalQuestions : null);

  const values = points.map(rateOf).filter((v): v is number => v !== null);
  const peak = Math.max(0.1, ...values) * 1.15;
  const x = (i: number) => PAD.l + (i * innerW) / Math.max(points.length - 1, 1);
  const y = (v: number) => PAD.t + (1 - v / peak) * innerH;

  const segments: { i: number; v: number }[][] = [];
  let current: { i: number; v: number }[] = [];
  points.forEach((p, i) => {
    const v = rateOf(p);
    if (v === null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({ i, v });
  });
  if (current.length) segments.push(current);

  const path = (pts: { i: number; v: number }[]) =>
    pts.map((d, n) => `${n === 0 ? 'M' : 'L'} ${x(d.i).toFixed(1)} ${y(d.v).toFixed(1)}`).join(' ');

  const boundaries = points
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i > 0 && p.panelVersion > 0 && points[i - 1].panelVersion > 0 && p.panelVersion !== points[i - 1].panelVersion);

  const LINE = 'var(--color-green)';
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  const latest = points[points.length - 1];

  return (
    <div>
      <Heading>Standing over time</Heading>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Share of panel questions mentioning the company, at each reading">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(peak * f)} y2={y(peak * f)} stroke="var(--color-border)" strokeWidth="1" opacity={f === 0 ? 1 : 0.55} />
            <text x={PAD.l - 7} y={y(peak * f) + 3.5} fontSize="10" textAnchor="end" fill="var(--color-ink-light)">
              {(peak * f * 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {boundaries.map(({ p, i }) => {
          const mid = (x(i - 1) + x(i)) / 2;
          return (
            <g key={`v${p.runId}`}>
              <line x1={mid} x2={mid} y1={PAD.t} y2={PAD.t + innerH} stroke="var(--color-ink-light)" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />
              <text x={mid + 3} y={PAD.t + 9} fontSize="9.5" fill="var(--color-ink-light)">v{p.panelVersion}</text>
            </g>
          );
        })}

        {segments.map((seg) => (
          <path key={`seg-${seg[0].i}`} d={path(seg)} fill="none" stroke={LINE} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {points.map((p, i) => {
          const v = rateOf(p);
          if (v === null) return null;
          const unmentioned = p.companyRank === null;
          return (
            <circle
              key={p.runId}
              cx={x(i)}
              cy={y(v)}
              r="3.5"
              fill={unmentioned ? 'var(--color-surface)' : LINE}
              stroke={LINE}
              strokeWidth="2"
            >
              <title>
                {[
                  `${dateOf(p.startedAt)}: ${p.questionsMentioned} of ${p.totalQuestions} questions`,
                  p.companyRank === null ? 'not mentioned' : `rank ${p.companyRank} of ${p.entrants}`,
                  p.panelVersion > 0 ? `panel v${p.panelVersion}` : '',
                ].filter(Boolean).join(' · ')}
              </title>
            </circle>
          );
        })}

        <text x={PAD.l} y={H - 12} fontSize="10" fill="var(--color-ink-light)">{dateOf(points[0].startedAt)}</text>
        {points.length > 1 && (
          <text x={W - PAD.r} y={H - 12} fontSize="10" textAnchor="end" fill="var(--color-ink-light)">{dateOf(latest.startedAt)}</text>
        )}
      </svg>

      <div className="text-[12px] text-ink-mid mt-1 leading-[1.5]">
        {latest.companyRank === null
          ? 'Latest reading: not mentioned in any answer.'
          : `Latest reading: rank ${latest.companyRank} of ${latest.entrants}, named in ${latest.questionsMentioned} of ${latest.totalQuestions} questions.`}
        {' '}One point per reading, not per day. A hollow dot is a reading where nobody named you.
      </div>
    </div>
  );
}
