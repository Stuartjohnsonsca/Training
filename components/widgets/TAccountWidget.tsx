'use client';
import type { WidgetProps } from './index';

interface Entry {
  narrative: string;
  amount: number | '';
}
interface Account {
  debits: Entry[];
  credits: Entry[];
}
type Value = Record<string, Account>;

function emptyAcct(): Account {
  return {
    debits: [
      { narrative: '', amount: '' },
      { narrative: '', amount: '' },
    ],
    credits: [
      { narrative: '', amount: '' },
      { narrative: '', amount: '' },
    ],
  };
}

export default function TAccountWidget({ config, value, onChange, disabled }: WidgetProps) {
  const accounts: string[] = config?.accounts ?? ['Account 1', 'Account 2'];
  const v: Value =
    value && typeof value === 'object' ? value : Object.fromEntries(accounts.map((a) => [a, emptyAcct()]));

  function update(acct: string, side: 'debits' | 'credits', idx: number, key: keyof Entry, newVal: any) {
    const next = structuredClone(v) as Value;
    if (!next[acct]) next[acct] = emptyAcct();
    const rows = next[acct][side];
    while (rows.length <= idx) rows.push({ narrative: '', amount: '' });
    (rows[idx][key] as any) = key === 'amount' ? (newVal === '' ? '' : Number(newVal)) : newVal;
    onChange(next);
  }

  function addRow(acct: string, side: 'debits' | 'credits') {
    const next = structuredClone(v) as Value;
    if (!next[acct]) next[acct] = emptyAcct();
    next[acct][side].push({ narrative: '', amount: '' });
    onChange(next);
  }

  return (
    <div className="space-y-5">
      {accounts.map((acct) => {
        const a = v[acct] ?? emptyAcct();
        const dTotal = a.debits.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const cTotal = a.credits.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const balanced = Math.abs(dTotal - cTotal) <= 0.01;
        return (
          <div key={acct} className="rounded-xl border border-slate-300 bg-white overflow-hidden">
            <div className="text-center font-semibold text-base bg-slate-50 border-b border-slate-200 py-2">
              {acct}
            </div>
            <div className="grid grid-cols-2 divide-x divide-slate-200">
              <Side
                label="Debit (Dr)"
                rows={a.debits}
                onChange={(i, k, val) => update(acct, 'debits', i, k, val)}
                onAdd={() => addRow(acct, 'debits')}
                total={dTotal}
                disabled={disabled}
              />
              <Side
                label="Credit (Cr)"
                rows={a.credits}
                onChange={(i, k, val) => update(acct, 'credits', i, k, val)}
                onAdd={() => addRow(acct, 'credits')}
                total={cTotal}
                disabled={disabled}
              />
            </div>
            {!disabled && (dTotal > 0 || cTotal > 0) && (
              <div
                className={`text-xs text-center py-1.5 ${
                  balanced ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50'
                }`}
              >
                {balanced ? '✓ Account balances' : `Difference: £${Math.abs(dTotal - cTotal).toFixed(2)}`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Side({
  label,
  rows,
  onChange,
  onAdd,
  total,
  disabled,
}: {
  label: string;
  rows: Entry[];
  onChange: (idx: number, key: keyof Entry, val: any) => void;
  onAdd: () => void;
  total: number;
  disabled?: boolean;
}) {
  return (
    <div className="p-3">
      <div className="text-center text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">{label}</div>
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-1.5">
            <input
              type="text"
              placeholder="Narrative"
              value={row.narrative}
              onChange={(e) => onChange(i, 'narrative', e.target.value)}
              disabled={disabled}
              className="flex-1 min-w-0 rounded border border-slate-200 px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              step="any"
              placeholder="0.00"
              value={row.amount}
              onChange={(e) => onChange(i, 'amount', e.target.value)}
              disabled={disabled}
              className="w-24 rounded border border-slate-200 px-2 py-1.5 text-sm text-right tabular-nums"
            />
          </div>
        ))}
      </div>
      {!disabled && (
        <button type="button" onClick={onAdd} className="text-brand-600 text-xs mt-2 hover:underline">
          + Add row
        </button>
      )}
      <div className="border-t border-slate-300 mt-2 pt-1.5 text-right text-sm font-semibold tabular-nums">
        £{total.toFixed(2)}
      </div>
    </div>
  );
}
