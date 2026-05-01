import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthed } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generateLesson, extractConcepts, ReferenceLesson } from '@/lib/lesson-generator';
import { classifyCategory } from '@/lib/category-classifier';

export const maxDuration = 120;

const Body = z.object({
  topic: z.string().min(2).max(300),
  forceRegenerate: z.boolean().optional(),
});

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

const MAX_REFERENCE_LESSONS = 3;

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { topic, forceRegenerate } = parsed.data;

  const categories = await prisma.category.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  if (categories.length === 0) {
    return NextResponse.json(
      { error: 'No training categories are configured. Tell the admin.' },
      { status: 503 },
    );
  }

  const chosenSlug = await classifyCategory(
    topic,
    categories.map((c) => ({ slug: c.slug, name: c.name, description: c.description })),
  );
  if (!chosenSlug) {
    return NextResponse.json(
      {
        error: `That topic doesn't fit any of the available training areas (${categories
          .map((c) => c.name)
          .join(', ')}). Try rephrasing, or ask the admin to add a new area.`,
      },
      { status: 422 },
    );
  }
  const category = categories.find((c) => c.slug === chosenSlug)!;
  const topicNormalized = normalize(topic);

  if (!forceRegenerate) {
    const existing = await prisma.lesson.findFirst({
      where: { categoryId: category.id, topicNormalized },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return NextResponse.json({
        lesson: existing,
        cached: true,
        category: { slug: category.slug, name: category.name },
      });
    }
  }

  // Find concept-overlapping prior lessons in the same category to offer as reusable reference material.
  const concepts = await extractConcepts(topic);
  const referenceLessons = await findReferenceLessons(category.id, concepts);

  const content = await generateLesson({
    topic,
    categorySystemPrompt: category.systemPrompt,
    allowedWidgets: category.allowedWidgets,
    referenceLessons,
  });

  const lesson = await prisma.lesson.create({
    data: {
      categoryId: category.id,
      topic,
      topicNormalized,
      title: content.title,
      content: {
        title: content.title,
        objectives: content.objectives,
        slides: content.slides,
        quiz: content.quiz,
      } as any,
      concepts: content.concepts ?? concepts,
    },
  });

  // Bump reuseCount for any reference lessons that actually contributed slides or questions.
  const reusedFromIds = new Set<string>();
  for (const ref of referenceLessons) {
    const refIds = new Set([...ref.slides.map((s) => s.id), ...ref.quiz.map((q) => q.id)]);
    if (
      content.reusedSlideIds.some((id) => refIds.has(id)) ||
      content.reusedQuestionIds.some((id) => refIds.has(id))
    ) {
      reusedFromIds.add(ref.id);
    }
  }
  if (reusedFromIds.size > 0) {
    await prisma.lesson.updateMany({
      where: { id: { in: [...reusedFromIds] } },
      data: { reuseCount: { increment: 1 } },
    });
  }

  return NextResponse.json({
    lesson,
    cached: false,
    category: { slug: category.slug, name: category.name },
    reused: {
      slideCount: content.reusedSlideIds.length,
      questionCount: content.reusedQuestionIds.length,
      lessonCount: reusedFromIds.size,
    },
  });
}

async function findReferenceLessons(categoryId: string, concepts: string[]): Promise<ReferenceLesson[]> {
  if (concepts.length === 0) return [];

  const candidates = await prisma.lesson.findMany({
    where: {
      categoryId,
      concepts: { hasSome: concepts },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  // Score by concept overlap, then take top N.
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
