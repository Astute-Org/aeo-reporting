// Rule-based scoring: turning one engine answer into observation rows.
//
// Imports nothing but the matcher, so the function that decides what a
// company is told it received is executable in a test with no database, no
// keys and no network. And because it is pure over stored rows, changing a
// rule is a re-scoring job rather than a re-run - the raw payloads are kept
// for exactly that.

import { canonicalizeUrl, matchUrl, mentionsBrand, stripUrlsPreserving } from './citation-match.js';

export type ObservationKind = 'retrieved' | 'cited' | 'linked_mention' | 'unlinked_mention';
export type ObservationSubject = 'company' | 'competitor';
export type MatchedOn = 'exact_url' | 'domain' | 'brand_name';

export interface ScorableCompany {
  id: string;
  name: string;
  domain?: string | null;
  aliases?: string[] | null;
  canonical_url?: string | null;
  url?: string | null;
}

export interface ScorableAnswer {
  answerText: string;
  cited: { url: string; title?: string | null }[];
  retrieved: { url: string; title?: string | null }[];
}

export interface ObservationInsert {
  answer_id: string;
  company_id: string;
  kind: ObservationKind;
  subject: ObservationSubject;
  matched_on: MatchedOn;
  label?: string | null;
  url?: string | null;
  domain?: string | null;
}

/**
 * Score one answer against one company.
 *
 * Deliberately does NOT decide position, sentiment or context. Those require
 * reading how the answer treats a brand, which is the judge's job, and they
 * are filled by the separate LLM pass. Leaving them absent here means an
 * un-enriched row reads as "not assessed" rather than carrying a default that
 * would be indistinguishable from a measurement.
 */
export function scoreAnswer(
  answerId: string,
  company: ScorableCompany,
  answer: ScorableAnswer,
): ObservationInsert[] {
  const rows: ObservationInsert[] = [];
  const site = {
    canonicalUrl: company.canonical_url ?? company.url,
    domain: company.domain,
  };

  // Cited and retrieved get identical matching but distinct kinds. The gap
  // between the two is the diagnostic the report leans on: retrieved and not
  // cited means the site is found and passed over, never retrieved means it is
  // not found at all, and the remedies are opposites.
  for (const [kind, sources] of [
    ['cited', answer.cited],
    ['retrieved', answer.retrieved],
  ] as const) {
    const seen = new Set<string>();
    for (const src of sources) {
      const matchedOn = matchUrl(src.url, site);
      if (!matchedOn) continue;
      const canon = canonicalizeUrl(src.url);
      // One answer citing the same page twice is one citation.
      if (canon && seen.has(canon)) continue;
      if (canon) seen.add(canon);
      rows.push({
        answer_id: answerId,
        company_id: company.id,
        kind,
        subject: 'company',
        matched_on: matchedOn,
        label: company.name,
        url: canon,
        domain: null,
      });
    }
  }

  // The company being named is the thing that matters most, and it happens
  // whether or not its site is linked. Aliases are checked because a brand
  // that changed name is still that brand.
  const terms = [company.name, ...(company.aliases ?? [])].filter((t): t is string => Boolean(t));
  // Matched against the PROSE, with URLs stripped. A company whose only
  // appearance is inside a link it was already credited a citation for has
  // not been talked about.
  const prose = stripUrlsPreserving(answer.answerText, terms);
  const namedAs = terms.find((t) => mentionsBrand(prose, t));
  if (namedAs) {
    const linked = company.domain
      ? answer.cited.some((s) => matchUrl(s.url, { domain: company.domain }) !== null)
      : false;
    rows.push({
      answer_id: answerId,
      company_id: company.id,
      kind: linked ? 'linked_mention' : 'unlinked_mention',
      subject: 'company',
      matched_on: 'brand_name',
      label: namedAs,
      domain: company.domain ?? null,
    });
  }

  return rows;
}
