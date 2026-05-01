import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/auth';
import LearnLanding from './LearnLanding';

export default async function LearnPage() {
  if (!(await isAuthed())) redirect('/login');
  return <LearnLanding />;
}
