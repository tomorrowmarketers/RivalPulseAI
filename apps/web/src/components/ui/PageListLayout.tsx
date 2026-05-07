'use client';

import { useState } from 'react';
import { LayoutGrid, List as ListIcon, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from './Input';

export type ViewMode = 'grid' | 'list';

export interface ToolbarCtx {
  viewMode: ViewMode;
  filterText: string;
}

interface PageListLayoutProps {
  title: string;
  description?: React.ReactNode;
  overview?: React.ReactNode;
  action?: React.ReactNode;
  isLoading?: boolean;
  loadingText?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchValueChange?: (value: string) => void;
  viewToggle?: boolean;
  defaultView?: ViewMode;
  toolbarExtra?: ((ctx: ToolbarCtx) => React.ReactNode) | React.ReactNode;
  children: ((ctx: ToolbarCtx) => React.ReactNode) | React.ReactNode;
}

export function PageListLayout({
  title,
  description,
  overview,
  action,
  isLoading = false,
  loadingText = 'Đang tải…',
  searchable = true,
  searchPlaceholder = 'Tìm kiếm…',
  searchValue,
  onSearchValueChange,
  viewToggle = true,
  defaultView = 'grid',
  toolbarExtra,
  children,
}: PageListLayoutProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(defaultView);
  const [internalFilterText, setInternalFilterText] = useState('');

  const filterText = searchValue ?? internalFilterText;
  const setFilterText = onSearchValueChange ?? setInternalFilterText;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-brand" />
          <p className="text-caption text-text-tertiary">{loadingText}</p>
        </div>
      </div>
    );
  }

  const ctx: ToolbarCtx = { viewMode, filterText };
  const toolbarExtraContent = typeof toolbarExtra === 'function' ? toolbarExtra(ctx) : toolbarExtra;
  const showToolbar = searchable || viewToggle || Boolean(toolbarExtraContent);

  return (
    <div className="px-6 py-6 xl:px-8">
      <header className="mb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-h1 font-emphasis text-text-primary">{title}</h1>
            {description && (
              <p className="mt-1 text-caption text-text-tertiary max-w-2xl">{description}</p>
            )}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      </header>

      {overview && <div className="mb-4">{overview}</div>}

      {showToolbar && (
        <div className="mb-4 flex flex-col gap-2.5 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:flex-row sm:items-center">
            {searchable && (
              <div className="min-w-[240px] max-w-md flex-1 sm:flex-[0_0_320px]">
                <Input
                  size="sm"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder={searchPlaceholder}
                  leadingIcon={<Search />}
                />
              </div>
            )}
            {toolbarExtraContent && (
              <div className="flex items-center gap-2">{toolbarExtraContent}</div>
            )}
          </div>

          {viewToggle && (
            <div className="flex items-center lg:justify-end">
              <div className="inline-flex items-center overflow-hidden rounded-md border border-[rgb(var(--border-strong))] bg-surface-1 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={cn(
                    'inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors',
                    viewMode === 'grid'
                      ? 'bg-surface-3 text-text-primary'
                      : 'text-text-tertiary hover:text-text-primary',
                  )}
                  title="Lưới"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors',
                    viewMode === 'list'
                      ? 'bg-surface-3 text-text-primary'
                      : 'text-text-tertiary hover:text-text-primary',
                  )}
                  title="Danh sách"
                >
                  <ListIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {typeof children === 'function' ? children(ctx) : children}
    </div>
  );
}
