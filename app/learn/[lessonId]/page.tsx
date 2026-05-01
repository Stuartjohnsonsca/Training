import { notFound, redirect } from 'next/navigation';
import { isAuthed } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getBranding } from '@/lib/settings';
import LessonPlayer from './LessonPlayer';

export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  if (!(await isAuthed())) redirect('/login');
  const { lessonId } = await params;

  const [lesson, branding] = await Promise.all([
    prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { category: { select: { name: true, slug: true } } },
    }),
    getBranding(),
  ]);
  if (!lesson) notFound();

  return (
    <LessonPlayer
      lessonId={lesson.id}
      categoryName={lesson.category.name}
      content={lesson.content as any}
      branding={branding}
    />
  );
}
