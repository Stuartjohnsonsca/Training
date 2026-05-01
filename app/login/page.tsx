import { signIn, auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user?.email) redirect('/learn');

  const sp = await searchParams;
  const error = sp?.error;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-2xl font-semibold tracking-tight text-white">Acumon Training</div>
          <div className="text-xs text-slate-400 mt-1">Powered by Acumon Intelligence</div>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-800 p-8 shadow-lg">
          <h1 className="text-xl font-semibold tracking-tight text-white text-center">Sign in</h1>
          <p className="mt-2 text-sm text-slate-400 text-center">
            Use your @acumon.com Microsoft account.
          </p>

          <form
            action={async () => {
              'use server';
              await signIn('microsoft-entra-id', { redirectTo: '/learn' });
            }}
            className="mt-8"
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-md bg-[#0078d4] px-4 py-3 text-sm font-medium text-white hover:bg-[#106ebe] transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 21 21" fill="none" aria-hidden>
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              Continue with Microsoft
            </button>
          </form>

          {error && (
            <div className="mt-5 rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
              {errorMessage(error)}
              <div className="mt-1 text-xs text-red-400/70">Error code: {error}</div>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Acumon staff only · @acumon.com accounts
        </p>
      </div>
    </main>
  );
}

function errorMessage(code: string): string {
  switch (code) {
    case 'AccessDenied':
      return 'That account is not from @acumon.com.';
    case 'Configuration':
      return 'The server is missing required configuration. Tell the admin.';
    case 'OAuthSignin':
    case 'OAuthCallback':
      return 'Microsoft sign-in failed. The redirect URI may not be registered for this app.';
    case 'OAuthAccountNotLinked':
      return 'This Microsoft account is already linked to a different sign-in method.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}
