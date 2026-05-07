'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Size = 'sm' | 'md' | 'lg';

const sizeClasses: Record<Size, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
};

interface AppModalShellProps {
  title: string;
  description?: string;
  onClose: () => void;
  size?: Size;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function AppModalShell({ title, description, onClose, size = 'md', footer, children }: AppModalShellProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className={cn(
          'flex w-full flex-col overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-popover',
          'max-h-[90vh]',
          sizeClasses[size],
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[rgb(var(--border-line))]">
          <div className="min-w-0">
            <h2 className="text-h3 text-text-primary truncate">{title}</h2>
            {description && <p className="mt-1 text-caption text-text-tertiary">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 rounded-md p-1.5 text-text-tertiary hover:bg-surface-2 transition-colors"
            aria-label="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">
          {children}
        </div>
        {footer && (
          <footer className="flex justify-end gap-2 px-5 py-3 border-t border-[rgb(var(--border-line))] bg-surface-2/40">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
