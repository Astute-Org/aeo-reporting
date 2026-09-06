// The API. Every path is under /api.

import { Router, type Request, type Response } from 'express';
import { canonicalizeUrl, domainOf } from './citation-match.js';
import { buildCompanyReport } from './company-report.js';
import { config } from './config.js';
import { getDb, newId, nowIso, parseList, toList } from './db.js';
import { activeEngines, allowedEngineIds, COST_PER_ANSWER_USD } from './engines/index.js';
import { generatePanel } from './generate-panel.js';
import { resolveJudge } from './llm/judge.js';
import { validatePanelEdit } from './panel-edit.js';
import { latestCompletedRunForPanel, promptStatsForRun } from './report.js';
import { runPanel } from './run-panel.js';

export const api = Router();

interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  url: string | null;
  canonical_url: string | null;
  aliases: string;
  competitors: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface PanelRow {
  id: string;
  version: number;
  category: string | null;
  repeats: number;
  cadence_hours: number;
  last_run_at: string | null;
  created_at: string;
}

interface PromptRow {
  id: string;
  text: string;
  intent: string;
  position: number | null;
}

function companyById(id: string): CompanyRow | null {
  return (getDb().prepare(`select * from companies where id = ?`).get(id) as CompanyRow | undefined) ?? null;
}

function activePanelFor(companyId: string): { panel: PanelRow | null; prompts: PromptRow[] } {
  const db = getDb();
  const panel = db
    .prepare(`select id, version, category, repeats, cadence_hours, last_run_at, created_at from panels where company_id = ? and is_active = 1 order by version desc limit 1`)
    .get(companyId) as PanelRow | undefined;
  if (!panel) return { panel: null, prompts: [] };
  const prompts = db
    .prepare(`select id, text, intent, position from prompts where panel_id = ? order by position, id`)
    .all(panel.id) as PromptRow[];
  return { panel, prompts };
}

function publicCompany(c: CompanyRow) {
  return {
    id: c.id,
    name: c.name,
    domain: c.domain,
    url: c.url,
    aliases: parseList(c.aliases),
    competitors: parseList(c.competitors),
    notes: c.notes,
    createdAt: c.created_at,
  };
}

function publicPanel(p: PanelRow | null) {
  return p
    ? { id: p.id, version: p.version, category: p.category, repeats: p.repeats, cadenceHours: p.cadence_hours, lastRunAt: p.last_run_at }
    : null;
}

function normalizeUrl(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function notFound(res: Response, what = 'company'): void {
  res.status(404).json({ error: `${what} not found` });
}

/** Insert a new panel version carrying the schedule position of the one it replaces. */
function insertPanelVersion(
  companyId: string,
  prompts: { text: string; intent: string }[],
  opts: { category: string | null; previous: PanelRow | null },
): { id: string; version: number } {
  const db = getDb();
  const id = newId();
  const version = (opts.previous?.version ?? 0) + 1;
  db.transaction(() => {
    // Deactivate BEFORE insert. Between the two statements there is briefly
    // no active panel, which costs at most a skipped tick; the other order
    // would briefly have two, which bills twice for the same reading.
    if (opts.previous) db.prepare(`update panels set is_active = 0 where company_id = ?`).run(companyId);
    // Carry last_run_at forward. A fresh panel with a null last_run_at is
    // "never run", and never-run is due immediately - so without this every
    // reword of a question would trigger a paid reading on the next tick.
    db.prepare(
      `insert into panels (id, company_id, version, is_active, category, cadence_hours, repeats, last_run_at, created_at)
       values (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      companyId,
      version,
      opts.category ?? opts.previous?.category ?? null,
      opts.previous?.cadence_hours ?? config.companyCadenceHours,
      opts.previous?.repeats ?? 1,
      opts.previous?.last_run_at ?? null,
      nowIso(),
    );
    const insert = db.prepare(`insert into prompts (id, panel_id, text, intent, position, created_at) values (?, ?, ?, ?, ?, ?)`);
    prompts.forEach((p, i) => insert.run(newId(), id, p.text, p.intent, i, nowIso()));
  })();
  return { id, version };
}

// ─── Status ──────────────────────────────────────────────────────────────────

/**
 * Which engines would actually answer, and who judges.
 *
 * Exists because of this system's defining failure mode: an engine whose key
 * is unset is silently skipped, which is correct on the server and
 * indistinguishable from "broken" to someone looking at a screen with no
 * numbers on it.
 */
api.get('/status', (_req, res) => {
  let engines: string[] = [];
  let engineError: string | null = null;
  try {
    engines = activeEngines().map((e) => e.id);
    allowedEngineIds();
  } catch (err) {
    engineError = err instanceof Error ? err.message : String(err);
  }
  const judge = resolveJudge();
  res.json({
    engines,
    engineError,
    judge: judge ? { provider: judge.provider, model: judge.model, panelModel: judge.panelModel } : null,
    llmScoring: config.llmScoring && judge !== null,
    scheduler: { enabled: config.schedulerEnabled, intervalMinutes: Math.round(config.dispatchIntervalMs / 60_000) },
    cadenceHoursDefault: config.companyCadenceHours,
    costPerAnswerUsd: COST_PER_ANSWER_USD,
  });
});

// ─── Companies ───────────────────────────────────────────────────────────────

api.get('/companies', (_req, res) => {
  const rows = getDb()
    .prepare(
      `select c.id, c.name, c.domain, c.created_at,
              (select version from panels p where p.company_id = c.id and p.is_active = 1 order by version desc limit 1) as panel_version,
              (select count(*) from prompts pr join panels p on p.id = pr.panel_id where p.company_id = c.id and p.is_active = 1) as prompt_count,
              (select count(*) from runs r join panels p on p.id = r.panel_id where p.company_id = c.id and r.status = 'completed') as runs_measured,
              (select max(r.started_at) from runs r join panels p on p.id = r.panel_id where p.company_id = c.id and r.status = 'completed') as last_reading_at,
              exists(select 1 from runs r join panels p on p.id = r.panel_id where p.company_id = c.id and r.status = 'running') as running
         from companies c
        order by c.created_at`,
    )
    .all() as {
    id: string; name: string; domain: string | null; created_at: string; panel_version: number | null;
    prompt_count: number; runs_measured: number; last_reading_at: string | null; running: number;
  }[];
  res.json({
    companies: rows.map((r) => ({
      id: r.id,
      name: r.name,
      domain: r.domain,
      createdAt: r.created_at,
      panelVersion: r.panel_version,
      promptCount: r.prompt_count,
      runsMeasured: r.runs_measured,
      lastReadingAt: r.last_reading_at,
      running: Boolean(r.running),
    })),
  });
});

/**
 * Start tracking a company, and write its first question panel in one call.
 *
 * Generation is inline rather than queued because a company without a panel
 * cannot be measured, and a half-created company that silently never got one
 * would sit there looking configured. It costs one judge call.
 */
api.post('/companies', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = String(body.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });

  const url = normalizeUrl(body.url);
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
  if (!url && !notes) {
    return res.status(400).json({ error: 'Give a website, or a short description of what the company sells, so questions can be generated.' });
  }
  const aliases = toList(body.aliases);
  const competitors = toList(body.competitors);

  const db = getDb();
  const id = newId();
  const now = nowIso();
  db.prepare(
    `insert into companies (id, name, domain, url, canonical_url, aliases, competitors, notes, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, domainOf(url), url, canonicalizeUrl(url), JSON.stringify(aliases), JSON.stringify(competitors), notes, now, now);

  let panelWarning: string | null = null;
  let promptCount = 0;
  try {
    if (!resolveJudge()) {
      throw new Error('no judge model is configured (set ANTHROPIC_API_KEY or GEMINI_API_KEY)');
    }
    const generated = await generatePanel({ name, url, notes, brandTerms: [name, ...aliases] });
    const accepted = generated.validation.accepted;
    insertPanelVersion(id, accepted, { category: generated.category, previous: null });
    promptCount = accepted.length;
    if (!generated.validation.balanced) {
      panelWarning = 'The generated questions are not balanced across the four kinds. Readings will skew toward whichever kind dominates - edit the panel to even it out.';
    }
  } catch (err) {
    insertPanelVersion(id, [], { category: null, previous: null });
    panelWarning = `Tracking started but question generation failed: ${err instanceof Error ? err.message : String(err)}. Add questions by hand, or regenerate them, before the first reading.`;
  }

  return res.status(201).json({
    id,
    promptCount,
    panelWarning,
    note: config.schedulerEnabled
      ? `The first reading runs within ${Math.round(config.dispatchIntervalMs / 60_000)} minutes, then every ${Math.round(config.companyCadenceHours / 24)} days.`
      : 'The scheduler is off, so readings run only when you press Read now.',
  });
});

api.get('/companies/:id', (req, res) => {
  const company = companyById(req.params.id);
  if (!company) return notFound(res);
  const { panel, prompts } = activePanelFor(company.id);
  return res.json({ company: publicCompany(company), panel: publicPanel(panel), prompts });
});

/**
 * Edit what the company is measured against: competitors, aliases, notes.
 * Everything else is frozen, because the name is the string the scorer
 * matches on and the site is what citations are matched against.
 */
api.patch('/companies/:id', (req, res) => {
  const company = companyById(req.params.id);
  if (!company) return notFound(res);

  const body = (req.body ?? {}) as Record<string, unknown>;
  const sets: string[] = [];
  const values: unknown[] = [];
  const notes: string[] = [];

  if ('competitors' in body) {
    if (!Array.isArray(body.competitors)) return res.status(400).json({ error: 'competitors must be an array' });
    sets.push('competitors = ?');
    values.push(JSON.stringify(toList(body.competitors)));
    notes.push('Competitors changed. They are the share-of-voice denominator, so that metric is not comparable across this edit - earlier readings were scored against the old list.');
  }
  if ('aliases' in body) {
    if (!Array.isArray(body.aliases)) return res.status(400).json({ error: 'aliases must be an array' });
    sets.push('aliases = ?');
    values.push(JSON.stringify(toList(body.aliases)));
    notes.push('Aliases apply from the next reading; earlier readings were matched on the old list.');
  }
  if ('notes' in body) {
    sets.push('notes = ?');
    values.push(typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null);
  }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });

  sets.push('updated_at = ?');
  values.push(nowIso(), company.id);
  getDb().prepare(`update companies set ${sets.join(', ')} where id = ?`).run(...values);

  return res.json({ company: publicCompany(companyById(company.id)!), notes });
});

/** Delete a company and every reading it ever took. Irreversible, and the UI says so. */
api.delete('/companies/:id', (req, res) => {
  const company = companyById(req.params.id);
  if (!company) return notFound(res);
  const running = getDb()
    .prepare(`select 1 from runs r join panels p on p.id = r.panel_id where p.company_id = ? and r.status = 'running'`)
    .get(company.id);
  if (running) return res.status(409).json({ error: 'A reading is in progress. Wait for it to finish before deleting.' });
  getDb().prepare(`delete from companies where id = ?`).run(company.id);
  return res.status(204).end();
});

// ─── The panel ───────────────────────────────────────────────────────────────

/**
 * Replace the question set, as a new version.
 *
 * Every stored run points at the panel it was asked on. Mutating the
 * questions under it would silently redefine what those runs measured, and
 * the trend line would draw a continuous series across a discontinuity. A
 * new version leaves the old readings attached to the old questions and lets
 * the chart mark the boundary.
 */
api.put('/companies/:id/panel', (req, res) => {
  const company = companyById(req.params.id);
  if (!company) return notFound(res);

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(body.prompts)) return res.status(400).json({ error: 'prompts must be an array of { text, intent }' });

  const submitted = (body.prompts as unknown[]).map((p) => {
    const row = (p ?? {}) as Record<string, unknown>;
    return { text: String(row.text ?? ''), intent: String(row.intent ?? '') };
  });

  const { accepted, errors, warnings } = validatePanelEdit(submitted, {
    brandTerms: [company.name, ...parseList(company.aliases)],
  });
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const { panel: previous } = activePanelFor(company.id);
  const created = insertPanelVersion(company.id, accepted, { category: null, previous });

  return res.json({
    panelId: created.id,
    version: created.version,
    promptCount: accepted.length,
    warnings,
    note: previous
      ? `Saved as v${created.version}. Readings from here are on the new questions; earlier ones stay attached to v${previous.version}, and the trend marks the change.`
      : `Saved as v${created.version}.`,
  });
});

/** Write a fresh panel from the website, as a new version. */
api.post('/companies/:id/panel/generate', async (req, res) => {
  const company = companyById(req.params.id);
  if (!company) return notFound(res);
  if (!resolveJudge()) return res.status(409).json({ error: 'No judge model is configured (set ANTHROPIC_API_KEY or GEMINI_API_KEY).' });

  try {
    const generated = await generatePanel({
      name: company.name,
      url: company.url,
      notes: company.notes,
      brandTerms: [company.name, ...parseList(company.aliases)],
    });
    const { panel: previous } = activePanelFor(company.id);
    const accepted = generated.validation.accepted;
    if (!accepted.length) return res.status(502).json({ error: 'The model proposed no usable questions. Try again, or add a description of the company.' });
    const created = insertPanelVersion(company.id, accepted, { category: generated.category, previous });
    return res.json({
      version: created.version,
      promptCount: accepted.length,
      balanced: generated.validation.balanced,
      category: generated.category,
      note: `Generated ${accepted.length} questions as v${created.version}.`,
    });
  } catch (err) {
    return res.status(502).json({ error: `Question generation failed: ${err instanceof Error ? err.message : String(err)}` });
  }
});

// ─── Readings ────────────────────────────────────────────────────────────────

/**
 * Take a reading now.
 *
 * Refuses if one is already in flight: a second click would ask every engine
 * the same questions again and bill for both. Started in the background and
 * answered 202, because a reading is minutes of vendor calls; the caller
 * polls the report, where a run in progress is visibly present.
 */
api.post('/companies/:id/runs', (req, res) => {
  const company = companyById(req.params.id);
  if (!company) return notFound(res);

  const engines = activeEngines();
  if (!engines.length) return res.status(409).json({ error: 'No answer engine is configured. Set at least one of OPENAI_API_KEY, PERPLEXITY_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY.' });

  const { panel, prompts } = activePanelFor(company.id);
  if (!panel) return res.status(409).json({ error: 'This company has no question panel.' });
  if (!prompts.length) return res.status(409).json({ error: 'The panel has no questions yet. Add some, or generate them.' });

  const live = getDb()
    .prepare(`select id, started_at from runs where panel_id = ? and status = 'running' order by started_at desc limit 1`)
    .get(panel.id) as { id: string; started_at: string } | undefined;
  if (live) {
    return res.status(409).json({
      error: 'A reading is already in progress. Wait for it to finish - starting another would ask every engine the same questions again and bill for both.',
      runId: live.id,
      startedAt: live.started_at,
    });
  }

  // A manual reading counts as the reading for this cadence slot.
  getDb().prepare(`update panels set last_run_at = ? where id = ?`).run(nowIso(), panel.id);

  void runPanel({ id: panel.id, company_id: company.id, repeats: panel.repeats }).catch((err) => {
    console.error(`[aeo] manual reading failed for company ${company.id}:`, err);
  });

  return res.status(202).json({
    status: 'started',
    engines: engines.map((e) => e.id),
    answersExpected: prompts.length * engines.length * panel.repeats,
    poll: `/api/companies/${company.id}/report`,
  });
});

api.get('/companies/:id/report', (req, res) => {
  try {
    const report = buildCompanyReport(req.params.id);
    if (!report) return notFound(res);
    return res.json(report);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'report failed' });
  }
});

/**
 * The exact questions this company is measured on, and how each one did on
 * the latest completed reading. The panel is the denominator of every number
 * in the report, so it should not be the one thing you cannot see.
 */
api.get('/companies/:id/prompts', (req, res) => {
  const company = companyById(req.params.id);
  if (!company) return notFound(res);
  const { panel, prompts } = activePanelFor(company.id);
  if (!panel) return res.json({ panel: null, runId: null, prompts: [] });

  const runId = latestCompletedRunForPanel(panel.id);
  const stats = runId ? promptStatsForRun(runId) : new Map();
  return res.json({
    panel: publicPanel(panel),
    runId,
    prompts: prompts.map((p) => ({ ...p, ...(stats.get(p.id) ?? { answers: 0, mentioned: 0, cited: 0 }) })),
  });
});

/**
 * What the assistants actually said to one question, on the latest completed
 * reading. A rate is a claim; the assistant's own words with the company's
 * name in them are proof.
 */
api.get('/companies/:id/answers', (req, res) => {
  const company = companyById(req.params.id);
  if (!company) return notFound(res);
  const promptId = typeof req.query.promptId === 'string' ? req.query.promptId : '';
  if (!promptId) return res.status(400).json({ error: 'promptId is required' });

  const db = getDb();
  const prompt = db
    .prepare(
      `select pr.id, pr.text, pr.intent, pr.panel_id
         from prompts pr join panels p on p.id = pr.panel_id
        where pr.id = ? and p.company_id = ?`,
    )
    .get(promptId, company.id) as { id: string; text: string; intent: string; panel_id: string } | undefined;
  if (!prompt) return res.status(404).json({ error: 'question not found on this company' });

  const runId = latestCompletedRunForPanel(prompt.panel_id);
  if (!runId) return res.json({ prompt: { id: prompt.id, text: prompt.text, intent: prompt.intent }, runId: null, answers: [] });

  const rows = db
    .prepare(
      `select id, engine, repeat_index, answer_text, status, created_at
         from answers where run_id = ? and prompt_id = ?
        order by engine, repeat_index`,
    )
    .all(runId, promptId) as { id: string; engine: string; repeat_index: number; answer_text: string | null; status: string; created_at: string }[];

  const byAnswer = new Map<string, { subject: string; label: string | null; context: string | null; position: number | null }[]>();
  if (rows.length) {
    const obs = db
      .prepare(
        `select answer_id, subject, label, context, position from observations
          where answer_id in (${rows.map(() => '?').join(',')}) and subject in ('company', 'competitor')
            and kind in ('linked_mention', 'unlinked_mention')`,
      )
      .all(...rows.map((r) => r.id)) as { answer_id: string; subject: string; label: string | null; context: string | null; position: number | null }[];
    for (const o of obs) {
      const list = byAnswer.get(o.answer_id) ?? [];
      list.push({ subject: o.subject, label: o.label, context: o.context, position: o.position });
      byAnswer.set(o.answer_id, list);
    }
  }

  return res.json({
    prompt: { id: prompt.id, text: prompt.text, intent: prompt.intent },
    runId,
    answers: rows.map((r) => ({
      id: r.id,
      engine: r.engine,
      repeatIndex: r.repeat_index,
      // Empty text is kept as empty rather than dropped: an assistant that
      // returned nothing is a real outcome.
      text: r.answer_text ?? '',
      status: r.status,
      mentions: byAnswer.get(r.id) ?? [],
    })),
  });
});

api.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not found' });
});
