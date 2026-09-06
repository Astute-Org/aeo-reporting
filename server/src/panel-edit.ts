// Validating a panel a human wrote.
//
// WHY NOT validatePanel. That function governs what a MODEL is allowed to
// propose, and its rules are shaped by the ways a model goes wrong: it pads
// with keyword strings, it repeats itself, and it names the company, which
// produces a question that always surfaces the company and therefore measures
// nothing. It rejects all three.
//
// The person editing the panel owns it. If they insist on a branded question,
// that is their call, and the consequence - a question that flatters them - is
// theirs to read. So branding warns here rather than rejects. Everything
// structural still rejects, because an empty question or an unknown kind is
// not a choice, it is a mistake.

import { mentionsBrand } from './citation-match.js';
import { INTENTS, type PromptIntent } from './metrics.js';

export const EDIT_MIN = 5;
export const EDIT_MAX = 40;

export interface EditedPrompt {
  text: string;
  intent: PromptIntent;
}

export interface PanelEditResult {
  accepted: EditedPrompt[];
  /** Fatal: the edit is refused and nothing is written. */
  errors: string[];
  /** Non-fatal: saved as asked, with the consequence stated. */
  warnings: string[];
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?.!]+$/, '');
}

export function validatePanelEdit(
  prompts: { text: string; intent: string }[],
  opts: { brandTerms?: string[] } = {},
): PanelEditResult {
  const terms = (opts.brandTerms ?? []).map((t) => t.trim()).filter(Boolean);
  const accepted: EditedPrompt[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  prompts.forEach((p, i) => {
    const position = i + 1;
    const text = (p.text ?? '').trim();
    const key = normalize(text);

    if (!key) {
      errors.push(`Question ${position} is empty.`);
      return;
    }
    if (!INTENTS.includes(p.intent as PromptIntent)) {
      errors.push(`Question ${position} has an unknown kind "${p.intent}". Use one of: ${INTENTS.join(', ')}.`);
      return;
    }
    if (key.split(' ').length < 4) {
      errors.push(`Question ${position} is too short to be a real question - write it the way a buyer would type it.`);
      return;
    }
    if (seen.has(key)) {
      errors.push(`Question ${position} duplicates an earlier one.`);
      return;
    }

    const branded = terms.find((t) => mentionsBrand(text, t));
    if (branded) {
      warnings.push(
        `Question ${position} names "${branded}". A question that names you almost always surfaces you, so it will read as a win without measuring one.`,
      );
    }

    seen.add(key);
    accepted.push({ text, intent: p.intent as PromptIntent });
  });

  if (accepted.length < EDIT_MIN) {
    errors.push(`A panel needs at least ${EDIT_MIN} questions; this one has ${accepted.length}.`);
  }
  if (accepted.length > EDIT_MAX) {
    errors.push(`A panel takes at most ${EDIT_MAX} questions; this one has ${accepted.length}. Every question is asked on every engine, every reading.`);
  }

  return { accepted, errors, warnings };
}
