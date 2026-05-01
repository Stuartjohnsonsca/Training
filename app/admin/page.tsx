import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import AdminCategories from './AdminCategories';
import { WIDGETS } from '@/lib/widgets/registry';

export default async function AdminPage() {
  if (!(await isAdmin())) redirect('/login?admin=1');

  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  return <AdminCategories initial={categories} widgetTypes={WIDGETS} />;
}
