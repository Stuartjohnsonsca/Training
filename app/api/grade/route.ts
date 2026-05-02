import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthed, currentUserEmail } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { gradeWidget, WidgetType } from '@/lib/widgets/registry';
import { chat } from '@/lib/together';
import { classifyForCpd } from '@/lib/ies8';
import { DEFAULT_ACTIVITY } from '@/lib/cpd-activities';

export const maxDuration = 60;

const Body = z.object({
  lessonId: z.string().min(1),
  answers: z.array(
    z.object({
      questionId: z.string(),
      answer: z.any(),
    }),
  ),
  /** ISO timestamp of when the learner first opened the lesson player — used for CPD duration. */
  viewStartedAt: z.string().datetime().optional(),
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
  try {
    if (!(await isAuthed())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { lessonId, answers, viewStartedAt } = parsed.data;
    const learner = await currentUserEmail();

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { category: { select: { name: true } } },
    });
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

    // Run feedback summary + CPD classification in parallel — both are LLM calls.
    const [feedback, cpd] = await Promise.all([
      summariseFeedback(lesson.title, quiz, results).catch((e) => {
        console.error('[grade] summariseFeedback failed', e);
        return '';
      }),
      classifyForCpd({
        topic: lesson.topic,
        title: lesson.title,
        objectives: content.objectives ?? [],
      }).catch((e) => {
        console.error('[grade] classifyForCpd failed', e);
        return null;
      }),
    ]);

    const topicArea = `${lesson.category.name} — ${lesson.topic}`;

    // Prefill the CPD reflection fields with sensible defaults — learner edits later in /my-cpd or on results.
    const objectives: string[] = Array.isArray(content?.objectives) ? content.objectives : [];
    const intendedLearningOutcomes = objectives.length
      ? objectives.map((o) => `• ${o}`).join('\n')
      : null;

    const attempt = await prisma.attempt.create({
      data: {
        lessonId,
        learner,
        answers: results as any,
        feedback,
        totalScore,
        maxScore,
        completedAt: new Date(),
        viewStartedAt: viewStartedAt ? new Date(viewStartedAt) : null,
        cpdSummary: cpd?.cpdSummary ?? null,
        isEthics: cpd?.isEthics ?? false,
        ies8Number: cpd?.ies8Number ?? null,
        ies8Label: cpd?.ies8Label ?? null,
        topicArea,
        activityCategory: DEFAULT_ACTIVITY,
        isStructured: true,
        intendedLearningOutcomes,
        learnedFromExercise: cpd?.cpdSummary ?? null,
      },
    });

    return NextResponse.json({
      attemptId: attempt.id,
      results,
      totalScore,
      maxScore,
      feedback,
      cpd: {
        attemptId: attempt.id,
        ies8Number: attempt.ies8Number,
        ies8Label: attempt.ies8Label,
        isEthics: attempt.isEthics,
        cpdSummary: attempt.cpdSummary,
        topicArea: attempt.topicArea,
        viewStartedAt: attempt.viewStartedAt,
        completedAt: attempt.completedAt,
        activityCategory: attempt.activityCategory,
        isStructured: attempt.isStructured,
        whyUndertaken: attempt.whyUndertaken,
        intendedLearningOutcomes: attempt.intendedLearningOutcomes,
        learnedFromExercise: attempt.learnedFromExercise,
        objectivesMet: attempt.objectivesMet,
      },
    });
  } catch (e: any) {
    console.error('[grade] unhandled error', e);
    return NextResponse.json(
      { error: `Grade failed: ${e?.message ?? String(e)}` },
      { status: 500 },
    );
  }
}

async function llmGradeBatch(
  items: { q: QuizQuestion; given: any }[],
): Promise<Array<{ questionId: string; correct: boolean; score: number; feedback: string }>> {
  const system = `You grade short written training answers fairly and generously, the way a good tutor would. Reply with ONE JSON object:
{ "results": [ { "questionId": string, "score": number (0..1), "correct": boolean, "feedback": string (1-2 sentences) } ] }

Grading principles:
- Score the IDEA, not the wording. Any answer that captures the key concept being tested earns 1.0, even if phrased very differently from the model answer or missing peripheral details.
- "Right of use" vs "right to use the asset for a limited period" vs "control over the leased asset for the lease term" — all 1.0.
- Award 0.5 for an answer that is partially right or shows clear understanding of part of the answer but misses an important component.
- Award 0 only when the answer is empty, off-topic, or demonstrates a misunderstanding.
- Spelling, grammar, and use of jargon do NOT affect the score.
- "correct" is true when score >= 0.8.
- Feedback: encouraging. If 1.0, briefly affirm. If partial, say what's missing. If wrong, explain the right idea in one sentence.`;

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
