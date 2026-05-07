import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
type Size = 'sm' | 'md';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-text-secondary border-[rgb(var(--border-line))]',
  brand:   'bg-brand/10 text-brand border-brand/20',
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  danger:  'bg-danger/10 text-danger border-danger/20',
  info:    'bg-info/10 text-info border-info/20',
};

const sizeClasses: Record<Size, string> = {
  sm: 'text-tiny px-1.5 py-0.5',
  md: 'text-caption px-2 py-0.5',
};

interface BadgeProps {
  tone?: Tone;
  size?: Size;
  className?: string;
  leadingIcon?: React.ReactNode;
  children: React.ReactNode;
}

export function Badge({ tone = 'neutral', size = 'sm', leadingIcon, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-emphasis whitespace-nowrap',
        toneClasses[tone],
        sizeClasses[size],
        className,
      )}
    >
      {leadingIcon && <span className="[&_svg]:h-3 [&_svg]:w-3">{leadingIcon}</span>}
      {children}
    </span>
  );
}
