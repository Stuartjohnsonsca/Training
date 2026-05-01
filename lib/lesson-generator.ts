import { chat } from './together';
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

const SLIDES_PER_HALF = 4;
const TOTAL_QUESTIONS = 7;

/**
 * Generate a lesson via THREE sequential LLM calls so no single call has to fit the whole
 * lesson into its token budget. Each call is bounded to ~5000 output tokens, well below the
 * 8000-token comfort zone for json-mode on Llama 3.3 70B Turbo.
 *
 *   Call 1 — outline + slides 1-4
 *   Call 2 — slides 5-8 (sees the outline + slides 1-4 so it doesn't repeat)
 *   Call 3 — 7 quiz questions (sees the full deck so questions test what was actually taught)
 *
 * Reuse: every call gets the same REFERENCE LIBRARY block so any of the 3 stages can pull verbatim
 * from prior lessons. We track which IDs came from the library to bump their reuseCount.
 */
export async function generateLesson(opts: {
  topic: string;
  categorySystemPrompt: string;
  allowedWidgets: string[];
  referenceLessons?: ReferenceLesson[];
}): Promise<LessonContent & { reusedSlideIds: string[]; reusedQuestionIds: string[] }> {
  const refs = opts.referenceLessons ?? [];
  const referenceBlock = buildReferenceBlock(refs);
  const widgetBlock = widgetsForLLM(opts.allowedWidgets);
  const ruleBlock = ruleBlockText();

  const part1Json = await chat({
    messages: [
      {
        role: 'system',
        content: `You are an expert curriculum designer producing a serious, in-depth training lesson for an Acumon professional staff audience.

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
      "svg": string                         // OPTIONAL inline SVG (≤ 1200 chars, viewBox set, no scripts). Use only when a diagram materially helps. Empty string otherwise.
    }
  ]
}

Plan the WHOLE lesson before writing — slides 5-8 will be generated in a follow-up call, and the quiz after that, so make sure the first ${SLIDES_PER_HALF} slides set up the second half cleanly.

${ruleBlock}

Available widgets (so you know what the quiz will be able to do):
${widgetBlock}${referenceBlock}`,
      },
      { role: 'user', content: `Topic: ${opts.topic}` },
    ],
    maxTokens: 8000,
    temperature: 0.55,
    json: true,
  });

  const part1 = parseJson(part1Json, 'outline + first slides');
  validateOutline(part1);

  const part2Json = await chat({
    messages: [
      {
        role: 'system',
        content: `You are continuing a training lesson. Output ONLY the SECOND half (${SLIDES_PER_HALF} slides) as ONE JSON object:

{
  "slides": [                               // exactly ${SLIDES_PER_HALF} slides — slides ${SLIDES_PER_HALF + 1}-${SLIDES_PER_HALF * 2} of the lesson
    {
      "id": string,                         // reuse a REFERENCE LIBRARY id verbatim if reusing; else "n_s${SLIDES_PER_HALF + 1}", "n_s${SLIDES_PER_HALF + 2}", ...
      "title": string, "bullets": string[], "speakerNotes": string,
      "theme": "concept" | "example" | "warning" | "recap" | "default",
      "svg": string
    }
  ]
}

ALREADY TAUGHT in slides 1-${SLIDES_PER_HALF} of this lesson "${part1.title}":
${part1.slides.map((s: any, i: number) => `  ${i + 1}. ${s.title} — ${(s.bullets ?? []).join(' | ')}`).join('\n')}

Pick up where slide ${SLIDES_PER_HALF} left off. Cover the remaining sub-areas of the topic. Don't repeat the first half. End with a recap-themed slide.

${ruleBlock}${referenceBlock}`,
      },
      { role: 'user', content: `Topic: ${opts.topic}` },
    ],
    maxTokens: 8000,
    temperature: 0.55,
    json: true,
  });

  const part2 = parseJson(part2Json, 'second-half slides');
  if (!Array.isArray(part2.slides) || part2.slides.length === 0) {
    throw new Error('Second-half slides call returned no slides');
  }

  const allSlides: LessonSlide[] = [...part1.slides, ...part2.slides];

  const part3Json = await chat({
    messages: [
      {
        role: 'system',
        content: `You are writing the QUIZ for a training lesson that has just been taught. Output ONLY the quiz as ONE JSON object:

{
  "quiz": [                                 // exactly ${TOTAL_QUESTIONS} questions, all testing what the slides taught
    {
      "id": string,                         // reuse a REFERENCE LIBRARY id verbatim if reusing; else "n_q1", ...
      "prompt": string,
      "widget": string,                     // pick from the available widgets below
      "config": object,
      "expectedAnswer": any,
      "explanation": string                 // 1-3 sentences; shown after grading
    }
  ]
}

Lesson "${part1.title}" — slides taught:
${allSlides.map((s: any, i: number) => `  ${i + 1}. ${s.title}`).join('\n')}

${ruleBlock}

Available widgets (pick the most pedagogically useful per question, mix them):
${widgetBlock}${referenceBlock}`,
      },
      { role: 'user', content: `Topic: ${opts.topic}` },
    ],
    maxTokens: 8000,
    temperature: 0.55,
    json: true,
  });

  const part3 = parseJson(part3Json, 'quiz');
  if (!Array.isArray(part3.quiz) || part3.quiz.length === 0) {
    throw new Error('Quiz call returned no questions');
  }

  // Track which slide / question IDs were copied from the reference library.
  const refSlideIds = new Set(refs.flatMap((r) => r.slides.map((s) => s.id)));
  const refQuestionIds = new Set(refs.flatMap((r) => r.quiz.map((q) => q.id)));
  const reusedSlideIds = allSlides.map((s) => s.id).filter((id) => refSlideIds.has(id));
  const reusedQuestionIds = (part3.quiz as LessonQuestion[]).map((q) => q.id).filter((id) => refQuestionIds.has(id));

  return {
    title: part1.title,
    objectives: part1.objectives,
    concepts: part1.concepts ?? [],
    slides: allSlides,
    quiz: part3.quiz,
    reusedSlideIds,
    reusedQuestionIds,
  };
}

function validateOutline(p: any): void {
  if (typeof p.title !== 'string' || !p.title.trim()) throw new Error('Outline missing title');
  if (!Array.isArray(p.objectives) || p.objectives.length === 0) throw new Error('Outline missing objectives');
  if (!Array.isArray(p.slides) || p.slides.length === 0) throw new Error('Outline missing slides');
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

/** Cheap concept extractor used to find related prior lessons. */
export async function extractConcepts(topic: string): Promise<string[]> {
  const text = await chat({
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
