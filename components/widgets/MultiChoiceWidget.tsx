'use client';
import type { WidgetProps } from './index';

export default function MultiChoiceWidget({ config, value, onChange, disabled }: WidgetProps) {
  const options: string[] = config?.options ?? [];
  const selected: number[] = Array.isArray(value) ? value.map(Number) : [];

  function toggle(i: number) {
    if (disabled) return;
    const next = selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i].sort((a, b) => a - b);
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">Select all that apply</p>
      {options.map((opt, i) => {
        const id = `mopt-${i}`;
        const checked = selected.includes(i);
        return (
          <label
            key={i}
            htmlFor={id}
            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition ${
              checked ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'
            } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <input
              type="checkbox"
              id={id}
              className="mt-1"
              checked={checked}
              onChange={() => toggle(i)}
              disabled={disabled}
            />
            <span className="text-sm text-slate-800">{opt}</span>
          </label>
        );
      })}
    </div>
  );
}
