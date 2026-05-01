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
}): Promise<ReviewFindings> {
  const slideSummary = opts.slides
    .map((s, i) => `Slide ${i + 1}: ${s.title}\n  - ${(s.bullets ?? []).join('\n  - ')}\n  Notes: ${s.speakerNotes.slice(0, 200)}`)
    .join('\n\n');

  const sourcesBlock = opts.sourcesContext
    ? `\n\nSOURCE MATERIAL (the lesson was supposed to teach this):\n${opts.sourcesContext.slice(0, 20000)}`
    : '';

  const text = await chat({
    messages: [
      {
        role: 'system',
        content: `You are a senior subject-matter reviewer auditing a draft training lesson before it goes to a learner. Your job is to catch gaps, outdated legislation/rates, and factual concerns.

Reply with ONE JSON object and nothing else:

{
  "missingAspects": [string, ...],   // Critical sub-topics or aspects of the topic that the slides DO NOT cover but should. Be specific. Empty array if none.
  "currencyCaveats": [string, ...],  // Specific rates, thresholds, legislation references, or dates mentioned in the slides that may be outdated. Phrase as "Verify the X% rate against current HMRC guidance" etc. Empty array if none.
  "factualConcerns": [string, ...],  // Statements you are uncertain about or that look incorrect. Empty array if none.
  "needsBackfill": boolean           // true if missingAspects contains items the lesson genuinely cannot work without (the learner would walk away with a dangerous gap). false if the lesson is broadly complete.
}

Reviewing principles:
- Treat the topic literally — if the topic specifies "individual landlord, Income Tax", do NOT flag the absence of company/Corporation Tax content (that's out of scope by design).
- DO flag if a key in-scope element is missing (e.g. for a residential rental income course, missing the s.272A finance-cost restriction would be critical).
- DO flag specific UK tax rates / thresholds / NI bands / personal allowances / corporation tax rates / VAT thresholds / IHT thresholds — these change annually and should always be verified.
- DO flag specific legislation references that may have been superseded (e.g. FRS 102 has been amended; ISA UK 315 was revised effective 2022).
- Currency caveats should ALWAYS include a generic "Verify current rates / thresholds against the latest HMRC / FRC / IASB pronouncements" entry if the lesson references any numeric rates or thresholds.
- Be honest about uncertainty. If you don't know whether a stat is current, list it.`,
      },
      {
        role: 'user',
        content: `Topic the lesson is supposed to teach:
"${opts.topic}"

Lesson title: ${opts.title}
Objectives:
${opts.objectives.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}

Slides:
${slideSummary}${sourcesBlock}`,
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
