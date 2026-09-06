// Page text for question generation.
//
// The generator only needs enough of a company's site to identify the market
// it competes in, so a plain fetch with the tags stripped is enough for most
// sites. Firecrawl is used when a key is present, because it renders
// JavaScript-heavy pages that a plain fetch returns empty.

import { config } from './config.js';

const MAX_CHARS = 12_000;

function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

async function firecrawlScrape(url: string): Promise<string> {
  try {
    const resp = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.firecrawlApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) return '';
    const json = (await resp.json()) as { success?: boolean; data?: { markdown?: string } };
    return json.success && json.data?.markdown ? json.data.markdown.slice(0, MAX_CHARS) : '';
  } catch {
    return '';
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#x2F': '/',
};

/** A rough but dependable HTML-to-text: strips scripts, styles and tags. */
export function htmlToText(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  const description =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(html)?.[1] ??
    '';
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?x?[0-9a-z]+);/gi, (m, code: string) => {
      if (ENTITIES[code]) return ENTITIES[code];
      if (/^#x[0-9a-f]+$/i.test(code)) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (/^#[0-9]+$/.test(code)) return String.fromCodePoint(parseInt(code.slice(1), 10));
      return m;
    })
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  return [title.trim(), description.trim(), body].filter(Boolean).join('\n\n').slice(0, MAX_CHARS);
}

async function plainScrape(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; aeo-reporting/0.1; +https://github.com)',
        accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) return '';
    const type = resp.headers.get('content-type') ?? '';
    if (!/html|xml|text/i.test(type)) return '';
    return htmlToText(await resp.text());
  } catch {
    return '';
  }
}

/** The page as text, or '' when nothing usable could be read. Never throws. */
export async function fetchPageText(url: string): Promise<string> {
  const normalized = normalizeUrl(url.trim());
  if (config.firecrawlApiKey) {
    const viaFirecrawl = await firecrawlScrape(normalized);
    if (viaFirecrawl.trim().length > 200) return viaFirecrawl;
  }
  return plainScrape(normalized);
}
