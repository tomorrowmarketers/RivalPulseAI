'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock3, ExternalLink, Globe, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Competitor, Seed, Source, formatDateTime, formatRelative } from './_shared';

interface Props {
  competitor: Competitor;
  seeds: Seed[];
  sources: Source[];
  isAdmin: boolean;
  onRefresh: () => Promise<void> | void;
}

const CAT_ORDER = ['san_pham', 'khuyen_mai', 'other'] as const;
const CAT_META: Record<string, { label: string; tone: 'brand' | 'warning' | 'neutral'; desc: string }> = {
  san_pham:   { label: 'Sản phẩm',   tone: 'brand',   desc: 'Trang sản phẩm, khóa học, dịch vụ' },
  khuyen_mai: { label: 'Khuyến mại', tone: 'warning',  desc: 'Trang ưu đãi, khuyến mãi, giảm giá' },
  other:      { label: 'Khác',       tone: 'neutral',  desc: 'Trang khác không thuộc nhóm trên' },
};
const SCHEDULE_OPTIONS = [6, 12, 24, 48, 72, 168] as const;

function pathOf(url: string) {
  try { return new URL(url).pathname || '/'; } catch { return url; }
}

function formatHoursLabel(hours: number) {
  if (hours % 168 === 0) return `${hours / 168} tuần`;
  if (hours % 24 === 0) return `${hours / 24} ngày`;
  return `${hours}h`;
}

function getArticleTime(source: Source) {
  return source.last_crawled_at ?? source.created_at ?? null;
}

export function SourcesTab({ competitor, seeds, sources, isAdmin, onRefresh }: Props) {
  const compSources = sources.filter((s) => s.competitor_id === competitor.id && s.is_active);
  const compSeeds = useMemo(
    () => seeds.filter((seed) => seed.competitor_id === competitor.id && seed.is_active),
    [competitor.id, seeds],
  );
  const initialDiscoveryHours = compSeeds[0]?.scan_frequency_hours ?? 24;
  const initialCrawlHours = compSources[0]?.crawl_frequency_hours ?? compSeeds[0]?.auto_crawl_frequency_hours ?? 48;
  const [schedule, setSchedule] = useState({ discoveryHours: initialDiscoveryHours, crawlHours: initialCrawlHours });
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState('');
  const [scheduleError, setScheduleError] = useState('');

  useEffect(() => {
    setSchedule({ discoveryHours: initialDiscoveryHours, crawlHours: initialCrawlHours });
  }, [initialCrawlHours, initialDiscoveryHours]);

  const scheduleDirty = schedule.discoveryHours !== initialDiscoveryHours || schedule.crawlHours !== initialCrawlHours;

  async function handleSaveSchedule() {
    if (!isAdmin) return;
    setSavingSchedule(true);
    setScheduleMessage('');
    setScheduleError('');
    try {
      await Promise.all([
        ...compSeeds.map((seed) => api.updateSeed(seed.id, {
          scan_frequency_hours: schedule.discoveryHours,
          auto_crawl_frequency_hours: schedule.crawlHours,
        })),
        ...compSources.map((source) => api.updateSource(source.id, {
          crawl_frequency_hours: schedule.crawlHours,
        })),
      ]);
      setScheduleMessage('Đã cập nhật lịch crawl cho các URL đang theo dõi.');
      await onRefresh();
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Không cập nhật được lịch crawl.');
    } finally {
      setSavingSchedule(false);
    }
  }

  if (compSources.length === 0) {
    return (
      <EmptyState
        icon={Globe}
        title="Chưa có trang nào đang theo dõi"
        description="Thêm đối thủ và chạy quét để hệ thống tự phát hiện các trang cần giám sát."
      />
    );
  }

  const grouped: Record<string, Source[]> = { san_pham: [], khuyen_mai: [], other: [] };
  for (const src of compSources) {
    const cat = src.page_category && grouped[src.page_category] !== undefined ? src.page_category : 'other';
    grouped[cat].push(src);
  }

  const activeCats = CAT_ORDER.filter((c) => grouped[c].length > 0);
  const totalHours = compSources[0]?.crawl_frequency_hours ?? 48;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4 shadow-linear-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-text-quaternary" />
              <p className="text-caption font-emphasis text-text-primary">Lịch crawl đang áp dụng</p>
            </div>
            <p className="mt-1 text-caption text-text-tertiary">
              Sau khi tạo đối thủ, bạn có thể quay lại tab này để đổi cả lịch quét link mới lẫn lịch crawl lại các URL đang theo dõi.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-[rgb(var(--border-line))] bg-surface-2/50 px-2.5 py-1 text-caption text-text-secondary">
              Quét link mới {formatHoursLabel(schedule.discoveryHours)}
            </span>
            <span className="rounded-md border border-[rgb(var(--border-line))] bg-surface-2/50 px-2.5 py-1 text-caption text-text-secondary">
              Crawl lại {formatHoursLabel(schedule.crawlHours)}
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ScheduleSelector
            label="Quét link mới"
            description="Áp dụng cho discovery seed để phát hiện URL mới hoặc menu mới."
            value={schedule.discoveryHours}
            disabled={!isAdmin || savingSchedule || compSeeds.length === 0}
            onChange={(hours) => setSchedule((prev) => ({ ...prev, discoveryHours: hours }))}
          />
          <ScheduleSelector
            label="Crawl lại URL đang theo dõi"
            description="Áp dụng cho các source đang active của đối thủ này."
            value={schedule.crawlHours}
            disabled={!isAdmin || savingSchedule}
            onChange={(hours) => setSchedule((prev) => ({ ...prev, crawlHours: hours }))}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-caption text-text-tertiary">
            {compSeeds.length > 0
              ? `Đang có ${compSeeds.length} seed quét link và ${compSources.length} URL active nhận lịch này.`
              : `Đang có ${compSources.length} URL active nhận lịch crawl lại.`}
          </div>
          {isAdmin && (
            <Button size="sm" variant="primary" onClick={handleSaveSchedule} loading={savingSchedule} disabled={!scheduleDirty}>
              Lưu lịch crawl
            </Button>
          )}
        </div>

        {savingSchedule && (
          <div className="mt-3 flex items-center gap-2 text-caption text-text-tertiary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Đang cập nhật lịch crawl...
          </div>
        )}
        {scheduleMessage && <p className="mt-3 text-caption text-success">{scheduleMessage}</p>}
        {scheduleError && <p className="mt-3 text-caption text-danger">{scheduleError}</p>}
      </div>

      {/* Summary row */}
      <div className="flex items-center gap-2 flex-wrap">
        {activeCats.map((cat) => {
          const m = CAT_META[cat];
          return (
            <div
              key={cat}
              className="flex items-center gap-2 rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 px-3 py-2"
            >
              <Badge tone={m.tone}>{m.label}</Badge>
              <span className="text-caption font-strong text-text-primary tabular-nums">{grouped[cat].length}</span>
              <span className="text-caption text-text-quaternary">trang</span>
            </div>
          );
        })}
        <span className="text-caption text-text-quaternary ml-auto">
          Tổng {compSources.length} · quét mỗi {formatHoursLabel(totalHours)}
        </span>
      </div>

      <p className="px-1 text-caption text-text-quaternary">
        Cột thời gian đang ưu tiên ngày crawl gần nhất của từng URL. Nếu trang không có ngày đăng gốc,
        hệ thống dùng mốc crawl như thời gian bài viết để bạn vẫn lọc được trang mới.
      </p>

      {/* Grouped sections */}
      {activeCats.map((cat) => {
        const m = CAT_META[cat];
        const srcs = grouped[cat];
        return (
          <div key={cat} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-1 py-0.5">
              <Badge tone={m.tone}>{m.label}</Badge>
              <span className="text-caption text-text-tertiary">{m.desc}</span>
              <span className="text-caption text-text-quaternary ml-auto">{srcs.length} trang</span>
            </div>
            <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 overflow-hidden shadow-linear-sm">
              <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_150px_24px] gap-3 border-b border-[rgb(var(--border-line))] bg-surface-2/30 px-4 py-2 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">
                <span className="pl-5">Trang / URL</span>
                <span className="text-right">Mốc bài viết</span>
                <span />
              </div>
              <ul className="divide-y divide-[rgb(var(--border-line))]">
                {srcs.map((src) => {
                  const title = src.page_title?.trim() || pathOf(src.url);
                  const hasTitle = !!src.page_title?.trim();
                  const articleTime = getArticleTime(src);
                  return (
                    <li
                      key={src.id}
                      className="grid gap-3 px-4 py-3.5 hover:bg-surface-2/30 transition-colors group sm:grid-cols-[minmax(0,1fr)_150px_24px] sm:items-center"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <div className={cn(
                          'mt-1 h-2 w-2 rounded-full flex-shrink-0',
                          src.is_active ? 'bg-success' : 'bg-text-quaternary',
                        )} />
                        <div className="min-w-0 flex-1">
                          <p className={cn(
                            'text-caption leading-snug',
                            hasTitle ? 'text-text-primary font-emphasis' : 'text-text-tertiary font-mono',
                          )}>
                            {title}
                          </p>
                          {hasTitle && (
                            <p className="mt-0.5 text-caption text-text-quaternary truncate">{src.url}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-0.5 text-left sm:items-end sm:text-right">
                        <span className="text-caption text-text-secondary tabular-nums">
                          {articleTime ? formatDateTime(articleTime) : 'Chưa crawl'}
                        </span>
                        <span className="text-tiny text-text-quaternary">
                          {articleTime
                            ? src.last_crawled_at
                              ? `${formatRelative(src.last_crawled_at)} · mốc crawl`
                              : 'Tạm theo mốc tạo nguồn theo dõi'
                            : 'Chưa có mốc thời gian'}
                        </span>
                      </div>
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="justify-self-start text-text-quaternary hover:text-brand transition-colors flex-shrink-0 opacity-100 sm:justify-self-end sm:opacity-0 sm:group-hover:opacity-100"
                        title="Mở trang"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScheduleSelector({
  label,
  description,
  value,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  disabled: boolean;
  onChange: (hours: number) => void;
}) {
  return (
    <div>
      <p className="text-caption font-emphasis text-text-primary">{label}</p>
      <p className="mt-1 text-caption text-text-tertiary">{description}</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {SCHEDULE_OPTIONS.map((hours) => {
          const active = value === hours;
          return (
            <button
              key={hours}
              type="button"
              disabled={disabled}
              onClick={() => onChange(hours)}
              className={cn(
                'rounded-md border px-2 py-2 text-caption font-emphasis transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                active
                  ? 'border-brand/40 bg-brand/8 text-brand'
                  : 'border-[rgb(var(--border-line))] bg-surface-2/40 text-text-secondary hover:bg-surface-2',
              )}
            >
              {formatHoursLabel(hours)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
