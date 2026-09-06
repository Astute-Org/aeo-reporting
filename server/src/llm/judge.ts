// The judge: one structured call, on whichever provider has a key.
//
// Two jobs go through here, and both want a JSON object back rather than
// prose: writing the question panel from a website, and reading each answer
// to say how every brand was treated. Neither is measuring an engine, so
// which vendor does it is a cost decision with no effect on what the numbers
// mean - which is exactly why it is allowed to fall back between providers,
// while the engine adapters are pinned to the vendor they measure.

import { config } from '../config.js';
import { anthropicClient, anthropicConfigured } from './anthropic.js';
import { geminiClient, geminiConfigured } from './gemini.js';

export type JudgeProvider = 'anthropic' | 'gemini';

export interface JudgeChoice {
  provider: JudgeProvider;
  /** Reads answers. Called once per answer per reading. */
  model: string;
  /** Writes the question panel. Called once per company, or on regenerate. */
  panelModel: string;
}

const DEFAULT_MODEL: Record<JudgeProvider, string> = {
  anthropic: 'claude-opus-5',
  gemini: 'gemini-3.5-flash',
};

/** Which provider and models would judge right now, or null if none can. */
export function resolveJudge(): JudgeChoice | null {
  let provider: JudgeProvider | null;
  if (config.judgeProvider === 'auto') {
    provider = anthropicConfigured() ? 'anthropic' : geminiConfigured() ? 'gemini' : null;
  } else {
    provider = config.judgeProvider;
    if (provider === 'anthropic' && !anthropicConfigured()) return null;
    if (provider === 'gemini' && !geminiConfigured()) return null;
  }
  if (!provider) return null;
  const model = config.judgeModel || DEFAULT_MODEL[provider];
  return { provider, model, panelModel: config.panelModel || model };
}

export interface StructuredTool {
  name: string;
  description: string;
  /** A JSON schema for the object wanted back. Keep it to objects, arrays, strings, integers, booleans and enums. */
  schema: Record<string, unknown>;
}

export interface StructuredCallOptions {
  purpose: 'judge' | 'panel';
  tool: StructuredTool;
  prompt: string;
  system?: string;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
}

/** Some providers reject keywords the others require; drop them per provider. */
function withoutKeys(schema: unknown, keys: string[]): unknown {
  if (Array.isArray(schema)) return schema.map((s) => withoutKeys(s, keys));
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (keys.includes(k)) continue;
      out[k] = withoutKeys(v, keys);
    }
    return out;
  }
  return schema;
}

function parseJson<T>(text: string, label: string): T | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed) as T;
  } catch (err) {
    console.error(`[aeo] ${label} returned something that is not JSON:`, trimmed.slice(0, 200));
    return null;
  }
}

/**
 * Ask the judge for an object matching `tool.schema`. Null when the model
 * returned nothing usable; throws when the call itself failed.
 */
export async function structuredCall<T>(opts: StructuredCallOptions): Promise<T | null> {
  const judge = resolveJudge();
  if (!judge) throw new Error('no judge model is configured (set ANTHROPIC_API_KEY, or GEMINI_API_KEY / Vertex credentials)');
  const model = opts.purpose === 'panel' ? judge.panelModel : judge.model;

  if (judge.provider === 'anthropic') {
    const res = await anthropicClient().messages.create({
      model,
      max_tokens: opts.maxTokens ?? 4_000,
      ...(opts.system ? { system: opts.system } : {}),
      output_config: {
        effort: opts.effort ?? 'medium',
        format: { type: 'json_schema', schema: opts.tool.schema },
      },
      messages: [{ role: 'user', content: opts.prompt }],
    });
    if (res.stop_reason === 'refusal') {
      console.warn(`[aeo] ${opts.tool.name}: the model declined (${res.stop_details?.category ?? 'no category'})`);
      return null;
    }
    const text = res.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return parseJson<T>(text, opts.tool.name);
  }

  const client = geminiClient();
  if (!client) throw new Error('Gemini judge selected but not configured');
  const res = await client.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    config: {
      ...(opts.system ? { systemInstruction: opts.system } : {}),
      responseMimeType: 'application/json',
      responseJsonSchema: withoutKeys(opts.tool.schema, ['additionalProperties']),
      maxOutputTokens: opts.maxTokens ?? 4_000,
    },
  });
  const text = res.text ?? '';
  if (!text.trim()) {
    console.warn(`[aeo] ${opts.tool.name}: Gemini returned no text (${res.candidates?.[0]?.finishReason ?? 'no candidate'})`);
    return null;
  }
  return parseJson<T>(text, opts.tool.name);
}
