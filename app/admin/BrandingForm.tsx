'use client';
import { useState } from 'react';

interface Branding {
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  footerText: string | null;
}

export default function BrandingForm({ initial }: { initial: Branding }) {
  const [b, setB] = useState<Branding>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    const res = await fetch('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(b),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      const e = await res.json().catch(() => ({}));
      alert('Save failed: ' + JSON.stringify(e.error ?? e));
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 pt-8">
      <h2 className="text-lg font-semibold mb-4">Branding</h2>
      <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Brand name</label>
            <input
              value={b.brandName}
              onChange={(e) => setB({ ...b, brandName: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Primary colour (hex, e.g. #1d4ed8)</label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={b.primaryColor}
                onChange={(e) => setB({ ...b, primaryColor: e.target.value })}
                className="w-10 h-9 rounded border border-slate-300 cursor-pointer"
              />
              <input
                value={b.primaryColor}
                onChange={(e) => setB({ ...b, primaryColor: e.target.value })}
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Logo URL</label>
          <input
            value={b.logoUrl ?? ''}
            onChange={(e) => setB({ ...b, logoUrl: e.target.value || null })}
            placeholder="https://example.com/logo.svg"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          {b.logoUrl && (
            <img src={b.logoUrl} alt="" className="mt-2 max-h-12" onError={(e) => (e.currentTarget.style.display = 'none')} />
          )}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Footer text (shown on every slide)</label>
          <input
            value={b.footerText ?? ''}
            onChange={(e) => setB({ ...b, footerText: e.target.value || null })}
            placeholder="© Acumon Intelligence — Confidential"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex justify-end items-center gap-3">
          {saved && <span className="text-sm text-emerald-600">Saved</span>}
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-brand-600 text-white py-2 px-4 text-sm font-medium hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save branding'}
          </button>
        </div>
      </form>
    </div>
  );
}
