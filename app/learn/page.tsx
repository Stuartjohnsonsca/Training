import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/auth';
import { prisma } from '@/lib/db';
import LearnLanding from './LearnLanding';

export default async function LearnPage() {
  if (!(await isAuthed())) redirect('/login');

  const categories = await prisma.category.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { slug: true, name: true, description: true },
  });

  return <LearnLanding categories={categories} />;
}
