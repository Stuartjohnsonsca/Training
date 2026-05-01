'use client';
import { WidgetType } from '@/lib/widgets/registry';
import MCQWidget from './MCQWidget';
import NumericWidget from './NumericWidget';
import ShortTextWidget from './ShortTextWidget';
import TAccountWidget from './TAccountWidget';

export interface WidgetProps {
  config: any;
  value: any;
  onChange: (v: any) => void;
  disabled?: boolean;
}

const REGISTRY: Record<WidgetType, React.ComponentType<WidgetProps>> = {
  'mcq': MCQWidget,
  'numeric': NumericWidget,
  'short-text': ShortTextWidget,
  't-account': TAccountWidget,
};

export function Widget({ widget, ...rest }: WidgetProps & { widget: WidgetType }) {
  const Cmp = REGISTRY[widget];
  if (!Cmp) return <div className="text-red-600 text-sm">Unknown widget: {widget}</div>;
  return <Cmp {...rest} />;
}
