import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthed } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  generateStepOutlineAndFirstHalf,
  generateStepSecondHalf,
  generateStepQuiz,
  extractConcepts,
  ReferenceLesson,
  TOTAL_SLIDES,
  SLIDES_PER_HALF,
  LessonSlide,
  LessonQuestion,
} from '@/lib/lesson-generator';
import { classifyCategory } from '@/lib/category-classifier';
import { seedDefaultCategories } from '@/lib/seed-defaults';
import { WIDGETS } from '@/lib/widgets/registry';

export const maxDuration = 60;

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

/** Start mode — classify category, run step 1 (outline + first half), persist a 'generating' Lesson. */
async function startLesson(topic: string, forceRegenerate: boolean): Promise<Response> {
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
        // metadata used by /continue calls so we don't need to recompute
        _systemPrompt: systemPrompt,
        _allowedWidgets: allowedWidgets,
        _referenceLessonIds: referenceLessons.map((r) => r.id),
      } as any,
      concepts: part1.concepts ?? concepts,
      status: 'generating',
    },
  });

  return NextResponse.json({
    lessonId: lesson.id,
    status: 'generating',
    step: 'first-half-done',
  } satisfies LessonResponseShape);
}

/** Continue mode — load a 'generating' lesson, run the next missing step. */
async function continueLesson(lessonId: string): Promise<Response> {
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  if (lesson.status === 'ready') {
    return NextResponse.json({ lessonId, status: 'ready' } satisfies LessonResponseShape);
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

  // What's next?
  if (slides.length < TOTAL_SLIDES) {
    // Step 2: second half slides
    const part2 = await generateStepSecondHalf(stepOpts, { title: lesson.title, slides });
    const allSlides = [...slides, ...part2.slides];
    await prisma.lesson.update({
      where: { id: lessonId },
      data: {
        content: { ...content, slides: allSlides } as any,
      },
    });
    return NextResponse.json({
      lessonId,
      status: 'generating',
      step: 'second-half-done',
    } satisfies LessonResponseShape);
  }

  if (quiz.length === 0) {
    // Step 3: quiz
    const part3 = await generateStepQuiz(stepOpts, { title: lesson.title, slides });

    // Strip helper metadata fields from final content.
    const finalContent = {
      title: lesson.title,
      objectives: content.objectives ?? [],
      slides,
      quiz: part3.quiz,
    };

    await prisma.lesson.update({
      where: { id: lessonId },
      data: {
        content: finalContent as any,
        status: 'ready',
      },
    });

    // Bump reuseCount on contributing reference lessons.
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
        if (slides.some((s) => ids.has(s.id)) || part3.quiz.some((q) => ids.has(q.id))) {
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

    return NextResponse.json({ lessonId, status: 'ready' } satisfies LessonResponseShape);
  }

  // Shouldn't reach here.
  await prisma.lesson.update({ where: { id: lessonId }, data: { status: 'ready' } });
  return NextResponse.json({ lessonId, status: 'ready' } satisfies LessonResponseShape);
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
