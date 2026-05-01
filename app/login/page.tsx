import { signIn, auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user?.email) redirect('/learn');

  const sp = await searchParams;
  const error = sp?.error;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
        <div>
          <h1 className="text-xl font-semibold">Training</h1>
          <p className="text-sm text-slate-500 mt-1">Sign in with your @acumon.com Microsoft account.</p>
        </div>
        <form
          action={async () => {
            'use server';
            await signIn('microsoft-entra-id', { redirectTo: '/learn' });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-md bg-brand-600 text-white py-2 text-sm font-medium hover:bg-brand-700"
          >
            Sign in with Microsoft
          </button>
        </form>
        {error && (
          <div className="text-sm text-red-600">
            {error === 'AccessDenied'
              ? 'That account is not from @acumon.com.'
              : 'Sign-in failed. Please try again.'}
          </div>
        )}
      </div>
    </div>
  );
}
