// Deciding whether a thing an answer engine cited or said is OURS.
//
// No imports at all: this is the rule set every number rests on, and it has
// to be reachable from a unit test without a database or a vendor key.
//
// The stakes are asymmetric in a way worth stating. A false negative
// under-reports the company. A false positive tells the company it was named
// when it was not, which is the claim that gets retracted. Every rule below
// fails closed: when a match is not confidently ours, it is not ours.

/**
 * Query parameters that carry no identity, only attribution.
 *
 * Allowlist-strip, never blocklist-keep. Dropping every parameter and
 * comparing paths is wrong: ?v= IS the video on YouTube and ?p= IS the post on
 * a default WordPress install, so a blanket strip collapses distinct pages
 * into one.
 */
const TRACKING_PARAMS = new Set([
  // Google Analytics and the wider utm convention
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_name', 'utm_reader', 'utm_brand',
  // Ad platform click ids
  'gclid', 'gclsrc', 'gad_source', 'gbraid', 'wbraid', 'dclid',
  'fbclid', 'msclkid', 'twclid', 'ttclid', 'igshid', 'li_fat_id',
  // Email service providers
  'mc_cid', 'mc_eid', 'mkt_tok', 'vero_id', 'vero_conv',
  '_hsenc', '_hsmi', 'hsa_acc', 'hsa_cam', 'hsa_grp', 'hsa_ad',
  'hsa_src', 'hsa_tgt', 'hsa_kw', 'hsa_mt', 'hsa_net', 'hsa_ver',
  // Platform-native referrers
  'ref', 'ref_src', 'ref_url', 'source', 'trk', 'trkinfo',
  // Newsletter share params, which appear on almost every newsletter URL an
  // engine surfaces because that is the form people share
  'r', 'showwelcome', 'triedredirect', '_bhlid',
  // YouTube share params. 'si' only, never 'v' or 't'
  'si', 'feature', 'pp',
]);

/**
 * A URL reduced to the form two references to the same page will agree on.
 *
 * Returns null rather than throwing for anything unparseable. Answer engines
 * emit malformed URLs often enough - truncated at a line break, wrapped in
 * markdown punctuation - that a throwing parser here would abort the scoring
 * of an otherwise good answer.
 */
export function canonicalizeUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  // Engines routinely hand back a URL welded to the punctuation around it.
  // Strip only from the ends, and only characters that cannot begin or end a
  // real URL.
  const trimmed = s.replace(/^[<("'[\s]+/, '').replace(/[>)"'\].,;:\s]+$/, '');
  if (!trimmed) return null;

  // Reject a foreign scheme BEFORE assuming https for a scheme-less input.
  // Prepending https to "mailto:someone@acme.com" produces a URL that parses
  // as host acme.com, so a mailto link would otherwise be recorded as a
  // citation of the company's domain.
  const scheme = /^([a-z][a-z0-9+-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') return null;

  let u: URL;
  try {
    u = new URL(scheme ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!host || !host.includes('.')) return null;

  // Fragments never identify a distinct page for citation purposes.
  u.hash = '';

  const params = new URLSearchParams();
  for (const [k, v] of u.searchParams) {
    if (TRACKING_PARAMS.has(k.toLowerCase())) continue;
    params.append(k, v);
  }

  // Sorted so ?a=1&b=2 and ?b=2&a=1 canonicalise identically.
  const sorted = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = sorted.length ? `?${sorted.map(([k, v]) => `${k}=${v}`).join('&')}` : '';

  const path = u.pathname.replace(/\/+$/, '');

  return `https://${host}${path}${query}`;
}

/**
 * The host of a URL, minus www, or null.
 *
 * Deliberately not a public-suffix-aware registrable domain: treating
 * acme.substack.com as equivalent to substack.com would be actively wrong.
 */
export function domainOf(raw: string | null | undefined): string | null {
  const canon = canonicalizeUrl(raw);
  if (!canon) return null;
  try {
    return new URL(canon).hostname;
  } catch {
    return null;
  }
}

export type UrlMatch = 'exact_url' | 'domain' | null;

export interface SiteIdentity {
  /** The page we most want cited, typically the homepage. */
  canonicalUrl?: string | null;
  /** The company's whole property. Any page on it is a domain match. */
  domain?: string | null;
}

/**
 * Whether a URL an engine surfaced belongs to this company, and on what basis.
 *
 * Exact beats domain because they are reported separately: a domain hit says
 * the company's site earned a citation, an exact hit says this specific page
 * did.
 */
export function matchUrl(candidate: string | null | undefined, site: SiteIdentity): UrlMatch {
  const candCanon = canonicalizeUrl(candidate);
  if (!candCanon) return null;

  const siteCanon = canonicalizeUrl(site.canonicalUrl);
  if (siteCanon && candCanon === siteCanon) return 'exact_url';

  const candHost = domainOf(candCanon);
  // The domain is commonly stored bare ("acme.com") rather than as a URL.
  // canonicalizeUrl assumes https for a scheme-less input, so domainOf handles
  // both forms through one parsing path.
  const siteHost = domainOf(site.domain);

  if (candHost && siteHost && candHost === siteHost) return 'domain';

  return null;
}

/**
 * Is this brand actually named in the answer text.
 *
 * Word-boundary anchored and case-insensitive. The naive `text.includes(name)`
 * is unusable for real brand names: "Wise" matches "otherwise" and "likewise",
 * "Notion" matches "notional", and a brand whose name is a common word would
 * report near-100% mention rate on every panel forever.
 *
 * Boundaries are defined so that a name can still be found adjacent to
 * punctuation ("Acme," / "(Acme)" / "Acme's"), which is how a brand normally
 * appears in prose.
 */
export function mentionsBrand(text: string | null | undefined, brand: string | null | undefined): boolean {
  const hay = (text ?? '').toLowerCase();
  const needle = (brand ?? '').trim().toLowerCase();
  if (!hay || !needle) return false;

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // An internal space in the brand matches any run of whitespace, since an
  // answer may wrap a two-word brand across a line.
  const pattern = escaped.replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${pattern}($|[^\\p{L}\\p{N}])`, 'iu').test(hay);
}

/**
 * The same text with every URL removed.
 *
 * Needed because mentionsBrand is word-boundary anchored and a URL is full of
 * word boundaries: "https://wise.com/gb/compare" contains "Wise" bounded by `/`
 * and `.`, so an answer that merely LINKS a company, without naming it in a
 * sentence, would be counted as a mention. Citations are counted separately,
 * so scoring a bare link as both would double-count one event across two
 * metrics.
 */
export function stripUrls(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\bhttps?:\/\/\S+/gi, ' ')
    // Scheme-less hosts, which answer engines emit as often as full URLs
    // ("see acme.com/pricing"). Two rules, because the two shapes carry
    // different evidence that a token is a link and not a sentence.
    //
    // WITH a path, any TLD counts: the slash is the proof.
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.[a-z]{2,24}\/\S*/gi, ' ')
    // WITHOUT a path the allowlist stays, because nothing else separates
    // "acme.com" from an unspaced sentence break like "the end.Next we tried".
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|ai|co|dev|app|so|xyz)\b/gi, ' ');
}

/**
 * stripUrls, but never at the cost of the brand we are looking for.
 *
 * Some brands ARE shaped like a host: Copy.ai, Booking.com, Calo.app. For
 * those, "Copy.ai is the tool most teams start with" became "  is the tool
 * most teams start with" before mentionsBrand ever saw it, so mention rate for
 * such a company was structurally zero forever.
 *
 * Only domain-shaped terms are shielded (the test is literally "would stripUrls
 * eat this term whole"), and only where the occurrence is not itself part of a
 * link:
 *
 *   "Copy.ai is great"        -> kept, a prose mention
 *   "see copy.ai/pricing"     -> stripped, a link with a path
 *   "https://copy.ai"         -> stripped, a link with a scheme
 *   "via www.copy.ai"         -> stripped, part of a longer host
 */
export function stripUrlsPreserving(text: string | null | undefined, terms: string[]): string {
  const shielded = terms.filter((t) => t.trim() && stripUrls(t).trim() === '');
  if (!shielded.length) return stripUrls(text);

  // NUL-delimited so the placeholder cannot occur in real text and cannot be
  // mistaken for a host: no dots, so the scheme-less rule skips it.
  const restore: [string, string][] = [];
  let out = text ?? '';
  shielded.forEach((term, i) => {
    const token = ` aeobrand${i} `;
    restore.push([token, term]);
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\w./-])${escaped}(?![\\w-])(?!/)`, 'gi'), token);
  });

  out = stripUrls(out);
  for (const [token, term] of restore) out = out.split(token).join(term);
  return out;
}
