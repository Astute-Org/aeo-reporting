// The engine registry.
//
// Four are implemented. Google AI Overviews, Copilot and Grok are absent
// rather than stubbed: a stub that returns an empty answer is
// indistinguishable in the data from an engine that ran and found nothing of
// ours, and the whole point of this system is to tell those two apart.
//
// Every engine is measured independently and never averaged, because they do
// not share an index: what ChatGPT cites and what Perplexity cites overlap far
// less than people assume.

import { config } from '../config.js';
import type { AeoEngine, EngineId } from './types.js';
import { openaiEngine } from './openai.js';
import { perplexityEngine } from './perplexity.js';
import { geminiEngine } from './gemini.js';
import { anthropicEngine } from './anthropic.js';

const ALL: AeoEngine[] = [openaiEngine, perplexityEngine, geminiEngine, anthropicEngine];

/**
 * Engines that are both implemented and configured, in priority order.
 *
 * Filtering on isConfigured here rather than failing per-prompt keeps an unset
 * key out of the results table entirely. A missing OPENAI_API_KEY should read
 * as "we did not measure ChatGPT", not as sixty failed answers that look like
 * an outage.
 *
 * AEO_ENGINES narrows it further. An unrecognised id throws at startup rather
 * than being skipped: AEO_ENGINES=openai,chatgpt silently measuring only
 * OpenAI, when someone believed they had asked for two, is the kind of quiet
 * that produces a number nobody can reconstruct later.
 */
export function activeEngines(): AeoEngine[] {
  const allowed = allowedEngineIds();
  return ALL.filter((e) => e.isConfigured() && (!allowed || allowed.includes(e.id)));
}

export function allowedEngineIds(): EngineId[] | null {
  const raw = (config.engines ?? '').trim();
  if (!raw) return null;
  const ids = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const known = new Set(ALL.map((e) => e.id as string));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) {
    throw new Error(`AEO_ENGINES lists unknown engine(s): ${unknown.join(', ')}. Known: ${[...known].join(', ')}`);
  }
  return ids as EngineId[];
}

/** Rough per-answer cost in USD, measured from real usage. For the estimate shown before a click. */
export const COST_PER_ANSWER_USD: Record<EngineId, number> = {
  openai: 0.054,
  gemini: 0.012,
  perplexity: 0.006,
  anthropic: 0.15,
};

export type { AeoEngine, EngineAnswer, EngineId, EngineSource } from './types.js';
