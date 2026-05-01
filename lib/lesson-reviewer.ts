import { chat } from './together';
import type { LessonSlide } from './lesson-generator';

export interface UnverifiedSpecific {
  /** 1-based slide number where the specific appears. */
  slideIdx: number;
  /** The exact phrase or claim that's not supported by the grounding sources. */
  phrase: string;
  /** Why this is a concern (e.g. "section number not present in grounding sources"). */
  reason: string;
}

export interface ReviewFindings {
  /** Critical sub-topics the slides should have covered but didn't. Drives backfill. */
  missingAspects: string[];
  /** Specific claims in slides that are NOT supported by the grounding sources — must be scrubbed. */
  unverifiedSpecifics: UnverifiedSpecific[];
  /** True if missingAspects contains items the lesson genuinely cannot work without. */
  needsBackfill: boolean;
}

export interface QuizCoverageIssue {
  questionId: string;
  prompt: string;
  reason: string;
}

/**
 * Cross-check that every quiz question can be answered from material EXPLICITLY taught in the slides.
 * Returns the list of questions that test something not covered. The caller should drop and regenerate them.
 */
export async function reviewQuizCoverage(opts: {
  topic: string;
  slides: LessonSlide[];
  quiz: Array<{ id: string; prompt: string; explanation: string }>;
}): Promise<QuizCoverageIssue[]> {
  if (opts.quiz.length === 0) return [];
  const slidesTaught = opts.slides
    .map((s, i) => `Slide ${i + 1}: ${s.title}\n  - ${(s.bullets ?? []).join('\n  - ')}`)
    .join('\n\n');
  const quizList = opts.quiz
    .map((q, i) => `Q${i + 1} (id=${q.id}): ${q.prompt}\n  Explanation: ${q.explanation}`)
    .join('\n\n');

  const text = await chat({
    messages: [
      {
        role: 'system',
        content: `You audit a training lesson's quiz against what its slides taught. The principle: "you can only examine what you taught."

Reply with ONE JSON object:
{ "issues": [ { "questionId": string, "prompt": string, "reason": string } ] }

For each quiz question, check:
1. Is the concept the question tests EXPLICITLY taught in the slides (in a bullet)?
2. Is the method/regime the question uses (e.g. straight-line vs reducing balance, FRS 102 vs IFRS) the SAME one the slides use for that asset/transaction class?
3. Does the question silently assume scope that the lesson explicitly excluded?
4. CATEGORY ERROR — does the question apply a method from one DOMAIN to compute something in a different domain? Specifically:
   - A UK TAX capital-allowance question MUST NOT use the accounting depreciation formula (cost − residual ÷ useful life). UK capital allowances use AIA / WDA reducing-balance / SBA straight-line on cost / FYA — NOT (cost − residual) ÷ useful life.
   - An ACCOUNTING depreciation question MUST NOT compute a tax allowance.
   - A CT (Corporation Tax) question MUST NOT use IT (Income Tax) bands and vice versa.
   - An IFRS lease question MUST NOT use FRS 102 finance/operating split and vice versa.

If any of those checks fail, add it to issues with a one-sentence reason naming the missing/mismatched concept. If the question is properly grounded in a taught slide AND its method matches the regime, do NOT include it.

Be strict: a question that uses a calculation method the slides didn't teach FOR THAT ASSET CLASS is an issue, even if the method exists elsewhere. A question that uses an accounting formula to compute a tax allowance is a CATEGORY ERROR — flag it.`,
      },
      {
        role: 'user',
        content: `Topic: ${opts.topic}

SLIDES TAUGHT:
${slidesTaught}

QUIZ:
${quizList}`,
      },
    ],
    maxTokens: 1500,
    temperature: 0.2,
    json: true,
  });

  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const obj = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(obj?.issues)) return [];
    return obj.issues
      .map((v: any) => ({
        questionId: String(v?.questionId ?? '').trim(),
        prompt: String(v?.prompt ?? '').trim(),
        reason: String(v?.reason ?? '').trim(),
      }))
      .filter((x: QuizCoverageIssue) => x.questionId);
  } catch (e) {
    console.error('[reviewQuizCoverage] could not parse issues', e);
    return [];
  }
}

/**
 * Review a generated lesson against the grounding sources. Returns structured findings.
 * The CALLER is responsible for fixing what's flagged — either backfilling missing aspects or
 * rewriting slides to scrub unverified specifics. The learner should NEVER see these findings;
 * by the time the lesson reaches them every issue should be resolved.
 */
export async function reviewLesson(opts: {
  topic: string;
  title: string;
  objectives: string[];
  slides: LessonSlide[];
  /** Optional: any uploaded source material. */
  sourcesContext?: string;
  /** Optional: live grounded sources (Tavily-fetched primary sources). */
  groundingContext?: string;
}): Promise<ReviewFindings> {
  const slideSummary = opts.slides
    .map((s, i) => `Slide ${i + 1}: ${s.title}\n  Bullets: ${(s.bullets ?? []).join(' | ')}\n  Notes: ${s.speakerNotes.slice(0, 300)}`)
    .join('\n\n');

  const sourcesBlock = opts.sourcesContext
    ? `\n\nUSER-UPLOADED SOURCES (the lesson was supposed to teach this):\n${opts.sourcesContext.slice(0, 20000)}`
    : '';
  const groundingBlock = opts.groundingContext
    ? `\n\nGROUNDING SOURCES (live primary sources retrieved for this lesson):\n${opts.groundingContext.slice(0, 30000)}`
    : '\n\nGROUNDING SOURCES: (none retrieved — treat any specific fact in the lesson as unverified).';

  const text = await chat({
    messages: [
      {
        role: 'system',
        content: `You are a senior reviewer auditing a draft training lesson. Your job is to enforce the system's accuracy contract: every specific claim in the lesson MUST be supported by grounding sources. Anything that isn't gets flagged so the system can fix it.

Reply with ONE JSON object and nothing else:

{
  "missingAspects": [string, ...],
  "unverifiedSpecifics": [
    { "slideIdx": number, "phrase": string, "reason": string }
  ],
  "needsBackfill": boolean
}

Definitions:
- missingAspects: critical sub-topics or aspects of the topic that the slides do NOT cover but should. Empty array if none.
- unverifiedSpecifics: every specific factual claim in the slides that does NOT appear (or is contradicted) in the grounding sources / user-uploaded sources. The CALLER will rewrite these slides to remove or generalise the offending phrase.
- needsBackfill: true if missingAspects has items the lesson genuinely cannot work without.

WHAT COUNTS AS A "SPECIFIC" (flag if not in sources):
- Statute / Act section numbers (e.g. "s.272A ITTOIA", "Section 1031", "s.260 CTA 2009")
- Case names with citation/year
- HMRC manual paragraph references (PIM/CCM/CA/etc. numbers)
- Monetary thresholds stated as fact (£12,300, £85,000, £150,000)
- Tax rates stated as a current real-world rate (19%, 25%, 20%, 45%)
- Effective dates ("from 6 April 2024", "in force from October 2018")
- ISA UK / FRS / IFRS paragraph or sub-section references
- NI / dividend / CGT / IHT / VAT thresholds as numbers
- HMRC published mileage/expense rates as numbers

EXEMPT (do NOT flag):
- Illustrative figures inside calculation questions phrased as "Assume X..." (these are pedagogical)
- General principles ("rates change annually; verify on gov.uk")
- Anything the GROUNDING SOURCES or USER-UPLOADED SOURCES contains verbatim or substantively

For each unverifiedSpecific, quote the exact phrase as it appears in the slide and name the slide number. Be specific — "Slide 3 states '18% writing-down allowance for main pool' but this rate is not in the grounding sources."

Be sceptical by default. If you're not sure whether something is in grounding, flag it (the rewriter will check too).`,
      },
      {
        role: 'user',
        content: `Topic: "${opts.topic}"
Title: ${opts.title}
Objectives:
${opts.objectives.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}

Slides:
${slideSummary}${sourcesBlock}${groundingBlock}`,
      },
    ],
    maxTokens: 3000,
    temperature: 0.2,
    json: true,
  });

  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const obj = JSON.parse(text.slice(start, end + 1));
    return {
      missingAspects: arrayOfStrings(obj.missingAspects),
      unverifiedSpecifics: parseUnverified(obj.unverifiedSpecifics),
      needsBackfill: Boolean(obj.needsBackfill),
    };
  } catch (e) {
    console.error('[reviewer] could not parse review, returning empty findings', e);
    return { missingAspects: [], unverifiedSpecifics: [], needsBackfill: false };
  }
}

function arrayOfStrings(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.map((v) => String(v).trim()).filter(Boolean);
}
function parseUnverified(x: unknown): UnverifiedSpecific[] {
  if (!Array.isArray(x)) return [];
  return x
    .map((v: any) => ({
      slideIdx: Number(v?.slideIdx),
      phrase: String(v?.phrase ?? '').trim(),
      reason: String(v?.reason ?? '').trim(),
    }))
    .filter((u) => Number.isFinite(u.slideIdx) && u.slideIdx >= 1 && u.phrase);
}

/**
 * Rewrite a single slide to remove or replace specific claims that the reviewer flagged as
 * unverified. The rewritten slide keeps the same id, theme, and pedagogical purpose, but the
 * specifics are either generalised (preferred) or removed.
 */
export async function rewriteSlideForVerification(opts: {
  topic: string;
  slide: LessonSlide;
  unverifiedPhrases: string[];
  categorySystemPrompt: string;
  groundingContext?: string;
}): Promise<LessonSlide> {
  const groundingBlock = opts.groundingContext
    ? `\n\nGROUNDING SOURCES — specifics that appear here ARE allowed. Anything else must be generalised:\n${opts.groundingContext.slice(0, 20000)}`
    : '';

  const text = await chat({
    messages: [
      {
        role: 'system',
        content: `You rewrite a training slide to remove specific claims that aren't supported by grounding sources. Keep the slide's pedagogical intent, theme, and SVG. Output ONE JSON object that is the rewritten slide:

{
  "id": "${opts.slide.id}",
  "title": string,
  "bullets": string[],
  "speakerNotes": string,
  "theme": "${opts.slide.theme ?? 'default'}",
  "svg": string
}

${opts.categorySystemPrompt}

REWRITING RULES:
- The reviewer flagged these phrases/claims as unverified. They MUST disappear from the rewritten slide. Replace with general principles OR remove the bullet/sentence:
${opts.unverifiedPhrases.map((p, i) => `  ${i + 1}. "${p}"`).join('\n')}

- Where you remove a specific, replace with a general principle and tell the learner where to verify (e.g. "the writing-down allowance rates are set by HMRC and on gov.uk — check the current rates there").
- Do NOT introduce any NEW specifics that aren't in the grounding sources. If grounding doesn't cover the topic of the bullet, generalise.
- The slide should still teach the same concept — just without the unsupported specifics.
- Speaker notes should still spell out symbols ("twenty per cent" not "20%") and read naturally.
- Keep the SVG unchanged unless it ALSO contained a flagged specific (in which case rewrite the SVG too).
- Output ONLY the JSON object.

Original slide:
Title: ${opts.slide.title}
Bullets:
${opts.slide.bullets.map((b, i) => `  ${i + 1}. ${b}`).join('\n')}
Speaker notes: ${opts.slide.speakerNotes}
SVG: ${opts.slide.svg ? '(present)' : '(none)'}${groundingBlock}`,
      },
      { role: 'user', content: `Topic: ${opts.topic}` },
    ],
    maxTokens: 2500,
    temperature: 0.3,
    json: true,
  });

  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const obj = JSON.parse(text.slice(start, end + 1));
    return {
      id: opts.slide.id,
      title: String(obj.title ?? opts.slide.title),
      bullets: Array.isArray(obj.bullets) ? obj.bullets.map(String) : opts.slide.bullets,
      speakerNotes: String(obj.speakerNotes ?? opts.slide.speakerNotes),
      theme: opts.slide.theme,
      svg: typeof obj.svg === 'string' ? obj.svg : opts.slide.svg,
    };
  } catch (e) {
    console.error('[rewriter] could not parse rewritten slide; returning original', e);
    return opts.slide;
  }
}

/** Generate one or more "backfill" slides to address critical gaps. Used when needsBackfill=true. */
export async function backfillSlides(opts: {
  topic: string;
  title: string;
  existingSlides: LessonSlide[];
  missingAspects: string[];
  categorySystemPrompt: string;
  sourcesContext?: string;
  groundingContext?: string;
}): Promise<{ slides: LessonSlide[] }> {
  const wantedCount = Math.min(3, opts.missingAspects.length);
  const idStart = opts.existingSlides.length + 1;
  const slideSummary = opts.existingSlides.map((s, i) => `  ${i + 1}. ${s.title}`).join('\n');
  const groundingBlock = opts.groundingContext
    ? `\n\nGROUNDING SOURCES — only state specifics that appear here:\n${opts.groundingContext.slice(0, 20000)}`
    : '';

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

Rules:
- Each new slide addresses one of the missing aspects.
- Specifics (rates, sections, case names, thresholds) ONLY if they appear in grounding sources below; otherwise teach the principle.
- Don't repeat material from existing slides.
- Speaker notes spell out symbols. Bullets use proper formatting.
- Output ONLY the JSON.${groundingBlock}`,
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
