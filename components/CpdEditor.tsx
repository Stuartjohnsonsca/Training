'use client';
import { useState } from 'react';
import { CPD_ACTIVITIES } from '@/lib/cpd-activities';

export interface CpdEntry {
  attemptId?: string;
  id?: string;
  topicArea: string | null;
  ies8Number: number | null;
  ies8Label: string | null;
  isEthics: boolean;
  cpdSummary: string | null;
  viewStartedAt: string | Date | null;
  completedAt: string | Date | null;
  activityCategory: string | null;
  isStructured: boolean;
  whyUndertaken: string | null;
  intendedLearningOutcomes: string | null;
  learnedFromExercise: string | null;
  objectivesMet: boolean | null;
  /** Language the lesson was generated in. Read-only — set at generation time. */
  lesson?: { outputLanguage?: string | null };
}

/**
 * Editable CPD entry form. Saves field-by-field as the learner edits — small autosave with debounce
 * would be nicer, but for now we save explicitly via the buttons / blur.
 */
export default function CpdEditor({ initial, onSaved }: { initial: CpdEntry; onSaved?: (e: CpdEntry) => void }) {
  const [e, setE] = useState<CpdEntry>(initial);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);

  const id = e.attemptId ?? e.id;

  async function patch(field: keyof CpdEntry, value: any) {
    if (!id) return;
    setSavingField(field as string);
    setE((prev) => ({ ...prev, [field]: value }));
    try {
      const res = await fetch(`/api/cpd?id=${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        const { entry } = await res.json();
        setE(entry);
        setSavedField(field as string);
        setTimeout(() => setSavedField(null), 1500);
        onSaved?.(entry);
      }
    } finally {
      setSavingField(null);
    }
  }

  const completedAt = e.completedAt ? new Date(e.completedAt) : null;
  const startedAt = e.viewStartedAt ? new Date(e.viewStartedAt) : null;
  const durationMin =
    completedAt && startedAt
      ? Math.max(1, Math.round((completedAt.getTime() - startedAt.getTime()) / 60000))
      : null;

  return (
    <div className="space-y-4">
      {/* Read-only system metadata */}
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Field label="Topic area">{e.topicArea ?? '—'}</Field>
        <Field label="IES 8 category">
          {e.ies8Number != null ? `${e.ies8Number}. ${e.ies8Label}` : '—'}
        </Field>
        <Field label="Lesson language">{e.lesson?.outputLanguage ?? 'English'}</Field>
        <Field label="Duration">{durationMin != null ? `${durationMin} min` : '—'}</Field>
        <Field label="Completed">{completedAt ? completedAt.toLocaleString('en-GB') : '—'}</Field>
      </dl>

      {/* Editable fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
        <div>
          <Label name="Activity category" saving={savingField === 'activityCategory'} saved={savedField === 'activityCategory'} />
          <select
            value={e.activityCategory ?? ''}
            onChange={(ev) => patch('activityCategory', ev.target.value || null)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">— select —</option>
            {CPD_ACTIVITIES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label name="Structured / unstructured" saving={savingField === 'isStructured'} saved={savedField === 'isStructured'} />
          <div className="flex gap-4 pt-1.5">
            <label className="text-sm flex items-center gap-2">
              <input
                type="radio"
                checked={e.isStructured}
                onChange={() => patch('isStructured', true)}
              />
              Structured
            </label>
            <label className="text-sm flex items-center gap-2">
              <input
                type="radio"
                checked={!e.isStructured}
                onChange={() => patch('isStructured', false)}
              />
              Unstructured
            </label>
          </div>
        </div>
        <div className="sm:col-span-2">
          <Label name="Counts as Ethics CPD" saving={savingField === 'isEthics'} saved={savedField === 'isEthics'} />
          <label className="text-sm flex items-center gap-2 pt-1">
            <input type="checkbox" checked={e.isEthics} onChange={(ev) => patch('isEthics', ev.target.checked)} />
            Yes — Ethics CPD
          </label>
        </div>
      </div>

      <ReflectionTextarea
        label="Why did you undertake this piece of learning?"
        field="whyUndertaken"
        value={e.whyUndertaken ?? ''}
        savingField={savingField}
        savedField={savedField}
        onCommit={(v) => patch('whyUndertaken', v || null)}
      />
      <ReflectionTextarea
        label="What were the intended learning outcomes of this piece of CPD?"
        field="intendedLearningOutcomes"
        value={e.intendedLearningOutcomes ?? ''}
        savingField={savingField}
        savedField={savedField}
        onCommit={(v) => patch('intendedLearningOutcomes', v || null)}
      />
      <ReflectionTextarea
        label="What did you learn from undertaking this CPD exercise?"
        field="learnedFromExercise"
        value={e.learnedFromExercise ?? ''}
        savingField={savingField}
        savedField={savedField}
        onCommit={(v) => patch('learnedFromExercise', v || null)}
      />

      <div>
        <Label name="Were the stated learning objectives met?" saving={savingField === 'objectivesMet'} saved={savedField === 'objectivesMet'} />
        <div className="flex gap-4 pt-1.5">
          <label className="text-sm flex items-center gap-2">
            <input
              type="radio"
              checked={e.objectivesMet === true}
              onChange={() => patch('objectivesMet', true)}
            />
            Yes
          </label>
          <label className="text-sm flex items-center gap-2">
            <input
              type="radio"
              checked={e.objectivesMet === false}
              onChange={() => patch('objectivesMet', false)}
            />
            No
          </label>
          <label className="text-sm flex items-center gap-2 text-slate-500">
            <input
              type="radio"
              checked={e.objectivesMet == null}
              onChange={() => patch('objectivesMet', null)}
            />
            Not yet answered
          </label>
        </div>
      </div>
    </div>
  );
}

function Label({ name, saving, saved }: { name: string; saving: boolean; saved: boolean }) {
  return (
    <label className="block text-xs font-medium text-slate-600 uppercase tracking-wide mb-1">
      {name}
      {saving && <span className="ml-2 text-slate-400 text-xs normal-case font-normal">saving...</span>}
      {saved && <span className="ml-2 text-emerald-600 text-xs normal-case font-normal">saved</span>}
    </label>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-slate-800">{children}</dd>
    </div>
  );
}

function ReflectionTextarea({
  label,
  field,
  value,
  savingField,
  savedField,
  onCommit,
}: {
  label: string;
  field: string;
  value: string;
  savingField: string | null;
  savedField: string | null;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  return (
    <div>
      <Label name={label} saving={savingField === field} saved={savedField === field} />
      <textarea
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local !== value) onCommit(local);
        }}
        rows={3}
        placeholder="Type your reflection — saves when you click away..."
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
    </div>
  );
}
