// The one shape every answer engine is reduced to.
//
// The engines disagree about almost everything - which index they search, how
// many sub-queries they fan out to, whether they re-rank at all - but for
// measurement they only have to agree on four things: what the answer said,
// what it cited, what it merely looked at, and what it cost.
//
// Keeping `retrieved` separate from `cited` is the point of this interface.
// What an engine fetches and what it shows the user are different sets, and
// the gap between them is diagnostic: a site that is retrieved but never
// cited is losing at selection, while one that is never retrieved is losing at
// indexing and no amount of rewriting will help it.

export type EngineId = 'openai' | 'perplexity' | 'gemini' | 'anthropic';

export interface EngineSource {
  url: string;
  title?: string | null;
}

export interface EngineUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** Billable searches, where the engine reports them. */
  searchCount?: number | null;
}

export interface EngineAnswer {
  answerText: string;
  /** Sources the answer actually attributes. */
  cited: EngineSource[];
  /**
   * Sources consulted during research, cited or not. Empty where the engine
   * does not expose its retrieval layer - an empty array here means "not
   * reported", not "nothing was retrieved".
   */
  retrieved: EngineSource[];
  usage: EngineUsage;
  /** Untouched vendor payload, persisted so scoring can be rewritten later. */
  raw: unknown;
}

export interface AeoEngine {
  readonly id: EngineId;
  /**
   * Whether this engine can run at all right now, normally a key check.
   * Separate from ask() so the dispatcher can skip an unconfigured engine
   * quietly instead of recording a failed answer per prompt and making an
   * unset environment variable look like an engine outage.
   */
  isConfigured(): boolean;
  ask(prompt: string, signal?: AbortSignal): Promise<EngineAnswer>;
}

/** Every engine call is bounded. A hung vendor must not wedge a whole run. */
export const ENGINE_TIMEOUT_MS = 90_000;

/** Fetch with a hard deadline, composed with any caller-supplied signal. */
export async function fetchWithDeadline(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
  timeoutMs: number = ENGINE_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`engine call exceeded ${timeoutMs}ms`)), timeoutMs);
  const onAbort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function isTransient(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** Seconds to wait, honouring Retry-After when the vendor sends one. */
function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 120) return seconds * 1000;
    const date = Date.parse(header);
    if (!Number.isNaN(date)) {
      const delta = date - Date.now();
      if (delta > 0 && delta <= 120_000) return delta;
    }
  }
  // Exponential with jitter. The jitter matters more than the curve: this runs
  // at concurrency N against one vendor, so without it every rate-limited call
  // in the batch retries on the same tick and rate-limits itself again.
  const base = 1000 * 2 ** attempt;
  return base + Math.floor(Math.random() * 400);
}

/**
 * fetchWithDeadline, but a rate limit is treated as "ask again", not as an
 * answer. A 429 recorded as a failed answer is a category error: the engine
 * did not decline to mention the company, we asked too fast. Three attempts
 * total, because a whole reading is waiting behind this one prompt.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
  timeoutMs: number = ENGINE_TIMEOUT_MS,
  attempts = 3,
): Promise<Response> {
  let res!: Response;
  for (let attempt = 0; attempt < attempts; attempt++) {
    res = await fetchWithDeadline(url, init, signal, timeoutMs);
    if (res.ok || !isTransient(res.status) || attempt === attempts - 1) return res;

    const waitMs = retryAfterMs(res, attempt);
    // Drain the body before discarding the response so the socket is released.
    await res.text().catch(() => '');
    console.warn(`[aeo] ${new URL(url).host} returned ${res.status}; retrying in ${waitMs}ms (attempt ${attempt + 1}/${attempts})`);

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, waitMs);
      function onAbort() {
        clearTimeout(t);
        reject(signal?.reason ?? new Error('aborted while backing off'));
      }
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
  return res;
}

export function dedupeSources(sources: EngineSource[]): EngineSource[] {
  const byUrl = new Map<string, EngineSource>();
  for (const s of sources) if (!byUrl.has(s.url)) byUrl.set(s.url, s);
  return [...byUrl.values()];
}
