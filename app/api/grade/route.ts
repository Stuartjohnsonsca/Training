import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthed, currentUserEmail } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { gradeWidget, WidgetType } from '@/lib/widgets/registry';
import { chat } from '@/lib/together';

export const maxDuration = 60;

const Body = z.object({
  lessonId: z.string().min(1),
  answers: z.array(
    z.object({
      questionId: z.string(),
      answer: z.any(),
    }),
  ),
});

interface QuizQuestion {
  id: string;
  prompt: string;
  widget: WidgetType;
  config: any;
  expectedAnswer: any;
  explanation: string;
}

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { lessonId, answers } = parsed.data;
  const learner = await currentUserEmail();

  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });

  const content = lesson.content as any;
  const quiz: QuizQuestion[] = content.quiz ?? [];

  const results = [] as Array<{
    questionId: string;
    correct: boolean;
    score: number;
    feedback: string;
  }>;

  const llmTodos: { q: QuizQuestion; given: any }[] = [];

  for (const q of quiz) {
    const a = answers.find((x) => x.questionId === q.id);
    const given = a?.answer;
    const r = gradeWidget(q.widget, q.config, q.expectedAnswer, given);
    if (r.needsLLMGrading) {
      llmTodos.push({ q, given });
      results.push({ questionId: q.id, correct: false, score: 0, feedback: '' });
    } else {
      results.push({ questionId: q.id, correct: r.correct, score: r.score, feedback: r.feedback });
    }
  }

  if (llmTodos.length > 0) {
    const graded = await llmGradeBatch(llmTodos);
    for (const g of graded) {
      const idx = results.findIndex((r) => r.questionId === g.questionId);
      if (idx >= 0) results[idx] = g;
    }
  }

  const totalScore = results.reduce((a, r) => a + r.score, 0);
  const maxScore = quiz.length;
  const feedback = await summariseFeedback(content.title, quiz, results);

  const attempt = await prisma.attempt.create({
    data: {
      lessonId,
      learner,
      answers: results as any,
      feedback,
      totalScore,
      maxScore,
      completedAt: new Date(),
    },
  });

  return NextResponse.json({
    attemptId: attempt.id,
    results,
    totalScore,
    maxScore,
    feedback,
  });
}

async function llmGradeBatch(
  items: { q: QuizQuestion; given: any }[],
): Promise<Array<{ questionId: string; correct: boolean; score: number; feedback: string }>> {
  const system = `You grade short written training answers. Reply with ONE JSON object:
{ "results": [ { "questionId": string, "score": number (0..1), "correct": boolean, "feedback": string (1-2 sentences) } ] }
A score of 1 means fully correct, 0.5 means partially correct, 0 means wrong or empty.`;

  const user = JSON.stringify(
    items.map((it) => ({
      questionId: it.q.id,
      prompt: it.q.prompt,
      modelAnswer: it.q.expectedAnswer,
      learnerAnswer: it.given ?? '',
    })),
  );

  const text = await chat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens: 2000,
    temperature: 0.2,
    json: true,
  });

  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const json = JSON.parse(text.slice(start, end + 1));
    return json.results;
  } catch {
    return items.map((it) => ({
      questionId: it.q.id,
      correct: false,
      score: 0,
      feedback: 'Could not grade automatically.',
    }));
  }
}

async function summariseFeedback(
  title: string,
  quiz: QuizQuestion[],
  results: Array<{ questionId: string; score: number; feedback: string }>,
): Promise<string> {
  const total = results.reduce((a, r) => a + r.score, 0);
  const detail = quiz
    .map((q) => {
      const r = results.find((x) => x.questionId === q.id);
      return `Q: ${q.prompt}\nScore: ${r?.score ?? 0}/1\n`;
    })
    .join('\n');

  const text = await chat({
    messages: [
      {
        role: 'system',
        content: `You write a brief, encouraging study summary for a trainee who just completed a lesson.
Keep it to 3-5 short paragraphs. Mention specifically which areas they did well in and which to revise. No fluff. No emojis. Plain text only.`,
      },
      {
        role: 'user',
        content: `Lesson: ${title}\nFinal score: ${total.toFixed(1)} / ${quiz.length}\n\nQuestion-by-question:\n${detail}`,
      },
    ],
    maxTokens: 600,
    temperature: 0.5,
  });

  return text.trim();
}
