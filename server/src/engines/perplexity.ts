// Perplexity, via the Sonar API.
//
// The only major engine running its own crawler and its own index rather
// than renting one, so its citation set overlaps the others far less than
// people expect. That makes it a genuinely independent read.
//
// The API is OpenAI-shaped, with two extra top-level fields on the response:
// `citations` (what the answer attributed) and `search_results` (what the
// search returned). Getting both means retrieval-versus-selection is
// measurable here for free.

import { config } from '../config.js';
import { dedupeSources, fetchWithRetry, type AeoEngine, type EngineAnswer, type EngineSource } from './types.js';

const ENDPOINT = 'https://api.perplexity.ai/chat/completions';

export interface RawResponse {
  choices?: { message?: { content?: string } }[];
  /** Historically a string[]; newer responses use objects. Both are handled. */
  citations?: (string | { url?: string; title?: string })[];
  search_results?: { url?: string; title?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /** Documented, nullable, and not populated by `sonar` in practice. */
    num_search_queries?: number;
    cost?: { total_cost?: number };
  };
}

/**
 * @param titles optional url -> title lookup. `citations` arrives as bare
 *   strings in practice while `search_results` holds the title for the very
 *   same URL; without this every cited source reads as untitled.
 */
export function toSources(
  items: RawResponse['citations'] | RawResponse['search_results'],
  titles?: Map<string, string>,
): EngineSource[] {
  const out: EngineSource[] = [];
  for (const item of items ?? []) {
    if (typeof item === 'string') {
      if (item) out.push({ url: item, title: titles?.get(item) ?? null });
      continue;
    }
    if (item?.url) out.push({ url: item.url, title: item.title ?? titles?.get(item.url) ?? null });
  }
  return dedupeSources(out);
}

export const perplexityEngine: AeoEngine = {
  id: 'perplexity',

  isConfigured() {
    return Boolean(config.perplexityApiKey);
  },

  async ask(prompt: string, signal?: AbortSignal): Promise<EngineAnswer> {
    const res = await fetchWithRetry(
      ENDPOINT,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.perplexityApiKey}`,
        },
        body: JSON.stringify({
          model: config.perplexityModel,
          messages: [{ role: 'user', content: prompt }],
          // No system prompt on purpose. Every instruction we add is a thumb on
          // the scale of a measurement: we want what a user asking this
          // question would get.
        }),
        signal,
      },
      signal,
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`perplexity ${res.status}: ${body.slice(0, 300)}`);
    }

    const raw = (await res.json()) as RawResponse;

    const titles = new Map<string, string>();
    for (const r of raw.search_results ?? []) if (r.url && r.title) titles.set(r.url, r.title);

    return {
      answerText: raw.choices?.[0]?.message?.content ?? '',
      cited: toSources(raw.citations, titles),
      retrieved: toSources(raw.search_results),
      usage: {
        inputTokens: raw.usage?.prompt_tokens ?? null,
        outputTokens: raw.usage?.completion_tokens ?? null,
        // Null reads as "not reported", never as "ran no searches". Left as
        // null rather than back-filled from search_results.length, which is a
        // different quantity wearing this one's name.
        searchCount: raw.usage?.num_search_queries ?? null,
      },
      raw,
    };
  },
};
