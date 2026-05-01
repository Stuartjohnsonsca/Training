import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/auth';

export default async function Home() {
  if (await isAuthed()) redirect('/learn');
  redirect('/login');
}
