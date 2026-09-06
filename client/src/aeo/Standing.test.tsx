// The leaderboard's dangerous edges, pinned. None survive a typechecker.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompanyStanding } from './Standing';
import type { Standing, StandingEntry } from './types';

function entry(name: string, questions: number, over: Partial<StandingEntry> = {}): StandingEntry {
  return { name, isCompany: false, questions, mentions: questions, recommended: 0, compared: 0, dismissed: 0, passing: 0, ...over };
}

function standing(entries: StandingEntry[], over: Partial<Standing> = {}): Standing {
  const i = entries.findIndex((e) => e.isCompany);
  return { runId: 'r1', totalQuestions: 20, companyName: 'Acme', companyRank: i === -1 ? null : i + 1, entries, ...over };
}

describe('CompanyStanding', () => {
  it('shows the company even when it ranks below the visible cut', () => {
    const rivals = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((n, i) => entry(n, 20 - i));
    const html = renderToStaticMarkup(<CompanyStanding standing={standing([...rivals, entry('Acme', 1, { isCompany: true })])} />);
    assert.match(html, /Acme/);
    assert.match(html, /\(you\)/);
  });

  it('numbers the company by its true rank, not its row position', () => {
    const rivals = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((n, i) => entry(n, 20 - i));
    const html = renderToStaticMarkup(<CompanyStanding standing={standing([...rivals, entry('Acme', 1, { isCompany: true })])} />);
    assert.match(html, />9</);
  });

  it('says the company was not mentioned rather than ranking it last', () => {
    const html = renderToStaticMarkup(<CompanyStanding standing={standing([entry('Rival', 14)], { companyRank: null })} />);
    assert.match(html, /was not mentioned in this reading/);
    assert.doesNotMatch(html, /is #/);
  });

  it('names the leader and the company rank when the company is behind', () => {
    const html = renderToStaticMarkup(<CompanyStanding standing={standing([entry('Rival', 14), entry('Acme', 8, { isCompany: true })])} />);
    assert.match(html, /is #2 of 2/);
    assert.match(html, /Rival leads with/);
  });

  it('renders nothing at all when there are no entries', () => {
    assert.equal(renderToStaticMarkup(<CompanyStanding standing={standing([])} />), '');
  });

  it('calls out being dismissed', () => {
    const html = renderToStaticMarkup(
      <CompanyStanding standing={standing([entry('Acme', 8, { isCompany: true, mentions: 12, recommended: 3, dismissed: 4 })])} />,
    );
    assert.match(html, /named you as the option to avoid/);
  });

  it('does not claim a stance split when nothing was classified', () => {
    const html = renderToStaticMarkup(<CompanyStanding standing={standing([entry('Acme', 8, { isCompany: true, mentions: 12 })])} />);
    assert.match(html, /none classified yet/);
    assert.doesNotMatch(html, /Recommended/);
  });
});
