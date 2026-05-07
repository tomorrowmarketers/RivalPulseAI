'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Loader2, Rss } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { KpiCard } from '@/components/ui/KpiCard';
import { Panel } from '@/components/ui/Panel';
import { api } from '@/lib/api';
import {
  CrawlJob, Competitor, EventItem, Seed, Source,
  formatDateTime, formatRelative, sourceTypeLabel,
} from './_shared';

interface Props {
  competitor: Competitor;
  seeds: Seed[];
  sources: Source[];
  onOpenTab: (tab: 'overview' | 'sources' | 'signals' | 'tech') => void;
}

export function OverviewTab({ competitor, seeds, sources, onOpenTab }: Props) {
  const [jobs, setJobs] = useState<CrawlJob[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const compSeeds = useMemo(() => seeds.filter((s) => s.competitor_id === competitor.id), [seeds, competitor.id]);
  const compSources = useMemo(() => sources.filter((s) => s.competitor_id === competitor.id), [sources, competitor.id]);
  const activeSources = useMemo(() => compSources.filter((s) => s.is_active), [compSources]);
  const pendingLinks = useMemo(() => compSeeds.reduce((sum, s) => sum + s.pending_count, 0), [compSeeds]);
  const sourceTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of compSources) counts.set(s.source_type, (counts.get(s.source_type) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [compSources]);

  const pendingEvents = useMemo(() => events.filter((e) => e.review_status === 'pending').length, [events]);
  const reportWorthyEvents = useMemo(() => events.filter((e) => e.is_report_worthy).length, [events]);
  const highUrgencyEvents = useMemo(() => events.filter((e) => e.urgency === 'high').length, [events]);
  const activeJobs = useMemo(() => jobs.filter((j) => j.status === 'queued' || j.status === 'running').length, [jobs]);
  const latestJob = jobs[0] ?? null;

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

  const actions: Array<{
    tab: 'sources' | 'signals' | 'tech';
    title: string;
    description: string;
    badge: React.ReactNode;
  }> = [
    {
      tab: 'sources',
      title: 'Quản lý nguồn crawl',
      description: activeSources.length
        ? `${activeSources.length} URL đang theo dõi · ${pendingLinks} URL mới chờ duyệt.`
        : 'Chưa có URL nào đang crawl. Bắt đầu từ seed và duyệt link.',
      badge: pendingLinks > 0
        ? <Badge tone="warning">{pendingLinks} chờ duyệt</Badge>
        : <Badge tone="success">Ổn định</Badge>,
    },
    {
      tab: 'signals',
      title: 'Duyệt tín hiệu AI',
      description: pendingEvents > 0
        ? `${pendingEvents} tín hiệu đang chờ duyệt trước khi đưa vào báo cáo.`
        : 'Không có tín hiệu chờ duyệt.',
      badge: pendingEvents > 0
        ? <Badge tone="warning">Cần xử lý</Badge>
        : <Badge tone="success">Đã sạch</Badge>,
    },
    {
      tab: 'tech',
      title: 'Lịch crawl & logs',
      description: latestJob?.status === 'failed'
        ? 'Crawl gần nhất bị lỗi. Vào tab Kỹ thuật xem nguyên nhân.'
        : activeJobs > 0
          ? `${activeJobs} job đang chạy hoặc chờ xử lý.`
          : latestJob
            ? `Chạy gần nhất ${formatRelative(latestJob.created_at)}.`
            : 'Chưa có lịch sử crawl.',
      badge: latestJob?.status === 'failed'
        ? <Badge tone="danger">Cần debug</Badge>
        : activeJobs > 0
          ? <Badge tone="brand">Đang chạy</Badge>
          : <Badge tone="neutral">Sẵn sàng</Badge>,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <div className="rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-caption text-danger">
          {error}
        </div>
      )}

      {/* KPI row */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Nguồn đang crawl" value={`${activeSources.length}/${compSources.length || 0}`} />
        <KpiCard label="Seed đang quản lý" value={compSeeds.length} tone="muted" />
        <KpiCard label="URL mới chờ duyệt" value={pendingLinks} tone={pendingLinks > 0 ? 'warning' : 'default'} />
        <KpiCard label="Tín hiệu cho báo cáo" value={reportWorthyEvents} tone="accent" />
      </div>

      {/* Quick actions + source coverage */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Panel
          title="Việc nên làm tiếp theo"
          description="Chọn đúng tab theo mục tiêu, không cần đọc hết bảng dữ liệu."
        >
          <div className="grid gap-2">
            {actions.map((item) => (
              <button
                key={item.tab}
                type="button"
                onClick={() => onOpenTab(item.tab)}
                className="flex items-start justify-between gap-3 rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 p-3 text-left transition-colors hover:border-brand/30 hover:bg-brand/5"
              >
                <div className="min-w-0">
                  <p className="text-small font-emphasis text-text-primary">{item.title}</p>
                  <p className="mt-1 text-caption text-text-tertiary">{item.description}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {item.badge}
                  <ChevronRight className="h-4 w-4 text-text-quaternary" />
                </div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel
          title="Độ phủ nguồn"
          description="Dữ liệu hiện đến từ những loại trang nào."
        >
          <div className="flex flex-col gap-2">
            {sourceTypeCounts.length > 0 ? (
              sourceTypeCounts.map(([type, count]) => (
                <div
                  key={type}
                  className="flex items-center justify-between rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 px-3 py-2"
                >
                  <span className="text-caption text-text-primary">{sourceTypeLabel(type)}</span>
                  <span className="text-caption font-emphasis text-text-secondary tabular-nums">{count}</span>
                </div>
              ))
            ) : (
              <p className="text-caption text-text-tertiary px-1">Chưa có nguồn crawl nào được duyệt.</p>
            )}
          </div>

          <div className="mt-3 grid gap-2">
            <div className="rounded-lg bg-surface-2/60 px-3 py-2">
              <p className="text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Trạng thái</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge tone={activeSources.length > 0 ? 'success' : 'warning'}>
                  {activeSources.length > 0 ? 'Đã có nguồn crawl' : 'Chưa có nguồn'}
                </Badge>
                <Badge tone={highUrgencyEvents > 0 ? 'danger' : 'neutral'}>
                  {highUrgencyEvents > 0 ? `${highUrgencyEvents} ưu tiên cao` : 'Không có ưu tiên cao'}
                </Badge>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* Recent signals */}
      <Panel
        title="Tín hiệu gần đây"
        description="AI tóm tắt các thay đổi vừa phát hiện. Vào tab Tín hiệu để duyệt chi tiết."
        actions={
          <Button variant="secondary" size="sm" onClick={() => onOpenTab('signals')}>
            Xem tất cả
          </Button>
        }
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-text-quaternary" />
          </div>
        ) : events.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {events.slice(0, 4).map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => onOpenTab('signals')}
                className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 p-4 text-left transition-colors hover:border-brand/30 hover:bg-brand/5"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="text-small font-emphasis text-text-primary truncate">{event.title}</p>
                    <p className="mt-0.5 text-tiny text-text-quaternary">
                      {event.event_type} · {event.detected_at ? formatDateTime(event.detected_at) : '—'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge tone={event.review_status === 'pending' ? 'warning' : 'success'}>
                      {event.review_status}
                    </Badge>
                    <Badge tone={event.urgency === 'high' ? 'danger' : event.urgency === 'medium' ? 'warning' : 'neutral'}>
                      {event.urgency}
                    </Badge>
                  </div>
                </div>
                <p className="text-caption text-text-secondary line-clamp-3 leading-relaxed">{event.summary}</p>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Rss}
            title="Chưa có tín hiệu"
            description="Sau khi crawl phát hiện thay đổi, AI sẽ tóm tắt ở đây."
          />
        )}
      </Panel>
    </div>
  );
}
