import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText } from './scrape.js';

describe('htmlToText', () => {
  test('keeps the title, description and body text, and drops scripts and styles', () => {
    const html = `<html><head><title>Acme Meals</title>
      <meta name="description" content="Healthy meal plans, delivered daily.">
      <style>.x{color:red}</style><script>window.__x = 1;</script></head>
      <body><nav>Menu</nav><h1>Eat well &amp; save time</h1><p>Plans from 5 &#163; a day.</p>
      <noscript>enable js</noscript></body></html>`;
    const text = htmlToText(html);
    assert.match(text, /Acme Meals/);
    assert.match(text, /Healthy meal plans, delivered daily/);
    assert.match(text, /Eat well & save time/);
    assert.match(text, /5 £ a day/);
    assert.doesNotMatch(text, /window\.__x/);
    assert.doesNotMatch(text, /color:red/);
    assert.doesNotMatch(text, /enable js/);
  });

  test('turns block boundaries into line breaks so paragraphs do not run together', () => {
    const text = htmlToText('<div>one</div><div>two</div><p>three</p>');
    assert.match(text, /one\ntwo\nthree/);
  });

  test('is bounded', () => {
    assert.ok(htmlToText(`<p>${'x'.repeat(50_000)}</p>`).length <= 12_000);
  });
});
