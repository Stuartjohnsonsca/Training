import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getBranding } from '@/lib/settings';

const Patch = z.object({
  brandName: z.string().min(1).max(80).optional(),
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z
    .string()
    .regex(/^#([0-9a-fA-F]{6})$/, 'must be a 6-digit hex like #1d4ed8')
    .optional(),
  footerText: z.string().max(200).nullable().optional(),
});

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ branding: await getBranding() });
}

export async function PATCH(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = Patch.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await getBranding(); // ensures the row exists
  const updated = await prisma.setting.update({
    where: { id: 'default' },
    data: parsed.data,
  });
  return NextResponse.json({
    branding: {
      brandName: updated.brandName,
      logoUrl: updated.logoUrl,
      primaryColor: updated.primaryColor,
      footerText: updated.footerText,
    },
  });
}
