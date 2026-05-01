'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';

interface Cat {
  slug: string;
  name: string;
  description: string | null;
}

export default function LearnLanding({ categories }: { categories: Cat[] }) {
  const router = useRouter();
  const [slug, setSlug] = useState(categories[0]?.slug ?? '');
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!slug || !topic.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/lessons/generate', {
        method: 'POST',
        body: JSON.stringify({ categorySlug: slug, topic: topic.trim() }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error?.formErrors?.join(', ') || e.error || 'Failed to generate lesson');
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
          <h1 className="font-semibold">Training</h1>
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

      <main className="max-w-2xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-semibold mb-2">What would you like to learn?</h2>
        <p className="text-slate-500 mb-8">
          Pick a category, type a topic, and get a narrated lesson with an interactive quiz.
        </p>

        <form onSubmit={start} className="space-y-5 bg-white border border-slate-200 rounded-2xl p-6">
          <div>
            <label className="block text-sm font-medium mb-2">Category</label>
            <div className="grid grid-cols-2 gap-2">
              {categories.map((c) => {
                const active = c.slug === slug;
                return (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() => setSlug(c.slug)}
                    className={`text-left rounded-lg border p-3 transition ${
                      active ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-sm font-medium">{c.name}</div>
                    {c.description && <div className="text-xs text-slate-500 mt-1">{c.description}</div>}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="topic">
              Topic
            </label>
            <input
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. straight-line depreciation"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              disabled={loading}
            />
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <button
            type="submit"
            disabled={loading || !topic.trim()}
            className="rounded-md bg-brand-600 text-white py-2 px-4 text-sm font-medium hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? 'Generating lesson (~30s)...' : 'Start lesson'}
          </button>
        </form>
      </main>
    </div>
  );
}
