import { chat } from './together';
import { widgetsForLLM, WidgetType } from './widgets/registry';

export interface LessonSlide {
  id: string;
  title: string;
  bullets: string[];
  speakerNotes: string;
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
  /** Lower-cased concept tags. The generator emits these so we can find reusable lessons later. */
  concepts: string[];
}

/** A prior lesson offered to the generator as reference material it can reuse from. */
export interface ReferenceLesson {
  id: string;
  topic: string;
  concepts: string[];
  slides: LessonSlide[];
  quiz: LessonQuestion[];
}

export async function generateLesson(opts: {
  topic: string;
  categorySystemPrompt: string;
  allowedWidgets: string[];
  numSlides?: number;
  numQuestions?: number;
  /** Up to ~3 prior lessons whose slides/questions can be reused if they directly fit the new topic. */
  referenceLessons?: ReferenceLesson[];
}): Promise<LessonContent & { reusedSlideIds: string[]; reusedQuestionIds: string[] }> {
  const numSlides = opts.numSlides ?? 6;
  const numQuestions = opts.numQuestions ?? 5;
  const refs = opts.referenceLessons ?? [];

  const referenceBlock =
    refs.length === 0
      ? ''
      : `

REFERENCE LIBRARY — these slides and questions are from prior lessons in the same category. If any of them directly cover a part of the new topic, REUSE them VERBATIM by including the same id and content in your output. Only generate new slides/questions for gaps. Aim to reuse where it would teach the same concept just as well — that saves the learner time and keeps the curriculum coherent.

${refs
  .map(
    (r) => `--- From lesson "${r.topic}" (id ${r.id}, concepts: ${r.concepts.join(', ') || 'n/a'}) ---
SLIDES:
${r.slides.map((s) => `  [id=${s.id}] ${s.title}\n    ${s.bullets.join(' | ')}`).join('\n')}
QUESTIONS:
${r.quiz.map((q) => `  [id=${q.id}, widget=${q.widget}] ${q.prompt}`).join('\n')}`,
  )
  .join('\n\n')}`;

  const system = `You are an expert curriculum designer producing a concise interactive training lesson.

${opts.categorySystemPrompt}

You must respond with ONE JSON object and nothing else (no prose, no markdown fences). The JSON must match this shape EXACTLY:

{
  "title": string,                          // catchy lesson title
  "objectives": string[],                   // 3-5 learning objectives, each one short sentence
  "concepts": string[],                     // 3-8 lower-cased concept tags this lesson covers (e.g. "depreciation", "straight-line", "frs 102")
  "slides": [                               // exactly ${numSlides} slides
    {
      "id": string,                         // reuse id from REFERENCE LIBRARY if you reuse a slide; otherwise "n_s1", "n_s2", ...
      "title": string,                      // slide heading, <= 8 words
      "bullets": string[],                  // 3-6 punchy bullets, each <= 16 words
      "speakerNotes": string                // 60-110 words spoken aloud by narrator. Conversational, no markdown, no list syntax.
    }
  ],
  "quiz": [                                 // exactly ${numQuestions} questions
    {
      "id": string,                         // reuse id from REFERENCE LIBRARY if you reuse a question; otherwise "n_q1", ...
      "prompt": string,
      "widget": string,                     // one of the widget slugs below
      "config": object,
      "expectedAnswer": any,
      "explanation": string
    }
  ]
}

Available widgets (pick the most pedagogically useful for each question):
${widgetsForLLM(opts.allowedWidgets)}

Rules:
- Build the lesson so the slides actually teach what the quiz tests.
- Mix widget types across the quiz where appropriate. Save calculation/practice widgets for later questions.
- Speaker notes must read naturally — they are spoken by a TTS voice. Spell out symbols ("pounds" not "£") and avoid bullet syntax.
- Slide bullets stay punchy (no full sentences).
- Use plain ASCII apostrophes and dashes only.
- When you REUSE a slide or question from the reference library, copy the WHOLE object (id, title, bullets, speakerNotes — or for questions: id, prompt, widget, config, expectedAnswer, explanation) verbatim. Do not paraphrase.
- Concepts: 3-8 short lower-case tags. They drive future reuse, so be consistent (use "frs 102" not "FRS 102 small companies").
- Output ONLY the JSON object.${referenceBlock}`;

  const text = await chat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `New topic: ${opts.topic}` },
    ],
    maxTokens: 8000,
    temperature: 0.6,
    json: true,
  });

  const parsed = extractJson(text) as LessonContent;

  // Identify which reused ids came from the reference library.
  const refSlideIds = new Set(refs.flatMap((r) => r.slides.map((s) => s.id)));
  const refQuestionIds = new Set(refs.flatMap((r) => r.quiz.map((q) => q.id)));
  const reusedSlideIds = parsed.slides.map((s) => s.id).filter((id) => refSlideIds.has(id));
  const reusedQuestionIds = parsed.quiz.map((q) => q.id).filter((id) => refQuestionIds.has(id));

  return { ...parsed, reusedSlideIds, reusedQuestionIds };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error('Lesson generator did not return valid JSON');
  }
}

/** Cheap concept extractor used when classifying a free-text topic to match against existing lessons. */
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
