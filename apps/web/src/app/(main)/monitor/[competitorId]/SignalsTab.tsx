'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Clock3, Loader2, Rss } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Competitor, EventItem, EVENT_TYPE_LABELS, formatDateTime, formatRelative } from './_shared';

interface Props {
  competitor: Competitor;
}

const URGENCY_META = {
  high:   { label: 'Cần chú ý ngay', tone: 'danger'  as const, dot: 'bg-danger' },
  medium: { label: 'Đáng theo dõi',   tone: 'warning' as const, dot: 'bg-warning' },
  low:    { label: 'Ít tác động',     tone: 'neutral'  as const, dot: 'bg-text-quaternary' },
};

function getArticleTime(event: EventItem): string | null {
  return event.captured_at ?? event.detected_at ?? null;
}

export function SignalsTab({ competitor }: Props) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    api.getCompetitorEvents(competitor.id, { review_status: '' })
      .then((res) => setEvents((res as { items: EventItem[] }).items))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [competitor.id]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-text-quaternary" />
      </div>
    );
  }

  if (error) {
    return <p className="text-caption text-danger px-1">{error}</p>;
  }

  if (events.length === 0) {
    return (
      <EmptyState
        icon={Rss}
        title="Chưa có thay đổi nào được phát hiện"
        description="Hệ thống sẽ thông báo khi crawl phát hiện nội dung mới trên trang của đối thủ."
      />
    );
  }

  // Group by urgency: high → medium → low
  const byUrgency: Record<string, EventItem[]> = { high: [], medium: [], low: [] };
  for (const ev of events) {
    const u = ev.urgency in byUrgency ? ev.urgency : 'low';
    byUrgency[u].push(ev);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Summary bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-caption font-strong text-text-primary tabular-nums">{events.length}</span>
        <span className="text-caption text-text-secondary">tín hiệu ghi nhận</span>
        <span className="text-caption text-text-quaternary">·</span>
        {(Object.entries(byUrgency) as [keyof typeof URGENCY_META, EventItem[]][]).map(([u, evs]) =>
          evs.length > 0 ? (
            <span key={u} className="flex items-center gap-1.5 text-caption text-text-tertiary">
              <span className={cn('inline-block h-1.5 w-1.5 rounded-full', URGENCY_META[u].dot)} />
              {evs.length} {URGENCY_META[u].label.toLowerCase()}
            </span>
          ) : null,
        )}
      </div>

      <p className="px-1 text-caption text-text-quaternary">
        Mốc thời gian của bài viết hiện ưu tiên thời điểm crawl ghi nhận. Khi nguồn chưa lộ ngày đăng gốc,
        hệ thống dùng mốc crawl như thời gian tạo để bạn vẫn theo dõi được thứ tự mới cũ.
      </p>

      {(Object.entries(byUrgency) as [keyof typeof URGENCY_META, EventItem[]][]).map(([urgency, evs]) => {
        if (!evs.length) return null;
        const meta = URGENCY_META[urgency];
        return (
          <div key={urgency} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-1">
              <span className={cn('inline-block h-2 w-2 rounded-full', meta.dot)} />
              <span className="text-caption font-emphasis text-text-secondary">{meta.label}</span>
              <span className="text-caption text-text-quaternary">{evs.length} thay đổi</span>
            </div>
            <div className="flex flex-col gap-2">
              {evs.map((ev) => {
                const isOpen = expanded.has(ev.id);
                const articleTime = getArticleTime(ev);
                const hasDiff =
                  (ev.diff?.added_blocks?.length ?? 0) + (ev.diff?.removed_blocks?.length ?? 0) > 0;
                return (
                  <div
                    key={ev.id}
                    className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 overflow-hidden shadow-linear-sm"
                  >
                    <div className="px-4 py-3.5 flex flex-col gap-2">
                      {/* Header row */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                          <span className="text-caption font-emphasis text-text-primary">
                            {EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}
                          </span>
                        </div>
                        <span className="text-caption text-text-quaternary tabular-nums flex-shrink-0">
                          {articleTime ? formatRelative(articleTime) : ''}
                        </span>
                      </div>

                      {/* Summary */}
                      {ev.summary && (
                        <p className="text-caption text-text-secondary leading-relaxed">{ev.summary}</p>
                      )}

                      {articleTime && (
                        <div className="flex items-center gap-1.5 text-caption text-text-tertiary">
                          <Clock3 className="h-3.5 w-3.5 text-text-quaternary" />
                          <span>Mốc bài viết {formatDateTime(articleTime)}</span>
                        </div>
                      )}

                      {/* Source URL */}
                      {(ev as unknown as { source_url?: string }).source_url && (
                        <p className="text-caption text-text-quaternary truncate">
                          {(ev as unknown as { source_url?: string }).source_url}
                        </p>
                      )}
                    </div>

                    {/* Expandable diff */}
                    {hasDiff && (
                      <>
                        <button
                          onClick={() => toggleExpand(ev.id)}
                          className="w-full flex items-center justify-center gap-1.5 border-t border-[rgb(var(--border-line))] px-4 py-2 text-caption font-emphasis text-text-quaternary hover:text-text-secondary hover:bg-surface-2/40 transition-colors"
                        >
                          {isOpen
                            ? <ChevronUp className="h-3 w-3" />
                            : <ChevronDown className="h-3 w-3" />}
                          {isOpen ? 'Ẩn chi tiết' : 'Xem nội dung thay đổi'}
                        </button>
                        {isOpen && (
                          <div className="border-t border-[rgb(var(--border-line))] bg-surface-2/30 px-4 py-3 flex flex-col gap-1.5">
                            {ev.diff?.added_blocks?.map((b, i) => (
                              <pre
                                key={`a-${i}`}
                                className="text-caption font-mono text-success bg-success/5 border border-success/15 rounded-md px-3 py-1.5 whitespace-pre-wrap"
                              >
                                + {b}
                              </pre>
                            ))}
                            {ev.diff?.removed_blocks?.map((b, i) => (
                              <pre
                                key={`r-${i}`}
                                className="text-caption font-mono text-danger bg-danger/5 border border-danger/15 rounded-md px-3 py-1.5 whitespace-pre-wrap"
                              >
                                − {b}
                              </pre>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
