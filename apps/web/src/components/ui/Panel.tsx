import { cn } from '@/lib/utils';

interface PanelProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Panel({ title, description, actions, children, className, bodyClassName }: PanelProps) {
  return (
    <section
      className={cn(
        'rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-sm',
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[rgb(var(--border-line))]">
          <div className="grid gap-1 min-w-0">
            {title && (
              <h2 className="text-h3 text-text-primary truncate">{title}</h2>
            )}
            {description && (
              <p className="text-caption text-text-tertiary">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn('p-5', bodyClassName)}>
        {children}
      </div>
    </section>
  );
}
