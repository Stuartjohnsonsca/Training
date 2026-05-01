import { chat, FAST_MODEL } from './together';
import { Jurisdiction, combinedDomains } from './jurisdictions';

export interface GroundedSource {
  /** Display name shown to the LLM and the learner. */
  filename: string;
  /** Plain-text content (cleaned, ≤ ~3000 chars per source). */
  text: string;
  url: string;
  domain: string;
}

export interface GroundingPack {
  jurisdictions: string[];
  queries: string[];
  sources: GroundedSource[];
}

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

/**
 * Build a grounding pack for a lesson topic.
 *  1. Generate ~5 targeted search queries (LLM, fast)
 *  2. Run each query against Tavily, restricted to the jurisdiction's authoritative domains
 *  3. Return the resulting source snippets, deduplicated by URL
 *
 * The lesson generator then treats these snippets as the SOLE authority for specific facts
 * (rates, sections, case names, thresholds). Anything not present in the snippets must be
 * stated only as a general principle.
 */
export async function buildGroundingPack(opts: {
  topic: string;
  jurisdictions: Jurisdiction[];
  maxQueries?: number;
  maxResultsPerQuery?: number;
}): Promise<GroundingPack> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn('[grounding] TAVILY_API_KEY not set — skipping web grounding');
    return { jurisdictions: opts.jurisdictions.map((j) => j.code), queries: [], sources: [] };
  }

  const queries = await generateSearchQueries({
    topic: opts.topic,
    jurisdictions: opts.jurisdictions,
    n: opts.maxQueries ?? 5,
  });
  if (queries.length === 0) {
    return { jurisdictions: opts.jurisdictions.map((j) => j.code), queries: [], sources: [] };
  }

  const domains = combinedDomains(opts.jurisdictions);
  const maxResults = opts.maxResultsPerQuery ?? 3;

  const allSources = await Promise.all(
    queries.map((q) => tavilySearch(apiKey, q, domains, maxResults).catch((e) => {
      console.error(`[grounding] search failed for "${q}":`, e?.message ?? e);
      return [] as GroundedSource[];
    })),
  );

  // Deduplicate by URL — different queries often hit the same gov.uk page.
  const byUrl = new Map<string, GroundedSource>();
  for (const list of allSources) {
    for (const s of list) {
      if (!byUrl.has(s.url)) byUrl.set(s.url, s);
    }
  }

  return {
    jurisdictions: opts.jurisdictions.map((j) => j.code),
    queries,
    sources: Array.from(byUrl.values()),
  };
}

async function tavilySearch(
  apiKey: string,
  query: string,
  domains: string[],
  maxResults: number,
): Promise<GroundedSource[]> {
  const res = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
      max_results: maxResults,
      include_domains: domains,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Tavily ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const results: any[] = data?.results ?? [];
  return results
    .filter((r) => r?.url && r?.content)
    .map((r) => {
      let domain = '';
      try {
        domain = new URL(r.url).hostname.replace(/^www\./, '');
      } catch {}
      const text = String(r.content).replace(/\s+/g, ' ').trim().slice(0, 3000);
      const title = String(r.title ?? domain).trim();
      return {
        filename: `${title} (${domain})`,
        text,
        url: r.url,
        domain,
      } satisfies GroundedSource;
    });
}

async function generateSearchQueries(opts: {
  topic: string;
  jurisdictions: Jurisdiction[];
  n: number;
}): Promise<string[]> {
  const sites = opts.jurisdictions.map((j) => `${j.name} (${j.domains.slice(0, 5).join(', ')}...)`).join('; ');
  const text = await chat({
    model: FAST_MODEL,
    messages: [
      {
        role: 'system',
        content: `You write web search queries that will retrieve authoritative primary sources for a training topic.
The user will paste the topic. Reply with ONE JSON object: {"queries": ["...","..."]} containing exactly ${opts.n} short queries, each 4-10 words.

Rules:
- Each query should target a DIFFERENT sub-aspect of the topic so the search results collectively cover the whole.
- Phrase queries as a researcher would: include statute/standard names ("ITTOIA section property income"), specific concepts ("FRS 102 finance lease classification"), or rate/threshold queries ("UK corporation tax rate current").
- Searches will be restricted to these authoritative jurisdictions: ${sites}
- Do not include "site:" filters in the query — domain filtering is handled separately.
- Output ONLY the JSON object.`,
      },
      { role: 'user', content: opts.topic },
    ],
    maxTokens: 400,
    temperature: 0.2,
    json: true,
  });

  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const obj = JSON.parse(text.slice(start, end + 1));
    if (Array.isArray(obj?.queries)) {
      return obj.queries.map((q: unknown) => String(q).trim()).filter(Boolean).slice(0, opts.n);
    }
  } catch (e) {
    console.error('[grounding] could not parse queries', e);
  }
  return [];
}

/** Format a grounding pack as a system-prompt block the generator can use. */
export function buildGroundingBlock(pack: GroundingPack): string {
  if (pack.sources.length === 0) {
    return `

GROUNDING — no authoritative sources were retrieved for this lesson. Be EXTRA cautious about specific citations: state principles only, do NOT invent section numbers, case names, rates, or thresholds.`;
  }
  return `

GROUNDING SOURCES — these are excerpts from authoritative primary sources retrieved live for this lesson. They are your ONLY permitted source for specific facts (statute section numbers, case names, rates, thresholds, dates, ISA paragraph references, FRS section numbers).

Rules of use:
- If a specific fact appears in the sources below, you may state it (and cite the source by domain in speakerNotes, e.g. "as gov.uk explains...").
- If a specific fact does NOT appear in these sources, you MUST NOT state it as a specific. Speak generally instead ("the relevant section of ITTOIA 2005") or refer the learner to the primary source ("verify the current rate at gov.uk/hmrc-rates").
- The principles you teach should align with the sources. Where the sources are silent on something, teach the broad principle drawing on your general training.

${pack.sources
  .map((s, i) => `--- Source ${i + 1}: ${s.filename} ---\n  URL: ${s.url}\n  Excerpt: ${s.text.slice(0, 1500)}`)
  .join('\n\n')}`;
}
