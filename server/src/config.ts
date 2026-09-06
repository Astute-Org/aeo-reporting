// Every knob in one place, read once at import.
//
// The .env file is loaded here rather than by a `--env-file` flag so that the
// same entry point works with a file (local), without one (Docker, a PaaS that
// injects variables) and under the test runner. Existing environment variables
// always win over the file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root: two levels above server/src or server/dist. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadEnvFile(file: string): void {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(process.env.AEO_ENV_FILE ?? path.join(REPO_ROOT, '.env'));

const env = process.env;

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value !== 'false' && value !== '0' && value !== 'off';
}

export const config = {
  /**
   * AEO_PORT wins over PORT. PORT is honoured so platforms that inject it just
   * work, but some dev launchers set PORT for the process they open in the
   * browser, which is the client, and the server must not follow it onto the
   * same port. The dev script sets AEO_PORT for exactly that reason.
   */
  port: positive(env.AEO_PORT || env.PORT, 3400),
  /** Any username, this password. Empty means the app is open. */
  adminPassword: env.ADMIN_PASSWORD ?? '',
  dataDir: env.AEO_DATA_DIR ? path.resolve(env.AEO_DATA_DIR) : path.join(REPO_ROOT, 'data'),

  // --- Answer engines: the assistants being measured ---
  openaiApiKey: env.OPENAI_API_KEY ?? '',
  openaiModel: env.AEO_OPENAI_MODEL || 'gpt-4.1',
  perplexityApiKey: env.PERPLEXITY_API_KEY ?? '',
  perplexityModel: env.AEO_PERPLEXITY_MODEL || 'sonar',
  geminiApiKey: env.GEMINI_API_KEY ?? '',
  geminiAuthMode: (env.GEMINI_AUTH_MODE || 'apikey') as 'apikey' | 'vertex',
  vertexProjectId: env.VERTEX_PROJECT_ID ?? '',
  vertexRegion: env.VERTEX_REGION || 'global',
  geminiModel: env.AEO_GEMINI_MODEL || 'gemini-3.5-flash',
  anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: env.AEO_ANTHROPIC_MODEL || 'claude-opus-5',
  /**
   * Comma-separated engine ids to measure. Unset means every configured
   * engine, which is the only brake between "off" and "every key at full
   * volume", so it is worth setting on a first run.
   */
  engines: env.AEO_ENGINES ?? '',

  // --- The judge: reads answers and writes the question panel ---
  judgeProvider: (env.AEO_JUDGE_PROVIDER || 'auto') as 'auto' | 'anthropic' | 'gemini',
  judgeModel: env.AEO_JUDGE_MODEL ?? '',
  panelModel: env.AEO_PANEL_MODEL ?? '',
  /**
   * The only default-on switch that costs money per answer. Without the judge
   * pass no competitor is ever recorded, so share of voice has no denominator
   * and the leaderboard shows only the company - turning it off is the
   * deliberate act, not turning it on.
   */
  llmScoring: flag(env.AEO_LLM_SCORING, true),
  firecrawlApiKey: env.FIRECRAWL_API_KEY ?? '',

  // --- Scheduling ---
  schedulerEnabled: flag(env.AEO_SCHEDULER_ENABLED, true),
  dispatchIntervalMs: positive(env.AEO_DISPATCH_INTERVAL_MS, 900_000),
  batchSize: positive(env.AEO_BATCH_SIZE, 2),
  /** In-flight engine calls per reading. Higher trips vendor rate limits. */
  concurrency: positive(env.AEO_CONCURRENCY, 4),
  /**
   * A run still marked running after this long is closed out as failed. Must
   * exceed the longest honest reading: prompts x engines x repeats at the
   * concurrency above, at up to 90 seconds per engine call.
   */
  staleRunMinutes: positive(env.AEO_STALE_RUN_MINUTES, 360),
  companyCadenceHours: positive(env.AEO_COMPANY_CADENCE_HOURS, 240),
};

export type Config = typeof config;
