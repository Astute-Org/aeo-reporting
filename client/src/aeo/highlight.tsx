// Wrapping brand names in the assistant's own words.
//
// HIGHLIGHTING COMES FROM THE SCORER, NOT FROM STRING MATCHING HERE. The
// server sends which brands it found in each answer, with alias handling.
// Re-deriving it in the browser would find a different set and quietly
// disagree with every number above it.

import type { AnswerMention } from './types';

/**
 * Wrap every occurrence of the named brands in the answer text.
 * Longest first, so "Paperless Post" wins over a "Post" that would otherwise
 * chop it in half.
 */
export function highlight(text: string, mentions: AnswerMention[]) {
  const names = [...new Set(mentions.map((m) => (m.label ?? '').trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (names.length === 0) return text;

  const mine = new Set(mentions.filter((m) => m.subject === 'company').map((m) => (m.label ?? '').trim().toLowerCase()));

  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');

  return text.split(re).map((part, i) => {
    const isName = names.some((n) => n.toLowerCase() === part.toLowerCase());
    if (!isName) return part;
    const isMine = mine.has(part.toLowerCase());
    return (
      <mark
        key={i}
        className={isMine ? 'bg-green-light text-ink font-semibold rounded-[2px] px-0.5' : 'bg-bg-alt text-ink-mid rounded-[2px] px-0.5'}
      >
        {part}
      </mark>
    );
  });
}
