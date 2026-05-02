import { WIDGETS } from '@/lib/widgets/registry';

export default function WidgetsList() {
  return (
    <div className="max-w-5xl mx-auto px-6 pt-8">
      <h2 className="text-lg font-semibold mb-2">Widgets</h2>
      <p className="text-sm text-slate-500 mb-4">
        Interactive question types the lesson generator can choose from. All widgets are available to every lesson —
        the generator picks per question. To add a new widget: drop a component into{' '}
        <code className="text-xs bg-slate-100 rounded px-1">components/widgets/</code>, register it in{' '}
        <code className="text-xs bg-slate-100 rounded px-1">lib/widgets/registry.ts</code>, and add a grader.
      </p>
      <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
        {WIDGETS.map((w) => (
          <div key={w.slug} className="p-4">
            <div className="flex items-center gap-2">
              <span className="font-medium">{w.label}</span>
              <code className="text-xs text-slate-500">{w.slug}</code>
            </div>
            <p className="text-sm text-slate-700 mt-1">{w.llmDescription}</p>
            <p className="text-xs text-slate-400 mt-1 font-mono">{w.llmConfigShape}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
