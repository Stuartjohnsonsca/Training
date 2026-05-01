import { claude, MODEL } from './claude';
import { widgetsForLLM, WidgetType } from './widgets/registry';

export interface LessonContent {
  title: string;
  objectives: string[];
  slides: {
    id: string;
    title: string;
    bullets: string[];
    speakerNotes: string;
  }[];
  quiz: {
    id: string;
    prompt: string;
    widget: WidgetType;
    config: any;
    expectedAnswer: any;
    explanation: string;
  }[];
}

export async function generateLesson(opts: {
  topic: string;
  categorySystemPrompt: string;
  allowedWidgets: string[];
  numSlides?: number;
  numQuestions?: number;
}): Promise<LessonContent> {
  const numSlides = opts.numSlides ?? 6;
  const numQuestions = opts.numQuestions ?? 5;

  const system = `You are an expert curriculum designer producing a concise interactive training lesson.

${opts.categorySystemPrompt}

You must respond with ONE JSON object and nothing else (no prose, no markdown fences). The JSON must match this shape EXACTLY:

{
  "title": string,                          // catchy lesson title
  "objectives": string[],                   // 3-5 learning objectives, each one short sentence
  "slides": [                               // exactly ${numSlides} slides
    {
      "id": string,                         // "s1", "s2", ...
      "title": string,                      // slide heading, <= 8 words
      "bullets": string[],                  // 3-6 punchy bullets, each <= 16 words
      "speakerNotes": string                // 60-110 words spoken aloud by narrator. Conversational, no markdown, no list syntax.
    }
  ],
  "quiz": [                                 // exactly ${numQuestions} questions
    {
      "id": string,                         // "q1", "q2", ...
      "prompt": string,                     // the question
      "widget": string,                     // one of the widget slugs below
      "config": object,                     // widget-specific (see shapes)
      "expectedAnswer": any,                // widget-specific
      "explanation": string                 // 1-3 sentences explaining the right answer; shown after grading
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
- Output ONLY the JSON object.`;

  const userMsg = `Topic: ${opts.topic}`;

  const res = await claude().messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    messages: [{ role: 'user', content: userMsg }],
  });

  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');

  const json = extractJson(text);
  return json as LessonContent;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // Strip markdown fences if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Fallback: find first '{' and matching last '}'.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error('Lesson generator did not return valid JSON');
  }
}
