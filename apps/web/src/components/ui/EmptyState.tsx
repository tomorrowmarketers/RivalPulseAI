import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-16 text-center', className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-2 text-text-quaternary">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-small font-emphasis text-text-primary">{title}</p>
        {description && <p className="mt-1 text-caption text-text-tertiary max-w-sm">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
