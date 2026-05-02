'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { upload } from '@vercel/blob/client';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface UploadedSource {
  id: string;
  filename: string;
  fileSizeBytes: number;
  approxTokens: number;
  truncated?: boolean;
}

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    role: 'assistant',
    content:
      "What training do you require? Describe the topic in your own words — anything from a single concept to a broader area. You can also attach reference documents (PDF, DOCX, PPTX, TXT) and I'll build a longer course tailored to them.",
  },
];

export default function LearnLanding() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<false | 'thinking' | 'generating' | 'uploading'>(false);
  const [error, setError] = useState('');
  const [sources, setSources] = useState<UploadedSource[]>([]);
  const [progress, setProgress] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function progressLabel(step: string | undefined, plannedSlides?: number, plannedQuiz?: number): string {
    if (!step) return 'Generating lesson...';
    let m = step.match(/^slides-(\d+)\/(\d+)/);
    if (m) return `Building slide ${m[1]} of ${m[2]}...`;
    if (step === 'backfill-done') return 'Filling in missing aspects...';
    if (step === 'reviewed' || step === 'review-clean') return 'Review passed — building quiz...';
    if (step.startsWith('review-cycle-')) return 'Reviewing for accuracy...';
    m = step.match(/^quiz-(\d+)\/(\d+)/);
    if (m) return `Building quiz question ${m[1]} of ${m[2]}...`;
    if (step.startsWith('quiz-batch-')) return 'Building quiz...';
    if (step === 'quiz-done' || step === 'finalised') return 'Almost ready...';
    return `Generating lesson... (${step})`;
  }

  function newChat() {
    setMessages(INITIAL_MESSAGES);
    setInput('');
    setError('');
    setBusy(false);
    setProgress('');
    setSources([]);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError('');
    setBusy('uploading');
    for (const file of Array.from(files)) {
      try {
        // 1. Client-direct upload to private Blob (server only issues a token).
        const blob = await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: '/api/blob/upload-token',
          clientPayload: 'source',
        });
        // 2. Register the upload — server fetches the file from Blob with the token, extracts text, persists.
        const regRes = await fetch('/api/sources/register', {
          method: 'POST',
          body: JSON.stringify({
            url: blob.url,
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            fileSizeBytes: file.size,
          }),
        });
        if (!regRes.ok) {
          const e = await regRes.json().catch(() => ({}));
          throw new Error(`${file.name}: ${extractErrorMessage(e)}`);
        }
        const { source } = await regRes.json();
        setSources((prev) => [...prev, source]);
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            content: `Attached: ${source.filename} (${(source.fileSizeBytes / 1024).toFixed(0)} KB, ~${source.approxTokens.toLocaleString()} tokens). I'll teach the material in this document.`,
          },
        ]);
      } catch (err: any) {
        setError(err.message ?? 'Upload failed');
      }
    }
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeSource(id: string) {
    setSources((prev) => prev.filter((s) => s.id !== id));
  }

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
        throw new Error(extractErrorMessage(e));
      }
      const refData = await refRes.json();

      if (refData.ready && refData.topic) {
        const sourceLine = sources.length > 0 ? ` using ${sources.length} attached document${sources.length === 1 ? '' : 's'}` : '';
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            content: `Right — building a lesson on: "${refData.topic}"${sourceLine}. ${sources.length > 0 ? 'With sources this can take a few minutes.' : 'This takes about a minute.'}`,
          },
        ]);
        setBusy('generating');
        setProgress('Researching authoritative sources...');

        const startRes = await fetch('/api/lessons/generate', {
          method: 'POST',
          body: JSON.stringify({
            topic: refData.topic,
            chatHistory: next,
            sourceIds: sources.map((s) => s.id),
          }),
        });
        if (!startRes.ok) {
          const e = await startRes.json().catch(() => ({}));
          throw new Error(extractErrorMessage(e));
        }
        let { lessonId, status, step, plannedSlides, plannedQuiz } = (await startRes.json()) as {
          lessonId: string;
          status: string;
          step?: string;
          plannedSlides?: number;
          plannedQuiz?: number;
        };

        if (plannedSlides && plannedQuiz) {
          setMessages((m) => [
            ...m,
            {
              role: 'assistant',
              content: `Plan: ${plannedSlides} slides + ${plannedQuiz} quiz questions, sized to the material.`,
            },
          ]);
        }
        setProgress(progressLabel(step, plannedSlides, plannedQuiz));

        // With longer lessons (20+ slides) we may need many continue calls.
        let safety = 30;
        while (status === 'generating' && safety-- > 0) {
          const contRes = await fetch('/api/lessons/generate', {
            method: 'POST',
            body: JSON.stringify({ lessonId }),
          });
          if (!contRes.ok) {
            const e = await contRes.json().catch(() => ({}));
            throw new Error(extractErrorMessage(e));
          }
          const data = (await contRes.json()) as {
            status: string;
            step?: string;
            plannedSlides?: number;
            plannedQuiz?: number;
          };
          status = data.status;
          setProgress(progressLabel(data.step, data.plannedSlides, data.plannedQuiz));
        }

        if (status !== 'ready') {
          throw new Error('Lesson did not finish generating in time. Try again.');
        }

        router.push(`/learn/${lessonId}`);
      } else {
        setMessages((m) => [...m, { role: 'assistant', content: refData.reply ?? '...' }]);
        setBusy(false);
      }
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
      setBusy(false);
      setProgress('');
    }
  }

  function extractErrorMessage(e: any): string {
    if (typeof e?.error === 'string') return e.error;
    if (e?.error?.formErrors?.length) return e.error.formErrors.join(', ');
    return 'Something went wrong';
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="font-semibold">Acumon Training</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={newChat}
              disabled={busy === 'generating' || (messages.length <= 1 && sources.length === 0)}
              className="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Discard this conversation and start over"
            >
              + New chat
            </button>
            <a href="/sources" className="text-sm text-slate-500 hover:text-slate-900">
              Sources
            </a>
            <a href="/my-cpd" className="text-sm text-slate-500 hover:text-slate-900">
              My CPD
            </a>
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
          style={{ maxHeight: 'calc(100vh - 280px)' }}
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
                {busy === 'generating'
                  ? progress || 'Generating lesson...'
                  : busy === 'uploading'
                  ? 'Uploading and extracting text...'
                  : 'Thinking...'}
              </div>
            </div>
          )}
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>

        {sources.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {sources.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-300 text-xs text-slate-700 pl-2 pr-1 py-1"
              >
                <span aria-hidden>📎</span>
                <span className="font-medium">{s.filename}</span>
                <span className="text-slate-500">~{s.approxTokens.toLocaleString()} tok</span>
                {!busy && (
                  <button
                    type="button"
                    onClick={() => removeSource(s.id)}
                    className="ml-1 w-4 h-4 rounded-full bg-slate-300 text-white text-[10px] hover:bg-slate-500"
                    aria-label={`Remove ${s.filename}`}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        <form onSubmit={send} className="mt-3 bg-white border border-slate-200 rounded-2xl p-2 flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.pptx,.txt,.md,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown,text/csv"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!!busy}
            className="self-stretch px-3 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            title="Attach reference document(s) — PDF, DOCX, PPTX, TXT"
            aria-label="Attach document"
          >
            📎
          </button>
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
