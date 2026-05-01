import { chat, FAST_MODEL } from './together';
import { widgetsForLLM, WidgetType } from './widgets/registry';

export type SlideTheme = 'concept' | 'example' | 'warning' | 'recap' | 'default';

export interface LessonSlide {
  id: string;
  title: string;
  bullets: string[];
  speakerNotes: string;
  theme?: SlideTheme;
  svg?: string;
}
export interface LessonQuestion {
  id: string;
  prompt: string;
  widget: WidgetType;
  config: any;
  expectedAnswer: any;
  explanation: string;
}
export interface LessonContent {
  title: string;
  objectives: string[];
  slides: LessonSlide[];
  quiz: LessonQuestion[];
  concepts: string[];
}

export interface ReferenceLesson {
  id: string;
  topic: string;
  concepts: string[];
  slides: LessonSlide[];
  quiz: LessonQuestion[];
}

export const SLIDES_PER_HALF = 4;
export const TOTAL_SLIDES = SLIDES_PER_HALF * 2;
export const TOTAL_QUESTIONS = 7;
/** Quiz is generated in batches of this size to keep each LLM call inside Vercel's 60s function budget. */
export const QUIZ_BATCH_SIZE = 4;

interface StepOpts {
  topic: string;
  categorySystemPrompt: string;
  allowedWidgets: string[];
  referenceLessons?: ReferenceLesson[];
}

/**
 * Each step is a separate HTTP-bounded call so a single Vercel function invocation only has to
 * fit ONE Together call (~10-30s) inside the 60s function timeout. The frontend orchestrates them
 * by re-POSTing /api/lessons/generate with the lessonId until status='ready'.
 */

/** Step 1 — outline + first half of slides. ~30s output budget. */
export async function generateStepOutlineAndFirstHalf(opts: StepOpts) {
  const refs = opts.referenceLessons ?? [];
  const system = `You are an expert curriculum designer producing a serious, in-depth training lesson for an Acumon professional staff audience.

${opts.categorySystemPrompt}

This is part 1 of 3. Output the lesson outline plus the FIRST ${SLIDES_PER_HALF} slides as ONE JSON object and nothing else:

{
  "title": string,                          // catchy lesson title
  "objectives": string[],                   // 3-5 concise learning objectives
  "concepts": string[],                     // 4-8 lower-cased concept tags driving future reuse
  "slides": [                               // exactly ${SLIDES_PER_HALF} slides — the FIRST half of the lesson
    {
      "id": string,                         // reuse a REFERENCE LIBRARY id verbatim if reusing; else "n_s1", "n_s2", ...
      "title": string,                      // <= 8 words
      "bullets": string[],                  // 3-6 punchy bullets, each <= 16 words
      "speakerNotes": string,               // 60-110 spoken words; conversational; no markdown; spell out symbols
      "theme": "concept" | "example" | "warning" | "recap" | "default",
      "svg": string                         // OPTIONAL inline SVG (≤ 1200 chars, viewBox set, no scripts). Empty string if no diagram.
    }
  ]
}

Plan the WHOLE lesson before writing — slides ${SLIDES_PER_HALF + 1}-${TOTAL_SLIDES} will follow in part 2, then ${TOTAL_QUESTIONS} quiz questions in part 3. Make sure these first slides set up the second half cleanly.

${ruleBlockText()}

Available widgets (so you know what the quiz will be able to test):
${widgetsForLLM(opts.allowedWidgets)}${buildReferenceBlock(refs)}`;

  const text = await chat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Topic: ${opts.topic}` },
    ],
    maxTokens: 8000,
    temperature: 0.55,
    json: true,
  });

  const parsed = parseJson(text, 'outline + first slides');
  if (!parsed.title || !Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error('Step 1 returned malformed outline');
  }
  return parsed as { title: string; objectives: string[]; concepts: string[]; slides: LessonSlide[] };
}

/** Step 2 — second half of slides. */
export async function generateStepSecondHalf(
  opts: StepOpts,
  outline: { title: string; slides: LessonSlide[] },
) {
  const refs = opts.referenceLessons ?? [];
  const system = `You are continuing a training lesson. Output ONLY the SECOND half (${SLIDES_PER_HALF} slides) as ONE JSON object:

{
  "slides": [                               // exactly ${SLIDES_PER_HALF} slides — slides ${SLIDES_PER_HALF + 1}-${TOTAL_SLIDES}
    {
      "id": string,                         // reuse a REFERENCE LIBRARY id verbatim if reusing; else "n_s${SLIDES_PER_HALF + 1}", ...
      "title": string, "bullets": string[], "speakerNotes": string,
      "theme": "concept" | "example" | "warning" | "recap" | "default",
      "svg": string
    }
  ]
}

ALREADY TAUGHT in slides 1-${SLIDES_PER_HALF} of "${outline.title}":
${outline.slides.map((s, i) => `  ${i + 1}. ${s.title} — ${(s.bullets ?? []).join(' | ')}`).join('\n')}

Pick up where slide ${SLIDES_PER_HALF} left off. Cover the remaining sub-areas. Don't repeat the first half. End with a recap-themed slide.

${ruleBlockText()}${buildReferenceBlock(refs)}`;

  const text = await chat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Topic: ${opts.topic}` },
    ],
    maxTokens: 8000,
    temperature: 0.55,
    json: true,
  });

  const parsed = parseJson(text, 'second-half slides');
  if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error('Step 2 returned no slides');
  }
  return parsed as { slides: LessonSlide[] };
}

/**
 * Step 3+ — generate a batch of quiz questions. Called multiple times so each LLM call only has to
 * produce a few questions (well under Vercel's 60s timeout). The model is told what's already been
 * asked so it doesn't repeat itself.
 */
export async function generateStepQuizBatch(
  opts: StepOpts,
  outline: { title: string; slides: LessonSlide[] },
  alreadyAsked: LessonQuestion[],
  count: number,
  batchIndex: number,
) {
  const refs = opts.referenceLessons ?? [];
  const idPrefix = `n_q${alreadyAsked.length + 1}`;
  const askedSummary =
    alreadyAsked.length === 0
      ? '(none yet)'
      : alreadyAsked.map((q, i) => `  ${i + 1}. [${q.widget}] ${q.prompt}`).join('\n');

  const system = `You are writing PART of the quiz for a training lesson that has just been taught. Output ONLY the next ${count} questions as ONE JSON object:

{
  "quiz": [                                 // exactly ${count} NEW questions, none repeating the ones already asked
    {
      "id": string,                         // reuse a REFERENCE LIBRARY id verbatim if reusing; else use "${idPrefix}", "n_q${alreadyAsked.length + 2}", ...
      "prompt": string,
      "widget": string,
      "config": object,
      "expectedAnswer": any,
      "explanation": string                 // 1-3 sentences; shown after grading
    }
  ]
}

Lesson "${outline.title}" — slides taught:
${outline.slides.map((s, i) => `  ${i + 1}. ${s.title}`).join('\n')}

QUESTIONS ALREADY ASKED in this quiz (do NOT repeat or rephrase these):
${askedSummary}

This is batch ${batchIndex + 1}. ${
    batchIndex === 0
      ? 'Open with foundational/recall questions, then move to applied ones.'
      : 'Lean into the harder applied/calculation questions and any sub-topics not yet covered.'
  }

${ruleBlockText()}

Available widgets (mix them — at least one calculation widget if any topic permits):
${widgetsForLLM(opts.allowedWidgets)}${buildReferenceBlock(refs)}`;

  const text = await chat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Topic: ${opts.topic}` },
    ],
    maxTokens: 6000,
    temperature: 0.55,
    json: true,
  });

  const parsed = parseJson(text, `quiz batch ${batchIndex + 1}`);
  if (!Array.isArray(parsed.quiz) || parsed.quiz.length === 0) {
    throw new Error(`Quiz batch ${batchIndex + 1} returned no questions`);
  }
  return parsed as { quiz: LessonQuestion[] };
}

/** Convenience for places that want the full lesson in one call (testing, scripts). */
export async function generateLesson(opts: StepOpts) {
  const part1 = await generateStepOutlineAndFirstHalf(opts);
  const part2 = await generateStepSecondHalf(opts, { title: part1.title, slides: part1.slides });
  const allSlides = [...part1.slides, ...part2.slides];

  const quiz: LessonQuestion[] = [];
  let batchIdx = 0;
  while (quiz.length < TOTAL_QUESTIONS) {
    const remaining = TOTAL_QUESTIONS - quiz.length;
    const count = Math.min(QUIZ_BATCH_SIZE, remaining);
    const batch = await generateStepQuizBatch(
      opts,
      { title: part1.title, slides: allSlides },
      quiz,
      count,
      batchIdx,
    );
    quiz.push(...batch.quiz.slice(0, count));
    batchIdx++;
  }

  const refs = opts.referenceLessons ?? [];
  const refSlideIds = new Set(refs.flatMap((r) => r.slides.map((s) => s.id)));
  const refQuestionIds = new Set(refs.flatMap((r) => r.quiz.map((q) => q.id)));
  return {
    title: part1.title,
    objectives: part1.objectives,
    concepts: part1.concepts,
    slides: allSlides,
    quiz,
    reusedSlideIds: allSlides.map((s) => s.id).filter((id) => refSlideIds.has(id)),
    reusedQuestionIds: quiz.map((q) => q.id).filter((id) => refQuestionIds.has(id)),
  };
}

function buildReferenceBlock(refs: ReferenceLesson[]): string {
  if (refs.length === 0) return '';
  return `

REFERENCE LIBRARY — slides and questions from prior lessons. If any directly fit, REUSE them VERBATIM by including the same id in your output (and the same content). Only generate new for gaps.

${refs
  .map(
    (r) => `--- From "${r.topic}" (id ${r.id}, concepts: ${r.concepts.join(', ') || 'n/a'}) ---
SLIDES:
${r.slides.map((s) => `  [id=${s.id}] ${s.title}\n    ${s.bullets.join(' | ')}`).join('\n')}
QUESTIONS:
${r.quiz.map((q) => `  [id=${q.id}, widget=${q.widget}] ${q.prompt}`).join('\n')}`,
  )
  .join('\n\n')}`;
}

function ruleBlockText(): string {
  return `Rules:
- DEPTH IS THE POINT. Cover the full lifecycle of the topic — recognition AND measurement AND subsequent treatment AND modifications AND edge cases AND classification choices, where each applies. Do not assume prior knowledge of any sub-area; if it matters, teach it.
- COMPLETENESS for any calculation question: include EVERY number a learner needs to solve it (discount rate, useful life, residual value, fair value, payment schedule, period). Never refer to "the standard's discount rate" without supplying the rate yourself.
- EXACT NUMERIC ANSWERS: the expectedAnswer for a numeric question MUST be the exact mathematically-correct value to 2 decimal places. Never round (e.g. 18,800 — never "approximately 18,000"). Never write an explanation that uses the word "approximately" for the model answer. The grader only allows £0.01 rounding tolerance.
- T-account questions go beyond initial recognition wherever the topic permits — also drill subsequent measurement (e.g. annual depreciation, interest unwind, modifications, disposal).
- Speaker notes must read naturally for TTS — spell out symbols ("pounds" not "£"), no markdown, no bullet syntax.
- Bullets stay punchy (no full sentences). Use plain ASCII apostrophes and dashes.
- When you REUSE from the reference library, copy the WHOLE object verbatim (id and all fields).
- Output ONLY the JSON object.`;
}

function parseJson(text: string, label: string): any {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {}
    }
    const tail = candidate.slice(-200).replace(/\n/g, ' ');
    throw new Error(`${label}: invalid JSON (probably truncated). Output ended: "${tail}"`);
  }
}

/** Cheap concept extractor used to find related prior lessons. Uses the fast small model. */
export async function extractConcepts(topic: string): Promise<string[]> {
  const text = await chat({
    model: FAST_MODEL,
    messages: [
      {
        role: 'system',
        content: `Extract 2-6 lower-case concept tags from the user's training topic. Tags should be short (1-3 words) and consistent (use "frs 102" not "FRS 102 small companies"). Reply with ONE JSON object: {"concepts": [...]}.`,
      },
      { role: 'user', content: topic },
    ],
    maxTokens: 200,
    temperature: 0,
    json: true,
  });
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const obj = JSON.parse(text.slice(start, end + 1));
    if (Array.isArray(obj?.concepts)) {
      return obj.concepts.map((c: unknown) => String(c).toLowerCase().trim()).filter(Boolean);
    }
  } catch {}
  return [];
}
