import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { seedDefaultCategories } from '@/lib/seed-defaults';

export async function POST() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await seedDefaultCategories();
  return NextResponse.json({ ok: true });
}
