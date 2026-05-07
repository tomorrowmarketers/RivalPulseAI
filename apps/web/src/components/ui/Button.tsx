import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'xs' | 'sm' | 'md';

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-brand text-white hover:bg-brand-hover disabled:bg-brand/50',
  secondary:
    'border border-[rgb(var(--border-strong))] bg-surface-1 text-text-secondary hover:bg-surface-2',
  ghost:
    'text-text-secondary hover:bg-surface-2',
  danger:
    'border border-danger/30 bg-danger/5 text-danger hover:bg-danger/10',
};

const sizeClasses: Record<Size, string> = {
  xs: 'h-7 px-2 text-caption gap-1 rounded-md',
  sm: 'h-8 px-3 text-caption gap-1.5 rounded-md',
  md: 'h-9 px-4 text-small gap-2 rounded-md',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'sm', leadingIcon, trailingIcon, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-emphasis transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
});
