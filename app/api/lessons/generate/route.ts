import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthed } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  generateStepSlideBatch,
  generateStepQuizBatch,
  extractConcepts,
  ReferenceLesson,
  SourceMaterial,
  DEFAULT_TOTAL_SLIDES,
  DEFAULT_TOTAL_QUESTIONS,
  QUIZ_BATCH_SIZE,
  SLIDE_BATCH_SIZE,
  LessonSlide,
  LessonQuestion,
} from '@/lib/lesson-generator';
import { classifyCategory } from '@/lib/category-classifier';
import { seedDefaultCategories } from '@/lib/seed-defaults';
import { WIDGETS } from '@/lib/widgets/registry';
import { planLessonLength } from '@/lib/lesson-planner';
import { reviewLesson, backfillSlides } from '@/lib/lesson-reviewer';
import { detectJurisdictions } from '@/lib/jurisdictions';
import { buildGroundingPack, GroundingPack } from '@/lib/web-grounding';

export const maxDuration = 60;

/**
 * Per-handler deadline. We stop initiating new LLM calls once elapsed time would push the
 * next call past this deadline, returning early so the frontend can re-POST and continue
 * in a fresh function invocation. Keeps each Vercel call comfortably under the 60s timeout.
 */
const HANDLER_DEADLINE_MS = 50_000;
const SLIDE_BATCH_BUDGET_MS = 28_000;
const QUIZ_BATCH_BUDGET_MS = 22_000;
const REVIEW_BUDGET_MS = 25_000;
const BACKFILL_BUDGET_MS = 28_000;

function timeRemaining(startedAt: number): number {
  return HANDLER_DEADLINE_MS - (Date.now() - startedAt);
}
function canFit(startedAt: number, needed: number): boolean {
  return timeRemaining(startedAt) >= needed;
}

const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});
const StartBody = z.object({
  // Refine now produces detailed multi-clause topics encoding all scope splits — bumped from 300 → 1500.
  topic: z.string().min(2).max(1500),
  forceRegenerate: z.boolean().optional(),
  chatHistory: z.array(ChatMessageSchema).optional(),
  sourceIds: z.array(z.string()).optional(),
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
  plannedSlides?: number;
  plannedQuiz?: number;
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
      return await startLesson(
        parsed.data.topic,
        parsed.data.forceRegenerate ?? false,
        parsed.data.chatHistory ?? null,
        parsed.data.sourceIds ?? [],
      );
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

async function startLesson(
  topic: string,
  forceRegenerate: boolean,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> | null,
  sourceIds: string[],
): Promise<Response> {
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

  // Cache only when there are no uploaded sources (sources change the lesson content).
  if (!forceRegenerate && category && sourceIds.length === 0) {
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

  // Reference lookup + source load + web grounding in parallel — all only need the topic.
  const detectedJurisdictions = detectJurisdictions(topic);
  const [referenceLessons, sources, groundingPack] = await Promise.all([
    findReferenceLessons(category?.id ?? null, concepts).catch((e) => {
      console.error('[start] reference lookup failed', e);
      return [] as ReferenceLesson[];
    }),
    loadSources(sourceIds).catch((e) => {
      console.error('[start] source load failed', e);
      return [] as Array<SourceMaterial & { id: string; approxTokens: number }>;
    }),
    buildGroundingPack({ topic, jurisdictions: detectedJurisdictions }).catch((e) => {
      console.error('[start] grounding failed', e);
      return { jurisdictions: detectedJurisdictions.map((j) => j.code), queries: [], sources: [] } as GroundingPack;
    }),
  ]);

  const allSourceMaterial = [
    ...sources.map((s) => ({ filename: s.filename, extractedText: s.text, approxTokens: s.approxTokens })),
    ...groundingPack.sources.map((s) => ({ filename: s.filename, extractedText: s.text, approxTokens: Math.round(s.text.length / 4) })),
  ];

  const plan = await planLessonLength({
    topic,
    sources: allSourceMaterial,
  }).catch((e) => {
    console.error('[start] planner failed, using defaults', e);
    return { numSlides: DEFAULT_TOTAL_SLIDES, numQuestions: DEFAULT_TOTAL_QUESTIONS };
  });

  // Run first slide batch (which also returns title, objectives, concepts).
  const firstBatch = await generateStepSlideBatch({
    step: {
      topic,
      categorySystemPrompt: systemPrompt,
      allowedWidgets,
      referenceLessons,
      sources,
      groundingPack,
      totalSlides: plan.numSlides,
      totalQuestions: plan.numQuestions,
    },
    totalSlides: plan.numSlides,
    existingSlides: [],
  });

  const lesson = await prisma.lesson.create({
    data: {
      categoryId: categoryIdForStorage,
      topic,
      topicNormalized,
      title: firstBatch.title!,
      content: {
        title: firstBatch.title,
        objectives: firstBatch.objectives ?? [],
        slides: firstBatch.slides,
        quiz: [],
        _systemPrompt: systemPrompt,
        _allowedWidgets: allowedWidgets,
        _referenceLessonIds: referenceLessons.map((r) => r.id),
        _sourceIds: sources.map((s) => s.id),
      } as any,
      concepts: firstBatch.concepts ?? concepts,
      status: 'generating',
      chatHistory: chatHistory ? (chatHistory as any) : undefined,
      plannedSlideCount: plan.numSlides,
      plannedQuizCount: plan.numQuestions,
      groundingPack: groundingPack as any,
      sources: sources.length > 0 ? { connect: sources.map((s) => ({ id: s.id })) } : undefined,
    },
  });

  return await runRemainingSteps(lesson.id, startedAt);
}

async function continueLesson(lessonId: string): Promise<Response> {
  const startedAt = Date.now();
  return await runRemainingSteps(lessonId, startedAt);
}

async function runRemainingSteps(lessonId: string, startedAt: number): Promise<Response> {
  let lastStep: string = 'noop';

  while (true) {
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
    if (lesson.status === 'ready') {
      return NextResponse.json({
        lessonId,
        status: 'ready',
        step: lastStep,
        plannedSlides: lesson.plannedSlideCount,
        plannedQuiz: lesson.plannedQuizCount,
      } satisfies LessonResponseShape);
    }

    const content = lesson.content as any;
    const slides: LessonSlide[] = Array.isArray(content?.slides) ? content.slides : [];
    const quiz: LessonQuestion[] = Array.isArray(content?.quiz) ? content.quiz : [];
    const totalSlides = lesson.plannedSlideCount || DEFAULT_TOTAL_SLIDES;
    const totalQuestions = lesson.plannedQuizCount || DEFAULT_TOTAL_QUESTIONS;

    const stepOpts = {
      topic: lesson.topic,
      categorySystemPrompt: content._systemPrompt ?? GENERIC_PROMPT,
      allowedWidgets: content._allowedWidgets ?? WIDGETS.map((w) => w.slug),
      referenceLessons: await loadReferenceLessons(content._referenceLessonIds ?? []),
      sources: await loadSources(content._sourceIds ?? []).catch(() => [] as Array<SourceMaterial & { id: string; approxTokens: number }>),
      groundingPack: (lesson.groundingPack as GroundingPack | null) ?? undefined,
      totalSlides,
      totalQuestions,
    };

    if (slides.length < totalSlides) {
      if (!canFit(startedAt, SLIDE_BATCH_BUDGET_MS)) {
        return NextResponse.json({
          lessonId,
          status: 'generating',
          step: lastStep,
          plannedSlides: totalSlides,
          plannedQuiz: totalQuestions,
        } satisfies LessonResponseShape);
      }
      const r = await generateStepSlideBatch({
        step: stepOpts,
        totalSlides,
        existingSlides: slides,
        title: lesson.title,
      });
      const allSlides = [...slides, ...r.slides];
      await prisma.lesson.update({
        where: { id: lessonId },
        data: { content: { ...content, slides: allSlides } as any },
      });
      lastStep = `slides-${allSlides.length}/${totalSlides}`;
      continue;
    }

    // POST-SLIDE REVIEW — runs once, after all slides exist but before any quiz question.
    // Reviewer LLM checks for missing aspects, outdated legislation/rates, factual concerns.
    // If critical gaps are flagged, we backfill 1-3 extra slides addressing them BEFORE the quiz.
    if (!content._reviewed) {
      if (!canFit(startedAt, REVIEW_BUDGET_MS)) {
        return NextResponse.json({
          lessonId,
          status: 'generating',
          step: lastStep,
          plannedSlides: totalSlides,
          plannedQuiz: totalQuestions,
        } satisfies LessonResponseShape);
      }
      const sourcesContext = stepOpts.sources?.map((s) => `--- ${s.filename} ---\n${s.text.slice(0, 5000)}`).join('\n\n');
      const groundingContext = stepOpts.groundingPack?.sources?.map((s) => `--- ${s.filename} (${s.url}) ---\n${s.text}`).join('\n\n');
      const review = await reviewLesson({
        topic: lesson.topic,
        title: lesson.title,
        objectives: content.objectives ?? [],
        slides,
        sourcesContext,
        groundingContext,
      });

      // If the reviewer says critical aspects are missing, backfill — but only if there's time.
      if (review.needsBackfill && review.missingAspects.length > 0 && canFit(startedAt, BACKFILL_BUDGET_MS)) {
        try {
          const backfilled = await backfillSlides({
            topic: lesson.topic,
            title: lesson.title,
            existingSlides: slides,
            missingAspects: review.missingAspects,
            categorySystemPrompt: content._systemPrompt ?? GENERIC_PROMPT,
            sourcesContext,
          });
          if (backfilled.slides.length > 0) {
            const allSlides = [...slides, ...backfilled.slides];
            await prisma.lesson.update({
              where: { id: lessonId },
              data: {
                content: {
                  ...content,
                  slides: allSlides,
                  _reviewed: true,
                  _review: review,
                } as any,
              },
            });
            lastStep = 'backfill-done';
            continue;
          }
        } catch (e) {
          console.error('[generate] backfill failed', e);
        }
      }

      await prisma.lesson.update({
        where: { id: lessonId },
        data: {
          content: { ...content, _reviewed: true, _review: review } as any,
        },
      });
      lastStep = 'reviewed';
      continue;
    }

    if (quiz.length < totalQuestions) {
      if (!canFit(startedAt, QUIZ_BATCH_BUDGET_MS)) {
        return NextResponse.json({
          lessonId,
          status: 'generating',
          step: lastStep,
          plannedSlides: totalSlides,
          plannedQuiz: totalQuestions,
        } satisfies LessonResponseShape);
      }
      const remaining = totalQuestions - quiz.length;
      const count = Math.min(QUIZ_BATCH_SIZE, remaining);
      const isFinal = remaining <= QUIZ_BATCH_SIZE;
      const batchIndex = Math.floor(quiz.length / QUIZ_BATCH_SIZE);
      const batch = await generateStepQuizBatch({
        step: stepOpts,
        outline: { title: lesson.title, slides },
        alreadyAsked: quiz,
        count,
        batchIndex,
        isFinal,
      });
      const newQuiz = [...quiz, ...batch.quiz.slice(0, count)];
      const stillIncomplete = newQuiz.length < totalQuestions;

      const updatedContent = stillIncomplete
        ? { ...content, quiz: newQuiz }
        : {
            title: lesson.title,
            objectives: content.objectives ?? [],
            slides,
            quiz: newQuiz,
            // Carry the reviewer's findings into the final content so the player can show them.
            review: content._review ?? null,
          };

      await prisma.lesson.update({
        where: { id: lessonId },
        data: {
          content: updatedContent as any,
          status: stillIncomplete ? 'generating' : 'ready',
        },
      });

      if (!stillIncomplete) {
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
          plannedSlides: totalSlides,
          plannedQuiz: totalQuestions,
        } satisfies LessonResponseShape);
      }

      lastStep = `quiz-${newQuiz.length}/${totalQuestions}`;
      continue;
    }

    await prisma.lesson.update({ where: { id: lessonId }, data: { status: 'ready' } });
    return NextResponse.json({
      lessonId,
      status: 'ready',
      step: 'finalised',
      plannedSlides: totalSlides,
      plannedQuiz: totalQuestions,
    } satisfies LessonResponseShape);
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

async function loadSources(ids: string[]): Promise<Array<SourceMaterial & { id: string; approxTokens: number }>> {
  if (!ids || ids.length === 0) return [];
  const rows = await prisma.lessonSource.findMany({ where: { id: { in: ids } } });
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    text: r.extractedText,
    approxTokens: r.approxTokens,
  }));
}
