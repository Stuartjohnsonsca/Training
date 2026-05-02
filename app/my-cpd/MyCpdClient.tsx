'use client';
import { useMemo, useState } from 'react';
import { signOut } from 'next-auth/react';
import CpdEditor, { type CpdEntry as EditorEntry } from '@/components/CpdEditor';

interface CpdEntry extends EditorEntry {
  id: string;
  lessonId: string;
  learner: string | null;
  totalScore: number;
  maxScore: number;
  lesson: { title: string; chatHistory: unknown };
}

export default function MyCpdClient({
  initial,
  isAdmin,
  learner,
}: {
  initial: CpdEntry[];
  isAdmin: boolean;
  learner: string;
}) {
  const [entries, setEntries] = useState<CpdEntry[]>(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showChatFor, setShowChatFor] = useState<string | null>(null);

  const totals = useMemo(() => {
    function durationFor(e: CpdEntry): number {
      if (!e.viewStartedAt || !e.completedAt) return 0;
      return Math.max(
        1,
        Math.round((new Date(e.completedAt).getTime() - new Date(e.viewStartedAt).getTime()) / 60000),
      );
    }
    const totalMin = entries.reduce((acc, e) => acc + durationFor(e), 0);
    const ethicsMin = entries.filter((e) => e.isEthics).reduce((acc, e) => acc + durationFor(e), 0);
    const structuredMin = entries.filter((e) => e.isStructured).reduce((acc, e) => acc + durationFor(e), 0);
    return { totalMin, ethicsMin, structuredMin, count: entries.length };
  }, [entries]);

  function applyPatch(id: string, patch: Partial<CpdEntry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  const editing = entries.find((e) => e.id === editingId);
  const showing = entries.find((e) => e.id === showChatFor);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="font-semibold">My CPD log</h1>
          <div className="flex items-center gap-4">
            <a href="/learn" className="text-sm text-slate-500 hover:text-slate-900">
              ← Back to training
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

      <main className="max-w-6xl mx-auto px-6 py-8">
        <p className="text-sm text-slate-500 mb-4">Account: <span className="font-mono">{learner}</span></p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <Stat label="Courses completed" value={totals.count.toString()} />
          <Stat label="Total CPD time" value={`${totals.totalMin} min`} />
          <Stat label="Structured CPD time" value={`${totals.structuredMin} min`} />
          <Stat label="Ethics CPD time" value={`${totals.ethicsMin} min`} />
        </div>

        {entries.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">
            No CPD entries yet. Complete a course at <a href="/learn" className="text-brand-600 underline">/learn</a> to see one here.
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-left">
                  <tr>
                    <th className="p-3 font-medium text-slate-600">Date</th>
                    <th className="p-3 font-medium text-slate-600">Topic area</th>
                    <th className="p-3 font-medium text-slate-600">Activity</th>
                    <th className="p-3 font-medium text-slate-600">Structured</th>
                    <th className="p-3 font-medium text-slate-600">IES 8</th>
                    <th className="p-3 font-medium text-slate-600">Ethics</th>
                    <th className="p-3 font-medium text-slate-600">Quiz</th>
                    <th className="p-3 font-medium text-slate-600">Time</th>
                    <th className="p-3 font-medium text-slate-600">Met objectives</th>
                    <th className="p-3 font-medium text-slate-600"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {entries.map((e) => {
                    const pct = e.maxScore > 0 ? Math.round((e.totalScore / e.maxScore) * 100) : 0;
                    const durationMin =
                      e.viewStartedAt && e.completedAt
                        ? Math.max(1, Math.round((new Date(e.completedAt).getTime() - new Date(e.viewStartedAt).getTime()) / 60000))
                        : null;
                    return (
                      <tr key={e.id} className="align-top">
                        <td className="p-3 text-slate-700 whitespace-nowrap">
                          {e.completedAt ? new Date(e.completedAt).toLocaleDateString('en-GB') : '—'}
                        </td>
                        <td className="p-3 text-slate-800 max-w-xs">{e.topicArea ?? e.lesson.title}</td>
                        <td className="p-3 text-slate-700 text-xs whitespace-nowrap">{e.activityCategory ?? '—'}</td>
                        <td className="p-3 text-slate-700 text-xs whitespace-nowrap">
                          {e.isStructured ? 'Structured' : 'Unstructured'}
                        </td>
                        <td className="p-3 text-slate-700 text-xs">
                          {e.ies8Number != null ? `${e.ies8Number}. ${e.ies8Label}` : '—'}
                        </td>
                        <td className="p-3 text-xs">{e.isEthics ? 'Yes' : '—'}</td>
                        <td className="p-3 text-slate-700 whitespace-nowrap">
                          {e.totalScore.toFixed(1)} / {e.maxScore} ({pct}%)
                        </td>
                        <td className="p-3 text-slate-700 whitespace-nowrap">
                          {durationMin != null ? `${durationMin} min` : '—'}
                        </td>
                        <td className="p-3 text-xs whitespace-nowrap">
                          {e.objectivesMet === true ? 'Yes' : e.objectivesMet === false ? 'No' : '—'}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <button
                            onClick={() => setEditingId(e.id)}
                            className="text-xs text-brand-600 hover:underline mr-3"
                          >
                            Edit
                          </button>
                          {Array.isArray(e.lesson.chatHistory) && (e.lesson.chatHistory as any[]).length > 0 && (
                            <button
                              onClick={() => setShowChatFor(e.id)}
                              className="text-xs text-brand-600 hover:underline"
                            >
                              Chat
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50" onClick={() => setEditingId(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-auto p-6" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-semibold">Edit CPD entry</h3>
                <p className="text-xs text-slate-500">{editing.lesson.title}</p>
              </div>
              <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-700">×</button>
            </div>
            <CpdEditor
              initial={editing}
              onSaved={(saved) => applyPatch(editing.id, saved as Partial<CpdEntry>)}
            />
          </div>
        </div>
      )}

      {showing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50" onClick={() => setShowChatFor(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-semibold">Refinement chat</h3>
                <p className="text-xs text-slate-500">{showing.lesson.title}</p>
              </div>
              <button onClick={() => setShowChatFor(null)} className="text-slate-400 hover:text-slate-700">×</button>
            </div>
            <div className="space-y-3">
              {(showing.lesson.chatHistory as Array<{ role: string; content: string }>).map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={
                    m.role === 'user'
                      ? 'rounded-2xl bg-brand-600 text-white px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap'
                      : 'rounded-2xl bg-slate-100 text-slate-800 px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap'
                  }>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}
