'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';

export default function LearnLanding() {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/lessons/generate', {
        method: 'POST',
        body: JSON.stringify({ topic: topic.trim() }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        const msg =
          (typeof e.error === 'string' && e.error) ||
          e.error?.formErrors?.join(', ') ||
          'Failed to generate lesson';
        throw new Error(msg);
      }
      const { lesson } = await res.json();
      router.push(`/learn/${lesson.id}`);
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="font-semibold">Acumon Training</h1>
          <div className="flex items-center gap-4">
            <a href="/admin" className="text-sm text-slate-500 hover:text-slate-900">
              Admin
            </a>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="text-sm text-slate-500 hover:text-slate-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-semibold mb-3">What training do you require?</h2>
        <p className="text-slate-500 mb-8">
          Describe what you'd like to learn — anything from a single concept ("straight-line depreciation") to
          a broader area ("ISA 315 risk assessment"). You'll get a narrated lesson followed by an interactive quiz.
        </p>

        <form onSubmit={start} className="space-y-4 bg-white border border-slate-200 rounded-2xl p-6">
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. how to account for a finance lease under FRS 102, or how to size a substantive sample for receivables..."
            rows={3}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            disabled={loading}
            autoFocus
          />

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading || !topic.trim()}
              className="rounded-md bg-brand-600 text-white py-2 px-5 text-sm font-medium hover:bg-brand-700 disabled:opacity-60"
            >
              {loading ? 'Generating lesson (~30s)...' : 'Start lesson'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
