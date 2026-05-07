'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  Clock,
  FileText,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import { AppModalShell } from '@/components/ui/AppModalShell';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

type ReportRun = {
  id: string;
  title: string;
  period_start: string;
  period_end: string;
  status: string;
  generated_at?: string | null;
};

type ReportDefinition = {
  id: string;
  title: string;
  report_type: string;
  cadence: string;
  cadence_days: number;
  auto_enabled: boolean;
  email_enabled: boolean;
  is_active: boolean;
  run_count: number;
  last_run?: { id: string; title: string; period_start: string; period_end: string; status: string; generated_at?: string } | null;
  next_run?: { days_until_next: number; next_period_start: string; next_period_end: string; is_overdue: boolean } | null;
  created_at: string;
  updated_at: string;
};

const inputClass =
  'w-full rounded-md border border-[rgb(var(--border-line)/0.12)] bg-surface-0 px-3 py-2.5 text-caption text-text-primary placeholder:text-text-quaternary outline-none focus:border-brand/55 transition-all';
const labelClass = 'flex flex-col gap-1.5 text-caption font-emphasis text-text-secondary';

const REPORT_TYPE_VI: Record<string, string> = {
  overview: 'Tổng quan',
  single_domain: 'Chuyên sâu',
  comparison: 'So sánh',
};

const STATUS_VI: Record<string, string> = {
  draft: 'Nháp',
  published: 'Đã phát hành',
  archived: 'Lưu trữ',
};

function fmt(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function statusTone(s: string) {
  if (s === 'published') return 'success' as const;
  if (s === 'draft') return 'neutral' as const;
  return 'warning' as const;
}

export default function ReportDefinitionPage() {
  const params = useParams<{ reportId: string }>();
  const router = useRouter();
  const defId = Array.isArray(params.reportId) ? params.reportId[0] : params.reportId;

  const [definition, setDefinition] = useState<ReportDefinition | null>(null);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Custom run modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [runForm, setRunForm] = useState({ title: '', period_start: '', period_end: '' });

  const load = useCallback(async () => {
    if (!defId) return;
    setLoading(true);
    setError('');
    try {
      const [defRes, runsRes] = await Promise.all([
        api.getReportDefinition(defId),
        api.getReportRuns(defId),
      ]);
      setDefinition((defRes as { item: ReportDefinition }).item);
      setRuns((runsRes as { items: ReportRun[] }).items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không tải được dữ liệu');
    } finally {
      setLoading(false);
    }
  }, [defId]);

  useEffect(() => {
    void load();
  }, [load]);

  function defaultDates(cadenceDays = 13) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - cadenceDays);
    return { period_start: start.toISOString().slice(0, 10), period_end: end.toISOString().slice(0, 10) };
  }

  function openRunModal() {
    const d = defaultDates(definition?.cadence_days ?? 13);
    setRunForm({ title: '', period_start: d.period_start, period_end: d.period_end });
    setCreateError('');
    setCreateOpen(true);
  }

  async function handleDelete() {
    if (!defId) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteReportDefinition(defId);
      router.push('/reports');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi xóa báo cáo');
      setBusy(false);
    }
  }

  async function handleRunNow() {
    if (!defId) return;
    setBusy(true);
    setError('');
    try {
      const d = definition?.next_run
        ? { period_start: definition.next_run.next_period_start, period_end: definition.next_run.next_period_end }
        : defaultDates(definition?.cadence_days ?? 13);
      const res = await api.createReportRun(defId, d as Record<string, unknown>);
      const newRun = (res as { item: ReportRun }).item;
      router.push(`/reports/${defId}/runs/${newRun.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi tạo lần chạy');
      setBusy(false);
    }
  }

  async function handleCreateRun(e: React.FormEvent) {
    e.preventDefault();
    setCreateBusy(true);
    setCreateError('');
    try {
      const res = await api.createReportRun(defId, runForm as Record<string, unknown>);
      const newRun = (res as { item: ReportRun }).item;
      setCreateOpen(false);
      router.push(`/reports/${defId}/runs/${newRun.id}`);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Lỗi tạo lần chạy');
    } finally {
      setCreateBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-text-quaternary" />
          <p className="text-caption text-text-tertiary">Đang tải…</p>
        </div>
      </div>
    );
  }

  if (!definition) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <FileText className="h-10 w-10 text-text-quaternary" />
          <div>
            <p className="text-body font-emphasis text-text-primary">Không tìm thấy báo cáo</p>
            <p className="mt-1 text-caption text-text-tertiary">{error || 'Báo cáo này không tồn tại hoặc đã bị xoá.'}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => router.push('/reports')}>
            Quay lại danh sách
          </Button>
        </div>
      </div>
    );
  }

  const nextRun = definition.next_run;
  const lastRun = definition.last_run;

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-caption text-text-tertiary">
        <button
          onClick={() => router.push('/reports')}
          className="inline-flex items-center gap-1.5 hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Tất cả báo cáo
        </button>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-text-primary font-emphasis truncate max-w-[320px]">{definition.title}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand/10">
            <FileText className="h-5 w-5 text-brand" />
          </div>
          <div className="min-w-0">
            <h1 className="text-title font-emphasis text-text-primary truncate max-w-[420px]">{definition.title}</h1>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <Badge
                tone={definition.report_type === 'comparison' ? 'brand' : definition.report_type === 'single_domain' ? 'info' : 'neutral'}
              >
                {REPORT_TYPE_VI[definition.report_type] ?? definition.report_type}
              </Badge>
              <span className="text-tiny text-text-quaternary">·</span>
              <span className="text-tiny text-text-tertiary">
                <Calendar className="mr-0.5 inline h-3 w-3" /> Mỗi {definition.cadence_days} ngày
              </span>
              {definition.auto_enabled && (
                <>
                  <span className="text-tiny text-text-quaternary">·</span>
                  <span className="text-tiny text-success flex items-center gap-0.5">
                    <Zap className="h-3 w-3" /> Tự động
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Plus className="h-3.5 w-3.5" />}
            onClick={openRunModal}
          >
            Chạy tuỳ chỉnh
          </Button>
          <Button
            variant="primary"
            size="sm"
            leadingIcon={<Play className="h-3.5 w-3.5" />}
            onClick={handleRunNow}
            loading={busy}
          >
            Chạy ngay
          </Button>
          {!deleteConfirm ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={() => setDeleteConfirm(true)}
            >
              Xóa
            </Button>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-tiny text-danger">Xác nhận xóa?</span>
              <Button variant="danger" size="sm" onClick={handleDelete} loading={busy}>
                Xóa luôn
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setDeleteConfirm(false)}>
                Huỷ
              </Button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-danger/10 px-4 py-3 text-caption text-danger">{error}</div>
      )}

      {/* Schedule summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4">
          <p className="text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Tổng số lần chạy</p>
          <p className="mt-2 text-2xl font-emphasis text-text-primary">{definition.run_count}</p>
        </div>
        <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4">
          <p className="text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Lần chạy gần nhất</p>
          {lastRun ? (
            <>
              <p className="mt-2 text-caption font-emphasis text-text-primary">{fmt(lastRun.period_end)}</p>
              <Badge tone={statusTone(lastRun.status)} className="mt-1">
                {lastRun.status === 'published' ? 'Đã phát hành' : lastRun.status === 'draft' ? 'Nháp' : 'Lưu trữ'}
              </Badge>
            </>
          ) : (
            <p className="mt-2 text-caption text-text-quaternary">Chưa chạy lần nào</p>
          )}
        </div>
        <div
          className={cn(
            'rounded-xl border p-4',
            nextRun?.is_overdue ? 'border-danger/30 bg-danger/5' : 'border-[rgb(var(--border-line))] bg-surface-1',
          )}
        >
          <p className="text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Chạy tiếp theo</p>
          {nextRun ? (
            <>
              <p className={cn('mt-2 text-caption font-emphasis', nextRun.is_overdue ? 'text-danger' : 'text-text-primary')}>
                {nextRun.is_overdue ? 'Quá hạn' : `${nextRun.days_until_next} ngày nữa`}
              </p>
              <p className="mt-0.5 text-tiny text-text-quaternary">{fmt(nextRun.next_period_end)}</p>
            </>
          ) : (
            <p className="mt-2 text-caption text-text-quaternary">—</p>
          )}
        </div>
      </div>

      {/* Run history */}
      <div className="flex flex-col gap-3">
        <p className="text-tiny font-strong uppercase tracking-[0.12em] text-text-quaternary">
          Lịch sử chạy ({runs.length})
        </p>
        {runs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[rgb(var(--border-line))] py-12 text-center">
            <Clock className="h-8 w-8 text-text-quaternary" />
            <p className="text-caption text-text-tertiary">
              Chưa có lần chạy nào.
              <br />
              Nhấn &quot;Chạy ngay&quot; để tạo báo cáo đầu tiên.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-sm">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[rgb(var(--border-line))] bg-surface-2/50">
                  <th className="px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">#</th>
                  <th className="px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Tiêu đề</th>
                  <th className="px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Kỳ báo cáo</th>
                  <th className="px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Trạng thái</th>
                  <th className="px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Thời điểm</th>
                  <th className="px-4 py-2.5 text-right text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--border-line))]">
                {runs.map((run, idx) => (
                  <tr
                    key={run.id}
                    className="cursor-pointer hover:bg-surface-2/30 transition-colors group"
                    onClick={() => router.push(`/reports/${defId}/runs/${run.id}`)}
                  >
                    <td className="px-4 py-3">
                      <span className="text-caption text-text-quaternary">#{runs.length - idx}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-caption font-emphasis text-text-primary truncate max-w-[260px]">{run.title}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-caption text-text-secondary">
                        {fmt(run.period_start)} → {fmt(run.period_end)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(run.status)}>{STATUS_VI[run.status] ?? run.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-caption text-text-tertiary">{run.generated_at ? fmt(run.generated_at) : '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ChevronRight className="inline h-4 w-4 text-text-quaternary" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Custom run modal */}
      {createOpen && (
        <AppModalShell
          size="sm"
          title="Chạy báo cáo tuỳ chỉnh"
          description="Tạo một lần chạy mới với kỳ thời gian tuỳ chọn."
          onClose={() => setCreateOpen(false)}
        >
          <form onSubmit={handleCreateRun} className="flex flex-col gap-4">
            <label className={labelClass}>
              Tiêu đề <span className="font-normal text-text-quaternary">(tuỳ chọn)</span>
              <input
                value={runForm.title}
                onChange={(e) => setRunForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="Competitor Watch — Tháng 5/2026"
                className={inputClass}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={labelClass}>
                Từ ngày
                <input
                  type="date"
                  value={runForm.period_start}
                  onChange={(e) => setRunForm((p) => ({ ...p, period_start: e.target.value }))}
                  required
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                Đến ngày
                <input
                  type="date"
                  value={runForm.period_end}
                  onChange={(e) => setRunForm((p) => ({ ...p, period_end: e.target.value }))}
                  required
                  className={inputClass}
                />
              </label>
            </div>
            {createError && <p className="text-tiny text-danger">{createError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" type="button" onClick={() => setCreateOpen(false)}>
                Huỷ
              </Button>
              <Button variant="primary" size="sm" type="submit" loading={createBusy}>
                Chạy báo cáo
              </Button>
            </div>
          </form>
        </AppModalShell>
      )}
    </div>
  );
}