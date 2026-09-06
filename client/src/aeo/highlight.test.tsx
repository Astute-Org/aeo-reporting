import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { highlight } from './highlight';
import type { AnswerMention } from './types';

function mention(label: string, subject: AnswerMention['subject'] = 'competitor'): AnswerMention {
  return { subject, label, context: null, position: null };
}

function html(text: string, mentions: AnswerMention[]) {
  return renderToStaticMarkup(<>{highlight(text, mentions)}</>);
}

function markClass(out: string, name: string): string | null {
  const m = out.match(new RegExp(`<mark class="([^"]*)">${name}</mark>`));
  return m ? m[1] : null;
}

describe('highlight', () => {
  it('marks the company differently from a competitor', () => {
    const out = html('Try Acme or Rival.', [mention('Acme', 'company'), mention('Rival')]);
    const mine = markClass(out, 'Acme');
    const rival = markClass(out, 'Rival');
    assert.ok(mine && rival);
    assert.match(mine!, /green/);
    assert.doesNotMatch(rival!, /green/);
  });

  it('prefers the longest name so a short one cannot chop it in half', () => {
    const out = html('We like Paperless Post here.', [mention('Paperless Post'), mention('Post')]);
    assert.match(out, />Paperless Post</);
  });

  it("matches regardless of the assistant's capitalisation", () => {
    assert.match(html('acme is worth a look.', [mention('Acme', 'company')]), /<mark[^>]*>acme<\/mark>/);
  });

  it('treats a name with regex characters as literal text', () => {
    assert.match(html('C++ Tools ships today.', [mention('C++ Tools')]), /<mark[^>]*>C\+\+ Tools<\/mark>/);
  });

  it('returns the text untouched when the scorer attributed nothing', () => {
    assert.equal(html('Nobody relevant here.', []), 'Nobody relevant here.');
  });

  it('marks every occurrence, not just the first', () => {
    assert.equal(html('Rival is fine. Rival again.', [mention('Rival')]).match(/<mark/g)?.length, 2);
  });
});
