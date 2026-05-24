import { cn } from '@/lib/utils';

type BadgeTone = 'neutral' | 'success' | 'warning' | 'accent' | 'danger';

interface StatusBadgeProps {
  tone?: BadgeTone;
  children: React.ReactNode;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-text-secondary border-[rgb(var(--border-line))]',
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  accent:  'bg-brand/10 text-brand border-brand/20',
  danger:  'bg-danger/10 text-danger border-danger/20',
};

export function StatusBadge({ tone = 'neutral', children }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-label font-emphasis whitespace-nowrap',
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}
