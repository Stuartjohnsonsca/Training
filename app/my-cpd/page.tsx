import { redirect } from 'next/navigation';
import { isAuthed, currentUserEmail, isAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import MyCpdClient from './MyCpdClient';

export default async function MyCpdPage() {
  if (!(await isAuthed())) redirect('/login');
  const learner = await currentUserEmail();
  const admin = await isAdmin();

  const entries = await prisma.attempt.findMany({
    where: { learner, completedAt: { not: null } },
    orderBy: { completedAt: 'desc' },
    select: {
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
      lesson: { select: { title: true, chatHistory: true } },
    },
  });

  return (
    <MyCpdClient
      initial={entries.map((e) => ({
        ...e,
        completedAt: e.completedAt?.toISOString() ?? null,
        viewStartedAt: e.viewStartedAt?.toISOString() ?? null,
      }))}
      isAdmin={admin}
      learner={learner ?? ''}
    />
  );
}
