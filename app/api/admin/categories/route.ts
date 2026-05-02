import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { isAdmin } from '@/lib/auth';
import { WIDGETS } from '@/lib/widgets/registry';

const widgetSlugs = WIDGETS.map((w) => w.slug) as [string, ...string[]];

const CategoryInput = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'lowercase, hyphens only'),
  name: z.string().min(1),
  description: z.string().optional().default(''),
  systemPrompt: z.string().min(10),
  // Field is no longer surfaced in the UI; default to all widget slugs server-side.
  allowedWidgets: z.array(z.enum(widgetSlugs)).default(WIDGETS.map((w) => w.slug)),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return NextResponse.json({ categories });
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = CategoryInput.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const created = await prisma.category.create({ data: parsed.data });
  return NextResponse.json({ category: created });
}
