import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WizardStepDef {
  key: string;
  label: string;
  caption?: string;
}

interface WizardStepperProps {
  steps: WizardStepDef[];
  currentIndex: number;
  highestReachedIndex?: number;
  onNavigate?: (key: string, index: number) => void;
  className?: string;
}

export function WizardStepper({
  steps,
  currentIndex,
  highestReachedIndex,
  onNavigate,
  className,
}: WizardStepperProps) {
  const reachedIndex = highestReachedIndex ?? currentIndex;

  return (
    <div className={cn('rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-3', className)}>
      <div className="grid gap-2 md:grid-cols-4 2xl:grid-cols-1">
        {steps.map((item, index) => {
          const active = currentIndex === index;
          const complete = reachedIndex > index && !active;
          const canNavigate = index <= reachedIndex && Boolean(onNavigate);

          return (
            <button
              type="button"
              key={item.key}
              disabled={!canNavigate || active}
              onClick={() => canNavigate && !active && onNavigate?.(item.key, index)}
              className={cn(
                'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                active
                  ? 'border-brand/30 bg-brand/10 text-brand'
                  : complete
                    ? 'border-success/30 bg-success/10 text-success hover:bg-success/15 cursor-pointer'
                    : 'border-[rgb(var(--border-line))] bg-surface-1 text-text-tertiary cursor-default',
              )}
            >
              <div className="flex items-center gap-2 text-caption font-emphasis">
                {complete ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <span className={cn(
                    'inline-flex h-5 w-5 items-center justify-center rounded-full text-tiny font-strong',
                    active ? 'bg-brand text-white' : 'bg-surface-2 text-text-quaternary',
                  )}>
                    {index + 1}
                  </span>
                )}
                <span>{item.label}</span>
              </div>
              {item.caption && (
                <p className={cn(
                  'mt-1 text-tiny',
                  active ? 'text-brand' : complete ? 'text-success' : 'text-text-quaternary',
                )}>
                  {item.caption}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
