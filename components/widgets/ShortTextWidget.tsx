'use client';
import type { WidgetProps } from './index';

export default function ShortTextWidget({ config, value, onChange, disabled }: WidgetProps) {
  return (
    <textarea
      placeholder={config?.placeholder ?? 'Type your answer...'}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      rows={4}
      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-100"
    />
  );
}
