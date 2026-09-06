// Where you stand, and how you are spoken about.
//
// "You 8 · Rival A 14 · Rival B 3" is the same data as "share of voice 32%",
// denominated in a way a person can argue with, and it says WHO is ahead.

import { Heading } from './Charts';
import type { Standing, StandingEntry } from './types';

/** Rivals shown by default. The tail is real but nobody reads position 9. */
const TOP_N = 6;

export function CompanyStanding({ standing }: { standing: Standing }) {
  const { entries, totalQuestions, companyRank, companyName } = standing;
  if (entries.length === 0) return null;

  const leader = entries[0];
  const company = entries.find((e) => e.isCompany) ?? null;
  const max = Math.max(...entries.map((e) => e.questions), 1);

  // Always include the company, even when it ranks below the cut. A board
  // that silently omits you is worse than one that shows you in tenth.
  const shown = entries.slice(0, TOP_N);
  if (company && !shown.includes(company)) shown.push(company);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Heading>Where you stand</Heading>

        <p className="text-[13px] text-ink-mid mb-3">
          {companyRank === null ? (
            <>
              {companyName} was not mentioned in this reading.{' '}
              {leader.name} came up in {leader.questions} of {totalQuestions} questions.
            </>
          ) : companyRank === 1 ? (
            <>{companyName} is mentioned in more questions than any competitor you declared.</>
          ) : (
            <>
              {companyName} is #{companyRank} of {entries.length}. {leader.name} leads with {leader.questions} of {totalQuestions} questions.
            </>
          )}
        </p>

        <div className="flex flex-col gap-1.5">
          {shown.map((e) => (
            <div key={e.name} className="flex items-center gap-3">
              {/* Rank comes from the full list, not the loop counter: `shown`
                  can carry the company out of rank order. */}
              <div className="w-5 shrink-0 text-[12px] tabular-nums text-ink-light">{entries.indexOf(e) + 1}</div>
              <div className={`w-[150px] shrink-0 truncate text-[13px] ${e.isCompany ? 'font-semibold text-ink' : 'text-ink-mid'}`} title={e.name}>
                {e.name}
                {e.isCompany && <span className="text-ink-light font-normal"> (you)</span>}
              </div>
              <div className="flex-1 h-5 rounded-[3px] bg-bg-alt overflow-hidden">
                <div className={`h-full ${e.isCompany ? 'bg-green' : 'bg-ink-light'}`} style={{ width: `${Math.max((e.questions / max) * 100, 1.5)}%` }} />
              </div>
              <div className="w-[92px] shrink-0 text-right text-[12px] tabular-nums text-ink-mid">{e.questions} of {totalQuestions}</div>
            </div>
          ))}
        </div>
      </div>

      {company && (
        <div>
          <Heading>How you're talked about</Heading>
          <ToneSplit entry={company} />
        </div>
      )}
    </div>
  );
}

/**
 * Recommended, compared, dismissed. Being named as the option to avoid
 * counts as a mention in most tools; here it is its own row.
 */
function ToneSplit({ entry }: { entry: StandingEntry }) {
  const rows = [
    { key: 'recommended', label: 'Recommended', n: entry.recommended, tone: 'bg-green', hint: 'Put forward as an option worth choosing.' },
    { key: 'compared', label: 'Compared', n: entry.compared, tone: 'bg-ink-mid', hint: 'Weighed against an alternative.' },
    { key: 'dismissed', label: 'Dismissed', n: entry.dismissed, tone: 'bg-error', hint: 'Named as the one to avoid.' },
    { key: 'passing', label: 'Mentioned in passing', n: entry.passing, tone: 'bg-border', hint: 'Named with no stance either way.' },
  ];
  const judged = rows.reduce((a, r) => a + r.n, 0);

  if (judged === 0) {
    return (
      <p className="text-[13px] text-ink-mid">
        {entry.mentions > 0
          ? `${entry.mentions} mention${entry.mentions === 1 ? '' : 's'}, none classified yet.`
          : 'No mentions in this reading.'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.filter((r) => r.n > 0).map((r) => (
        <div key={r.key} className="flex items-center gap-3" title={r.hint}>
          <div className="w-[150px] shrink-0 text-[13px] text-ink">{r.label}</div>
          <div className="flex-1 h-5 rounded-[3px] bg-bg-alt overflow-hidden">
            <div className={`h-full ${r.tone}`} style={{ width: `${(r.n / judged) * 100}%` }} />
          </div>
          <div className="w-[40px] shrink-0 text-right text-[12px] tabular-nums text-ink-mid">{r.n}</div>
        </div>
      ))}
      {entry.dismissed > 0 && (
        <p className="text-[12px] text-ink-mid mt-1">
          {entry.dismissed} answer{entry.dismissed === 1 ? '' : 's'} named you as the option to avoid.
          Most tools would count {entry.dismissed === 1 ? 'that' : 'those'} as a win.
        </p>
      )}
    </div>
  );
}
