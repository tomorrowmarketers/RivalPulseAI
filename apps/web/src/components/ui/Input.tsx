import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

type Size = 'sm' | 'md';

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 text-caption px-3',
  md: 'h-9 text-small px-3',
};

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: Size;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', leadingIcon, trailingIcon, invalid, className, ...rest },
  ref,
) {
  const hasIcon = Boolean(leadingIcon || trailingIcon);

  if (!hasIcon) {
    return (
      <input
        ref={ref}
        className={cn(
          'block w-full rounded-md border bg-surface-1 text-text-primary placeholder:text-text-quaternary outline-none transition-colors',
          'focus:border-brand focus:shadow-focus-brand',
          invalid ? 'border-danger' : 'border-[rgb(var(--border-strong))]',
          sizeClasses[size],
          className,
        )}
        {...rest}
      />
    );
  }

  return (
    <div className={cn(
      'group relative flex items-center rounded-md border bg-surface-1 transition-colors',
      'focus-within:border-brand focus-within:shadow-focus-brand',
      invalid ? 'border-danger' : 'border-[rgb(var(--border-strong))]',
    )}>
      {leadingIcon && (
        <span className="pointer-events-none flex h-full items-center pl-2.5 text-text-quaternary [&_svg]:h-4 [&_svg]:w-4">
          {leadingIcon}
        </span>
      )}
      <input
        ref={ref}
        className={cn(
          'min-w-0 flex-1 bg-transparent text-text-primary placeholder:text-text-quaternary outline-none',
          sizeClasses[size],
          leadingIcon && '!pl-2',
          trailingIcon && '!pr-2',
          className,
        )}
        {...rest}
      />
      {trailingIcon && (
        <span className="flex h-full items-center pr-2.5 text-text-quaternary [&_svg]:h-4 [&_svg]:w-4">
          {trailingIcon}
        </span>
      )}
    </div>
  );
});
