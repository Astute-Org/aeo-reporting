import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeUrl, domainOf, matchUrl, mentionsBrand, stripUrls, stripUrlsPreserving } from './citation-match.js';

describe('stripUrls', () => {
  test('removes full urls, so a linked brand is not read as a named one', () => {
    const text = 'One summary is at https://wise.com/gb/compare and another elsewhere.';
    assert.equal(mentionsBrand(text, 'Wise'), true);
    assert.equal(mentionsBrand(stripUrls(text), 'Wise'), false);
  });

  test('removes scheme-less hosts, which engines emit just as often', () => {
    assert.equal(mentionsBrand(stripUrls('see wise.com/compare for fees'), 'Wise'), false);
    assert.equal(mentionsBrand(stripUrls('try notion.so today'), 'Notion'), false);
  });

  test('leaves the brand alone when it is genuinely named in prose', () => {
    const text = 'Wise is worth a look. Details at https://wise.com/gb.';
    assert.equal(mentionsBrand(stripUrls(text), 'Wise'), true);
  });

  test('does not eat ordinary prose that happens to contain a full stop', () => {
    const text = 'It works. Wise is fine. That is all.';
    assert.equal(stripUrls(text).includes('Wise is fine'), true);
  });

  test('handles empty input', () => {
    assert.equal(stripUrls(null), '');
    assert.equal(stripUrls(undefined), '');
    assert.equal(stripUrls(''), '');
  });
});

describe('canonicalizeUrl', () => {
  test('two references to the same page agree', () => {
    assert.equal(canonicalizeUrl('https://www.acme.com/blog/post-42/'), canonicalizeUrl('http://acme.com/blog/post-42'));
  });

  test('strips tracking params but keeps meaningful ones', () => {
    assert.equal(canonicalizeUrl('https://acme.com/post?utm_source=chatgpt&utm_medium=ai&page=2'), 'https://acme.com/post?page=2');
    assert.equal(canonicalizeUrl('https://acme.com/x?gclid=abc&fbclid=def'), 'https://acme.com/x');
  });

  test('keeps the youtube video id, which a blanket query strip would destroy', () => {
    assert.equal(canonicalizeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=tracking'), 'https://youtube.com/watch?v=dQw4w9WgXcQ');
    assert.notEqual(canonicalizeUrl('https://youtube.com/watch?v=aaa'), canonicalizeUrl('https://youtube.com/watch?v=bbb'));
  });

  test('sorts params so ordering does not create a second identity', () => {
    assert.equal(canonicalizeUrl('https://acme.com/p?b=2&a=1'), canonicalizeUrl('https://acme.com/p?a=1&b=2'));
  });

  test('survives the punctuation engines weld onto urls', () => {
    assert.equal(canonicalizeUrl('(https://acme.com/post).'), 'https://acme.com/post');
    assert.equal(canonicalizeUrl('<https://acme.com/post>'), 'https://acme.com/post');
    assert.equal(canonicalizeUrl('"https://acme.com/post",'), 'https://acme.com/post');
  });

  test('drops the fragment, including scroll-to-text', () => {
    assert.equal(canonicalizeUrl('https://acme.com/post#:~:text=some%20quoted%20thing'), 'https://acme.com/post');
  });

  test('returns null rather than throwing on junk, so one bad url cannot abort scoring', () => {
    assert.equal(canonicalizeUrl(null), null);
    assert.equal(canonicalizeUrl(''), null);
    assert.equal(canonicalizeUrl('not a url'), null);
    assert.equal(canonicalizeUrl('javascript:alert(1)'), null);
    assert.equal(canonicalizeUrl('mailto:someone@acme.com'), null);
  });
});

describe('domainOf', () => {
  test('strips www and lowercases', () => {
    assert.equal(domainOf('https://WWW.Acme.com/path'), 'acme.com');
  });

  test('does not treat two subdomains of a host as the same property', () => {
    assert.notEqual(domainOf('https://alice.substack.com'), domainOf('https://bob.substack.com'));
  });
});

describe('matchUrl', () => {
  const site = { canonicalUrl: 'https://acme.com', domain: 'acme.com' };

  test('the homepage is an exact match', () => {
    assert.equal(matchUrl('https://www.acme.com/?utm_source=chatgpt', site), 'exact_url');
  });

  test('another page on the same site is a domain match', () => {
    assert.equal(matchUrl('https://acme.com/pricing', site), 'domain');
  });

  test('an unrelated domain is not a match', () => {
    assert.equal(matchUrl('https://competitor.com/p/issue-42', site), null);
    assert.equal(matchUrl(null, site), null);
  });

  test('works when the domain is stored bare rather than as a url', () => {
    assert.equal(matchUrl('https://acme.com/other', { domain: 'acme.com' }), 'domain');
  });
});

describe('mentionsBrand', () => {
  test('finds the brand in ordinary prose', () => {
    assert.equal(mentionsBrand('I would look at Wise for that.', 'Wise'), true);
    assert.equal(mentionsBrand('Options include Wise, Revolut and Monzo.', 'Wise'), true);
    assert.equal(mentionsBrand("Wise's fees are lower.", 'Wise'), true);
    assert.equal(mentionsBrand('(Wise) is one option', 'Wise'), true);
  });

  test('does not fire on a substring, which is the whole reason this exists', () => {
    assert.equal(mentionsBrand('Otherwise you could use something else.', 'Wise'), false);
    assert.equal(mentionsBrand('likewise, it is fine', 'Wise'), false);
    assert.equal(mentionsBrand('a notional amount', 'Notion'), false);
  });

  test('is case insensitive and tolerates a wrapped multi-word brand', () => {
    assert.equal(mentionsBrand('try LINEAR app today', 'Linear App'), true);
    assert.equal(mentionsBrand('try Linear\n   App today', 'Linear App'), true);
  });

  test('empty inputs are false, never true', () => {
    assert.equal(mentionsBrand('', 'Wise'), false);
    assert.equal(mentionsBrand('some text', ''), false);
    assert.equal(mentionsBrand(null, null), false);
  });
});

describe('a brand whose name is shaped like a domain', () => {
  test('survives URL stripping when it is named in prose', () => {
    const text = 'Copy.ai is the tool most teams start with, and Copy.ai has a free tier.';
    assert.equal(stripUrls(text).includes('Copy.ai'), false, 'precondition: plain stripUrls eats it');
    assert.ok(mentionsBrand(stripUrlsPreserving(text, ['Copy.ai']), 'Copy.ai'));
  });

  test('is still stripped when it is only a link', () => {
    for (const linked of [
      'Full pricing at copy.ai/pricing if you want it.',
      'See https://copy.ai for details.',
      'Read more at www.copy.ai today.',
    ]) {
      assert.equal(mentionsBrand(stripUrlsPreserving(linked, ['Copy.ai']), 'Copy.ai'), false, linked);
    }
  });

  test('one occurrence named and another linked still counts as a mention', () => {
    const text = 'Copy.ai is worth a look; pricing is at copy.ai/pricing.';
    assert.ok(mentionsBrand(stripUrlsPreserving(text, ['Copy.ai']), 'Copy.ai'));
  });

  test('an ordinary brand name is unaffected, and its bare link still stripped', () => {
    assert.equal(stripUrlsPreserving('Try wise.com/compare for fees.', ['Wise']), stripUrls('Try wise.com/compare for fees.'));
    assert.ok(mentionsBrand(stripUrlsPreserving('Wise is cheapest.', ['Wise']), 'Wise'));
  });

  test('a regex metacharacter in the brand name does not break the shield', () => {
    assert.doesNotThrow(() => stripUrlsPreserving('C++.dev is a real thing apparently.', ['C++.dev']));
  });
});

describe('a bare host on a TLD outside the allowlist', () => {
  test('is stripped when it carries a path, whatever the TLD', () => {
    for (const [text, brand] of [
      ['A fee table lives at wise.fr/compare if you want it.', 'Wise'],
      ['Details at notion.site/pricing', 'Notion'],
      ['Try monzo.co.uk/business today', 'Monzo'],
    ] as [string, string][]) {
      assert.equal(mentionsBrand(stripUrls(text), brand), false, text);
    }
  });

  test('still strips listed TLDs with no path at all', () => {
    assert.equal(mentionsBrand(stripUrls('Have a look at wise.com sometime.'), 'Wise'), false);
  });

  test('does not eat prose that merely lacks a space after a full stop', () => {
    const text = 'That was the end.Next we compared Wise against the rest.';
    assert.ok(mentionsBrand(stripUrls(text), 'Wise'), stripUrls(text));
  });
});
