'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { KpiCard } from '@/components/ui/KpiCard';
import { ModuleOverview } from '@/components/ui/ModuleOverview';
import { Panel } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { api } from '@/lib/api';

type OverviewData = Record<string, unknown>;
type SystemAI = { uses_live_gpt?: boolean; model?: string };
type SystemPipeline = { last_crawl_at?: string; next_scheduled_at?: string };
type SystemReview = { pending_events?: number };
type ReportSchedule = {
  cadence_days: number; auto_enabled: boolean; email_enabled: boolean;
  last_report_end?: string; last_report_id?: string;
  next_report_end: string; days_until_next: number; is_overdue: boolean;
};

export default function OverviewPage() {
  const [days, setDays] = useState(14);
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setError('');
    api
      .getOverview(days)
      .then((payload) => {
        if (active) setData(payload);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [days]);

  const systemStatus = data?.system_status as Record<string, unknown> | undefined;
  const aiStatus = systemStatus?.ai as SystemAI | undefined;
  const pipeline = systemStatus?.pipeline as SystemPipeline | undefined;
  const review = systemStatus?.review as SystemReview | undefined;
  const schedule = data?.report_schedule as ReportSchedule | undefined;

  const scheduleLabel = schedule
    ? schedule.is_overdue || schedule.days_until_next === 0
      ? 'Báo cáo đã quá hạn'
      : schedule.days_until_next === 1
      ? 'Báo cáo đến hạn ngày mai'
      : `Báo cáo tiếp theo sau ${schedule.days_until_next} ngày`
    : null;

  return (
    <div className="flex flex-col gap-5 p-6">
      <ModuleOverview
        kicker="Tổng quan"
        title="Trạng thái pipeline hiện tại"
        description="Kiểm tra độ phủ, áp lực hàng đợi và trạng thái báo cáo trước khi đi sâu vào từng module."
        badges={['Độ phủ', 'Hàng đợi duyệt', 'Sẵn sàng báo cáo']}
        stats={[
          { label: 'Đối thủ', value: String(data?.competitors_tracked ?? '—'), helper: 'Đối thủ đang theo dõi.' },
          { label: 'Thay đổi mới', value: String(data?.new_events ?? '—'), helper: `Phát hiện trong ${days} ngày qua.` },
          { label: 'Chờ duyệt', value: String(data?.pending_reviews ?? '—'), helper: 'Đang chờ phê duyệt.' },
        ]}
      />

      {/* Day filter */}
      <div className="flex items-center gap-2">
        {[7, 14, 30].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setDays(value)}
            className={`rounded-full border px-3 py-1 text-caption font-emphasis transition-colors ${
              value === days
                ? 'border-brand/40 bg-brand/10 text-brand-active'
                : 'border-[rgb(var(--border-subtle)/0.08)] text-text-tertiary hover:text-text-primary hover:bg-surface-2'
            }`}
          >
            {value} ngày qua
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/8 px-3 py-2.5 text-caption text-danger">
          {error}
        </div>
      )}

      {/* Report schedule banner */}
      {schedule && (
        <div className={`flex items-center justify-between rounded-lg border px-4 py-3 gap-4 ${
          schedule.is_overdue || schedule.days_until_next === 0
            ? 'border-danger/30 bg-danger/8'
            : schedule.days_until_next <= 3
            ? 'border-warning/30 bg-warning/8'
            : 'border-[rgb(var(--border-subtle)/0.10)] bg-surface-1'
        }`}>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-caption font-emphasis text-text-primary">{scheduleLabel}</span>
            {schedule.auto_enabled && <StatusBadge tone="success">Tự động</StatusBadge>}
            {schedule.email_enabled
              ? <StatusBadge tone="success">Email bật</StatusBadge>
              : <StatusBadge tone="warning">Email tắt</StatusBadge>}
            {schedule.last_report_end && (
              <span className="text-caption text-text-tertiary">Gần nhất: {schedule.last_report_end}</span>
            )}
          </div>
          <Link
            href="/reports"
            className="flex-shrink-0 rounded-lg border border-brand/40 px-3.5 py-1.5 text-caption font-emphasis text-brand hover:bg-brand/8 transition-all"
          >
            {schedule.is_overdue || schedule.days_until_next === 0 ? 'Tạo ngay →' : 'Xem báo cáo →'}
          </Link>
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-5 gap-4">
        <KpiCard label="Đối thủ theo dõi" value={String(data?.competitors_tracked ?? '—')} />
        <KpiCard label="Trang theo dõi" value={String(data?.monitored_urls ?? '—')} />
        <KpiCard label="Thay đổi mới" value={String(data?.new_events ?? '—')} tone="accent" />
        <KpiCard label="Chờ duyệt" value={String(data?.pending_reviews ?? '—')} tone="warning" />
        <KpiCard label="Sẵn sàng báo cáo" value={String(data?.report_worthy_events ?? '—')} tone="muted" />
      </div>

      {/* Split panels */}
      <div className="grid grid-cols-2 gap-4">
        <Panel title="Kiểm tra hệ thống" description="Phát hiện lỗi phủ sóng trước khi nó làm lệch feed.">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-caption text-text-secondary">Mô hình AI</span>
              <StatusBadge tone={aiStatus?.uses_live_gpt ? 'success' : 'warning'}>
                {aiStatus?.uses_live_gpt ? `OpenAI live / ${aiStatus.model}` : 'Heuristic fallback'}
              </StatusBadge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-caption text-text-secondary">Hàng đợi duyệt</span>
              <StatusBadge tone={(review?.pending_events ?? 0) > 0 ? 'accent' : 'success'}>
                {review?.pending_events
                  ? `${review.pending_events} chờ duyệt`
                  : 'Hàng đợi trống'}
              </StatusBadge>
            </div>
            {pipeline?.last_crawl_at && (
              <div className="flex items-center justify-between">
                <span className="text-caption text-text-secondary">Crawl gần nhất</span>
                <span className="text-caption text-text-tertiary font-emphasis">
                  {new Date(pipeline.last_crawl_at as string).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </Panel>

        <Panel
          title="Luồng làm việc"
          description="Đi theo đúng thứ tự để dữ liệu crawl dễ hiểu hơn và không bị trôi khỏi mục tiêu sử dụng."
        >
          <div className="flex flex-col gap-2">
            {[
              { href: '/monitor', label: '1. Kiểm tra nguồn crawl', helper: 'Xem đối thủ nào đang crawl, URL nào mới được phát hiện và có gì cần chỉnh.' },
              { href: '/ask', label: '2. Hỏi AI trên dữ liệu đã crawl', helper: 'Dùng khi muốn hỏi nhanh theo scope nguồn hoặc đối thủ cụ thể.' },
              { href: '/reports', label: '3. Tạo hoặc xem báo cáo', helper: 'Tổng hợp insight sau khi backlog review đã gọn.' },
            ].map(({ href, label, helper }) => (
              <Link
                key={href}
                href={href}
                className="flex items-start justify-between gap-3 rounded-lg border border-[rgb(var(--border-subtle)/0.08)] bg-surface-0 px-3.5 py-3 text-caption text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors group"
              >
                <div>
                  <p className="text-caption font-emphasis text-text-primary">{label}</p>
                  <p className="mt-1 text-caption text-text-tertiary">{helper}</p>
                </div>
                <span className="text-text-quaternary group-hover:text-text-tertiary text-caption">→</span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
