import { chat } from './together';

/** Per-lesson plan for how big the lesson should be — driven by source-material depth. */
export interface LessonPlan {
  numSlides: number;
  numQuestions: number;
}

const MIN_SLIDES = 8;
const MAX_SLIDES = 24;
const MIN_QUESTIONS = 7;
const MAX_QUESTIONS = 25;

/**
 * Decide how big a lesson should be, based on:
 *  - the topic
 *  - the size and breadth of any uploaded source material
 *
 * Without sources we default to (8, 7). With sources we ask the LLM to size to the material.
 */
export async function planLessonLength(opts: {
  topic: string;
  sources?: Array<{ filename: string; extractedText: string; approxTokens: number }>;
}): Promise<LessonPlan> {
  const sources = opts.sources ?? [];
  if (sources.length === 0) {
    return { numSlides: MIN_SLIDES, numQuestions: MIN_QUESTIONS };
  }

  // Build a brief preview of each source — title, length, opening lines — so the planner gets a feel
  // without us having to send the entire text.
  const sourcePreviews = sources
    .map((s, i) => {
      const opening = s.extractedText.slice(0, 600).replace(/\n+/g, ' ').trim();
      const tail = s.extractedText.length > 600 ? `... [+${s.approxTokens} tokens total]` : '';
      return `Source ${i + 1}: "${s.filename}" (~${s.approxTokens} tokens)\n  Preview: ${opening}${tail}`;
    })
    .join('\n\n');

  const text = await chat({
    messages: [
      {
        role: 'system',
        content: `Decide how long a training lesson should be when teaching the supplied source material on the given topic.
Reply with ONE JSON object:

  {"numSlides": number, "numQuestions": number, "reasoning": string}

Constraints:
  numSlides:    integer between ${MIN_SLIDES} and ${MAX_SLIDES}
  numQuestions: integer between ${MIN_QUESTIONS} and ${MAX_QUESTIONS}

Sizing principles:
- The lesson must be long enough to TEACH the material properly. If the source is dense (a 50-page standard, a multi-section chapter), bias HIGH. If the source is short or narrow, bias LOWER but still above the minimum.
- Each slide carries roughly one sub-topic. Estimate the number of distinct sub-topics in the source(s) and add 2-3 for orientation/recap, that's a good slide target.
- Quiz length scales with slide count — roughly 3 quiz questions per 4 slides.
- numSlides MUST be an even number (so it splits cleanly into halves) and divisible by 2.
- Output ONLY the JSON object.`,
      },
      {
        role: 'user',
        content: `Topic: ${opts.topic}\n\nSource material:\n${sourcePreviews}`,
      },
    ],
    maxTokens: 400,
    temperature: 0.2,
    json: true,
  });

  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const obj = JSON.parse(text.slice(start, end + 1));
    let numSlides = Math.round(Number(obj.numSlides));
    let numQuestions = Math.round(Number(obj.numQuestions));
    if (!Number.isFinite(numSlides)) numSlides = MIN_SLIDES;
    if (!Number.isFinite(numQuestions)) numQuestions = MIN_QUESTIONS;
    numSlides = Math.max(MIN_SLIDES, Math.min(MAX_SLIDES, numSlides));
    if (numSlides % 2 !== 0) numSlides += 1;
    numQuestions = Math.max(MIN_QUESTIONS, Math.min(MAX_QUESTIONS, numQuestions));
    return { numSlides, numQuestions };
  } catch (e) {
    console.error('[planner] could not parse plan, using defaults', e);
    return { numSlides: MIN_SLIDES, numQuestions: MIN_QUESTIONS };
  }
}
