// Claude, via the Messages API with the hosted web_search tool.
//
// The most tractable engine in the set: it reports both layers natively. Text
// blocks carry citations, and the web_search_tool_result block carries every
// result the search returned, so retrieval-versus-selection is a real signal
// here rather than an inference.

import type Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { anthropicClient, anthropicConfigured } from '../llm/anthropic.js';
import { dedupeSources, ENGINE_TIMEOUT_MS, type AeoEngine, type EngineAnswer, type EngineSource } from './types.js';

/**
 * The basic web_search tool, NOT the dynamic-filtering variant.
 *
 * The newer `web_search_20260209` runs code execution under the hood to
 * filter results before they reach the model, and the citation linkage is not
 * emitted: measured A/B on the same prompt, the basic tool returned 7 cited
 * sources and the newer one returned 0 while `retrieved` stayed populated on
 * both. On a measurement of citations that inverts the diagnosis - "retrieved
 * but never selected", stated confidently and backwards. Override with
 * AEO_ANTHROPIC_WEB_SEARCH_TYPE if that changes.
 */
export const WEB_SEARCH_TOOL_TYPE = process.env.AEO_ANTHROPIC_WEB_SEARCH_TYPE || 'web_search_20250305';

/** Resumes of a paused turn before the answer is called a failure. */
const MAX_RESUMES = 2;

type ContentBlock = Anthropic.Messages.ContentBlock;

interface TextBlockCitation {
  url?: string;
  title?: string;
}

export function extractCited(content: readonly ContentBlock[]): EngineSource[] {
  const out: EngineSource[] = [];
  for (const block of content) {
    if (block.type !== 'text') continue;
    const citations = (block as { citations?: TextBlockCitation[] }).citations ?? [];
    for (const c of citations) {
      if (!c.url) continue;
      out.push({ url: c.url, title: c.title ?? null });
    }
  }
  return dedupeSources(out);
}

export function extractRetrieved(content: readonly ContentBlock[]): EngineSource[] {
  const out: EngineSource[] = [];
  for (const block of content) {
    if (block.type !== 'web_search_tool_result') continue;
    // On an error the block's content is a single error object rather than a
    // list of results, which would otherwise throw on iteration.
    const results = (block as { content?: unknown }).content;
    if (!Array.isArray(results)) continue;
    for (const r of results as { url?: string; title?: string }[]) {
      if (!r.url) continue;
      out.push({ url: r.url, title: r.title ?? null });
    }
  }
  return dedupeSources(out);
}

export function textOf(content: readonly ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

export const anthropicEngine: AeoEngine = {
  id: 'anthropic',

  isConfigured() {
    return anthropicConfigured();
  },

  async ask(prompt: string, signal?: AbortSignal): Promise<EngineAnswer> {
    const client = anthropicClient();

    // Hosted web search runs a server-side loop with an iteration limit. When
    // it hits it the response comes back with stop_reason 'pause_turn' and a
    // PARTIAL answer. Taking that at face value understates mentions on
    // exactly the prompts that needed the most searching, so the turn is
    // resumed, bounded.
    const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: prompt }];
    const blocks: ContentBlock[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let searches = 0;
    let reportedSearches = false;
    let res!: Anthropic.Messages.Message;

    for (let turn = 0; turn <= MAX_RESUMES; turn++) {
      res = await client.messages.create(
        {
          model: config.anthropicModel,
          max_tokens: 4096,
          // max_uses caps the billable part: hosted search is charged per
          // request on top of tokens.
          tools: [{ type: WEB_SEARCH_TOOL_TYPE, name: 'web_search', max_uses: 5 } as never],
          messages,
        },
        { signal, timeout: ENGINE_TIMEOUT_MS },
      );

      blocks.push(...(res.content as ContentBlock[]));
      inputTokens += res.usage?.input_tokens ?? 0;
      outputTokens += res.usage?.output_tokens ?? 0;
      const perTurn = (res.usage as { server_tool_use?: { web_search_requests?: number } } | undefined)
        ?.server_tool_use?.web_search_requests;
      if (typeof perTurn === 'number') {
        searches += perTurn;
        reportedSearches = true;
      }

      if (res.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: res.content }, { role: 'user', content: 'Continue.' });
    }

    if (res.stop_reason === 'pause_turn') {
      throw new Error(
        `anthropic web search still paused after ${MAX_RESUMES} resume(s); answer is incomplete and would understate every metric`,
      );
    }
    if (res.stop_reason === 'refusal') {
      throw new Error('anthropic declined to answer this prompt (stop_reason: refusal)');
    }

    return {
      answerText: textOf(blocks),
      cited: extractCited(blocks),
      retrieved: extractRetrieved(blocks),
      usage: {
        inputTokens: inputTokens || null,
        outputTokens: outputTokens || null,
        searchCount: reportedSearches ? searches : null,
      },
      raw: { ...res, content: blocks },
    };
  },
};
