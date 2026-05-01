'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    role: 'assistant',
    content:
      "What training do you require? Describe the topic in your own words — anything from a single concept to a broader area.",
  },
];

export default function LearnLanding() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<false | 'thinking' | 'generating'>(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  function newChat() {
    setMessages(INITIAL_MESSAGES);
    setInput('');
    setError('');
    setBusy(false);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setError('');
    setBusy('thinking');

    try {
      const refRes = await fetch('/api/lessons/refine', {
        method: 'POST',
        body: JSON.stringify({ messages: next.filter((m) => m.role === 'user' || m.role === 'assistant') }),
      });
      if (!refRes.ok) {
        const e = await refRes.json().catch(() => ({}));
        throw new Error(typeof e.error === 'string' ? e.error : 'Could not understand your request.');
      }
      const refData = await refRes.json();

      if (refData.ready && refData.topic) {
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            content: `Right — generating a lesson on: "${refData.topic}". This usually takes about 30 seconds...`,
          },
        ]);
        setBusy('generating');
        const genRes = await fetch('/api/lessons/generate', {
          method: 'POST',
          body: JSON.stringify({ topic: refData.topic }),
        });
        if (!genRes.ok) {
          const e = await genRes.json().catch(() => ({}));
          const msg =
            (typeof e.error === 'string' && e.error) ||
            e.error?.formErrors?.join(', ') ||
            'Failed to generate lesson';
          throw new Error(msg);
        }
        const { lesson } = await genRes.json();
        router.push(`/learn/${lesson.id}`);
      } else {
        setMessages((m) => [...m, { role: 'assistant', content: refData.reply ?? '...' }]);
        setBusy(false);
      }
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="font-semibold">Acumon Training</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={newChat}
              disabled={busy === 'generating' || messages.length <= 1}
              className="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Discard this conversation and start over"
            >
              + New chat
            </button>
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

      <main className="flex-1 max-w-2xl w-full mx-auto px-6 py-8 flex flex-col">
        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto pr-2"
          style={{ maxHeight: 'calc(100vh - 240px)' }}
        >
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={
                  m.role === 'user'
                    ? 'rounded-2xl bg-brand-600 text-white px-4 py-2.5 text-sm max-w-[85%] whitespace-pre-wrap'
                    : 'rounded-2xl bg-white border border-slate-200 px-4 py-2.5 text-sm text-slate-800 max-w-[85%] whitespace-pre-wrap'
                }
              >
                {m.content}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-white border border-slate-200 px-4 py-2.5 text-sm text-slate-500 italic">
                {busy === 'generating' ? 'Generating lesson...' : 'Thinking...'}
              </div>
            </div>
          )}
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>

        <form onSubmit={send} className="mt-4 bg-white border border-slate-200 rounded-2xl p-2 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(e as any);
              }
            }}
            placeholder={busy ? '' : 'Type your reply...'}
            rows={1}
            disabled={!!busy}
            autoFocus
            className="flex-1 resize-none rounded-md px-3 py-2 text-sm focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!!busy || !input.trim()}
            className="rounded-md bg-brand-600 text-white px-4 py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-60"
          >
            Send
          </button>
        </form>
      </main>
    </div>
  );
}
