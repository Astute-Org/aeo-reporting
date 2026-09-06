// Building the question set a company is measured against.
//
// The panel is the denominator of every number this system produces, which
// makes it the highest-leverage thing to get right and the easiest thing to
// get quietly wrong. Two failure modes, both of which produce a
// plausible-looking panel:
//
//   Branded prompts. "What is Acme?" always surfaces Acme, so a panel with
//   them in reports a high visibility that measures the company's name, not
//   its standing in the market.
//
//   Intent monoculture. A panel that is all "best X for Y" measures listicles.
//   Different content wins different kinds of question, so a discovery-only
//   panel systematically flatters whoever wins listicles.
//
// Both are enforced in validatePanel, which is pure and tested. The model
// proposes; the validator decides.

import { mentionsBrand } from './citation-match.js';
import { structuredCall } from './llm/judge.js';
import { INTENTS, type PromptIntent } from './metrics.js';
import { fetchPageText } from './scrape.js';

export { INTENTS };

/**
 * Questions per panel. Every question is bought engines x repeats on every
 * reading, so this is the single biggest cost lever. The floor exists so a
 * panel cannot collapse onto one kind of question.
 */
export const PANEL_SIZE = 20;
export const PANEL_MIN = 12;

export interface CandidatePrompt {
  text: string;
  intent: PromptIntent;
}

export interface PanelValidation {
  accepted: CandidatePrompt[];
  rejected: { text: string; reason: string }[];
  /** Every intent represented at least minPerIntent times, and enough of them. */
  balanced: boolean;
}

export interface ValidateOptions {
  /** The company's name and aliases: anything that makes a prompt branded. */
  brandTerms: string[];
  min?: number;
  max?: number;
  minPerIntent?: number;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?.!]+$/, '');
}

/**
 * Decide which generated prompts are allowed into a panel.
 *
 * Pure, so the rule that governs every downstream number is checkable without
 * a model, a key or a network.
 */
export function validatePanel(candidates: CandidatePrompt[], opts: ValidateOptions): PanelValidation {
  const min = opts.min ?? PANEL_MIN;
  const max = opts.max ?? PANEL_SIZE;
  const minPerIntent = opts.minPerIntent ?? 3;
  const terms = opts.brandTerms.map((t) => t.trim()).filter(Boolean);

  const accepted: CandidatePrompt[] = [];
  const rejected: { text: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    const text = (c.text ?? '').trim();
    const key = normalize(text);

    if (!key) {
      rejected.push({ text, reason: 'empty' });
      continue;
    }
    if (!INTENTS.includes(c.intent)) {
      rejected.push({ text, reason: `unknown intent "${c.intent}"` });
      continue;
    }
    // Three words is not a buyer question, it is a keyword, and keywords
    // behave differently in fan-out.
    if (key.split(' ').length < 4) {
      rejected.push({ text, reason: 'too short to be a real question' });
      continue;
    }
    if (seen.has(key)) {
      rejected.push({ text, reason: 'duplicate' });
      continue;
    }

    const branded = terms.find((t) => mentionsBrand(text, t));
    if (branded) {
      rejected.push({ text, reason: `branded: mentions "${branded}"` });
      continue;
    }

    seen.add(key);
    accepted.push({ text, intent: c.intent });
  }

  // Trim to max by round-robin across intents rather than by taking the first
  // N. Models group by category, so taking the first N would cut the tail
  // intent entirely.
  let kept = accepted;
  if (accepted.length > max) {
    const buckets = new Map<PromptIntent, CandidatePrompt[]>(INTENTS.map((i) => [i, []]));
    for (const p of accepted) buckets.get(p.intent)!.push(p);
    kept = [];
    let progress = true;
    while (kept.length < max && progress) {
      progress = false;
      for (const intent of INTENTS) {
        const bucket = buckets.get(intent)!;
        if (!bucket.length || kept.length >= max) continue;
        kept.push(bucket.shift()!);
        progress = true;
      }
    }
  }

  const counts = new Map<PromptIntent, number>(INTENTS.map((i) => [i, 0]));
  for (const p of kept) counts.set(p.intent, counts.get(p.intent)! + 1);
  const balanced = INTENTS.every((i) => counts.get(i)! >= minPerIntent) && kept.length >= min;

  return { accepted: kept, rejected, balanced };
}

const PANEL_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', description: 'The market the company competes in, in a few words.' },
    prompts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          intent: { type: 'string', enum: INTENTS },
        },
        required: ['text', 'intent'],
        additionalProperties: false,
      },
    },
  },
  required: ['category', 'prompts'],
  additionalProperties: false,
};

export function buildInstruction(name: string, context: string, notes?: string | null): string {
  return [
    `A company called "${name}" wants to know how it shows up in AI answers. Below is`,
    'material about it: its own website, and possibly a note from the company.',
    '',
    'Your job is to write the questions a REAL BUYER in this market would type into',
    'ChatGPT while deciding what to buy. You are not writing questions about the',
    'website, and you are not writing questions about the company.',
    '',
    'Rules:',
    `- Never name "${name}" or any specific vendor. A question that names a brand`,
    '  is worthless here: it always surfaces that brand, so it measures nothing.',
    `- Write ${PANEL_SIZE + 4} questions spread evenly across four kinds:`,
    '  discovery ("best X for Y"), comparison ("X vs Z" phrased generically),',
    '  validation ("is X worth it", "what do people actually think about X"),',
    '  implementation ("how do I do X", "what is the process for X").',
    '- Questions should be the length and phrasing a person actually types, not',
    '  keyword strings.',
    '- Infer the market from the material and write for that market broadly. The',
    '  website is only here to identify the market; do not write questions about',
    '  the company itself.',
    '- Write in the language and for the places the company\'s buyers actually use.',
    ...(notes?.trim() ? ['', '--- NOTE FROM THE COMPANY ---', notes.trim().slice(0, 2_000)] : []),
    '',
    '--- WEBSITE ---',
    context.slice(0, 8_000),
  ].join('\n');
}

export interface GeneratedPanel {
  category: string;
  validation: PanelValidation;
}

/**
 * Propose a panel for a company.
 *
 * Context comes from the company's website where one was given, and from the
 * stored notes otherwise.
 */
export async function generatePanel(input: {
  name: string;
  url?: string | null;
  notes?: string | null;
  brandTerms: string[];
}): Promise<GeneratedPanel> {
  const scraped = input.url ? await fetchPageText(input.url) : '';
  const context = scraped || input.notes || '';

  if (!context.trim()) {
    throw new Error('no material to generate questions from: the website returned nothing readable and no description was given');
  }

  const parsed = await structuredCall<{ category?: string; prompts?: CandidatePrompt[] }>({
    purpose: 'panel',
    tool: { name: 'propose_panel', description: 'Return the question panel.', schema: PANEL_SCHEMA },
    prompt: buildInstruction(input.name, context, scraped ? input.notes : null),
    maxTokens: 8_000,
    effort: 'medium',
  });
  if (!parsed) throw new Error('question generation returned nothing usable');

  const validation = validatePanel(parsed.prompts ?? [], { brandTerms: input.brandTerms });
  return { category: parsed.category ?? '', validation };
}
