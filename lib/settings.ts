import { prisma } from './db';

export interface Branding {
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  footerText: string | null;
}

export async function getBranding(): Promise<Branding> {
  const row = await prisma.setting.findUnique({ where: { id: 'default' } });
  if (!row) {
    const created = await prisma.setting.create({ data: { id: 'default' } });
    return {
      brandName: created.brandName,
      logoUrl: created.logoUrl,
      primaryColor: created.primaryColor,
      footerText: created.footerText,
    };
  }
  return {
    brandName: row.brandName,
    logoUrl: row.logoUrl,
    primaryColor: row.primaryColor,
    footerText: row.footerText,
  };
}
