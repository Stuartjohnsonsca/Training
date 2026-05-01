import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthed } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generateLesson } from '@/lib/lesson-generator';

export const maxDuration = 120;

const Body = z.object({
  categorySlug: z.string().min(1),
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
  const { categorySlug, topic, forceRegenerate } = parsed.data;

  const category = await prisma.category.findUnique({ where: { slug: categorySlug } });
  if (!category || !category.active) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 });
  }

  const topicNormalized = normalize(topic);

  if (!forceRegenerate) {
    const existing = await prisma.lesson.findFirst({
      where: { categoryId: category.id, topicNormalized },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return NextResponse.json({ lesson: existing, cached: true });
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

  return NextResponse.json({ lesson, cached: false });
}
