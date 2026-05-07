'use client';

import { cn } from '@/lib/utils';
import { MARKET_SEGMENTS, type MarketSegment } from '@/lib/marketSegments';

interface SegmentTagPickerProps {
  value: MarketSegment | '';
  onChange: (value: MarketSegment | '') => void;
  disabled?: boolean;
  className?: string;
}

export function SegmentTagPicker({ value, onChange, disabled, className }: SegmentTagPickerProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {MARKET_SEGMENTS.map((segment) => {
        const active = value === segment;
        return (
          <button
            key={segment}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(active ? '' : segment)}
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-1 text-caption font-emphasis transition-colors',
              active
                ? 'border-brand/30 bg-brand/10 text-brand'
                : 'border-[rgb(var(--border-line))] bg-surface-1 text-text-secondary hover:bg-surface-2',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            {segment}
          </button>
        );
      })}

      {value && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange('')}
          className={cn(
            'inline-flex items-center rounded-full border border-[rgb(var(--border-line))] px-2.5 py-1 text-caption font-emphasis text-text-tertiary transition-colors hover:bg-surface-2',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          Bỏ chọn
        </button>
      )}
    </div>
  );
}