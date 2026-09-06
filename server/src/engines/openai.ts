// ChatGPT, via the OpenAI Responses API with the hosted web_search tool.
//
// The least faithful proxy of the four: the Responses API is not the same
// retrieval path as chatgpt.com, which personalises before it retrieves. What
// is measured here is a stable, repeatable stand-in, and every number this
// engine produces should be read as one.
//
// Raw fetch rather than the openai SDK because this needs exactly one
// endpoint.
//
// Two parsing rules, both learned from a live payload rather than the docs:
//
//   - The answer text is assembled from the message items. `output_text` is
//     a convenience getter the SDK synthesises and the wire does not carry;
//     reading it yields an empty answer on every call while citations parse
//     fine, which is the worst shape of failure because the row looks like a
//     terse answer rather than a broken parser.
//   - Nothing indexes into `output`. A live response put the message at
//     output[19], behind ten web_search_call and ten reasoning items.

import { config } from '../config.js';
import { dedupeSources, fetchWithRetry, type AeoEngine, type EngineAnswer, type EngineSource } from './types.js';

const ENDPOINT = 'https://api.openai.com/v1/responses';

interface RawAnnotation {
  type?: string;
  url?: string;
  title?: string;
}

interface RawContent {
  type?: string;
  text?: string;
  annotations?: RawAnnotation[];
}

interface RawOutputItem {
  type?: string;
  content?: RawContent[];
  action?: { sources?: { url?: string; title?: string }[] };
}

export interface RawResponse {
  output?: RawOutputItem[];
  /** NOT PRESENT ON THE WIRE. Kept only to document the trap - see extractText. */
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Cited URLs, walked out of every output item and every content block. */
export function extractCited(raw: RawResponse): EngineSource[] {
  const out: EngineSource[] = [];
  for (const item of raw.output ?? []) {
    for (const block of item.content ?? []) {
      for (const ann of block.annotations ?? []) {
        if (ann.type !== 'url_citation' || !ann.url) continue;
        out.push({ url: ann.url, title: ann.title ?? null });
      }
    }
  }
  return dedupeSources(out);
}

/** The answer itself, joined across every output_text block. */
export function extractText(raw: RawResponse): string {
  const parts: string[] = [];
  for (const item of raw.output ?? []) {
    for (const block of item.content ?? []) {
      if (block.type !== 'output_text') continue;
      if (typeof block.text === 'string' && block.text) parts.push(block.text);
    }
  }
  return parts.join('\n');
}

/**
 * Sources consulted during the search, whether or not the answer used them.
 * Only present when the request asked for it via `include`.
 */
export function extractRetrieved(raw: RawResponse): EngineSource[] {
  const out: EngineSource[] = [];
  for (const item of raw.output ?? []) {
    for (const src of item.action?.sources ?? []) {
      if (!src.url) continue;
      out.push({ url: src.url, title: src.title ?? null });
    }
  }
  return dedupeSources(out);
}

/** Searches the model ran: the billable unit, and the fan-out width. */
export function countSearches(raw: RawResponse): number {
  return (raw.output ?? []).filter((i) => i.type === 'web_search_call').length;
}

export const openaiEngine: AeoEngine = {
  id: 'openai',

  isConfigured() {
    return Boolean(config.openaiApiKey);
  },

  async ask(prompt: string, signal?: AbortSignal): Promise<EngineAnswer> {
    const res = await fetchWithRetry(
      ENDPOINT,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: config.openaiModel,
          input: prompt,
          tools: [{ type: 'web_search' }],
          // Force the search. Left to its own judgement the model answers some
          // prompts from memory, which produces an answer with no sources and
          // is indistinguishable in the data from a search that found nothing
          // of ours. We are measuring retrieval, so retrieval has to happen.
          tool_choice: 'required',
          include: ['web_search_call.action.sources'],
        }),
        signal,
      },
      signal,
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`openai responses ${res.status}: ${body.slice(0, 300)}`);
    }

    const raw = (await res.json()) as RawResponse;

    return {
      answerText: extractText(raw),
      cited: extractCited(raw),
      retrieved: extractRetrieved(raw),
      usage: {
        inputTokens: raw.usage?.input_tokens ?? null,
        outputTokens: raw.usage?.output_tokens ?? null,
        searchCount: countSearches(raw),
      },
      raw,
    };
  },
};
