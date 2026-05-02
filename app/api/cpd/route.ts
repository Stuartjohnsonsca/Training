import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthed, currentUserEmail, isAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { CPD_ACTIVITIES } from '@/lib/cpd-activities';

const SELECT = {
  id: true,
  lessonId: true,
  learner: true,
  totalScore: true,
  maxScore: true,
  cpdSummary: true,
  isEthics: true,
  ies8Number: true,
  ies8Label: true,
  topicArea: true,
  viewStartedAt: true,
  completedAt: true,
  activityCategory: true,
  isStructured: true,
  whyUndertaken: true,
  intendedLearningOutcomes: true,
  learnedFromExercise: true,
  objectivesMet: true,
  lesson: {
    select: { title: true, chatHistory: true },
  },
} as const;

export async function GET(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const allUsers = url.searchParams.get('all') === '1' && (await isAdmin());

  const learner = await currentUserEmail();
  const where = allUsers ? { completedAt: { not: null } } : { learner, completedAt: { not: null } };

  const attempts = await prisma.attempt.findMany({
    where,
    orderBy: { completedAt: 'desc' },
    select: SELECT,
  });

  return NextResponse.json({ entries: attempts });
}

const PatchBody = z.object({
  isEthics: z.boolean().optional(),
  cpdSummary: z.string().max(4000).nullable().optional(),
  activityCategory: z.enum(CPD_ACTIVITIES as [string, ...string[]]).nullable().optional(),
  isStructured: z.boolean().optional(),
  whyUndertaken: z.string().max(4000).nullable().optional(),
  intendedLearningOutcomes: z.string().max(4000).nullable().optional(),
  learnedFromExercise: z.string().max(4000).nullable().optional(),
  objectivesMet: z.boolean().nullable().optional(),
});

export async function PATCH(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const learner = await currentUserEmail();
  const attempt = await prisma.attempt.findUnique({ where: { id } });
  if (!attempt) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (attempt.learner !== learner && !(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const updated = await prisma.attempt.update({
    where: { id },
    data: parsed.data,
    select: SELECT,
  });
  return NextResponse.json({ entry: updated });
}
