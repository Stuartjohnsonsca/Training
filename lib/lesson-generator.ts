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

export interface SourceMaterial {
  filename: string;
  text: string;
}

export const DEFAULT_TOTAL_SLIDES = 8;
export const DEFAULT_TOTAL_QUESTIONS = 7;
export const SLIDE_BATCH_SIZE = 4;
export const QUIZ_BATCH_SIZE = 4;

interface StepOpts {
  topic: string;
  categorySystemPrompt: string;
  allowedWidgets: string[];
  referenceLessons?: ReferenceLesson[];
  sources?: SourceMaterial[];
  totalSlides?: number;
  totalQuestions?: number;
}

/**
 * Generation is split across many small LLM calls so each Vercel function invocation only has to
 * fit ONE Together call (~10-30s) inside the 60s function timeout. The frontend orchestrates the
 * sequence by re-POSTing /api/lessons/generate with the lessonId until status='ready'.
 *
 * Slides are generated in batches of SLIDE_BATCH_SIZE. The FIRST batch also returns the lesson
 * outline (title + objectives + concepts). Subsequent batches return slides only.
 *
 * Quiz is generated in batches of QUIZ_BATCH_SIZE.
 */

/** Generate the next batch of slides. If no slides yet, also returns outline. */
export async function generateStepSlideBatch(opts: {
  step: StepOpts;
  totalSlides: number;
  existingSlides: LessonSlide[];
  /** Title of the lesson (only set on batches AFTER the first; first batch GENERATES the title). */
  title?: string;
}) {
  const { step, totalSlides, existingSlides, title } = opts;
  const refs = step.referenceLessons ?? [];
  const sources = step.sources ?? [];
  const isFirst = existingSlides.length === 0;
  const start = existingSlides.length + 1;
  const end = Math.min(existingSlides.length + SLIDE_BATCH_SIZE, totalSlides);
  const count = end - start + 1;

  const outlineFields = isFirst
    ? `\n  "title": string,                          // catchy lesson title
  "objectives": string[],                   // 4-6 concise learning objectives
  "concepts": string[],                     // 4-10 lower-cased concept tags driving future reuse`
    : '';

  const idHint = `n_s${existingSlides.length + 1}`;

  const alreadyTaught = existingSlides.length === 0
    ? ''
    : `\n\nALREADY TAUGHT in slides 1-${existingSlides.length}${title ? ` of "${title}"` : ''}:\n${existingSlides
        .map((s, i) => `  ${i + 1}. ${s.title} — ${(s.bullets ?? []).slice(0, 3).join(' | ')}`)
        .join('\n')}`;

  const role = isFirst
    ? `This is the FIRST batch of a ${totalSlides}-slide lesson. Output the outline AND the first ${count} slides.`
    : `This is a CONTINUATION batch — slides ${start}-${end} of a ${totalSlides}-slide lesson. Don't repeat what was already taught.`;

  const closing = end === totalSlides
    ? '\nThis batch contains the FINAL slide(s). End with a recap-themed slide that summarises the whole lesson.'
    : `\nMore slides will follow after this batch (${end + 1}-${totalSlides}). Leave room.`;

  const system = `You are an expert curriculum designer producing a serious, in-depth training lesson for an Acumon professional staff audience.

${step.categorySystemPrompt}

${role}${closing}

Output ONE JSON object and nothing else:

{${outlineFields}
  "slides": [                               // exactly ${count} slides
    {
      "id": string,                         // reuse a REFERENCE LIBRARY id verbatim if reusing; else "${idHint}", "n_s${existingSlides.length + 2}", ...
      "title": string,                      // <= 8 words
      "bullets": string[],                  // 3-6 punchy bullets, each <= 16 words
      "speakerNotes": string,               // 60-110 spoken words; conversational; no markdown; spell out symbols
      "theme": "concept" | "example" | "warning" | "recap" | "default",
      "svg": string                         // STRONGLY ENCOURAGED inline SVG diagram (≤ 1500 chars, viewBox="0 0 400 240", no scripts). Aim to include one on AT LEAST 60% of slides — see SVG rules below. Empty string only if a diagram would genuinely add nothing.
    }
  ]
}

${ruleBlockText()}

Available widgets (so you know what the quiz will be able to test):
${widgetsForLLM(step.allowedWidgets)}${alreadyTaught}${buildReferenceBlock(refs)}${buildSourceBlock(sources)}`;

  const text = await chat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Topic: ${step.topic}` },
    ],
    maxTokens: 8000,
    temperature: 0.55,
    json: true,
  });

  const parsed = parseJson(text, isFirst ? 'outline + first slide batch' : `slide batch ${start}-${end}`);
  if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error('Slide batch returned no slides');
  }
  if (isFirst && (!parsed.title || typeof parsed.title !== 'string')) {
    throw new Error('First batch must include a title');
  }
  return parsed as {
    title?: string;
    objectives?: string[];
    concepts?: string[];
    slides: LessonSlide[];
  };
}

/**
 * Generate the next batch of quiz questions. The model is told what's already been asked so it
 * doesn't repeat itself.
 */
export async function generateStepQuizBatch(opts: {
  step: StepOpts;
  outline: { title: string; slides: LessonSlide[] };
  alreadyAsked: LessonQuestion[];
  count: number;
  batchIndex: number;
  isFinal: boolean;
}) {
  const { step, outline, alreadyAsked, count, batchIndex, isFinal } = opts;
  const refs = step.referenceLessons ?? [];
  const sources = step.sources ?? [];
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
      : isFinal
      ? 'These are the FINAL questions — make sure any major sub-topic not yet tested is covered.'
      : 'Lean into the harder applied/calculation questions and any sub-topics not yet covered.'
  }

${ruleBlockText()}

Available widgets (mix them — at least one calculation widget if any topic permits):
${widgetsForLLM(step.allowedWidgets)}${buildReferenceBlock(refs)}${buildSourceBlock(sources)}`;

  const text = await chat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Topic: ${step.topic}` },
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

/** Convenience for testing/scripts — runs the full chunked pipeline serially. */
export async function generateLesson(opts: StepOpts) {
  const totalSlides = opts.totalSlides ?? DEFAULT_TOTAL_SLIDES;
  const totalQuestions = opts.totalQuestions ?? DEFAULT_TOTAL_QUESTIONS;

  let title = '';
  let objectives: string[] = [];
  let concepts: string[] = [];
  const slides: LessonSlide[] = [];

  while (slides.length < totalSlides) {
    const r = await generateStepSlideBatch({
      step: opts,
      totalSlides,
      existingSlides: slides,
      title,
    });
    if (slides.length === 0) {
      title = r.title!;
      objectives = r.objectives ?? [];
      concepts = r.concepts ?? [];
    }
    slides.push(...r.slides);
  }

  const quiz: LessonQuestion[] = [];
  let qBatch = 0;
  while (quiz.length < totalQuestions) {
    const remaining = totalQuestions - quiz.length;
    const count = Math.min(QUIZ_BATCH_SIZE, remaining);
    const isFinal = remaining <= QUIZ_BATCH_SIZE;
    const r = await generateStepQuizBatch({
      step: opts,
      outline: { title, slides },
      alreadyAsked: quiz,
      count,
      batchIndex: qBatch++,
      isFinal,
    });
    quiz.push(...r.quiz.slice(0, count));
  }

  const refs = opts.referenceLessons ?? [];
  const refSlideIds = new Set(refs.flatMap((r) => r.slides.map((s) => s.id)));
  const refQuestionIds = new Set(refs.flatMap((r) => r.quiz.map((q) => q.id)));
  return {
    title,
    objectives,
    concepts,
    slides,
    quiz,
    reusedSlideIds: slides.map((s) => s.id).filter((id) => refSlideIds.has(id)),
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

function buildSourceBlock(sources: SourceMaterial[]): string {
  if (sources.length === 0) return '';
  return `

SOURCE MATERIAL (uploaded by the learner) — this is the PRIMARY material the lesson must teach.
Treat it as authoritative for facts/figures it explicitly covers. Quote or paraphrase from it where helpful, and refer to it by name in speakerNotes (e.g. "as the document explains..."). Supplement with broader expertise for context, edge cases, comparisons, and pitfalls — but DO NOT contradict the source. If sources are long, focus on the parts most relevant to the topic.

${sources
  .map((s, i) => `--- Source ${i + 1}: ${s.filename} ---
${s.text.length > 30000 ? s.text.slice(0, 30000) + '\n[...truncated to first 30k characters of this source...]' : s.text}`)
  .join('\n\n')}`;
}

function ruleBlockText(): string {
  return `Rules:
- DEPTH IS THE POINT. Cover the full lifecycle of the topic — recognition AND measurement AND subsequent treatment AND modifications AND edge cases AND classification choices, where each applies. Do not assume prior knowledge of any sub-area; if it matters, teach it.
- JURISDICTIONAL DISCIPLINE — this is a UK firm, audience is UK accountants/auditors/advisors. Apply UK rules unless the topic explicitly says IFRS or international. Avoid US-isms (no IRS, 401(k), IRA, federal/state tax, "depreciation deduction for tax", S-corp/C-corp, etc.). Use UK terminology and UK-specific legislation references (HMRC, FRC, ICAEW, FRS 102 / FRS 105 / ISA (UK), ITTOIA, ITA, CTA, TCGA, VATA, FA, etc.).
- TAX vs ACCOUNTING — never conflate them. Accounting profit and taxable profit are DIFFERENT and a course on one must not silently use rules from the other. In particular, for UK TAX:
    * Accounting depreciation is NOT a tax-deductible expense — it is added back when computing taxable profit. Capital allowances are claimed instead (and even those are restricted: no general capital allowances on residential dwellings; Structures & Buildings Allowance applies only to commercial structures from October 2018 at 3% straight-line).
    * Property income (UK rental business) is NOT trading income — it has its own rules (s.260 ITTOIA for individuals, s.202 CTA 2009 for companies). Cash basis is the default for individual landlords below £150k; accruals for companies and larger landlords.
    * Finance-cost relief for individual residential landlords is restricted to a 20% basic-rate tax reducer (s.272A ITTOIA), not deducted from profit.
    * Replacement of domestic items relief (s.311A ITTOIA) replaced wear-and-tear in 2016 for individuals; capital allowances apply for FHLs and commercial.
    * "Loss" on rental business is ring-fenced — losses can only be carried forward against future income from the same property business.
- COMPLETENESS for any calculation question: include EVERY number a learner needs to solve it (discount rate, useful life, residual value, fair value, payment schedule, period). Never refer to "the standard's discount rate" without supplying the rate yourself.
- EXACT NUMERIC ANSWERS: the expectedAnswer for a numeric question MUST be the exact mathematically-correct value to 2 decimal places. Never round (e.g. 18,800 — never "approximately 18,000"). Never write an explanation that uses the word "approximately" for the model answer. The grader only allows £0.01 rounding tolerance.
- T-account questions go beyond initial recognition wherever the topic permits — also drill subsequent measurement (e.g. annual depreciation, interest unwind, modifications, disposal).
- Speaker notes (spokenNotes ONLY) must read naturally for TTS — spell out symbols ("eighteen thousand eight hundred pounds" not "£18,800"), no markdown, no bullet syntax.
- EVERYWHERE ELSE (slide bullets, slide titles, quiz prompts, quiz explanations, expectedAnswer for short-text questions): use proper number and currency formatting. Numbers get comma thousand separators (£18,800 not £18800; 5,250 not 5250). Use the £ / % symbols, NEVER the words "pounds" or "percent".
- Bullets stay punchy (no full sentences). Use plain ASCII apostrophes and dashes.
- When you REUSE from the reference library, copy the WHOLE object verbatim (id and all fields).
- SVG diagrams: include them on the MAJORITY of slides (~60%+) — they massively help the learner. Modern flat design like a polished slide deck, NOT minimalist line art. Use bold filled shapes from this palette:
    blues:   #1d4ed8 #3b82f6 #93c5fd #dbeafe
    greens:  #047857 #10b981 #6ee7b7 #d1fae5
    ambers:  #b45309 #f59e0b #fcd34d #fef3c7
    violets: #6d28d9 #8b5cf6 #c4b5fd #ede9fe
    accents: #ef4444 (errors), #ffffff (text/highlights), #1e293b (deep contrast)
  Use rounded rectangles (rx=8-16), filled circles, white text on coloured backgrounds. Combine 2-4 colours.
  Useful diagram types: T-account layouts, debit/credit flow arrows, balance sheet structure, formulas, ratio breakdowns, decision trees, timelines, comparison tables, before/after, calculation walkthroughs.

  TEXT IN SVG — CRITICAL: text MUST visually fit inside its containing shape. Common failure: long words overflow the rectangle. Rules:
  - Set viewBox="0 0 400 240". Plan layouts with shapes ≥ 80px wide for any label.
  - Use font-size="11" or "12" for labels inside shapes; "14"-"16" only for headlines outside shapes; "20-24" only for big single numbers.
  - Use text-anchor="middle" and place at the shape's centre; or text-anchor="start" with explicit x-padding.
  - Keep each label ≤ 12 characters where possible — use abbreviations (Dr/Cr, B/S, P&L, NI, CT, IT, FRS, "Yr 1", "£10k") and split into two <text> elements with dy="1.2em" if you need more.
  - Test mentally: "would 'Right of use asset' fit in a 100px-wide box at font-size 12?" If not, abbreviate to "ROU asset" or use two lines.
  - Never let text cross outside its shape. If unsure, make the shape bigger.
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
