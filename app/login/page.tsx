'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const role = sp.get('admin') === '1' ? 'admin' : 'user';
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password, role }),
    });
    setLoading(false);
    if (res.ok) {
      router.push(role === 'admin' ? '/admin' : '/learn');
    } else {
      setError('Wrong password');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{role === 'admin' ? 'Admin sign in' : 'Training'}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {role === 'admin' ? 'Enter the admin password.' : 'Enter the access password to begin.'}
          </p>
        </div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full rounded-md bg-brand-600 text-white py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-60"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
