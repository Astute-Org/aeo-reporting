// Periodic dispatcher: claim panels whose cadence has come round and run them.
//
// The claim stamps last_run_at in the same transaction that selects the
// panel, so a thrown reading does not retry until its next cadence. That is
// deliberate: whatever it spent before throwing is spent, and an immediate
// retry would spend it again for a reading we will take on schedule anyway.

import { config } from './config.js';
import { getDb, nowIso } from './db.js';
import { activeEngines } from './engines/index.js';
import { liveRunIds, runPanel, type PanelToRun } from './run-panel.js';

let dispatching = false;
let timer: NodeJS.Timeout | null = null;

/** Aborted on shutdown, so in-flight engine calls are cancelled. */
const shutdownSignal = new AbortController();

interface CandidatePanel extends PanelToRun {
  cadence_hours: number;
  last_run_at: string | null;
}

/**
 * Panels due for a reading, stamped as claimed.
 *
 * A panel that has never run is due now: the first reading is the one the
 * person who just set it up is waiting for. A panel with a run still in
 * flight is never claimed, because a duplicated reading is a duplicated bill.
 */
export function claimDuePanels(limit: number, now: number = Date.now()): PanelToRun[] {
  const db = getDb();
  const claim = db.transaction((): PanelToRun[] => {
    const candidates = db
      .prepare(
        `select p.id, p.company_id, p.repeats, p.cadence_hours, p.last_run_at
           from panels p
          where p.is_active = 1
            and not exists (select 1 from runs r where r.panel_id = p.id and r.status = 'running')
          order by (p.last_run_at is not null), p.last_run_at`,
      )
      .all() as CandidatePanel[];

    const due = candidates
      .filter((p) => {
        if (!p.last_run_at) return true;
        const last = Date.parse(p.last_run_at);
        return !Number.isFinite(last) || last + p.cadence_hours * 3_600_000 <= now;
      })
      .slice(0, limit);

    const stamp = db.prepare(`update panels set last_run_at = ? where id = ?`);
    const stampedAt = new Date(now).toISOString();
    for (const p of due) stamp.run(stampedAt, p.id);

    return due.map((p) => ({ id: p.id, company_id: p.company_id, repeats: p.repeats }));
  });
  return claim();
}

/**
 * Close out runs whose process vanished mid-reading.
 *
 * The predicate is purely "running for longer than N minutes", so it cannot
 * tell a crashed run from a slow one. It therefore never touches a run this
 * process knows to be alive.
 */
export function reclaimStaleRuns(staleMinutes: number, now: number = Date.now()): number {
  const live = new Set(liveRunIds());
  const cutoff = new Date(now - staleMinutes * 60_000).toISOString();
  const rows = getDb()
    .prepare(`select id from runs where status = 'running' and started_at < ?`)
    .all(cutoff) as { id: string }[];
  const stale = rows.filter((r) => !live.has(r.id));
  if (!stale.length) return 0;

  const close = getDb().prepare(
    `update runs set status = 'failed', completed_at = ?, error = coalesce(error || ' | ', '') || ? where id = ?`,
  );
  const note = `Abandoned in running for over ${staleMinutes} minutes - reclaimed`;
  for (const r of stale) close.run(nowIso(), note, r.id);
  return stale.length;
}

async function dispatchDue(): Promise<void> {
  if (dispatching) return;
  dispatching = true;
  try {
    const reclaimed = reclaimStaleRuns(config.staleRunMinutes);
    if (reclaimed > 0) console.warn(`[aeo] reclaimed ${reclaimed} abandoned run(s)`);

    if (!activeEngines().length) return;
    const panels = claimDuePanels(config.batchSize);
    for (const panel of panels) {
      if (shutdownSignal.signal.aborted) return;
      try {
        await runPanel(panel, shutdownSignal.signal);
      } catch (err) {
        console.error(`[aeo] scheduled reading failed for panel ${panel.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[aeo] dispatch error:', err);
  } finally {
    dispatching = false;
  }
}

export function startScheduler(): void {
  if (!config.schedulerEnabled) {
    console.log('[aeo] scheduler off (AEO_SCHEDULER_ENABLED=false) - readings run only when started by hand');
    return;
  }
  const engines = activeEngines();
  if (!engines.length) {
    console.warn('[aeo] scheduler idle: no answer engine is configured. Set at least one API key.');
  } else {
    console.log(`[aeo] scheduler on, every ${Math.round(config.dispatchIntervalMs / 60_000)} min (engines: ${engines.map((e) => e.id).join(', ')})`);
  }
  timer = setInterval(() => void dispatchDue(), config.dispatchIntervalMs);
  // The first tick fires shortly after boot rather than an interval later, so
  // a freshly set-up company gets its first reading without waiting.
  setTimeout(() => void dispatchDue(), 5_000);
}

/** Close out this process's in-flight runs on the way down. */
export function releaseRuns(): void {
  if (timer) clearInterval(timer);
  shutdownSignal.abort();
  const ids = liveRunIds();
  if (!ids.length) return;
  const close = getDb().prepare(`update runs set status = 'failed', completed_at = ?, error = 'interrupted by shutdown' where id = ?`);
  for (const id of ids) close.run(nowIso(), id);
  console.warn(`[aeo] closed out ${ids.length} in-flight run(s) on shutdown`);
}
