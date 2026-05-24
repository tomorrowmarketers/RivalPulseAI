'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertCircle, CheckCircle2, ChevronRight, Clock,
  History, Loader2, Play, StopCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Competitor, CrawlJob, Source, TechSubTab,
  formatDateTime, formatDuration, formatRelative, formatTime,
  logLevelClass,
} from './_shared';

interface Props {
  competitor: Competitor;
  sources: Source[];
  isAdmin: boolean;
  initialSubTab?: TechSubTab;
  onSubTabChange?: (sub: TechSubTab) => void;
}

export function TechTab({ competitor, sources, isAdmin }: Props) {
  const [jobs, setJobs] = useState<CrawlJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const compSources = useMemo(
    () => sources.filter((s) => s.competitor_id === competitor.id && s.is_active),
    [sources, competitor.id],
  );

  const loadJobs = useCallback(async () => {
    try {
      const res = await api.getCrawlJobs({ competitor_id: competitor.id, limit: 50 }) as { items: CrawlJob[] };
      setJobs(res.items);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [competitor.id]);

  useEffect(() => { setLoading(true); void loadJobs(); }, [loadJobs]);

  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    if (hasActive) {
      pollRef.current = setInterval(loadJobs, 3000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current); pollRef.current = null;
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobs, loadJobs]);

  const latestJobBySource = useMemo(() => {
    const m = new Map<string, CrawlJob>();
    for (const j of jobs) if (!m.has(j.source_id)) m.set(j.source_id, j);
    return m;
  }, [jobs]);

  async function handleRun(sourceId: string) {
    setBusy((b) => ({ ...b, [sourceId]: true }));
    try { await api.enqueueCrawlJob(sourceId); await loadJobs(); }
    finally { setBusy((b) => ({ ...b, [sourceId]: false })); }
  }

  async function handleCancel(jobId: string, sourceId: string) {
    setBusy((b) => ({ ...b, [sourceId]: true }));
    try { await api.cancelCrawlJob(jobId); await loadJobs(); }
    finally { setBusy((b) => ({ ...b, [sourceId]: false })); }
  }

  function toggleLog(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  const recentJobs = jobs.slice(0, 30);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-text-quaternary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ─── Sources block ──────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-caption font-emphasis uppercase tracking-[0.06em] text-text-secondary">
            Nguồn đang theo dõi
          </h3>
          {hasActive && (
            <span className="inline-flex items-center gap-1.5 text-caption text-brand">
              <Loader2 className="h-3 w-3 animate-spin" />
              Đang xử lý — làm mới mỗi 3 giây
            </span>
          )}
        </div>

        {compSources.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="Chưa có URL nào đang theo dõi"
            description="Thêm seed URL và duyệt link để bắt đầu crawl."
          />
        ) : (
          <ul className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 divide-y divide-[rgb(var(--border-line))] overflow-hidden">
            {compSources.map((src) => {
              const latestJob = latestJobBySource.get(src.id) ?? null;
              const isActive = latestJob?.status === 'running' || latestJob?.status === 'queued';
              const isBusy = busy[src.id];
              const status = latestJob?.status ?? null;
              const dotClass =
                status === 'failed' ? 'bg-danger' :
                status === 'running' || status === 'queued' ? 'bg-brand animate-pulse' :
                status === 'succeeded' ? 'bg-success' :
                'bg-text-quaternary';

              return (
                <li key={src.id} className="flex items-center gap-3 px-3 py-2 hover:bg-surface-2/40 transition-colors">
                  <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', dotClass)} />
                  <div className="min-w-0 flex-1">
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-caption text-text-primary hover:text-brand truncate block"
                    >
                      {src.url}
                    </a>
                    <div className="flex flex-wrap items-center gap-x-2 text-caption text-text-quaternary">
                      <span>{src.crawl_frequency_hours}h</span>
                      <span>·</span>
                      <span title={src.last_crawled_at ?? undefined}>
                        {src.last_crawled_at ? formatRelative(src.last_crawled_at) : 'Chưa crawl'}
                      </span>
                      {latestJob?.status === 'failed' && latestJob.error_message && (
                        <>
                          <span>·</span>
                          <span className="text-danger truncate" title={latestJob.error_message}>
                            {latestJob.error_message}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {isAdmin && (isActive ? (
                    <Button
                      variant="danger"
                      size="xs"
                      leadingIcon={<StopCircle className="h-3 w-3" />}
                      onClick={() => handleCancel(latestJob!.id, src.id)}
                      loading={isBusy}
                    >
                      Hủy
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="xs"
                      leadingIcon={<Play className="h-3 w-3" />}
                      onClick={() => handleRun(src.id)}
                      loading={isBusy}
                    >
                      Chạy
                    </Button>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ─── Activity block ─────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-caption font-emphasis uppercase tracking-[0.06em] text-text-secondary">
            Hoạt động gần đây
          </h3>
          {recentJobs.length > 0 && (
            <span className="text-caption text-text-quaternary tabular-nums">
              {recentJobs.length} lần crawl
            </span>
          )}
        </div>

        {recentJobs.length === 0 ? (
          <EmptyState
            icon={History}
            title="Chưa có lần chạy nào"
            description="Nhấn Chạy ở danh sách nguồn phía trên để bắt đầu."
          />
        ) : (
          <ul className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 divide-y divide-[rgb(var(--border-line))] overflow-hidden">
            {recentJobs.map((job) => {
              const isExpanded = expanded.has(job.id);
              const isActive = job.status === 'queued' || job.status === 'running';
              const hasLogs = (job.log_lines?.length ?? 0) > 0 || job.status === 'failed';
              const StatusIcon =
                job.status === 'failed' ? AlertCircle :
                job.status === 'succeeded' ? CheckCircle2 :
                isActive ? Loader2 : Clock;
              const statusColor =
                job.status === 'failed' ? 'text-danger' :
                job.status === 'succeeded' ? 'text-success' :
                isActive ? 'text-brand' : 'text-text-quaternary';

              return (
                <Fragment key={job.id}>
                  <li
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 transition-colors',
                      hasLogs ? 'cursor-pointer hover:bg-surface-2/40' : '',
                      isActive && 'bg-brand/5',
                    )}
                    onClick={() => hasLogs && toggleLog(job.id)}
                  >
                    <StatusIcon
                      className={cn('h-3.5 w-3.5 flex-shrink-0', statusColor, isActive && 'animate-spin')}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-caption text-text-primary tabular-nums whitespace-nowrap">
                          {formatDateTime(job.created_at)}
                        </span>
                        {job.source_url && (
                          <span className="text-caption text-text-tertiary truncate" title={job.source_url}>
                            {job.source_url}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 text-caption text-text-quaternary">
                        <span>{job.trigger_type === 'manual' ? 'Thủ công' : 'Tự động'}</span>
                        {job.duration_seconds != null && (
                          <>
                            <span>·</span>
                            <span className="tabular-nums">{formatDuration(job.duration_seconds)}</span>
                          </>
                        )}
                        {(job.changes_found ?? 0) > 0 && (
                          <>
                            <span>·</span>
                            <span className="font-emphasis text-warning tabular-nums">
                              {job.changes_found} thay đổi
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    {hasLogs && (
                      <ChevronRight className={cn(
                        'h-3.5 w-3.5 text-text-quaternary flex-shrink-0 transition-transform',
                        isExpanded && 'rotate-90',
                      )} />
                    )}
                  </li>
                  {isExpanded && hasLogs && (
                    <li className="px-3 py-2 bg-surface-2/30">
                      <div className="rounded-md border border-[rgb(var(--border-line))] bg-surface-1 p-2 font-mono overflow-x-auto">
                        {job.log_lines?.length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            {job.log_lines.map((line, i) => (
                              <div key={i} className="flex items-start gap-3 text-caption leading-5">
                                <span className="flex-shrink-0 text-text-quaternary tabular-nums w-[64px]">
                                  {formatTime(line.ts)}
                                </span>
                                <span className={cn('w-[52px] flex-shrink-0', logLevelClass(line.level))}>
                                  {line.level.toUpperCase()}
                                </span>
                                <span className={logLevelClass(line.level)}>{line.msg}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-caption text-text-quaternary">
                            {job.status === 'failed' && job.error_message ? job.error_message : 'Không có log'}
                          </p>
                        )}
                      </div>
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
