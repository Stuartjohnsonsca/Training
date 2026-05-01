import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthed } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  generateStepOutlineAndFirstHalf,
  generateStepSecondHalf,
  generateStepQuizBatch,
  extractConcepts,
  ReferenceLesson,
  TOTAL_SLIDES,
  TOTAL_QUESTIONS,
  QUIZ_BATCH_SIZE,
  LessonSlide,
  LessonQuestion,
} from '@/lib/lesson-generator';
import { classifyCategory } from '@/lib/category-classifier';
import { seedDefaultCategories } from '@/lib/seed-defaults';
import { WIDGETS } from '@/lib/widgets/registry';

export const maxDuration = 60;

/**
 * Per-handler deadline. We stop initiating new LLM calls once elapsed time would push the
 * next call past this deadline, returning early so the frontend can re-POST and continue
 * in a fresh function invocation. Keeps each Vercel call comfortably under the 60s timeout.
 */
const HANDLER_DEADLINE_MS = 50_000;
/** Pessimistic estimates of how long each step takes on Together. Tunable. */
const SLIDE_BATCH_BUDGET_MS = 28_000;
const QUIZ_BATCH_BUDGET_MS = 22_000;

function timeRemaining(startedAt: number): number {
  return HANDLER_DEADLINE_MS - (Date.now() - startedAt);
}
function canFit(startedAt: number, needed: number): boolean {
  return timeRemaining(startedAt) >= needed;
}

const StartBody = z.object({
  topic: z.string().min(2).max(300),
  forceRegenerate: z.boolean().optional(),
  lessonId: z.undefined().optional(),
});
const ContinueBody = z.object({
  lessonId: z.string().min(1),
  topic: z.undefined().optional(),
});
const Body = z.union([StartBody, ContinueBody]);

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

const MAX_REFERENCE_LESSONS = 3;

const GENERIC_PROMPT = `You generate training lessons for an Acumon professional staff audience (accountants, auditors, advisors).
The topic might fall outside the firm's usual practice areas — that's fine. Produce a serious, well-researched lesson at a professional adult level.
Use UK English, plain language, and concrete examples. £ for currency unless the topic specifies otherwise.`;

interface LessonResponseShape {
  lessonId: string;
  status: 'generating' | 'ready';
  step?: string;
  cached?: boolean;
}

export async function POST(req: Request) {
  try {
    if (!(await isAuthed())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const parsed = Body.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    if ('lessonId' in parsed.data && parsed.data.lessonId) {
      return await continueLesson(parsed.data.lessonId);
    }
    if ('topic' in parsed.data && parsed.data.topic) {
      return await startLesson(parsed.data.topic, parsed.data.forceRegenerate ?? false);
    }
    return NextResponse.json({ error: 'Provide either topic or lessonId' }, { status: 400 });
  } catch (e: any) {
    console.error('[generate] unhandled error', e);
    return NextResponse.json(
      { error: `Unexpected error: ${e?.message ?? String(e)}` },
      { status: 500 },
    );
  }
}

/** Start mode — classify category, run step 1 (outline + first half), then keep going if time allows. */
async function startLesson(topic: string, forceRegenerate: boolean): Promise<Response> {
  const startedAt = Date.now();
  let categories = await prisma.category.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  if (categories.length === 0) {
    await seedDefaultCategories();
    categories = await prisma.category.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  const [chosenSlug, concepts] = await Promise.all([
    classifyCategory(
      topic,
      categories.map((c) => ({ slug: c.slug, name: c.name, description: c.description })),
    ).catch((e) => {
      console.error('[start] classifyCategory failed', e);
      return null as string | null;
    }),
    extractConcepts(topic).catch((e) => {
      console.error('[start] extractConcepts failed', e);
      return [] as string[];
    }),
  ]);

  let category = chosenSlug ? categories.find((c) => c.slug === chosenSlug) ?? null : null;
  let categoryIdForStorage: string;
  let systemPrompt: string;
  let allowedWidgets: string[];
  if (category) {
    categoryIdForStorage = category.id;
    systemPrompt = category.systemPrompt;
    allowedWidgets = category.allowedWidgets;
  } else {
    categoryIdForStorage = categories[0].id;
    systemPrompt = GENERIC_PROMPT;
    allowedWidgets = WIDGETS.map((w) => w.slug);
  }

  const topicNormalized = normalize(topic);

  if (!forceRegenerate && category) {
    const existing = await prisma.lesson.findFirst({
      where: { categoryId: category.id, topicNormalized, status: 'ready' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return NextResponse.json({
        lessonId: existing.id,
        status: 'ready',
        cached: true,
      } satisfies LessonResponseShape);
    }
  }

  const referenceLessons = await findReferenceLessons(category?.id ?? null, concepts).catch((e) => {
    console.error('[start] reference lookup failed', e);
    return [] as ReferenceLesson[];
  });

  const part1 = await generateStepOutlineAndFirstHalf({
    topic,
    categorySystemPrompt: systemPrompt,
    allowedWidgets,
    referenceLessons,
  });

  const lesson = await prisma.lesson.create({
    data: {
      categoryId: categoryIdForStorage,
      topic,
      topicNormalized,
      title: part1.title,
      content: {
        title: part1.title,
        objectives: part1.objectives,
        slides: part1.slides,
        quiz: [],
        _systemPrompt: systemPrompt,
        _allowedWidgets: allowedWidgets,
        _referenceLessonIds: referenceLessons.map((r) => r.id),
      } as any,
      concepts: part1.concepts ?? concepts,
      status: 'generating',
    },
  });

  // If we still have time in the budget, keep going in this same invocation instead of forcing
  // the frontend to make extra round trips.
  return await runRemainingSteps(lesson.id, startedAt);
}

/** Continue mode — load the lesson, run as many remaining steps as fit in the deadline. */
async function continueLesson(lessonId: string): Promise<Response> {
  const startedAt = Date.now();
  return await runRemainingSteps(lessonId, startedAt);
}

/**
 * Run remaining generation steps for a lesson, packing as many as fit before HANDLER_DEADLINE_MS.
 * Returns when the lesson is ready OR when we don't have time for the next step (frontend re-POSTs).
 */
async function runRemainingSteps(lessonId: string, startedAt: number): Promise<Response> {
  let lastStep: string = 'noop';

  while (true) {
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
    if (lesson.status === 'ready') {
      return NextResponse.json({ lessonId, status: 'ready', step: lastStep } satisfies LessonResponseShape);
    }

    const content = lesson.content as any;
    const slides: LessonSlide[] = Array.isArray(content?.slides) ? content.slides : [];
    const quiz: LessonQuestion[] = Array.isArray(content?.quiz) ? content.quiz : [];

    const stepOpts = {
      topic: lesson.topic,
      categorySystemPrompt: content._systemPrompt ?? GENERIC_PROMPT,
      allowedWidgets: content._allowedWidgets ?? WIDGETS.map((w) => w.slug),
      referenceLessons: await loadReferenceLessons(content._referenceLessonIds ?? []),
    };

    // What's the next step?
    if (slides.length < TOTAL_SLIDES) {
      if (!canFit(startedAt, SLIDE_BATCH_BUDGET_MS)) {
        return NextResponse.json({
          lessonId,
          status: 'generating',
          step: lastStep,
        } satisfies LessonResponseShape);
      }
      const part2 = await generateStepSecondHalf(stepOpts, { title: lesson.title, slides });
      const allSlides = [...slides, ...part2.slides];
      await prisma.lesson.update({
        where: { id: lessonId },
        data: { content: { ...content, slides: allSlides } as any },
      });
      lastStep = 'second-half-done';
      continue;
    }

    if (quiz.length < TOTAL_QUESTIONS) {
      if (!canFit(startedAt, QUIZ_BATCH_BUDGET_MS)) {
        return NextResponse.json({
          lessonId,
          status: 'generating',
          step: lastStep,
        } satisfies LessonResponseShape);
      }
      const remaining = TOTAL_QUESTIONS - quiz.length;
      const count = Math.min(QUIZ_BATCH_SIZE, remaining);
      const batchIndex = Math.floor(quiz.length / QUIZ_BATCH_SIZE);
      const batch = await generateStepQuizBatch(stepOpts, { title: lesson.title, slides }, quiz, count, batchIndex);
      const newQuiz = [...quiz, ...batch.quiz.slice(0, count)];
      const isFinal = newQuiz.length >= TOTAL_QUESTIONS;

      const updatedContent = isFinal
        ? {
            title: lesson.title,
            objectives: content.objectives ?? [],
            slides,
            quiz: newQuiz,
          }
        : { ...content, quiz: newQuiz };

      await prisma.lesson.update({
        where: { id: lessonId },
        data: {
          content: updatedContent as any,
          status: isFinal ? 'ready' : 'generating',
        },
      });

      if (isFinal) {
        const refIds: string[] = content._referenceLessonIds ?? [];
        if (refIds.length > 0) {
          const refs = await prisma.lesson.findMany({ where: { id: { in: refIds } } });
          const reusedFromIds = new Set<string>();
          for (const ref of refs) {
            const refContent = ref.content as any;
            const ids = new Set([
              ...(refContent.slides ?? []).map((s: any) => s.id),
              ...(refContent.quiz ?? []).map((q: any) => q.id),
            ]);
            if (slides.some((s) => ids.has(s.id)) || newQuiz.some((q) => ids.has(q.id))) {
              reusedFromIds.add(ref.id);
            }
          }
          if (reusedFromIds.size > 0) {
            await prisma.lesson.updateMany({
              where: { id: { in: [...reusedFromIds] } },
              data: { reuseCount: { increment: 1 } },
            });
          }
        }
        return NextResponse.json({
          lessonId,
          status: 'ready',
          step: 'quiz-done',
        } satisfies LessonResponseShape);
      }

      lastStep = `quiz-batch-${batchIndex}-done`;
      continue;
    }

    // Defensive: nothing left to do but status wasn't 'ready'.
    await prisma.lesson.update({ where: { id: lessonId }, data: { status: 'ready' } });
    return NextResponse.json({ lessonId, status: 'ready', step: 'finalised' } satisfies LessonResponseShape);
  }
}

async function findReferenceLessons(
  categoryId: string | null,
  concepts: string[],
): Promise<ReferenceLesson[]> {
  if (concepts.length === 0) return [];

  const candidates = await prisma.lesson.findMany({
    where: {
      ...(categoryId ? { categoryId } : {}),
      concepts: { hasSome: concepts },
      status: 'ready',
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  const scored = candidates
    .map((c) => {
      const overlap = c.concepts.filter((x) => concepts.includes(x)).length;
      return { lesson: c, overlap };
    })
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, MAX_REFERENCE_LESSONS);

  return scored.map(({ lesson }) => {
    const c = lesson.content as any;
    return {
      id: lesson.id,
      topic: lesson.topic,
      concepts: lesson.concepts,
      slides: c.slides ?? [],
      quiz: c.quiz ?? [],
    };
  });
}

async function loadReferenceLessons(ids: string[]): Promise<ReferenceLesson[]> {
  if (!ids || ids.length === 0) return [];
  const rows = await prisma.lesson.findMany({ where: { id: { in: ids } } });
  return rows.map((lesson) => {
    const c = lesson.content as any;
    return {
      id: lesson.id,
      topic: lesson.topic,
      concepts: lesson.concepts,
      slides: c.slides ?? [],
      quiz: c.quiz ?? [],
    };
  });
}
