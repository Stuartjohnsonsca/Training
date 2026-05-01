import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthed } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generateLesson, extractConcepts, ReferenceLesson } from '@/lib/lesson-generator';
import { classifyCategory } from '@/lib/category-classifier';
import { seedDefaultCategories } from '@/lib/seed-defaults';
import { WIDGETS } from '@/lib/widgets/registry';

export const maxDuration = 120;

const Body = z.object({
  topic: z.string().min(2).max(300),
  forceRegenerate: z.boolean().optional(),
});

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

const MAX_REFERENCE_LESSONS = 3;

const GENERIC_PROMPT = `You generate training lessons for an Acumon professional staff audience (accountants, auditors, advisors).
The topic might fall outside the firm's usual practice areas — that's fine. Produce a serious, well-researched lesson at a professional adult level.
Use UK English, plain language, and concrete examples. £ for currency unless the topic specifies otherwise.`;

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { topic, forceRegenerate } = parsed.data;

  // Auto-bootstrap: if the DB has no categories yet, seed the defaults so the user is never blocked.
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

  const chosenSlug = await classifyCategory(
    topic,
    categories.map((c) => ({ slug: c.slug, name: c.name, description: c.description })),
  );

  // If no category is a sensible fit, generate with a generic prompt + all widgets — never refuse the user.
  let category = chosenSlug ? categories.find((c) => c.slug === chosenSlug) ?? null : null;
  let categoryIdForStorage: string;
  let systemPrompt: string;
  let allowedWidgets: string[];

  if (category) {
    categoryIdForStorage = category.id;
    systemPrompt = category.systemPrompt;
    allowedWidgets = category.allowedWidgets;
  } else {
    // Use the first active category as a parent for storage (so the lesson still has a row in the DB),
    // but use a generic prompt + the union of all widget types.
    const fallbackParent = categories[0];
    categoryIdForStorage = fallbackParent.id;
    systemPrompt = GENERIC_PROMPT;
    allowedWidgets = WIDGETS.map((w) => w.slug);
  }

  const topicNormalized = normalize(topic);

  if (!forceRegenerate && category) {
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

  // Find concept-overlapping prior lessons in the same category (or any category if generic).
  const concepts = await extractConcepts(topic);
  const referenceLessons = await findReferenceLessons(category?.id ?? null, concepts);

  const content = await generateLesson({
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

  // Bump reuseCount on lessons that actually contributed content.
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
    category: category ? { slug: category.slug, name: category.name } : null,
    reused: {
      slideCount: content.reusedSlideIds.length,
      questionCount: content.reusedQuestionIds.length,
      lessonCount: reusedFromIds.size,
    },
  });
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
