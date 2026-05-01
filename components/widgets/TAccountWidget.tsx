'use client';
import { useState } from 'react';
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
  return { debits: [{ narrative: '', amount: '' }], credits: [{ narrative: '', amount: '' }] };
}

export default function TAccountWidget({ config, value, onChange, disabled }: WidgetProps) {
  const accounts: string[] = config?.accounts ?? ['Account 1', 'Account 2'];
  const v: Value = value && typeof value === 'object' ? value : Object.fromEntries(accounts.map((a) => [a, emptyAcct()]));

  function update(acct: string, side: 'debits' | 'credits', idx: number, key: keyof Entry, newVal: any) {
    const next = structuredClone(v) as Value;
    if (!next[acct]) next[acct] = emptyAcct();
    const rows = next[acct][side];
    if (!rows[idx]) rows[idx] = { narrative: '', amount: '' };
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
    <div className="grid gap-4 sm:grid-cols-2">
      {accounts.map((acct) => {
        const a = v[acct] ?? emptyAcct();
        const dTotal = a.debits.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const cTotal = a.credits.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        return (
          <div key={acct} className="rounded-lg border border-slate-300 bg-white p-3">
            <div className="text-center font-semibold text-sm border-b border-slate-300 pb-2 mb-2">{acct}</div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-center font-medium text-slate-500 mb-1">Dr</div>
                {a.debits.map((row, i) => (
                  <div key={i} className="flex gap-1 mb-1">
                    <input
                      type="text"
                      placeholder="narrative"
                      value={row.narrative}
                      onChange={(e) => update(acct, 'debits', i, 'narrative', e.target.value)}
                      disabled={disabled}
                      className="w-2/3 rounded border border-slate-200 px-1 py-0.5"
                    />
                    <input
                      type="number"
                      step="any"
                      placeholder="0"
                      value={row.amount}
                      onChange={(e) => update(acct, 'debits', i, 'amount', e.target.value)}
                      disabled={disabled}
                      className="w-1/3 rounded border border-slate-200 px-1 py-0.5 text-right"
                    />
                  </div>
                ))}
                {!disabled && (
                  <button type="button" onClick={() => addRow(acct, 'debits')} className="text-brand-600 text-xs mt-1">
                    + add
                  </button>
                )}
                <div className="text-right border-t border-slate-300 mt-2 pt-1 font-medium">£{dTotal.toFixed(2)}</div>
              </div>
              <div className="border-l border-slate-300 pl-3">
                <div className="text-center font-medium text-slate-500 mb-1">Cr</div>
                {a.credits.map((row, i) => (
                  <div key={i} className="flex gap-1 mb-1">
                    <input
                      type="text"
                      placeholder="narrative"
                      value={row.narrative}
                      onChange={(e) => update(acct, 'credits', i, 'narrative', e.target.value)}
                      disabled={disabled}
                      className="w-2/3 rounded border border-slate-200 px-1 py-0.5"
                    />
                    <input
                      type="number"
                      step="any"
                      placeholder="0"
                      value={row.amount}
                      onChange={(e) => update(acct, 'credits', i, 'amount', e.target.value)}
                      disabled={disabled}
                      className="w-1/3 rounded border border-slate-200 px-1 py-0.5 text-right"
                    />
                  </div>
                ))}
                {!disabled && (
                  <button type="button" onClick={() => addRow(acct, 'credits')} className="text-brand-600 text-xs mt-1">
                    + add
                  </button>
                )}
                <div className="text-right border-t border-slate-300 mt-2 pt-1 font-medium">£{cTotal.toFixed(2)}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
