/**
 * Jurisdictions and their authoritative source whitelists for web-grounded lesson generation.
 *
 * When a lesson is generated, the topic is matched against these jurisdictions and Tavily
 * searches are restricted to the matching jurisdiction's authoritative domains. This stops the
 * generator from fabricating jurisdiction-confused content (US tax rules in UK lessons etc.).
 */

export interface Jurisdiction {
  code: string;
  name: string;
  /**
   * Domains that count as authoritative primary sources for this jurisdiction.
   * Tavily is asked to restrict its search to these.
   */
  domains: string[];
  /**
   * Lower-case phrases that, if present in the topic, signal this jurisdiction.
   * Used as a fast pre-LLM heuristic.
   */
  signals: string[];
}

export const JURISDICTIONS: Jurisdiction[] = [
  {
    code: 'UK',
    name: 'United Kingdom',
    domains: [
      'gov.uk',
      'legislation.gov.uk',
      'hmrc.gov.uk',
      'frc.org.uk',
      'fca.org.uk',
      'icaew.com',
      'accaglobal.com',
      'tax.org.uk',
      'iaasb.org',
      'ifrs.org',
      'ifac.org',
      'pra.bankofengland.co.uk',
    ],
    signals: [
      'uk', 'united kingdom', 'great britain', 'england', 'scotland', 'wales', 'northern ireland',
      'hmrc', 'gov.uk', 'frc', 'icaew', 'acca', 'ciot',
      'ittoia', 'cta 2009', 'cta 2010', 'tcga', 'fa 2024', 'fa 2025', 'tma', 'vata',
      'frs 102', 'frs 105', 'frs 100', 'frs 101', 'isa (uk)', 'isa uk', 'practice note',
      'sterling', '£', 'gbp', 'pound', 'pounds',
      'self assessment', 'self-assessment', 'corporation tax', 'income tax', 'capital gains tax',
      'inheritance tax', 'national insurance', 'paye', 'cis', 'ir35',
      'companies house', 'companies act 2006',
    ],
  },
  {
    code: 'US',
    name: 'United States',
    domains: [
      'irs.gov',
      'sec.gov',
      'fasb.org',
      'aicpa.org',
      'aicpa-cima.com',
      'pcaobus.org',
      'gao.gov',
      'congress.gov',
      'law.cornell.edu',
    ],
    signals: [
      'us', 'usa', 'united states', 'america', 'american',
      'irs', 'sec', 'fasb', 'aicpa', 'pcaob', 'gaap us', 'us gaap',
      '401(k)', '401k', 'ira', 'roth', 'macrs', 'section 1031', 'section 179',
      'subchapter s', 's-corp', 'c-corp', 'llc',
      'federal tax', 'state tax', 'aotr',
      'asc 842', 'asc 606', 'asc 740', 'asc 805',
      'usd', 'dollar', '$',
    ],
  },
  {
    code: 'IE',
    name: 'Ireland',
    domains: [
      'revenue.ie',
      'irishstatutebook.ie',
      'charteredaccountants.ie',
      'cpaireland.ie',
      'cro.ie',
      'centralbank.ie',
      'ifrs.org',
    ],
    signals: ['ireland', 'irish', 'revenue commissioners', 'tca 1997', 'cro.ie', 'cgt ireland', 'usc'],
  },
  {
    code: 'AU',
    name: 'Australia',
    domains: [
      'ato.gov.au',
      'asic.gov.au',
      'aasb.gov.au',
      'auasb.gov.au',
      'cpaaustralia.com.au',
      'charteredaccountantsanz.com',
      'legislation.gov.au',
    ],
    signals: [
      'australia', 'australian', 'ato', 'asic', 'aasb', 'auasb',
      'fbt', 'gst australia', 'super', 'superannuation', 'aud', 'a$',
      'aasb 16', 'aasb 15',
    ],
  },
  {
    code: 'CA',
    name: 'Canada',
    domains: [
      'canada.ca',
      'cra-arc.gc.ca',
      'cpacanada.ca',
      'osfi-bsif.gc.ca',
      'osc.ca',
      'laws-lois.justice.gc.ca',
    ],
    signals: ['canada', 'canadian', 'cra', 'cpa canada', 'cad', 't1', 't2', 'rrsp', 'tfsa'],
  },
  {
    code: 'INTERNATIONAL',
    name: 'International (IFRS / ISA)',
    domains: ['ifrs.org', 'ifac.org', 'iaasb.org', 'oecd.org'],
    signals: ['ifrs', 'international financial reporting', 'ias ', 'iaasb', 'isa international', 'oecd'],
  },
];

const UK = JURISDICTIONS[0];

/**
 * Pick the best-fit jurisdiction(s) for a topic. Heuristic-first to save an LLM call.
 * Returns up to 2 jurisdictions (most topics are mono-jurisdictional, but cross-border ones
 * sometimes span e.g. UK + International).
 */
export function detectJurisdictions(topic: string): Jurisdiction[] {
  const t = topic.toLowerCase();
  const scored = JURISDICTIONS.map((j) => {
    const hits = j.signals.filter((s) => t.includes(s)).length;
    return { j, hits };
  })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  if (scored.length === 0) return [UK]; // default: UK
  if (scored.length === 1) return [scored[0].j];
  // If the top two are both strong (≥2 hits each), include both — likely cross-border lesson.
  if (scored[1].hits >= 2 && scored[0].hits - scored[1].hits <= 1) {
    return [scored[0].j, scored[1].j];
  }
  return [scored[0].j];
}

/** Combine domains across multiple jurisdictions (deduplicated). */
export function combinedDomains(jurisdictions: Jurisdiction[]): string[] {
  return Array.from(new Set(jurisdictions.flatMap((j) => j.domains)));
}
