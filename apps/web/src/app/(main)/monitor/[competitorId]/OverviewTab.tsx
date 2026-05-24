'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, ChevronDown, ChevronRight, ChevronUp,
  Globe, Loader2, Rss, Settings,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  CrawlJob, Competitor, EventItem, Seed, Source,
  EVENT_TYPE_LABELS, formatDateTime, formatRelative,
} from './_shared';

interface Props {
  competitor: Competitor;
  seeds: Seed[];
  sources: Source[];
  onOpenTab: (tab: 'overview' | 'sources' | 'signals' | 'tech') => void;
}

const URGENCY_TONE: Record<string, 'danger' | 'warning' | 'neutral'> = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
};

const URGENCY_DOT: Record<string, string> = {
  high: 'bg-danger',
  medium: 'bg-warning',
  low: 'bg-text-quaternary',
};

const URGENCY_LABEL: Record<string, string> = {
  high: 'Cần chú ý',
  medium: 'Theo dõi',
  low: 'Ít tác động',
};

function eventTime(ev: EventItem): string {
  return ev.captured_at ?? ev.detected_at ?? '';
}

/** Group events that came from the same crawl finding (same source URL + timestamp). */
type CrawlFinding = {
  key: string;
  source_url: string;
  captured_at: string;
  events: EventItem[];
  highest_urgency: 'high' | 'medium' | 'low';
};

function groupByCrawl(events: EventItem[]): CrawlFinding[] {
  const groups = new Map<string, CrawlFinding>();
  for (const ev of events) {
    const url = ev.source_url ?? 'unknown';
    const ts = eventTime(ev);
    // Bucket by URL + minute (events from same diff are written within the same flush)
    const minute = ts ? ts.slice(0, 16) : 'no-time';
    const key = `${url}__${minute}`;

    const existing = groups.get(key);
    if (existing) {
      existing.events.push(ev);
      if (
        ev.urgency === 'high' ||
        (ev.urgency === 'medium' && existing.highest_urgency === 'low')
      ) {
        existing.highest_urgency = ev.urgency;
      }
    } else {
      groups.set(key, {
        key,
        source_url: url,
        captured_at: ts,
        events: [ev],
        highest_urgency: ev.urgency,
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) =>
    b.captured_at.localeCompare(a.captured_at),
  );
}

/** Pretty "Trước → Sau" block. Pairs are best-effort by common prefix; rest are listed. */
function ComparisonBlock({
  added,
  removed,
}: {
  added: string[];
  removed: string[];
}) {
  const cleanAdded = added.filter((b) => b.trim());
  const cleanRemoved = removed.filter((b) => b.trim());

  if (!cleanAdded.length && !cleanRemoved.length) {
    return (
      <p className="text-caption text-text-tertiary px-1">Không có chi tiết kèm theo.</p>
    );
  }

  // Pair items by common prefix (e.g. course name) so we get clean Cũ→Mới rows.
  const usedRemoved = new Set<number>();
  const pairs: { before: string; after: string }[] = [];
  const onlyAdded: string[] = [];

  for (const a of cleanAdded) {
    const aPrefix = a.slice(0, 30).toLowerCase();
    let matchIdx = -1;
    for (let i = 0; i < cleanRemoved.length; i++) {
      if (usedRemoved.has(i)) continue;
      const r = cleanRemoved[i];
      const rPrefix = r.slice(0, 30).toLowerCase();
      if (
        aPrefix.slice(0, 18) === rPrefix.slice(0, 18) &&
        aPrefix.slice(0, 18).length >= 8
      ) {
        matchIdx = i;
        break;
      }
    }
    if (matchIdx >= 0) {
      usedRemoved.add(matchIdx);
      pairs.push({ before: cleanRemoved[matchIdx], after: a });
    } else {
      onlyAdded.push(a);
    }
  }
  const onlyRemoved = cleanRemoved.filter((_, i) => !usedRemoved.has(i));

  return (
    <div className="flex flex-col gap-3">
      {pairs.length > 0 && (
        <div>
          <p className="text-caption font-emphasis text-text-secondary mb-1.5">
            Đã thay đổi
          </p>
          <div className="flex flex-col gap-1.5">
            {pairs.map((p, i) => (
              <div
                key={`p-${i}`}
                className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 overflow-hidden"
              >
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] divide-y md:divide-y-0 md:divide-x divide-[rgb(var(--border-line))]">
                  <div className="px-3 py-2">
                    <p className="text-caption font-strong uppercase tracking-[0.08em] text-text-quaternary mb-0.5">
                      Cũ
                    </p>
                    <p className="text-caption text-text-tertiary line-through decoration-text-quaternary">
                      {p.before}
                    </p>
                  </div>
                  <div className="hidden md:flex items-center justify-center px-2">
                    <ArrowRight className="h-3.5 w-3.5 text-brand" />
                  </div>
                  <div className="px-3 py-2 bg-success/5">
                    <p className="text-caption font-strong uppercase tracking-[0.08em] text-success mb-0.5">
                      Mới
                    </p>
                    <p className="text-caption text-text-primary">{p.after}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {onlyAdded.length > 0 && (
        <div>
          <p className="text-caption font-emphasis text-success mb-1.5">
            Mới xuất hiện ({onlyAdded.length})
          </p>
          <ul className="flex flex-col gap-1">
            {onlyAdded.map((b, i) => (
              <li
                key={`a-${i}`}
                className="rounded-md border border-success/15 bg-success/5 px-3 py-1.5 text-caption text-text-primary"
              >
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {onlyRemoved.length > 0 && (
        <div>
          <p className="text-caption font-emphasis text-text-tertiary mb-1.5">
            Đã gỡ bỏ ({onlyRemoved.length})
          </p>
          <ul className="flex flex-col gap-1">
            {onlyRemoved.map((b, i) => (
              <li
                key={`r-${i}`}
                className="rounded-md border border-[rgb(var(--border-line))] bg-surface-1 px-3 py-1.5 text-caption text-text-tertiary line-through decoration-text-quaternary"
              >
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FindingCard({
  finding,
  competitorName,
  expanded,
  onToggle,
}: {
  finding: CrawlFinding;
  competitorName: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Sort signals within the finding: high → medium → low
  const sorted = useMemo(() => {
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return [...finding.events].sort(
      (a, b) => (order[a.urgency] ?? 3) - (order[b.urgency] ?? 3),
    );
  }, [finding.events]);

  // All sibling events share the same parent diff — use the first available
  const unifiedDiff = sorted.find((e) => e.diff)?.diff;
  const added = unifiedDiff?.added_blocks ?? [];
  const removed = unifiedDiff?.removed_blocks ?? [];

  const tone = URGENCY_TONE[finding.highest_urgency];
  const dot = URGENCY_DOT[finding.highest_urgency];

  return (
    <div
      className={cn(
        'rounded-xl border bg-surface-1 overflow-hidden shadow-linear-sm',
        finding.highest_urgency === 'high'
          ? 'border-danger/30'
          : 'border-[rgb(var(--border-line))]',
      )}
    >
      {/* Header */}
      <div className="px-4 py-3.5 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className={cn('inline-block h-2 w-2 rounded-full', dot)} />
            <Badge tone={tone}>{URGENCY_LABEL[finding.highest_urgency]}</Badge>
            <span className="text-caption font-emphasis text-text-primary">
              {sorted.length} tín hiệu mới từ {competitorName}
            </span>
          </div>
          <span className="text-caption text-text-quaternary tabular-nums flex-shrink-0">
            {finding.captured_at
              ? `${formatRelative(finding.captured_at)} · ${formatDateTime(finding.captured_at)}`
              : '—'}
          </span>
        </div>

        {finding.source_url && finding.source_url !== 'unknown' && (
          <a
            href={finding.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-brand transition-colors w-fit"
          >
            <Globe className="h-3 w-3" />
            <span className="truncate max-w-md">{finding.source_url}</span>
          </a>
        )}

        {/* Signal-type chips (the WHAT) */}
        <div className="flex flex-wrap gap-1 mt-1">
          {sorted.map((ev) => (
            <span
              key={ev.id}
              className={cn(
                'inline-flex items-center rounded-md px-1.5 py-px text-caption leading-tight',
                ev.urgency === 'high'
                  ? 'bg-danger/10 text-danger'
                  : ev.urgency === 'medium'
                    ? 'bg-warning/10 text-warning'
                    : 'bg-surface-2 text-text-secondary',
              )}
              title={ev.summary}
            >
              {EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}
            </span>
          ))}
        </div>

        {/* Highlight: most important signal title */}
        {sorted[0]?.title && (
          <p className="text-caption text-text-primary leading-relaxed mt-1">
            <span className="font-emphasis">Nổi bật:</span> {sorted[0].title}
          </p>
        )}
      </div>

      {/* Expand toggle */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-center gap-1.5 border-t border-[rgb(var(--border-line))] px-4 py-2 text-caption font-emphasis text-text-quaternary hover:text-text-secondary hover:bg-surface-2/40 transition-colors"
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {expanded ? 'Thu gọn' : 'So sánh chi tiết Cũ ↔ Mới'}
      </button>

      {/* Expanded comparison */}
      {expanded && (
        <div className="border-t border-[rgb(var(--border-line))] bg-surface-2/30 px-4 py-4">
          <ComparisonBlock added={added} removed={removed} />

          {/* Per-signal AI commentary */}
          {sorted.length > 1 && (
            <div className="mt-4 pt-4 border-t border-[rgb(var(--border-line))]">
              <p className="text-caption font-emphasis text-text-secondary mb-2">
                AI ghi chú từng tín hiệu
              </p>
              <div className="flex flex-col gap-2">
                {sorted.map((ev) => (
                  <div
                    key={`note-${ev.id}`}
                    className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge tone={URGENCY_TONE[ev.urgency]}>
                        {EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}
                      </Badge>
                    </div>
                    <p className="text-caption text-text-secondary leading-relaxed">
                      {ev.summary}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function OverviewTab({ competitor, seeds, sources, onOpenTab }: Props) {
  const [jobs, setJobs] = useState<CrawlJob[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const compSeeds = useMemo(() => seeds.filter((s) => s.competitor_id === competitor.id), [seeds, competitor.id]);
  const compSources = useMemo(() => sources.filter((s) => s.competitor_id === competitor.id), [sources, competitor.id]);
  const activeSources = useMemo(() => compSources.filter((s) => s.is_active), [compSources]);
  const pendingLinks = useMemo(() => compSeeds.reduce((sum, s) => sum + s.pending_count, 0), [compSeeds]);

  const findings = useMemo(() => groupByCrawl(events), [events]);
  const highCount = useMemo(
    () => findings.filter((f) => f.highest_urgency === 'high').length,
    [findings],
  );

  const latestJob = jobs[0] ?? null;
  const activeJobs = useMemo(
    () => jobs.filter((j) => j.status === 'queued' || j.status === 'running').length,
    [jobs],
  );

  // Auto-expand the most recent finding on load
  useEffect(() => {
    if (findings.length > 0 && expandedKey === null) {
      setExpandedKey(findings[0].key);
    }
  }, [findings, expandedKey]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      try {
        const [jobsRes, eventsRes] = await Promise.all([
          api.getCrawlJobs({ competitor_id: competitor.id, limit: 20 }) as Promise<{ items: CrawlJob[] }>,
          api.getCompetitorEvents(competitor.id) as Promise<{ items: EventItem[] }>,
        ]);
        if (ignore) return;
        setJobs(jobsRes.items);
        setEvents(eventsRes.items);
      } catch (err: unknown) {
        if (!ignore) setError(err instanceof Error ? err.message : 'Không tải được tổng quan');
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    void load();
    return () => { ignore = true; };
  }, [competitor.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-text-quaternary" />
      </div>
    );
  }

  const hasAlerts = pendingLinks > 0 || latestJob?.status === 'failed' || activeJobs > 0;

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <div className="rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-caption text-danger">
          {error}
        </div>
      )}

      {/* ── Slim stat bar (KPIs + alerts inline) ─────────── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-caption text-text-quaternary">Phát hiện</span>
          <span className="text-caption font-emphasis text-text-primary tabular-nums">{findings.length}</span>
        </div>
        <span className="h-3.5 w-px bg-[rgb(var(--border-line))]" />
        <div className="flex items-center gap-1.5">
          <span className="text-caption text-text-quaternary">Cần chú ý</span>
          <span className={cn(
            'text-caption font-emphasis tabular-nums inline-flex items-center gap-1',
            highCount > 0 ? 'text-danger' : 'text-text-primary',
          )}>
            {highCount > 0 && <AlertTriangle className="h-3 w-3" />}
            {highCount}
          </span>
        </div>
        <span className="h-3.5 w-px bg-[rgb(var(--border-line))]" />
        <div className="flex items-center gap-1.5">
          <span className="text-caption text-text-quaternary">Nguồn</span>
          <span className="text-caption font-emphasis text-text-primary tabular-nums">
            {activeSources.length}<span className="text-text-quaternary font-normal">/{compSources.length || 0}</span>
          </span>
        </div>
        <span className="h-3.5 w-px bg-[rgb(var(--border-line))]" />
        <div className="flex items-center gap-1.5">
          <span className="text-caption text-text-quaternary">Crawl gần nhất</span>
          <span className="text-caption font-emphasis text-text-primary">
            {latestJob?.created_at ? formatRelative(latestJob.created_at) : '—'}
          </span>
        </div>

        {hasAlerts && (
          <div className="flex flex-wrap items-center gap-1.5 ml-auto">
            {pendingLinks > 0 && (
              <button
                type="button"
                onClick={() => onOpenTab('sources')}
                className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-caption font-emphasis text-warning hover:bg-warning/20 transition-colors"
              >
                {pendingLinks} URL chờ duyệt
                <ChevronRight className="h-3 w-3" />
              </button>
            )}
            {latestJob?.status === 'failed' && (
              <button
                type="button"
                onClick={() => onOpenTab('tech')}
                className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2.5 py-0.5 text-caption font-emphasis text-danger hover:bg-danger/20 transition-colors"
              >
                <AlertTriangle className="h-3 w-3" />
                Crawl lỗi
              </button>
            )}
            {activeJobs > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 text-caption font-emphasis text-brand">
                <Loader2 className="h-3 w-3 animate-spin" />
                {activeJobs} đang chạy
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Findings list (newest first) ───────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-caption font-emphasis text-text-secondary uppercase tracking-[0.06em]">
          Tín hiệu gần đây
        </h2>
        {findings.length > 0 && (
          <span className="text-caption text-text-quaternary tabular-nums">{findings.length} lần phát hiện</span>
        )}
      </div>
      {findings.length === 0 ? (
        <EmptyState
          icon={Rss}
          title="Chưa có thay đổi nào được phát hiện"
          description="Sau khi crawl tìm thấy nội dung mới, AI sẽ tóm tắt thành các tín hiệu ở đây."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {findings.map((f) => (
            <FindingCard
              key={f.key}
              finding={f}
              competitorName={competitor.name}
              expanded={expandedKey === f.key}
              onToggle={() => setExpandedKey(expandedKey === f.key ? null : f.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
