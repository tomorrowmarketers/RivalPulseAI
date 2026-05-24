import type { LucideIcon } from 'lucide-react';

interface StatItem {
  label: string;
  value: React.ReactNode;
  helper?: string;
}

interface ModuleOverviewProps {
  icon?: LucideIcon;
  kicker?: string;
  title: string;
  description: string;
  badges?: string[];
  stats?: StatItem[];
}

export function ModuleOverview({ icon: Icon, kicker, title, description, badges = [], stats = [] }: ModuleOverviewProps) {
  const statsGridClassName =
    stats.length <= 1
      ? 'grid-cols-1'
      : stats.length === 2
        ? 'grid-cols-1 sm:grid-cols-2'
        : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3';

  return (
    <section className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1.85fr)]">
      <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4">
        <div className="flex items-start gap-3">
          {Icon && (
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Icon className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0">
            {kicker && (
              <p className="mb-1 text-label font-strong uppercase tracking-[0.06em] text-text-quaternary">
                {kicker}
              </p>
            )}
            <h2 className="text-small font-emphasis text-text-primary">{title}</h2>
            <p className="mt-1 text-caption leading-relaxed text-text-secondary">{description}</p>
            {badges.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {badges.map((badge) => (
                  <span
                    key={badge}
                    className="inline-flex items-center rounded-full border border-brand/15 bg-brand/5 px-2 py-0.5 text-label font-emphasis text-brand"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {stats.length > 0 && (
        <div className={`grid gap-3 ${statsGridClassName}`}>
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4">
              <p className="text-label font-strong uppercase tracking-[0.06em] text-text-quaternary">{stat.label}</p>
              <div className="mt-1.5 text-h3 font-emphasis text-text-primary">{stat.value}</div>
              {stat.helper && <p className="mt-1 text-caption text-text-tertiary">{stat.helper}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
