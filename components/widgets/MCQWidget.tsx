'use client';
import type { WidgetProps } from './index';

export default function MCQWidget({ config, value, onChange, disabled }: WidgetProps) {
  const options: string[] = config?.options ?? [];
  return (
    <div className="space-y-2">
      {options.map((opt, i) => {
        const id = `opt-${i}`;
        const checked = Number(value) === i;
        return (
          <label
            key={i}
            htmlFor={id}
            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition ${
              checked ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'
            } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <input
              type="radio"
              id={id}
              name="mcq"
              className="mt-1"
              checked={checked}
              onChange={() => onChange(i)}
              disabled={disabled}
            />
            <span className="text-sm text-slate-800">{opt}</span>
          </label>
        );
      })}
    </div>
  );
}
