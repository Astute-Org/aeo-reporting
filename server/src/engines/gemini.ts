// Gemini, with the Google Search grounding tool.
//
// AI Overviews and Gemini-the-assistant are different surfaces over the same
// index and cite differently, and Gemini is the only one of the two reachable
// through an API at all.
//
// THE REDIRECT PROBLEM, and the reason this engine would otherwise report a
// confident zero forever: `web.uri` on a grounding chunk is not the
// publisher's URL. It is an opaque grounding-api-redirect link, identical in
// shape for every source. Matching a company's domain against that never
// matches, so every run would record "found nothing" and look perfectly
// healthy doing it. sourceFromChunk below is the workaround, and it costs
// something real: this engine yields DOMAIN matches, never exact pages.

import { config } from '../config.js';
import { geminiClient } from '../llm/gemini.js';
import { dedupeSources, ENGINE_TIMEOUT_MS, type AeoEngine, type EngineAnswer, type EngineSource } from './types.js';

interface GroundingChunk {
  web?: { uri?: string; title?: string; domain?: string };
}

interface GroundingSupport {
  groundingChunkIndices?: number[];
}

/** A bare hostname and nothing else: no spaces, no path, at least one dot. */
const BARE_DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Resolve a chunk to something the citation matcher can actually match.
 *
 * Three tiers, in descending trustworthiness, because the API is inconsistent
 * about which fields it fills:
 *
 *   1. `web.domain`, the documented field, when present.
 *   2. `web.title` WHEN it is a bare hostname, which is what live responses
 *      actually carry ("rippling.com", "deel.com").
 *   3. The redirect URI, unchanged. Useless for matching, but recorded rather
 *      than dropped so retrieval counts stay honest and the failure is visible
 *      in the data instead of looking like an engine that found nothing.
 *
 * A real page title ("Best tools for paying contractors") must never become a
 * URL, so tier 2 is deliberately strict.
 */
export function sourceFromChunk(chunk: GroundingChunk): EngineSource | null {
  const web = chunk.web;
  if (!web) return null;

  const domain = (web.domain ?? '').trim();
  if (domain) return { url: `https://${domain}`, title: web.title ?? null };

  const title = (web.title ?? '').trim();
  if (BARE_DOMAIN.test(title)) return { url: `https://${title.toLowerCase()}`, title };

  const uri = (web.uri ?? '').trim();
  if (!uri) return null;
  return { url: uri, title: web.title ?? null };
}

/** Everything the grounding step surfaced, cited or not. */
export function extractRetrieved(chunks: readonly GroundingChunk[]): EngineSource[] {
  const out: EngineSource[] = [];
  for (const chunk of chunks) {
    const src = sourceFromChunk(chunk);
    if (src) out.push(src);
  }
  return dedupeSources(out);
}

/**
 * Only the chunks a groundingSupport actually attributes to a span of the
 * answer. An index pointing outside the chunk list is ignored rather than
 * throwing: a truncated response must degrade to a smaller citation set, not
 * a failed run.
 *
 * Note that Gemini's supports routinely reference every chunk retrieved, so
 * cited and retrieved are often identical and selection rate on this engine
 * says little. Do not average it with the other engines.
 */
export function extractCited(
  chunks: readonly GroundingChunk[],
  supports: readonly GroundingSupport[],
): EngineSource[] {
  const cited = new Set<number>();
  for (const s of supports) {
    for (const i of s.groundingChunkIndices ?? []) {
      if (Number.isInteger(i) && i >= 0 && i < chunks.length) cited.add(i);
    }
  }
  const out: EngineSource[] = [];
  for (const i of cited) {
    const src = sourceFromChunk(chunks[i]);
    if (src) out.push(src);
  }
  return dedupeSources(out);
}

export const geminiEngine: AeoEngine = {
  id: 'gemini',

  isConfigured() {
    return geminiClient() !== null;
  },

  async ask(prompt: string, signal?: AbortSignal): Promise<EngineAnswer> {
    const client = geminiClient();
    if (!client) throw new Error('Gemini is not configured (GEMINI_API_KEY, or GEMINI_AUTH_MODE=vertex with VERTEX_PROJECT_ID)');

    const res = await client.models.generateContent({
      model: config.geminiModel,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        tools: [{ googleSearch: {} }],
        abortSignal: signal,
        httpOptions: { timeout: ENGINE_TIMEOUT_MS },
      },
    });

    const candidate = res.candidates?.[0];
    const grounding = candidate?.groundingMetadata as
      | { groundingChunks?: GroundingChunk[]; groundingSupports?: GroundingSupport[]; webSearchQueries?: string[] }
      | undefined;
    const chunks = grounding?.groundingChunks ?? [];
    const supports = grounding?.groundingSupports ?? [];

    const answerText = (candidate?.content?.parts ?? [])
      .map((p) => (p as { text?: string }).text ?? '')
      .filter(Boolean)
      .join('\n');

    const usage = res.usageMetadata;
    // Thinking tokens are billed as output but reported outside
    // candidatesTokenCount, so omitting them understates cost.
    const outputTokens =
      usage === undefined
        ? null
        : (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);

    return {
      answerText,
      cited: extractCited(chunks, supports),
      retrieved: extractRetrieved(chunks),
      usage: {
        inputTokens: usage?.promptTokenCount ?? null,
        outputTokens,
        searchCount: grounding?.webSearchQueries?.length ?? null,
      },
      raw: res,
    };
  },
};
