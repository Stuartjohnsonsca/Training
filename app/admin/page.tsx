import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import AdminCategories from './AdminCategories';
import BrandingForm from './BrandingForm';
import WidgetsList from './WidgetsList';
import { getBranding } from '@/lib/settings';

export default async function AdminPage() {
  if (!(await isAdmin())) redirect('/login?error=AccessDenied');

  const [categories, branding] = await Promise.all([
    prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    getBranding(),
  ]);

  return (
    <>
      <BrandingForm initial={branding} />
      <AdminCategories initial={categories} />
      <WidgetsList />
    </>
  );
}
