'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Mail,
  RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { KpiCard } from '@/components/ui/KpiCard';
import { Panel } from '@/components/ui/Panel';
import { cn } from '@/lib/utils';

type ReportKeyChange = {
  competitor?: string;
  title?: string;
  event_type?: string;
  urgency?: 'high' | 'medium' | 'low' | string;
  url?: string;
};

type ReportEvent = {
  id: string;
  competitor_name?: string | null;
  event_type: string;
  title: string;
  summary: string;
  evidence_excerpt?: string | null;
  source_url: string;
  urgency: 'high' | 'medium' | 'low' | string;
  review_status: string;
  is_report_worthy: boolean;
  detected_at?: string;
};

type RunDetail = {
  id: string;
  title: string;
  period_start: string;
  period_end: string;
  status: string;
  report_type?: string | null;
  executive_summary?: string | null;
  key_changes_json?: ReportKeyChange[] | null;
  cross_market_patterns?: string | null;
  recommended_actions?: string | null;
  html_download_url?: string | null;
  pdf_download_url?: string | null;
  generated_at?: string | null;
  published_at?: string | null;
  definition_id?: string | null;
  events: ReportEvent[];
};

const URGENCY_VI: Record<string, string> = {
  high: 'Cao',
  medium: 'Vừa',
  low: 'Thấp',
};
const REVIEW_STATUS_VI: Record<string, string> = {
  approved: 'Đã duyệt',
  pending: 'Chờ duyệt',
  dismissed: 'Bỏ qua',
  auto_approved: 'Tự duyệt',
};
const EVENT_TYPE_VI: Record<string, string> = {
  product_launch: 'Ra mắt SP',
  product_update: 'Cập nhật SP',
  pricing_change: 'Thay đổi giá',
  promotion_launch: 'Ra mắt KM',
  promotion_update: 'Cập nhật KM',
  positioning_change: 'Định vị',
  content_campaign: 'Chiến dịch ND',
  schedule_change: 'Lịch học',
  partnership_update: 'Đối tác',
  hiring_signal: 'Tuyển dụng',
  testimonial_or_social_proof: 'Social proof',
  enterprise_offer_change: 'Gói DN',
  other: 'Khác',
};
const STATUS_VI: Record<string, string> = {
  draft: 'Nháp',
  published: 'Đã phát hành',
  archived: 'Lưu trữ',
};

function fmt(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDt(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
function urgencyTone(urgency: string) {
  if (urgency === 'high') return 'danger' as const;
  if (urgency === 'medium') return 'warning' as const;
  return 'neutral' as const;
}
function statusTone(s: string) {
  if (s === 'published') return 'success' as const;
  if (s === 'draft') return 'neutral' as const;
  return 'warning' as const;
}

type RunTab = 'content' | 'events';

export default function ReportRunPage() {
  const params = useParams<{ reportId: string; runId: string }>();
  const router = useRouter();
  const defId = Array.isArray(params.reportId) ? params.reportId[0] : params.reportId;
  const runId = Array.isArray(params.runId) ? params.runId[0] : params.runId;

  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState<'publish' | 'email' | ''>('');
  const [tab, setTab] = useState<RunTab>('content');

  const loadRun = useCallback(async () => {
    if (!defId || !runId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.getReportRun(defId, runId);
      setRun((res as { item: RunDetail }).item);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không tải được báo cáo');
    } finally {
      setLoading(false);
    }
  }, [defId, runId]);

  useEffect(() => {
    void loadRun();
  }, [loadRun]);

  const events = run?.events ?? [];
  const competitorCount = useMemo(
    () => new Set(events.map((e) => e.competitor_name).filter(Boolean)).size,
    [events],
  );
  const reportWorthyCount = useMemo(
    () => events.filter((e) => e.is_report_worthy).length,
    [events],
  );
  const competitorCoverage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const evt of events) {
      const key = evt.competitor_name ?? 'Unknown';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [events]);

  async function handlePublish() {
    if (!defId || !runId) return;
    setBusyAction('publish');
    setError('');
    try {
      await api.publishReportRun(defId, runId);
      await loadRun();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không publish được');
    } finally {
      setBusyAction('');
    }
  }

  async function handleSendEmail() {
    if (!defId || !runId) return;
    setBusyAction('email');
    setError('');
    try {
      await api.sendReportRunEmail(defId, runId);
      await loadRun();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không gửi được email');
    } finally {
      setBusyAction('');
    }
  }

  if (loading) {
    return (
      <div className='flex min-h-[60vh] items-center justify-center'>
        <div className='flex flex-col items-center gap-3'>
          <RefreshCw className='h-6 w-6 animate-spin text-text-quaternary' />
          <p className='text-caption text-text-tertiary'>Đang tải báo cáo...</p>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className='flex min-h-[60vh] items-center justify-center px-6'>
        <div className='flex max-w-md flex-col items-center gap-4 text-center'>
          <FileText className='h-10 w-10 text-text-quaternary' />
          <div>
            <p className='text-body font-emphasis text-text-primary'>Không tìm thấy lần chạy</p>
            <p className='mt-1 text-caption text-text-tertiary'>{error}</p>
          </div>
          <Button variant='secondary' size='sm' onClick={() => router.push('/reports/' + defId)}>
            Quay lại báo cáo
          </Button>
        </div>
      </div>
    );
  }

  const keyChanges = run.key_changes_json ?? [];

  return (
    <div className='flex flex-col gap-6 px-6 py-6'>
      {/* Breadcrumb */}
      <div className='flex items-center gap-2 text-caption text-text-tertiary'>
        <button
          onClick={() => router.push('/reports')}
          className='inline-flex items-center gap-1.5 hover:text-text-primary transition-colors'
        >
          <ArrowLeft className='h-3.5 w-3.5' />
          Báo cáo
        </button>
        <ChevronRight className='h-3.5 w-3.5' />
        <button
          onClick={() => router.push('/reports/' + defId)}
          className='hover:text-text-primary transition-colors'
        >
          Tất cả lần chạy
        </button>
        <ChevronRight className='h-3.5 w-3.5' />
        <span className='text-text-primary font-emphasis truncate max-w-[280px]'>{run.title}</span>
      </div>

      {/* Header */}
      <div className='flex items-start justify-between gap-4 flex-wrap'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2 flex-wrap'>
            <h1 className='text-title font-emphasis text-text-primary'>{run.title}</h1>
            <Badge tone={statusTone(run.status)}>{STATUS_VI[run.status] ?? run.status}</Badge>
          </div>
          <p className='mt-1 text-caption text-text-tertiary'>
            <Clock className='mr-0.5 inline h-3.5 w-3.5' />
            {fmt(run.period_start)} {'->'} {fmt(run.period_end)}
            {run.generated_at && (
              <span className='ml-2 text-text-quaternary'>· Đã sinh lúc {fmtDt(run.generated_at)}</span>
            )}
          </p>
        </div>
        <div className='flex items-center gap-2 flex-shrink-0 flex-wrap'>
          {run.html_download_url && (
            <a href={run.html_download_url} target='_blank' rel='noopener noreferrer'>
              <Button variant='secondary' size='sm' leadingIcon={<Download className='h-3.5 w-3.5' />}>
                HTML
              </Button>
            </a>
          )}
          {run.pdf_download_url && (
            <a href={run.pdf_download_url} target='_blank' rel='noopener noreferrer'>
              <Button variant='secondary' size='sm' leadingIcon={<Download className='h-3.5 w-3.5' />}>
                PDF
              </Button>
            </a>
          )}
          {run.status !== 'published' && (
            <Button
              variant='secondary'
              size='sm'
              leadingIcon={<CheckCircle2 className='h-3.5 w-3.5' />}
              loading={busyAction === 'publish'}
              onClick={handlePublish}
            >
              Phát hành
            </Button>
          )}
          <Button
            variant='secondary'
            size='sm'
            leadingIcon={<Mail className='h-3.5 w-3.5' />}
            loading={busyAction === 'email'}
            onClick={handleSendEmail}
          >
            Gửi email
          </Button>
        </div>
      </div>

      {error && <div className='rounded-lg bg-danger/10 px-4 py-3 text-caption text-danger'>{error}</div>}

      {/* Tabs */}
      <div className='flex gap-0 border-b border-[rgb(var(--border-line))]'>
        {([
          { key: 'content' as const, label: 'Nội dung', icon: FileText },
          { key: 'events' as const, label: 'Sự kiện (' + events.length + ')', icon: Activity },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-caption transition-colors',
              tab === key
                ? 'border-brand text-brand font-emphasis'
                : 'border-transparent text-text-tertiary hover:text-text-secondary',
            )}
          >
            <Icon className='h-3.5 w-3.5' />
            {label}
          </button>
        ))}
      </div>

      {/* Content tab */}
      {tab === 'content' && (
        <div className='flex flex-col gap-6'>
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
            <KpiCard label='Sự kiện theo dõi' value={events.length} />
            <KpiCard label='Đáng báo cáo' value={reportWorthyCount} />
            <KpiCard label='Đối thủ' value={competitorCount} />
            <KpiCard
              label='Thay đổi lớn'
              value={keyChanges.filter((c) => c.urgency === 'high').length}
              tone='warning'
            />
          </div>

          {run.executive_summary && (
            <Panel title='Tóm tắt điều hành'>
              <p className='whitespace-pre-wrap text-caption text-text-secondary leading-relaxed'>
                {run.executive_summary}
              </p>
            </Panel>
          )}

          {keyChanges.length > 0 && (
            <Panel title={'Thay đổi chính (' + keyChanges.length + ')'}>
              <div className='flex flex-col divide-y divide-[rgb(var(--border-line))]'>
                {keyChanges.map((change, idx) => (
                  <div key={idx} className='flex items-start gap-3 py-3 first:pt-0 last:pb-0'>
                    <div
                      className={cn(
                        'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-strong',
                        change.urgency === 'high'
                          ? 'bg-danger/10 text-danger'
                          : change.urgency === 'medium'
                          ? 'bg-warning/10 text-warning'
                          : 'bg-surface-3 text-text-quaternary',
                      )}
                    >
                      {idx + 1}
                    </div>
                    <div className='min-w-0 flex-1'>
                      {change.competitor && (
                        <p className='mb-0.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary'>
                          {change.competitor}
                        </p>
                      )}
                      <p className='text-caption text-text-primary'>{change.title}</p>
                      {change.url && (
                        <a
                          href={change.url}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='mt-0.5 inline-flex items-center gap-1 text-tiny text-brand hover:underline'
                        >
                          <ExternalLink className='h-3 w-3' /> Xem nguồn
                        </a>
                      )}
                    </div>
                    {change.urgency && (
                      <Badge tone={urgencyTone(change.urgency)} className='flex-shrink-0'>
                        {URGENCY_VI[change.urgency] ?? change.urgency}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
            {run.cross_market_patterns && (
              <Panel title='Xu hướng thị trường'>
                <p className='whitespace-pre-wrap text-caption text-text-secondary leading-relaxed'>
                  {run.cross_market_patterns}
                </p>
              </Panel>
            )}
            {run.recommended_actions && (
              <Panel title='Khuyến nghị hành động'>
                <p className='whitespace-pre-wrap text-caption text-text-secondary leading-relaxed'>
                  {run.recommended_actions}
                </p>
              </Panel>
            )}
          </div>

          {competitorCoverage.length > 0 && (
            <Panel title='Độ phủ của đối thủ'>
              <div className='flex flex-col gap-2'>
                {competitorCoverage.map(([name, count]) => (
                  <div key={name} className='flex items-center gap-3'>
                    <p className='w-40 flex-shrink-0 truncate text-caption text-text-primary'>{name}</p>
                    <div className='flex h-2 flex-1 overflow-hidden rounded-full bg-surface-3'>
                      <div
                        className='h-full rounded-full bg-brand/60'
                        style={{ width: Math.min(100, (count / events.length) * 100) + '%' }}
                      />
                    </div>
                    <span className='w-6 text-right text-tiny text-text-quaternary'>{count}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* Events tab */}
      {tab === 'events' && (
        <div className='flex flex-col gap-4'>
          {events.length === 0 ? (
            <div className='rounded-xl border border-dashed border-[rgb(var(--border-line))] py-12 text-center'>
              <p className='text-caption text-text-tertiary'>Không có sự kiện nào trong báo cáo này.</p>
            </div>
          ) : (
            <div className='overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1'>
              <table className='w-full text-left'>
                <thead>
                  <tr className='border-b border-[rgb(var(--border-line))] bg-surface-2/50'>
                    <th className='px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary'>Đối thủ</th>
                    <th className='px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary'>Loại</th>
                    <th className='px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary'>Tiêu đề</th>
                    <th className='px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary'>Mức độ</th>
                    <th className='px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary'>Duyệt</th>
                    <th className='px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary'>Nguồn</th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-[rgb(var(--border-line))]'>
                  {events.map((evt) => (
                    <tr key={evt.id} className='group hover:bg-surface-2/30 transition-colors'>
                      <td className='px-4 py-3'>
                        <span className='text-caption font-emphasis text-text-primary'>
                          {evt.competitor_name ?? '-'}
                        </span>
                      </td>
                      <td className='px-4 py-3'>
                        <Badge tone='neutral'>{EVENT_TYPE_VI[evt.event_type] ?? evt.event_type}</Badge>
                      </td>
                      <td className='px-4 py-3'>
                        <p className='max-w-[280px] truncate text-caption text-text-primary'>{evt.title}</p>
                        {evt.evidence_excerpt && (
                          <p className='mt-0.5 max-w-[280px] truncate text-tiny text-text-quaternary'>
                            {evt.evidence_excerpt}
                          </p>
                        )}
                      </td>
                      <td className='px-4 py-3'>
                        <Badge tone={urgencyTone(evt.urgency)}>{URGENCY_VI[evt.urgency] ?? evt.urgency}</Badge>
                      </td>
                      <td className='px-4 py-3'>
                        <span
                          className={cn(
                            'text-tiny',
                            evt.review_status === 'approved' || evt.review_status === 'auto_approved'
                              ? 'text-success'
                              : evt.review_status === 'dismissed'
                              ? 'text-text-quaternary'
                              : 'text-warning',
                          )}
                        >
                          {REVIEW_STATUS_VI[evt.review_status] ?? evt.review_status}
                        </span>
                      </td>
                      <td className='px-4 py-3'>
                        <a
                          href={evt.source_url}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='inline-flex items-center gap-1 text-tiny text-brand hover:underline'
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className='h-3 w-3' /> Xem
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
