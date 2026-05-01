'use client';
import type { WidgetProps } from './index';

export default function NumericWidget({ config, value, onChange, disabled }: WidgetProps) {
  const unit: string = config?.unit ?? '';
  return (
    <div className="flex items-center gap-2 max-w-sm">
      {unit === '£' && <span className="text-slate-500">£</span>}
      <input
        type="number"
        step="any"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        disabled={disabled}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-100"
      />
      {unit && unit !== '£' && <span className="text-slate-500">{unit}</span>}
    </div>
  );
}
