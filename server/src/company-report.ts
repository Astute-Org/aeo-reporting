// The company's standing, over time.
//
// A company has no before-and-after: it was visible in AI answers before we
// started measuring and will be after we stop, so there is nothing to
// subtract and any "lift" number here would be inventing a cause for
// whatever the category did that month. What a company has instead is a
// series: where it ranked, on its own questions, on each date it was asked.
//
// THE SERIES IS ONLY HONEST WITHIN A PANEL VERSION. The questions are
// editable, and every edit supersedes the panel rather than mutating it, so
// two points either side of an edit were measured on different question sets.
// The trend carries the version on every point so the chart can draw that
// boundary rather than imply continuity across it.

import { getDb, parseList } from './db.js';
import { loadRunMetrics, runningRun, runsForCompany, type CompletedRun, type InProgress, type RunReport } from './report.js';
import { buildStanding, type Standing } from './standing.js';

/** Readings carried on the trend. Twenty-four points is eight months at ten days. */
export const MAX_TREND_RUNS = 24;

/** Answers below this and the latest rates are too thin to lead with. */
const THIN_ANSWERS = 30;

export interface CompanyTrendPoint {
  runId: string;
  startedAt: string;
  /** The panel version this run was asked on. Points across a change are not comparable. */
  panelVersion: number;
  /** 1-based. Null when the company was not mentioned at all - not last place. */
  companyRank: number | null;
  /** Brands on the board that run, the company included. The rank's denominator. */
  entrants: number;
  /** Distinct questions the company appeared in. */
  questionsMentioned: number;
  /** Questions in the panel that run, so a point reads "8 of 20". */
  totalQuestions: number;
}

export interface CompanyReport {
  companyId: string;
  name: string;
  competitors: string[];
  aliases: string[];
  /** Metrics for the most recent completed run. Null until the first one lands. */
  latest: RunReport | null;
  /** Leaderboard and tone split for that same run. */
  standing: Standing | null;
  /** Oldest first, so a chart can render it left to right without sorting. */
  trend: CompanyTrendPoint[];
  /** Completed runs in total, which can exceed trend.length once capped. */
  runsMeasured: number;
  inProgress: InProgress | null;
  /** Anything that makes the numbers less trustworthy than they look. */
  caveats: string[];
}

/**
 * Turn loaded rows into the series. Pure, so every point on the chart is
 * reproducible from stored rows by a test.
 *
 * A run with no standing at all still yields a point. Null there means the
 * judge found neither the company nor any competitor in any answer, which is
 * a real and bad reading, not a gap in the data.
 */
export function assembleTrend(
  runs: { id: string; started_at: string; panel_id: string }[],
  versionByPanel: Map<string, number>,
  standingByRun: Map<string, Standing | null>,
  totalQuestionsByPanel: Map<string, number>,
): CompanyTrendPoint[] {
  return [...runs]
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .map((run) => {
      const standing = standingByRun.get(run.id) ?? null;
      const company = standing?.entries.find((e) => e.isCompany) ?? null;
      return {
        runId: run.id,
        startedAt: run.started_at,
        // Version 0 is the "we could not tell" value and is never a real
        // version. A point carrying it draws no boundary rather than
        // inventing one.
        panelVersion: versionByPanel.get(run.panel_id) ?? 0,
        companyRank: standing?.companyRank ?? null,
        entrants: standing?.entries.length ?? 0,
        questionsMentioned: company?.questions ?? 0,
        totalQuestions: totalQuestionsByPanel.get(run.panel_id) ?? standing?.totalQuestions ?? 0,
      };
    });
}

function safeStanding(runId: string, name: string, totalQuestions: number): Standing | null {
  try {
    return buildStanding(runId, name, totalQuestions);
  } catch (err) {
    console.error(`[aeo] standing unavailable for run ${runId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Build the company report. Null when the company does not exist. */
export function buildCompanyReport(companyId: string): CompanyReport | null {
  const db = getDb();
  const company = db
    .prepare(`select id, name, competitors, aliases from companies where id = ?`)
    .get(companyId) as { id: string; name: string; competitors: string; aliases: string } | undefined;
  if (!company) return null;

  const competitors = parseList(company.competitors);
  const allRuns: CompletedRun[] = runsForCompany(company.id);
  const inProgress = runningRun(company.id);

  const panelRows = db.prepare(`select id, version from panels where company_id = ?`).all(company.id) as { id: string; version: number }[];
  const versionByPanel = new Map(panelRows.map((p) => [p.id, p.version]));

  const runs = allRuns.slice(-MAX_TREND_RUNS);
  const panelIds = [...new Set(runs.map((r) => r.panel_id))];

  const totalQuestionsByPanel = new Map<string, number>();
  if (panelIds.length) {
    const counts = db
      .prepare(`select panel_id, count(*) as n from prompts where panel_id in (${panelIds.map(() => '?').join(',')}) group by panel_id`)
      .all(...panelIds) as { panel_id: string; n: number }[];
    for (const c of counts) totalQuestionsByPanel.set(c.panel_id, c.n);
  }

  const standingByRun = new Map<string, Standing | null>(
    runs.map((run) => [run.id, safeStanding(run.id, company.name, totalQuestionsByPanel.get(run.panel_id) ?? 0)]),
  );

  const trend = assembleTrend(runs, versionByPanel, standingByRun, totalQuestionsByPanel);

  const latestRun = runs[runs.length - 1] ?? null;
  const latest: RunReport | null = latestRun
    ? { runId: latestRun.id, startedAt: latestRun.started_at, completedAt: latestRun.completed_at, metrics: loadRunMetrics(latestRun.id) }
    : null;

  const caveats: string[] = [];
  if (!competitors.length) {
    caveats.push('No competitors declared, so share of voice has no denominator and the leaderboard shows only whoever the engines named unprompted.');
  }
  if (latest && latest.metrics.answers < THIN_ANSWERS) {
    caveats.push(`The latest reading rests on ${latest.metrics.answers} answers, which is thin - read the confidence intervals rather than the headline rate.`);
  }
  if (allRuns.length === 1) {
    caveats.push('One reading so far. A single point is a position, not a trend.');
  }
  const versionsInTrend = new Set(trend.map((p) => p.panelVersion).filter((v) => v > 0));
  if (versionsInTrend.size > 1) {
    caveats.push(
      `The questions changed during this window (panel v${Math.min(...versionsInTrend)} to v${Math.max(...versionsInTrend)}). Points either side of a change were measured on different question sets and are not directly comparable.`,
    );
  }
  if (allRuns.length > runs.length) {
    caveats.push(`Showing the ${runs.length} most recent readings of ${allRuns.length}.`);
  }
  // A reading in flight is not a caveat here: it travels as `inProgress`,
  // with its progress, and the UI renders that as its own banner.

  return {
    companyId: company.id,
    name: company.name,
    competitors,
    aliases: parseList(company.aliases),
    latest,
    standing: latest ? standingByRun.get(latest.runId) ?? null : null,
    trend,
    runsMeasured: allRuns.length,
    inProgress,
    caveats,
  };
}
