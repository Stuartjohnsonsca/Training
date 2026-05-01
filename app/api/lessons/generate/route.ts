import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthed } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generateLesson } from '@/lib/lesson-generator';
import { classifyCategory } from '@/lib/category-classifier';

export const maxDuration = 120;

const Body = z.object({
  topic: z.string().min(2).max(300),
  forceRegenerate: z.boolean().optional(),
});

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

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
      return NextResponse.json({ lesson: existing, cached: true, category: { slug: category.slug, name: category.name } });
    }
  }

  const content = await generateLesson({
    topic,
    categorySystemPrompt: category.systemPrompt,
    allowedWidgets: category.allowedWidgets,
  });

  const lesson = await prisma.lesson.create({
    data: {
      categoryId: category.id,
      topic,
      topicNormalized,
      title: content.title,
      content: content as any,
    },
  });

  return NextResponse.json({
    lesson,
    cached: false,
    category: { slug: category.slug, name: category.name },
  });
}
