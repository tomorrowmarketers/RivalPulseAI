import { cn } from '@/lib/utils';

type KpiTone = 'default' | 'accent' | 'warning' | 'muted';

interface KpiCardProps {
  label: string;
  value: string | number;
  helper?: string;
  tone?: KpiTone;
}

const toneClasses: Record<KpiTone, string> = {
  default: 'border-[rgb(var(--border-line))] bg-surface-1',
  accent:  'border-brand/20 bg-brand/5',
  warning: 'border-warning/20 bg-warning/5',
  muted:   'border-[rgb(var(--border-line))] bg-surface-2/40',
};

export function KpiCard({ label, value, helper, tone = 'default' }: KpiCardProps) {
  return (
    <article className={cn('rounded-xl border p-4', toneClasses[tone])}>
      <span className="block text-label font-strong text-text-quaternary">
        {label}
      </span>
      <strong className="mt-1 block text-h3 font-emphasis text-text-primary">
        {value}
      </strong>
      {helper && (
        <p className="mt-1 text-caption text-text-tertiary">{helper}</p>
      )}
    </article>
  );
}
