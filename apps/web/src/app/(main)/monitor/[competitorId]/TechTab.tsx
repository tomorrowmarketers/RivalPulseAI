'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertCircle, CheckCircle2, ChevronDown, Circle, Clock,
  History, Loader2, Play, StopCircle, X,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Competitor, CrawlJob, Source, TechSubTab,
  formatDateTime, formatDuration, formatRelative, formatTime,
  logLevelClass, sourceTypeLabel,
} from './_shared';

interface Props {
  competitor: Competitor;
  sources: Source[];
  isAdmin: boolean;
  initialSubTab?: TechSubTab;
  onSubTabChange?: (sub: TechSubTab) => void;
}

export function TechTab({ competitor, sources, isAdmin, initialSubTab = 'pipeline', onSubTabChange }: Props) {
  const [subTab, setSubTab] = useState<TechSubTab>(initialSubTab);
  const [jobs, setJobs] = useState<CrawlJob[]>([]);
  const [loading, setLoading] = useState(true);
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

  function switchSub(sub: TechSubTab) {
    setSubTab(sub);
    onSubTabChange?.(sub);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-tab nav */}
      <div className="flex gap-1 rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 p-1 self-start">
        {(['pipeline', 'logs'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => switchSub(s)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-emphasis transition-colors',
              subTab === s
                ? 'bg-surface-3 text-text-primary'
                : 'text-text-tertiary hover:text-text-primary',
            )}
          >
            {s === 'pipeline' ? <Activity className="h-3.5 w-3.5" /> : <History className="h-3.5 w-3.5" />}
            {s === 'pipeline' ? 'Lịch crawl' : 'Logs kỹ thuật'}
          </button>
        ))}
      </div>

      {subTab === 'pipeline' && (
        <PipelineSubTab
          competitor={competitor}
          sources={compSources}
          jobs={jobs}
          isAdmin={isAdmin}
          onJobsChanged={loadJobs}
        />
      )}
      {subTab === 'logs' && (
        <LogsSubTab jobs={jobs} loading={loading} />
      )}
    </div>
  );
}

function JobStatusBadge({ status }: { status: CrawlJob['status'] }) {
  const base = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-tiny font-emphasis whitespace-nowrap';
  if (status === 'queued') return (
    <span className={cn(base, 'bg-surface-2 border-[rgb(var(--border-line))] text-text-tertiary')}>
      <Circle className="h-2 w-2" /> Đang chờ
    </span>
  );
  if (status === 'running') return (
    <span className={cn(base, 'bg-brand/10 border-brand/20 text-brand')}>
      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Đang chạy
    </span>
  );
  if (status === 'succeeded') return (
    <span className={cn(base, 'bg-success/10 border-success/20 text-success')}>
      <CheckCircle2 className="h-2.5 w-2.5" /> Thành công
    </span>
  );
  if (status === 'failed') return (
    <span className={cn(base, 'bg-danger/10 border-danger/20 text-danger')}>
      <AlertCircle className="h-2.5 w-2.5" /> Lỗi
    </span>
  );
  return (
    <span className={cn(base, 'bg-surface-2 border-[rgb(var(--border-line))] text-text-quaternary')}>
      <X className="h-2 w-2" /> Đã hủy
    </span>
  );
}

function PipelineSubTab({
  competitor: _competitor, sources, jobs, isAdmin, onJobsChanged,
}: {
  competitor: Competitor;
  sources: Source[];
  jobs: CrawlJob[];
  isAdmin: boolean;
  onJobsChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const latestJobBySource = useMemo(() => {
    const m = new Map<string, CrawlJob>();
    for (const j of jobs) if (!m.has(j.source_id)) m.set(j.source_id, j);
    return m;
  }, [jobs]);

  async function handleRun(sourceId: string) {
    setBusy((b) => ({ ...b, [sourceId]: true }));
    try { await api.enqueueCrawlJob(sourceId); await onJobsChanged(); }
    finally { setBusy((b) => ({ ...b, [sourceId]: false })); }
  }

  async function handleCancel(jobId: string, sourceId: string) {
    setBusy((b) => ({ ...b, [sourceId]: true }));
    try { await api.cancelCrawlJob(jobId); await onJobsChanged(); }
    finally { setBusy((b) => ({ ...b, [sourceId]: false })); }
  }

  if (sources.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={Activity}
          title="Chưa có URL nào đang theo dõi"
          description="Thêm seed URL và duyệt link để bắt đầu crawl."
        />
      </Panel>
    );
  }

  const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'running');

  return (
    <Panel
      title="Pipeline crawl"
      description="Mỗi dòng là một URL theo dõi định kỳ. Bạn có thể chạy lại hoặc dừng job thủ công."
      actions={hasActive ? <Badge tone="brand" leadingIcon={<Loader2 className="animate-spin" />}>Đang xử lý</Badge> : <Badge tone="neutral">Sẵn sàng</Badge>}
      bodyClassName="p-0"
    >
      {hasActive && (
        <div className="flex items-center gap-2 px-5 py-2 bg-brand/5 border-b border-brand/10">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-brand flex-shrink-0" />
          <span className="text-caption font-emphasis text-brand">Đang chạy</span>
          <span className="text-caption text-text-tertiary">— làm mới mỗi 3 giây</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[rgb(var(--border-line))] bg-surface-2/50">
              <th className="px-5 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary w-[40%]">URL</th>
              <th className="px-3 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Loại</th>
              <th className="px-3 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Chu kỳ</th>
              <th className="px-3 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Lần cuối</th>
              <th className="px-3 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Trạng thái</th>
              <th className="px-3 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary text-right">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border-line))]">
            {sources.map((src) => {
              const latestJob = latestJobBySource.get(src.id) ?? null;
              const isActive = latestJob?.status === 'running' || latestJob?.status === 'queued';
              const isBusy = busy[src.id];
              return (
                <tr key={src.id} className="hover:bg-surface-2/40 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-start gap-2 min-w-0">
                      <div className={cn('mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0', src.is_active ? 'bg-success' : 'bg-text-quaternary')} />
                      <div className="min-w-0">
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-caption text-text-primary hover:text-brand truncate block max-w-xs"
                        >
                          {src.url}
                        </a>
                        {latestJob?.error_message && latestJob.status === 'failed' && (
                          <p className="text-tiny text-danger truncate mt-0.5 max-w-xs" title={latestJob.error_message}>
                            {latestJob.error_message}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3"><span className="text-caption text-text-tertiary">{sourceTypeLabel(src.source_type)}</span></td>
                  <td className="px-3 py-3"><span className="text-caption text-text-quaternary tabular-nums">{src.crawl_frequency_hours}h</span></td>
                  <td className="px-3 py-3">
                    {src.last_crawled_at
                      ? <span className="text-caption text-text-tertiary" title={src.last_crawled_at}>{formatRelative(src.last_crawled_at)}</span>
                      : <span className="text-caption text-text-quaternary">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    {latestJob ? (
                      <div className="flex flex-col items-start gap-1">
                        <JobStatusBadge status={latestJob.status} />
                        {latestJob.status === 'succeeded' && latestJob.duration_seconds != null && (
                          <span className="text-tiny text-text-quaternary">{formatDuration(latestJob.duration_seconds)}</span>
                        )}
                        {latestJob.status === 'succeeded' && (latestJob.changes_found ?? 0) > 0 && (
                          <span className="text-tiny font-emphasis text-warning">{latestJob.changes_found} thay đổi</span>
                        )}
                      </div>
                    ) : <span className="text-caption text-text-quaternary">Chưa chạy</span>}
                  </td>
                  <td className="px-3 py-3 text-right">
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function LogsSubTab({ jobs, loading }: { jobs: CrawlJob[]; loading: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  if (jobs.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={History}
          title="Chưa có lần chạy nào"
          description="Sang tab Lịch crawl và nhấn Chạy để bắt đầu."
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="Logs kỹ thuật"
      description="Chỉ dùng khi cần debug. Nếu quan tâm đối thủ thay đổi gì, vào tab Tín hiệu."
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[rgb(var(--border-line))] bg-surface-2/50">
              <th className="px-5 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Thời gian</th>
              <th className="px-3 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">URL nguồn</th>
              <th className="px-3 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Kích hoạt</th>
              <th className="px-3 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Trạng thái</th>
              <th className="px-3 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Thời lượng</th>
              <th className="px-3 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Thay đổi</th>
              <th className="px-3 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary text-right">Logs</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const isExpanded = expanded.has(job.id);
              const isActive = job.status === 'queued' || job.status === 'running';
              return (
                <Fragment key={job.id}>
                  <tr className={cn('border-b border-[rgb(var(--border-line))] hover:bg-surface-2/40 transition-colors', isActive && 'bg-brand/5')}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        {isActive && <Loader2 className="h-3 w-3 animate-spin text-brand flex-shrink-0" />}
                        <span className="text-caption text-text-tertiary tabular-nums">{formatDateTime(job.created_at)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {job.source_url
                        ? <a href={job.source_url} target="_blank" rel="noopener noreferrer" className="text-caption text-text-primary hover:text-brand truncate block max-w-[220px]" title={job.source_url}>{job.source_url}</a>
                        : <span className="text-caption text-text-quaternary">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={job.trigger_type === 'manual' ? 'brand' : 'neutral'}>
                        {job.trigger_type === 'manual' ? 'Thủ công' : 'Tự động'}
                      </Badge>
                    </td>
                    <td className="px-3 py-3"><JobStatusBadge status={job.status} /></td>
                    <td className="px-3 py-3">
                      {job.duration_seconds != null
                        ? <span className="inline-flex items-center gap-1 text-caption text-text-tertiary tabular-nums"><Clock className="h-3 w-3" />{formatDuration(job.duration_seconds)}</span>
                        : <span className="text-caption text-text-quaternary">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      {(job.changes_found ?? 0) > 0
                        ? <span className="text-caption font-emphasis text-warning tabular-nums">{job.changes_found}</span>
                        : <span className="text-caption text-text-quaternary tabular-nums">{job.status === 'succeeded' ? '0' : '—'}</span>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {(job.log_lines?.length > 0 || job.status === 'failed') && (
                        <button
                          onClick={() => toggleExpand(job.id)}
                          className="inline-flex items-center gap-1 text-caption font-emphasis text-text-tertiary hover:text-brand transition-colors"
                        >
                          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')} />
                          {job.log_lines?.length ?? 0} dòng
                        </button>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-b border-[rgb(var(--border-line))]">
                      <td colSpan={7} className="px-5 pb-4 pt-0">
                        <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2/50 p-3 font-mono overflow-x-auto">
                          {job.log_lines?.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {job.log_lines.map((line, i) => (
                                <div key={i} className="flex items-start gap-3 text-caption leading-5">
                                  <span className="flex-shrink-0 text-text-quaternary tabular-nums w-[80px]">{formatTime(line.ts)}</span>
                                  <span className={cn('font-emphasis w-[60px] flex-shrink-0', logLevelClass(line.level))}>[{line.level.toUpperCase()}]</span>
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
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
