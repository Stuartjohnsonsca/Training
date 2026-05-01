'use client';
import { useState } from 'react';
import { signOut } from 'next-auth/react';
import type { WidgetDef } from '@/lib/widgets/registry';

interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  allowedWidgets: string[];
  active: boolean;
  sortOrder: number;
}

export default function AdminCategories({
  initial,
  widgetTypes,
}: {
  initial: Category[];
  widgetTypes: WidgetDef[];
}) {
  const [items, setItems] = useState<Category[]>(initial);
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);

  function blank(): Category {
    return {
      id: '',
      slug: '',
      name: '',
      description: '',
      systemPrompt:
        'You generate training lessons for [audience]. Use [terminology/conventions]. For practical questions, prefer [problem types].',
      allowedWidgets: ['mcq', 'numeric', 'short-text'],
      active: true,
      sortOrder: items.length * 10 + 10,
    };
  }

  async function save(c: Category) {
    const isNew = !c.id;
    const url = isNew ? '/api/admin/categories' : `/api/admin/categories/${c.id}`;
    const method = isNew ? 'POST' : 'PATCH';
    const res = await fetch(url, {
      method,
      body: JSON.stringify({
        slug: c.slug,
        name: c.name,
        description: c.description ?? '',
        systemPrompt: c.systemPrompt,
        allowedWidgets: c.allowedWidgets,
        active: c.active,
        sortOrder: c.sortOrder,
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      alert('Save failed: ' + JSON.stringify(e.error ?? e));
      return;
    }
    const { category } = await res.json();
    setItems((prev) =>
      isNew ? [...prev, category].sort((a, b) => a.sortOrder - b.sortOrder) : prev.map((i) => (i.id === category.id ? category : i)),
    );
    setEditing(null);
    setCreating(false);
  }

  async function remove(c: Category) {
    if (!confirm(`Delete "${c.name}"? This also deletes its cached lessons and attempts.`)) return;
    const res = await fetch(`/api/admin/categories/${c.id}`, { method: 'DELETE' });
    if (!res.ok) {
      alert('Delete failed');
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== c.id));
  }

  async function logout() {
    await signOut({ callbackUrl: '/login' });
  }

  const active = creating ? blank() : editing;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="font-semibold">Training admin</h1>
          <div className="flex items-center gap-4">
            <a href="/learn" className="text-sm text-slate-500 hover:text-slate-900">
              Learner view
            </a>
            <button onClick={logout} className="text-sm text-slate-500 hover:text-slate-900">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Categories</h2>
          <div className="flex gap-2">
            {items.length === 0 && (
              <button
                onClick={async () => {
                  const res = await fetch('/api/admin/seed', { method: 'POST' });
                  if (!res.ok) {
                    alert('Seed failed');
                    return;
                  }
                  location.reload();
                }}
                className="rounded-md border border-slate-300 bg-white text-slate-700 py-2 px-3 text-sm font-medium hover:bg-slate-50"
              >
                Seed defaults (Accounting + Audit)
              </button>
            )}
            <button
              onClick={() => {
                setCreating(true);
                setEditing(null);
              }}
              className="rounded-md bg-brand-600 text-white py-2 px-3 text-sm font-medium hover:bg-brand-700"
            >
              + New category
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
          {items.length === 0 && <div className="p-6 text-sm text-slate-500">No categories yet.</div>}
          {items.map((c) => (
            <div key={c.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  <code className="text-xs text-slate-500">{c.slug}</code>
                  {!c.active && (
                    <span className="text-xs bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">inactive</span>
                  )}
                </div>
                {c.description && <div className="text-sm text-slate-500 mt-0.5">{c.description}</div>}
                <div className="text-xs text-slate-400 mt-1">
                  Widgets: {c.allowedWidgets.join(', ') || '—'}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setEditing(c);
                    setCreating(false);
                  }}
                  className="text-sm text-brand-600 hover:underline"
                >
                  Edit
                </button>
                <button onClick={() => remove(c)} className="text-sm text-red-600 hover:underline">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        {active && (
          <CategoryEditor
            initial={active}
            widgetTypes={widgetTypes}
            onCancel={() => {
              setEditing(null);
              setCreating(false);
            }}
            onSave={save}
          />
        )}
      </main>
    </div>
  );
}

function CategoryEditor({
  initial,
  widgetTypes,
  onSave,
  onCancel,
}: {
  initial: Category;
  widgetTypes: WidgetDef[];
  onSave: (c: Category) => Promise<void>;
  onCancel: () => void;
}) {
  const [c, setC] = useState<Category>(initial);
  const [saving, setSaving] = useState(false);

  function toggle(slug: string) {
    setC((prev) => ({
      ...prev,
      allowedWidgets: prev.allowedWidgets.includes(slug)
        ? prev.allowedWidgets.filter((s) => s !== slug)
        : [...prev.allowedWidgets, slug],
    }));
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto p-6">
        <h3 className="font-semibold text-lg mb-4">{c.id ? 'Edit category' : 'New category'}</h3>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                value={c.name}
                onChange={(e) => setC({ ...c, name: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Slug (lowercase, hyphens)</label>
              <input
                value={c.slug}
                onChange={(e) => setC({ ...c, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description (shown to learner)</label>
            <input
              value={c.description ?? ''}
              onChange={(e) => setC({ ...c, description: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">System prompt (steers the AI lesson generator)</label>
            <textarea
              rows={5}
              value={c.systemPrompt}
              onChange={(e) => setC({ ...c, systemPrompt: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
            />
            <div className="text-xs text-slate-500 mt-1">
              Describe the audience, terminology, and what kind of practical questions to favour.
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Allowed widgets</label>
            <div className="space-y-2">
              {widgetTypes.map((w) => (
                <label key={w.slug} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={c.allowedWidgets.includes(w.slug)}
                    onChange={() => toggle(w.slug)}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">{w.label}</span>
                    <span className="text-slate-500"> — {w.llmDescription}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Sort order</label>
              <input
                type="number"
                value={c.sortOrder}
                onChange={(e) => setC({ ...c, sortOrder: Number(e.target.value) })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={c.active}
                  onChange={(e) => setC({ ...c, active: e.target.checked })}
                />
                Active (visible to learners)
              </label>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onCancel} className="text-sm text-slate-600 hover:text-slate-900 px-3">
            Cancel
          </button>
          <button
            onClick={async () => {
              setSaving(true);
              await onSave(c);
              setSaving(false);
            }}
            disabled={saving || !c.name || !c.slug || !c.systemPrompt || c.allowedWidgets.length === 0}
            className="rounded-md bg-brand-600 text-white py-2 px-4 text-sm font-medium hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
