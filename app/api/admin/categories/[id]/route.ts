import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { isAdmin } from '@/lib/auth';
import { WIDGETS } from '@/lib/widgets/registry';

const widgetSlugs = WIDGETS.map((w) => w.slug) as [string, ...string[]];

const Patch = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/).optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  systemPrompt: z.string().min(10).optional(),
  allowedWidgets: z.array(z.enum(widgetSlugs)).min(1).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const updated = await prisma.category.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ category: updated });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  await prisma.category.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
