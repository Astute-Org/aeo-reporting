// Payload parsing for every engine adapter.
//
// These parsers all fail SOFT: a vendor changing its response shape produces
// an empty citation list, not an exception. That is the right runtime
// behaviour and a terrible failure to have go unnoticed, because "the engine
// returned no citations" and "we can no longer read this engine's citations"
// look identical downstream. So the shapes are pinned here.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { extractText as openaiText, extractCited as openaiCited, extractRetrieved as openaiRetrieved, countSearches, type RawResponse as OpenAiRaw } from './openai.js';
import { toSources, type RawResponse as PerplexityRaw } from './perplexity.js';
import { fetchWithRetry } from './types.js';
import { extractRetrieved as geminiRetrieved, extractCited as geminiCited } from './gemini.js';
import { extractCited as claudeCited, extractRetrieved as claudeRetrieved, textOf } from './anthropic.js';

describe('openai response parsing', () => {
  const payload: OpenAiRaw = {
    output_text: 'Several options are worth considering.',
    output: [
      { type: 'reasoning' },
      {
        type: 'web_search_call',
        action: { sources: [{ url: 'https://acme.com/blog/post', title: 'Post' }, { url: 'https://competitor.com/blog', title: 'Competitor' }] },
      },
      { type: 'web_search_call', action: { sources: [{ url: 'https://third.com/x' }] } },
      {
        type: 'message',
        content: [{
          annotations: [
            { type: 'url_citation', url: 'https://acme.com/blog/post', title: 'Post' },
            { type: 'file_citation', url: 'https://ignored.com/doc' },
          ],
        }],
      },
    ],
    usage: { input_tokens: 900, output_tokens: 120 },
  };

  test('finds citations even when a reasoning item shifts the output array', () => {
    const cited = openaiCited(payload);
    assert.equal(cited.length, 1);
    assert.equal(cited[0].url, 'https://acme.com/blog/post');
  });

  test('ignores annotation types that are not url citations', () => {
    assert.ok(!openaiCited(payload).some((c) => c.url.includes('ignored.com')));
  });

  test('reads the retrieval layer from every search call, not just the first', () => {
    const retrieved = openaiRetrieved(payload);
    assert.equal(retrieved.length, 3);
    assert.ok(retrieved.some((r) => r.url === 'https://third.com/x'));
  });

  test('search count is the fan-out width, which is the billable unit', () => {
    assert.equal(countSearches(payload), 2);
  });

  test('a drifted shape yields empty rather than throwing', () => {
    assert.deepEqual(openaiCited({} as OpenAiRaw), []);
    assert.deepEqual(openaiCited({ output: [{ type: 'message' }] }), []);
    assert.deepEqual(openaiRetrieved({ output: [{ type: 'web_search_call' }] }), []);
    assert.equal(countSearches({}), 0);
  });

  test('reads text from the message item, not the SDK-only output_text field', () => {
    const raw = {
      output_text: 'THE SDK FIELD - MUST NOT BE USED',
      output: [
        { type: 'reasoning', content: [] },
        { type: 'message', content: [{ type: 'output_text', text: 'Acme is a good option.', annotations: [] }] },
      ],
    };
    assert.equal(openaiText(raw), 'Acme is a good option.');
  });

  test('joins several output_text blocks rather than truncating to the first', () => {
    const raw = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'part one' }, { type: 'output_text', text: 'part two' }] }] };
    assert.equal(openaiText(raw), 'part one\npart two');
  });
});

describe('perplexity response parsing', () => {
  test('a bare-string citation borrows its title from search_results', () => {
    const raw: PerplexityRaw = { citations: ['https://a.com/p'], search_results: [{ url: 'https://a.com/p', title: 'A Post' }] };
    const titles = new Map<string, string>();
    for (const r of raw.search_results ?? []) if (r.url && r.title) titles.set(r.url, r.title);
    assert.deepEqual(toSources(raw.citations, titles), [{ url: 'https://a.com/p', title: 'A Post' }]);
  });

  test('reads the newer object shape with titles', () => {
    assert.deepEqual(toSources([{ url: 'https://a.com/one', title: 'One' }]), [{ url: 'https://a.com/one', title: 'One' }]);
  });

  test('handles a payload mixing both shapes', () => {
    assert.equal(toSources(['https://a.com/one', { url: 'https://b.com/two', title: 'Two' }]).length, 2);
  });

  test('empty, missing and malformed entries never produce blank sources', () => {
    assert.deepEqual(toSources(undefined), []);
    assert.deepEqual(toSources(['']), []);
    assert.deepEqual(toSources([{} as { url?: string }]), []);
  });

  test('duplicates collapse', () => {
    assert.equal(toSources(['https://a.com/x', 'https://a.com/x']).length, 1);
  });
});

describe('transient vendor failures are retried, not recorded as answers', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origFetch; });

  function stubFetch(sequence: number[]) {
    let i = 0;
    const calls: number[] = [];
    globalThis.fetch = (async () => {
      const status = sequence[Math.min(i, sequence.length - 1)];
      calls.push(status);
      i += 1;
      return new Response(status === 200 ? '{"ok":true}' : 'rate limited', {
        status,
        headers: status === 429 ? { 'retry-after': '0' } : {},
      });
    }) as typeof fetch;
    return calls;
  }

  test('a 429 is retried and the eventual success is returned', async () => {
    const calls = stubFetch([429, 200]);
    const res = await fetchWithRetry('https://api.perplexity.ai/x', { method: 'POST' });
    assert.equal(res.status, 200);
    assert.deepEqual(calls, [429, 200]);
  });

  test('a 400 is NOT retried - a bad request stays bad', async () => {
    const calls = stubFetch([400, 200]);
    const res = await fetchWithRetry('https://api.openai.com/x', { method: 'POST' });
    assert.equal(res.status, 400);
    assert.deepEqual(calls, [400]);
  });

  test('gives up after the attempt budget and returns the last response', async () => {
    const calls = stubFetch([429, 429, 429, 429]);
    const res = await fetchWithRetry('https://api.perplexity.ai/x', { method: 'POST' });
    assert.equal(res.status, 429);
    assert.equal(calls.length, 3);
  });
});

describe('anthropic response parsing', () => {
  const content = [
    { type: 'text', text: 'Here is the answer.', citations: [{ url: 'https://a.com/p', title: 'A' }] },
    { type: 'web_search_tool_result', content: [{ url: 'https://a.com/p', title: 'A' }, { url: 'https://b.com/q', title: 'B' }] },
    { type: 'text', text: 'And a second paragraph.' },
  ] as never[];

  test('citations come off text blocks', () => {
    const cited = claudeCited(content);
    assert.equal(cited.length, 1);
    assert.equal(cited[0].url, 'https://a.com/p');
  });

  test('the search result block is the retrieval layer', () => {
    assert.equal(claudeRetrieved(content).length, 2);
  });

  test('answer text joins every text block', () => {
    const text = textOf(content);
    assert.match(text, /Here is the answer\./);
    assert.match(text, /And a second paragraph\./);
  });

  test('an errored search block carries an object, not a list, and must not throw', () => {
    const errored = [{ type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } }] as never[];
    assert.deepEqual(claudeRetrieved(errored), []);
  });
});

describe('gemini response parsing', () => {
  const chunks = [
    { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123', title: 'Best tools', domain: 'acme.com' } },
    { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/DeF456', title: 'Comparison', domain: 'rival.com' } },
    { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/GhI789', title: 'Guide', domain: 'other.com' } },
  ];

  test('resolves the real domain, never the grounding redirect', () => {
    const [first] = geminiRetrieved(chunks);
    assert.equal(first.url, 'https://acme.com');
    assert.doesNotMatch(first.url, /vertexaisearch|grounding-api-redirect/);
  });

  test('cited is only what a support attributes, not everything retrieved', () => {
    const cited = geminiCited(chunks, [{ groundingChunkIndices: [0, 2] }]).map((s) => s.url);
    assert.deepEqual(cited, ['https://acme.com', 'https://other.com']);
    assert.equal(geminiRetrieved(chunks).length, 3);
  });

  test('an out-of-range support index is ignored rather than throwing', () => {
    const cited = geminiCited(chunks, [{ groundingChunkIndices: [0, 99, -1] }]);
    assert.deepEqual(cited.map((s) => s.url), ['https://acme.com']);
  });

  test('promotes a bare-hostname title when domain is absent, which is what the API actually sends', () => {
    const live = [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQ', title: 'rippling.com' } }];
    assert.deepEqual(geminiRetrieved(live), [{ url: 'https://rippling.com', title: 'rippling.com' }]);
  });

  test('a real page title is NEVER promoted into a url', () => {
    const prose = [{ web: { uri: 'https://example.com/post', title: 'Best tools for paying contractors' } }];
    assert.deepEqual(geminiRetrieved(prose), [{ url: 'https://example.com/post', title: 'Best tools for paying contractors' }]);
  });

  test('keeps an unresolvable redirect rather than dropping the source', () => {
    assert.equal(geminiRetrieved([{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/XYZ' } }]).length, 1);
  });

  test('a drifted shape yields empty rather than throwing', () => {
    assert.deepEqual(geminiRetrieved([{}, { web: {} }]), []);
    assert.deepEqual(geminiCited([], [{ groundingChunkIndices: [0] }]), []);
  });
});
