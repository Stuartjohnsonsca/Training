import { chat } from './together';
import type { LessonSlide } from './lesson-generator';

export interface ReviewFindings {
  /** Critical gaps the slides should have covered but didn't. */
  missingAspects: string[];
  /** Specific legislation / rates / dates referenced in the slides that may be outdated and should be verified. */
  currencyCaveats: string[];
  /** Factual statements the reviewer is uncertain about — flag for the learner to verify. */
  factualConcerns: string[];
  /** True if the missingAspects are serious enough to merit regenerating slides. */
  needsBackfill: boolean;
}

/**
 * Review a generated lesson for accuracy + completeness BEFORE the quiz is generated and the
 * lesson is shown to the learner. Returns structured findings; the caller decides whether to
 * regenerate slides or just surface the caveats.
 */
export async function reviewLesson(opts: {
  topic: string;
  title: string;
  objectives: string[];
  slides: LessonSlide[];
  /** Optional: any uploaded source material. If present, the review checks the slides against it. */
  sourcesContext?: string;
  /** Optional: live grounded sources (Tavily-fetched primary sources). Specifics outside this corpus are forbidden. */
  groundingContext?: string;
}): Promise<ReviewFindings> {
  const slideSummary = opts.slides
    .map((s, i) => `Slide ${i + 1}: ${s.title}\n  - ${(s.bullets ?? []).join('\n  - ')}\n  Notes: ${s.speakerNotes.slice(0, 200)}`)
    .join('\n\n');

  const sourcesBlock = opts.sourcesContext
    ? `\n\nSOURCE MATERIAL (the lesson was supposed to teach this):\n${opts.sourcesContext.slice(0, 20000)}`
    : '';
  const groundingBlock = opts.groundingContext
    ? `\n\nGROUNDING SOURCES (live primary sources — every specific fact in the lesson must be derivable from these):\n${opts.groundingContext.slice(0, 30000)}`
    : '\n\nGROUNDING SOURCES: (none retrieved). Treat any specific fact in the lesson as a likely fabrication and flag it.';

  const text = await chat({
    messages: [
      {
        role: 'system',
        content: `You are a senior UK subject-matter reviewer auditing a draft training lesson before it goes to a learner. Your job is to catch gaps, jurisdictional errors, outdated legislation/rates, and factual concerns. You are SCEPTICAL by default — flag anything you're not 90% confident about.

Reply with ONE JSON object and nothing else:

{
  "missingAspects": [string, ...],   // Critical sub-topics or aspects of the topic that the slides DO NOT cover but should. Be specific. Empty array if none.
  "currencyCaveats": [string, ...],  // Specific rates, thresholds, legislation references, or dates mentioned in the slides that may be outdated. Phrase as "Verify the X% rate against current HMRC guidance" etc. Empty array if none.
  "factualConcerns": [string, ...],  // Statements that look INCORRECT, jurisdictionally wrong, or where you have low confidence. Be blunt: name the slide and the wrong claim. Empty array if none.
  "needsBackfill": boolean           // true if missingAspects contains items the lesson genuinely cannot work without (the learner would walk away with a dangerous gap), OR if factualConcerns includes a flat-out wrong claim. false if the lesson is broadly complete and accurate.
}

PRIMARY DUTY: enforce STRICT MODE. Specific facts are forbidden UNLESS they appear verbatim in the grounding sources provided to you below. Any specific not in grounding is a fabrication risk and must be flagged.

For every specific fact in a slide, classify it as one of:
  (a) PRESENT IN GROUNDING — the same fact (section number, case, rate, threshold, date) appears in the grounding sources. ALLOWED. Don't flag.
  (b) NOT IN GROUNDING — the slide states a specific that does not appear in the grounding sources. POLICY VIOLATION. Flag in factualConcerns by name and slide number, and set needsBackfill=true.

Specific-fact categories you must check (and only allow if found in grounding):
- Statute / Act section numbers (e.g. "s.272A ITTOIA")
- Case names with citation/year
- HMRC manual paragraph references (PIM/CCM/etc.)
- Monetary thresholds (£12,300, £85,000) — illustrative figures inside "Assume X" calculation questions are OK
- Tax rates as a number (19%, 25%, 20%) — illustrative rates inside "Assume X" calculation questions are OK
- Effective dates / "in force from" dates
- ISA UK / FRS / IFRS paragraph or sub-section references
- NI band / personal allowance / dividend allowance / CGT annual exemption / IHT nil-rate band as a number
- HMRC published rates as a number (e.g. AMAP, simplified mileage)

When you flag, name the slide and quote the offending phrase. Example: "Slide 3 cites 's.272A ITTOIA' but this section number is not in any grounding source — possible fabrication; reword to 'the relevant ITTOIA provision' with a 'verify on gov.uk' note."

Reviewing principles — these are the things to actively HUNT for:

JURISDICTIONAL ERRORS (especially UK vs US tax/accounting confusion):
- The audience is UK. Default jurisdiction is UK unless the topic explicitly says IFRS / international / non-UK.
- Flag US-isms in UK lessons: "depreciation deductible for tax purposes" (NO — UK adds depreciation back, then claims capital allowances), 401(k), IRA, IRS, federal/state tax, S-corp/C-corp, MACRS, Section 1031, etc.
- Flag IFRS rules mistakenly applied to FRS 102 / FRS 105 (or vice versa). Lease accounting differs hugely: IFRS 16 puts almost all leases on balance sheet; FRS 102 Section 20 keeps the operating/finance distinction.

UK TAX SPECIFICS (high-priority confusion areas):
- Property/rental: depreciation is NOT a tax-deductible expense. Capital allowances apply only to commercial property (Structures & Buildings Allowance 3% from Oct 2018) and Furnished Holiday Lets. NO general capital allowances on residential dwellings.
- Property/rental: replacement of domestic items relief (s.311A ITTOIA) replaced wear & tear in 2016.
- Residential landlord finance costs: 20% basic-rate tax reducer only (s.272A ITTOIA), NOT a deduction from profit.
- Property losses are ring-fenced to the same property business.
- Trading vs property income: NOT interchangeable.
- Cash basis vs accruals basis defaults differ (individuals vs companies, threshold £150k for individuals).

UK ACCOUNTING SPECIFICS:
- FRS 102 vs FRS 105 (micro) vs IFRS — different recognition rules, especially for leases, financial instruments, intangibles, deferred tax.
- "GAAP" alone is ambiguous; UK GAAP since 2015 = FRS 102 / FRS 105 (FRS 100 framework).

LEGISLATION CURRENCY (always flag for verification):
- ANY specific tax rate, threshold, allowance, NI band, dividend allowance, CGT annual exemption, VAT threshold, IHT nil-rate band — these change annually. Add a currencyCaveat for each.
- Standards that have been revised: ISA (UK) 315 (revised 2022, effective for periods from 15 Dec 2022), FRS 102 periodic reviews.

If the topic specifies a scope (e.g. "individual landlord, Income Tax"), do NOT flag the absence of company/Corporation Tax content — that's out of scope by design. But DO flag if the slides drift into the OTHER scope by accident.

Currency caveats should ALWAYS include a generic "Verify current rates / thresholds against the latest HMRC / FRC / IASB pronouncements" entry if the lesson references any numeric rates or thresholds.

Be HONEST about uncertainty. If you don't know whether a stat is current or whether a rule applies, list it. Better to flag a real concern than to wave through a wrong lesson.`,
      },
      {
        role: 'user',
        content: `Topic the lesson is supposed to teach:
"${opts.topic}"

Lesson title: ${opts.title}
Objectives:
${opts.objectives.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}

Slides:
${slideSummary}${sourcesBlock}${groundingBlock}`,
      },
    ],
    maxTokens: 2500,
    temperature: 0.2,
    json: true,
  });

  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const obj = JSON.parse(text.slice(start, end + 1));
    return {
      missingAspects: arrayOfStrings(obj.missingAspects),
      currencyCaveats: arrayOfStrings(obj.currencyCaveats),
      factualConcerns: arrayOfStrings(obj.factualConcerns),
      needsBackfill: Boolean(obj.needsBackfill),
    };
  } catch (e) {
    console.error('[reviewer] could not parse review, returning empty findings', e);
    return { missingAspects: [], currencyCaveats: [], factualConcerns: [], needsBackfill: false };
  }
}

function arrayOfStrings(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.map((v) => String(v).trim()).filter(Boolean);
}

/** Generate one or more "backfill" slides to address critical gaps the reviewer found. */
export async function backfillSlides(opts: {
  topic: string;
  title: string;
  existingSlides: LessonSlide[];
  missingAspects: string[];
  categorySystemPrompt: string;
  sourcesContext?: string;
}): Promise<{ slides: LessonSlide[] }> {
  const wantedCount = Math.min(3, opts.missingAspects.length);
  const idStart = opts.existingSlides.length + 1;
  const slideSummary = opts.existingSlides
    .map((s, i) => `  ${i + 1}. ${s.title}`)
    .join('\n');

  const text = await chat({
    messages: [
      {
        role: 'system',
        content: `You are filling in gaps the senior reviewer flagged in a draft training lesson. Output ONE JSON object with the new slides ONLY:

{
  "slides": [   // exactly ${wantedCount} new slides covering the missing aspects below
    { "id": "n_b${idStart}" (then n_b${idStart + 1}, ...), "title": string, "bullets": string[3-6], "speakerNotes": string (60-110 spoken words), "theme": "concept"|"example"|"warning"|"recap"|"default", "svg": "" }
  ]
}

${opts.categorySystemPrompt}

Lesson "${opts.title}" — slides ALREADY taught:
${slideSummary}

The reviewer flagged these as critical missing aspects to add:
${opts.missingAspects.slice(0, 3).map((a, i) => `  ${i + 1}. ${a}`).join('\n')}

Each new slide should address one of those aspects. Don't repeat material from existing slides. Speaker notes spell out symbols ("eighteen thousand pounds"); bullets use proper formatting (£18,000, %). Output ONLY the JSON.`,
      },
      { role: 'user', content: `Topic: ${opts.topic}` },
    ],
    maxTokens: 4000,
    temperature: 0.55,
    json: true,
  });

  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const obj = JSON.parse(text.slice(start, end + 1));
    if (Array.isArray(obj.slides) && obj.slides.length > 0) return { slides: obj.slides };
  } catch (e) {
    console.error('[reviewer/backfill] could not parse, returning none', e);
  }
  return { slides: [] };
}
