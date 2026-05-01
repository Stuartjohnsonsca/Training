import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAuthed } from '@/lib/auth';

export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const categories = await prisma.category.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, slug: true, name: true, description: true },
  });
  return NextResponse.json({ categories });
}
