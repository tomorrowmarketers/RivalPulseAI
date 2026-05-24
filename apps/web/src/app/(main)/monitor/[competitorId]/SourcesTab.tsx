'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Calendar, Check, ChevronRight, ExternalLink, Filter, Globe, Hand, Info, Pause, Play, Repeat, Search, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { AppModalShell } from '@/components/ui/AppModalShell';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Competitor, Seed, SeedLink, Source, SOURCE_TYPE_LABELS, SOURCE_TYPES, formatDateTime, formatRelative } from './_shared';

interface Props {
  competitor: Competitor;
  seeds: Seed[];
  sources: Source[];
  isAdmin: boolean;
  onRefresh: () => Promise<void> | void;
}

const CAT_ORDER = ['san_pham', 'khuyen_mai', 'other'] as const;
const CAT_META: Record<string, { label: string; dot: string }> = {
  san_pham:   { label: 'Sản phẩm',   dot: 'bg-brand' },
  khuyen_mai: { label: 'Khuyến mại', dot: 'bg-warning' },
  other:      { label: 'Khác',       dot: 'bg-text-quaternary' },
};
const SCHEDULE_OPTIONS = [6, 12, 24, 48, 72, 168] as const;

type ScheduleMode = 'manual' | 'interval' | 'cron';
type ScheduleState = {
  mode: ScheduleMode;
  hours: number;
  cron: string;
  autoApprove: boolean;
  autoSourceTypes: string[];
};

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
  // Show ALL sources for this competitor (active + paused) so user can resume/delete.
  const compSources = useMemo(
    () => sources.filter((s) => s.competitor_id === competitor.id),
    [competitor.id, sources],
  );
  // Same for seeds.
  const compSeeds = useMemo(
    () => seeds.filter((seed) => seed.competitor_id === competitor.id),
    [competitor.id, seeds],
  );
  const activeSources = useMemo(() => compSources.filter((s) => s.is_active), [compSources]);
  const activeSeeds = useMemo(() => compSeeds.filter((s) => s.is_active), [compSeeds]);

  // Sync state: 'on' if any seed or source is active. Off only when ALL paused.
  const syncOn = activeSources.length > 0 || activeSeeds.length > 0;
  const syncFullyOff = compSources.length + compSeeds.length > 0 && !syncOn;

  const [togglingSync, setTogglingSync] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Source | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  async function handleToggleSync() {
    if (!isAdmin) return;
    const next = !syncOn;
    setTogglingSync(true);
    setSyncError('');
    try {
      await Promise.all([
        ...compSeeds.map((s) => api.updateSeed(s.id, { is_active: next })),
        ...compSources.map((s) => api.updateSource(s.id, { is_active: next })),
      ]);
      await onRefresh();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Không cập nhật được trạng thái đồng bộ.');
    } finally {
      setTogglingSync(false);
    }
  }

  async function handleDeleteSource() {
    if (!isAdmin || !pendingDelete) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.deleteSource(pendingDelete.id);
      await onRefresh();
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Không xóa được URL này.');
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleSource(src: Source) {
    if (!isAdmin) return;
    try {
      await api.updateSource(src.id, { is_active: !src.is_active });
      await onRefresh();
    } catch {
      /* swallow; surfaces are noisy */
    }
  }

  async function handleRunAll() {
    if (!isAdmin) return;
    const sourceTargets = compSources;
    const seedTargets = compSeeds;
    if (sourceTargets.length === 0 && seedTargets.length === 0) {
      setRunError('Chưa có seed hoặc URL nào để chạy.');
      return;
    }
    setRunningAll(true);
    setRunError('');
    setRunOk(false);
    try {
      await Promise.all([
        ...sourceTargets.map((s) => api.runCrawl(s.id)),
        ...seedTargets.map((s) => api.rescanSeed(s.id)),
      ]);
      setRunOk(true);
      await onRefresh();
      setTimeout(() => setRunOk(false), 4000);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Không khởi tạo pipeline được.');
    } finally {
      setRunningAll(false);
    }
  }

  // ── Unified cadence (1 schedule for the whole pipeline) ──
  const initialHours =
    activeSources[0]?.crawl_frequency_hours
    ?? compSources[0]?.crawl_frequency_hours
    ?? activeSeeds[0]?.scan_frequency_hours
    ?? compSeeds[0]?.scan_frequency_hours
    ?? 24;
  const totalEntities = compSeeds.length + compSources.length;
  const anyActive = activeSeeds.length > 0 || activeSources.length > 0;
  const initialMode: ScheduleMode = (totalEntities > 0 && !anyActive ? 'manual' : 'interval') as ScheduleMode;
  const initialAutoApprove = compSeeds.some((s) => s.auto_approve_new_links);
  const initialAutoSourceTypes: string[] = (() => {
    // Union of all seeds' auto_approve_source_types lists, filtered to valid types.
    const set = new Set<string>();
    for (const s of compSeeds) {
      for (const t of s.auto_approve_source_types ?? []) {
        if (SOURCE_TYPES.includes(t)) set.add(t);
      }
    }
    return Array.from(set);
  })();

  // ── Filters / search ──────────────────────────────
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'san_pham' | 'khuyen_mai' | 'other'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'oldest' | 'az'>('recent');

  const filteredSources = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = compSources.filter((src) => {
      if (statusFilter === 'active' && !src.is_active) return false;
      if (statusFilter === 'paused' && src.is_active) return false;
      if (categoryFilter !== 'all') {
        const cat = src.page_category && CAT_META[src.page_category] ? src.page_category : 'other';
        if (cat !== categoryFilter) return false;
      }
      if (q) {
        const hay = `${src.url} ${src.page_title ?? ''} ${src.source_type ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list = [...list];
    if (sortBy === 'recent') {
      list.sort((a, b) => {
        const ta = getArticleTime(a) ?? '';
        const tb = getArticleTime(b) ?? '';
        return tb.localeCompare(ta);
      });
    } else if (sortBy === 'oldest') {
      list.sort((a, b) => {
        const ta = getArticleTime(a) ?? '';
        const tb = getArticleTime(b) ?? '';
        return ta.localeCompare(tb);
      });
    } else {
      list.sort((a, b) => (a.page_title || a.url).localeCompare(b.page_title || b.url));
    }
    return list;
  }, [compSources, query, statusFilter, categoryFilter, sortBy]);

  const filterActive = query.trim() !== '' || statusFilter !== 'all' || categoryFilter !== 'all';
  function clearFilters() {
    setQuery('');
    setStatusFilter('all');
    setCategoryFilter('all');
  }

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleState>({
    mode: initialMode,
    hours: initialHours,
    cron: '',
    autoApprove: initialAutoApprove,
    autoSourceTypes: initialAutoSourceTypes,
  });
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [runningAll, setRunningAll] = useState(false);
  const [runError, setRunError] = useState('');
  const [runOk, setRunOk] = useState(false);

  useEffect(() => {
    setSchedule({
      mode: initialMode,
      hours: initialHours,
      cron: '',
      autoApprove: initialAutoApprove,
      autoSourceTypes: initialAutoSourceTypes,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMode, initialHours, initialAutoApprove, initialAutoSourceTypes.join('|')]);

  const scheduleDirty =
    schedule.mode !== initialMode ||
    (schedule.mode === 'interval' && schedule.hours !== initialHours) ||
    (schedule.mode === 'cron' && schedule.cron.trim() !== '') ||
    schedule.autoApprove !== initialAutoApprove ||
    (schedule.autoApprove && schedule.autoSourceTypes.slice().sort().join('|') !== initialAutoSourceTypes.slice().sort().join('|'));

  async function handleSaveSchedule() {
    if (!isAdmin) return;
    if (schedule.autoApprove && schedule.autoSourceTypes.length === 0) {
      setScheduleError('Chọn ít nhất 1 loại nguồn để tự duyệt.');
      return;
    }
    setSavingSchedule(true);
    setScheduleError('');
    try {
      const autoActive = schedule.mode !== 'manual';
      await Promise.all([
        ...compSeeds.map((seed) => api.updateSeed(seed.id, {
          is_active: autoActive,
          auto_approve_new_links: schedule.autoApprove,
          ...(schedule.autoApprove ? {
            auto_approve_source_types: schedule.autoSourceTypes,
            auto_source_type: schedule.autoSourceTypes[0] ?? 'other',
          } : { auto_approve_source_types: [] }),
          ...(autoActive ? {
            scan_frequency_hours: schedule.hours,
            auto_crawl_frequency_hours: schedule.hours,
          } : {}),
        })),
        ...compSources.map((source) => api.updateSource(source.id, {
          is_active: autoActive,
          ...(autoActive ? { crawl_frequency_hours: schedule.hours } : {}),
        })),
      ]);
      await onRefresh();
      setScheduleOpen(false);
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Không cập nhật được lịch crawl.');
    } finally {
      setSavingSchedule(false);
    }
  }

  if (compSources.length === 0 && !compSeeds.some((s) => s.pending_count > 0)) {
    return (
      <EmptyState
        icon={Globe}
        title="Chưa có trang nào đang theo dõi"
        description="Thêm đối thủ và chạy quét để hệ thống tự phát hiện các trang cần giám sát."
      />
    );
  }

  const grouped: Record<string, Source[]> = { san_pham: [], khuyen_mai: [], other: [] };
  for (const src of filteredSources) {
    const cat = src.page_category && grouped[src.page_category] !== undefined ? src.page_category : 'other';
    grouped[cat].push(src);
  }
  const activeCats = CAT_ORDER.filter((c) => grouped[c].length > 0);

  // Unfiltered counts for filter-chip badges.
  const catCounts: Record<string, number> = { san_pham: 0, khuyen_mai: 0, other: 0 };
  let activeCount = 0;
  let pausedCount = 0;
  for (const src of compSources) {
    const cat = src.page_category && catCounts[src.page_category] !== undefined ? src.page_category : 'other';
    catCounts[cat] += 1;
    if (src.is_active) activeCount += 1; else pausedCount += 1;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── Title row ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-baseline gap-2">
          <h3 className="text-caption font-emphasis text-text-primary">URL đang theo dõi</h3>
          <span className="text-caption text-text-quaternary tabular-nums">{compSources.length}</span>
        </div>

        {isAdmin && compSources.length + compSeeds.length > 0 && (
          <button
            type="button"
            onClick={handleToggleSync}
            disabled={togglingSync}
            className={cn(
              'ml-auto inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-caption font-emphasis transition-colors',
              syncOn
                ? 'border-success/30 bg-success/5 text-success hover:bg-success/10'
                : 'border-warning/40 bg-warning/5 text-warning hover:bg-warning/10',
              togglingSync && 'opacity-60 cursor-not-allowed',
            )}
            title={syncOn ? 'Bấm để tạm dừng đồng bộ tự động cho mọi URL' : 'Bấm để bật lại đồng bộ tự động'}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', syncOn ? 'bg-success animate-pulse' : 'bg-warning')} />
            {syncOn ? 'Đang đồng bộ' : 'Đã tạm dừng'}
          </button>
        )}
      </div>

      {/* ── Pipeline status strip (always visible) ─────────── */}
      {compSources.length + compSeeds.length > 0 && (
        <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-caption text-text-quaternary">Pipeline:</span>
            <ModeBadge stageLabel="Lịch chung" mode={schedule.mode} hours={schedule.hours} cron={schedule.cron} />
            {schedule.autoApprove && schedule.autoSourceTypes.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md border border-info/30 bg-info/5 px-1.5 py-0.5 text-caption font-emphasis text-info" title={`Auto-approve cho loại: ${schedule.autoSourceTypes.map((t) => SOURCE_TYPE_LABELS[t] ?? t).join(', ')}`}>
                <Sparkles className="h-3 w-3" />
                Tự duyệt · {schedule.autoSourceTypes.length === 1
                  ? (SOURCE_TYPE_LABELS[schedule.autoSourceTypes[0]] ?? schedule.autoSourceTypes[0])
                  : `${schedule.autoSourceTypes.length} loại`}
              </span>
            )}
            <span className="text-caption text-text-quaternary">·</span>
            <span className="text-caption text-text-tertiary">{compSeeds.length} seed → {compSources.length} URL → phân tích</span>

            <div className="ml-auto flex items-center gap-2">
              {isAdmin && (
                <Button
                  size="xs"
                  variant="primary"
                  loading={runningAll}
                  leadingIcon={<Play className="h-3 w-3" />}
                  onClick={handleRunAll}
                  disabled={compSources.length + compSeeds.length === 0}
                  title={compSources.length + compSeeds.length === 0 ? 'Chưa có seed hoặc URL nào' : `Rà seed (${compSeeds.length}) + crawl (${compSources.length}) ngay lập tức`}
                >
                  Chạy ngay
                </Button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setScheduleOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[rgb(var(--border-line))] bg-surface-1 px-2.5 py-1 text-caption text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Cấu hình
                </button>
              )}
            </div>
          </div>
          {runError && (
            <p className="mt-2 text-caption text-danger">{runError}</p>
          )}
          {runOk && (
            <p className="mt-2 text-caption text-success inline-flex items-center gap-1">
              <Check className="h-3 w-3" /> Đã đẩy {compSources.length} URL + {compSeeds.length} seed vào hàng đợi. Theo dõi tiến độ ở Kỹ thuật &amp; lịch sử.
            </p>
          )}
        </div>
      )}
      {syncError && (
        <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-caption text-danger">{syncError}</p>
      )}

      {/* ── Pending approval section ─────────────────── */}
      {compSeeds.some((s) => s.pending_count > 0) && (
        <PendingSection
          seeds={compSeeds.filter((s) => s.pending_count > 0)}
          isAdmin={isAdmin}
          onChanged={onRefresh}
        />
      )}

      {/* ── Filter / search bar ────────────────────────────── */}
      {compSources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 px-3 py-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-quaternary pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo URL, tiêu đề, loại nguồn…"
              className="w-full rounded-md border border-[rgb(var(--border-line))] bg-surface-2/40 pl-8 pr-7 py-1.5 text-caption text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-brand/60 focus:bg-surface-1 transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-quaternary hover:text-text-primary p-0.5"
                title="Xóa tìm kiếm"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Status filter */}
          <FilterChipGroup
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as typeof statusFilter)}
            options={[
              { value: 'all', label: 'Tất cả', count: compSources.length },
              { value: 'active', label: 'Đang chạy', count: activeCount, dot: 'bg-success' },
              { value: 'paused', label: 'Tạm dừng', count: pausedCount, dot: 'bg-text-quaternary' },
            ]}
          />

          {/* Category filter */}
          <FilterChipGroup
            value={categoryFilter}
            onChange={(v) => setCategoryFilter(v as typeof categoryFilter)}
            options={[
              { value: 'all', label: 'Mọi loại' },
              { value: 'san_pham', label: 'Sản phẩm', count: catCounts.san_pham, dot: CAT_META.san_pham.dot },
              { value: 'khuyen_mai', label: 'Khuyến mại', count: catCounts.khuyen_mai, dot: CAT_META.khuyen_mai.dot },
              { value: 'other', label: 'Khác', count: catCounts.other, dot: CAT_META.other.dot },
            ]}
          />

          {/* Sort */}
          <div className="flex items-center gap-1">
            <Filter className="h-3 w-3 text-text-quaternary" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="rounded-md border border-[rgb(var(--border-line))] bg-surface-2/40 px-2 py-1 text-caption text-text-secondary focus:outline-none focus:border-brand/60 hover:bg-surface-2 transition-colors"
            >
              <option value="recent">Mới crawl trước</option>
              <option value="oldest">Cũ trước</option>
              <option value="az">A → Z</option>
            </select>
          </div>

          {filterActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption text-text-tertiary hover:bg-surface-2 hover:text-text-primary transition-colors"
            >
              <X className="h-3 w-3" />
              Xóa lọc
            </button>
          )}

          <span className="ml-auto text-caption text-text-quaternary tabular-nums">
            {filterActive ? `${filteredSources.length} / ${compSources.length}` : `${compSources.length} URL`}
          </span>
        </div>
      )}

      {/* ── Source list (flat, single container) ───────────── */}
      {filteredSources.length === 0 && compSources.length > 0 ? (
        <div className="rounded-lg border border-dashed border-[rgb(var(--border-line))] bg-surface-1 px-4 py-8 text-center">
          <p className="text-caption text-text-tertiary">Không có URL nào khớp bộ lọc.</p>
          {filterActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-2 text-caption text-brand hover:underline"
            >
              Xóa bộ lọc
            </button>
          )}
        </div>
      ) : (
      <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 divide-y divide-[rgb(var(--border-line))] overflow-hidden">
        {activeCats.map((cat) => {
          const m = CAT_META[cat];
          const srcs = grouped[cat];
          return (
            <div key={cat}>
              <div className="flex items-center gap-2 px-4 py-1.5 bg-surface-2/40 sticky top-0">
                <span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} />
                <span className="text-caption font-emphasis uppercase tracking-[0.06em] text-text-secondary">
                  {m.label}
                </span>
                <span className="text-caption text-text-quaternary tabular-nums">{srcs.length}</span>
              </div>
              <ul className="divide-y divide-[rgb(var(--border-line))]">
                {srcs.map((src) => {
                  const title = src.page_title?.trim() || pathOf(src.url);
                  const hasTitle = !!src.page_title?.trim();
                  const articleTime = getArticleTime(src);
                  return (
                    <li
                      key={src.id}
                      className={cn(
                        'group flex items-center gap-3 px-4 py-2 hover:bg-surface-2/30 transition-colors',
                        !src.is_active && 'opacity-60',
                      )}
                    >
                      <span className={cn(
                        'h-1.5 w-1.5 rounded-full flex-shrink-0',
                        src.is_active ? 'bg-success' : 'bg-text-quaternary',
                      )} />
                      <div className="min-w-0 flex-1">
                        <p className={cn(
                          'text-caption truncate',
                          hasTitle ? 'text-text-primary' : 'text-text-tertiary font-mono',
                          !src.is_active && 'line-through decoration-text-quaternary/50',
                        )}>
                          {title}
                          {!src.is_active && (
                            <span className="ml-2 inline-flex items-center rounded-md bg-surface-2 px-1.5 py-px text-caption text-text-quaternary no-underline">
                              Tạm dừng
                            </span>
                          )}
                        </p>
                        {hasTitle && (
                          <p className="text-caption text-text-quaternary truncate">{src.url}</p>
                        )}
                      </div>
                      <span
                        className="text-caption text-text-quaternary tabular-nums flex-shrink-0 whitespace-nowrap"
                        title={articleTime ? formatDateTime(articleTime) : undefined}
                      >
                        {articleTime ? formatRelative(articleTime) : '—'}
                      </span>
                      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-md p-1 text-text-quaternary hover:bg-surface-2 hover:text-brand transition-colors"
                          title="Mở trang"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleToggleSource(src)}
                              className="rounded-md p-1 text-text-quaternary hover:bg-surface-2 hover:text-text-primary transition-colors"
                              title={src.is_active ? 'Tạm dừng URL này' : 'Bật lại URL này'}
                            >
                              {src.is_active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDelete(src)}
                              className="rounded-md p-1 text-text-quaternary hover:bg-danger/10 hover:text-danger transition-colors"
                              title="Xóa URL"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      )}

      {/* ── Delete confirm dialog ──────────────────── */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => !deleting && setPendingDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 p-5 shadow-linear-popover"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 rounded-md bg-danger/10 p-2 text-danger">
                <Trash2 className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-caption font-emphasis text-text-primary">Xóa URL khỏi danh sách theo dõi?</p>
                <p className="mt-1 text-caption text-text-tertiary truncate">{pendingDelete.url}</p>
                <p className="mt-2 text-caption text-text-tertiary">
                  Toàn bộ bản chụp, lịch sử crawl và tín hiệu liên quan đến URL này sẽ bị xóa vĩnh viễn. Không thể hoàn tác.
                </p>
                <p className="mt-2 text-caption text-text-quaternary">
                  Nếu chỉ muốn tạm dừng, hãy dùng nút <Pause className="inline h-3 w-3 mx-0.5" /> thay vì xóa.
                </p>
              </div>
            </div>
            {deleteError && <p className="mt-3 text-caption text-danger">{deleteError}</p>}
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button size="xs" variant="secondary" onClick={() => setPendingDelete(null)} disabled={deleting}>
                Hủy
              </Button>
              <Button size="xs" variant="danger" loading={deleting} onClick={handleDeleteSource}>
                Xóa vĩnh viễn
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pipeline schedule modal ──────────────────────── */}
      {scheduleOpen && (
        <AppModalShell
          title="Cấu hình pipeline đồng bộ"
          description="Pipeline gồm 3 giai đoạn nối tiếp. Đặt tần suất cho mỗi giai đoạn để hệ thống tự chạy đúng nhịp bạn cần."
          size="lg"
          onClose={() => !savingSchedule && setScheduleOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setScheduleOpen(false)} disabled={savingSchedule}>
                Hủy
              </Button>
              <Button
                variant="primary"
                loading={savingSchedule}
                disabled={!scheduleDirty}
                leadingIcon={<Check className="h-3.5 w-3.5" />}
                onClick={handleSaveSchedule}
              >
                Áp dụng
              </Button>
            </>
          }
        >
          <PipelineDesigner
            schedule={schedule}
            seedsCount={compSeeds.length}
            sourcesCount={compSources.length}
            disabled={savingSchedule}
            onChange={setSchedule}
          />
          {scheduleError && (
            <p className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-caption text-danger">{scheduleError}</p>
          )}
          <div className="mt-4 flex items-start gap-2 rounded-md border border-[rgb(var(--border-line))] bg-surface-2/40 px-3 py-2.5">
            <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-text-quaternary" />
            <div className="text-caption text-text-tertiary space-y-1">
              <p>
                <span className="text-text-secondary font-emphasis">Thủ công:</span> hệ thống không tự chạy. Bạn phải tự bấm Chạy trong tab Kỹ thuật &amp; lịch sử.
              </p>
              <p>
                <span className="text-text-secondary font-emphasis">Định kỳ:</span> chạy sau mỗi N giờ tính từ lần crawl gần nhất. URL chưa từng crawl sẽ chạy lần đầu ngay khi được duyệt để có baseline.
              </p>
              <p>
                <span className="text-text-secondary font-emphasis">Cron:</span> đang xem trước, hệ thống tạm thời quy về Định kỳ gần nhất khi áp dụng.
              </p>
            </div>
          </div>
        </AppModalShell>
      )}
    </div>
  );
}

type FilterChipOption = {
  value: string;
  label: string;
  count?: number;
  dot?: string;
};

function FilterChipGroup({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (next: string) => void;
  options: FilterChipOption[];
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-[rgb(var(--border-line))] bg-surface-2/40 p-0.5">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2 py-0.5 text-caption transition-colors',
              active
                ? 'bg-surface-1 text-text-primary font-emphasis shadow-sm'
                : 'text-text-tertiary hover:text-text-primary',
            )}
          >
            {opt.dot && <span className={cn('h-1.5 w-1.5 rounded-full', opt.dot)} />}
            <span>{opt.label}</span>
            {opt.count !== undefined && (
              <span className="text-text-quaternary tabular-nums">{opt.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ScheduleSelector({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (hours: number) => void;
}) {
  return (
    <div>
      <p className="text-caption font-emphasis text-text-secondary mb-1.5">{label}</p>
      <div className="grid grid-cols-6 gap-1">
        {SCHEDULE_OPTIONS.map((hours) => {
          const active = value === hours;
          return (
            <button
              key={hours}
              type="button"
              disabled={disabled}
              onClick={() => onChange(hours)}
              className={cn(
                'rounded-md border px-1.5 py-1.5 text-caption transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                active
                  ? 'border-brand/40 bg-brand/10 text-brand font-emphasis'
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

// ──────────────────────────────────────────────────────────────────────────
// Pipeline designer — single unified cadence + auto-approve config
// ──────────────────────────────────────────────────────────────────────────
function PipelineDesigner({
  schedule,
  seedsCount,
  sourcesCount,
  disabled,
  onChange,
}: {
  schedule: ScheduleState;
  seedsCount: number;
  sourcesCount: number;
  disabled: boolean;
  onChange: (next: ScheduleState | ((prev: ScheduleState) => ScheduleState)) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* 1) Unified cadence */}
      <PipelineStage
        index={1}
        title="Lịch chạy chung"
        subtitle="Khám phá link mới & crawl các URL đã duyệt cùng nhịp"
        meta={`${seedsCount} seed · ${sourcesCount} URL`}
        accent="brand"
        editable
        mode={schedule.mode}
        hours={schedule.hours}
        cron={schedule.cron}
        disabled={disabled}
        onChangeMode={(m) => onChange((p) => ({ ...p, mode: m }))}
        onChangeHours={(h) => onChange((p) => ({ ...p, hours: h }))}
        onChangeCron={(c) => onChange((p) => ({ ...p, cron: c }))}
      />

      {/* 2) Read-only flow visualization */}
      <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2/30 p-3">
        <p className="text-caption text-text-quaternary mb-2">Mỗi chu kỳ chạy theo thứ tự:</p>
        <div className="flex flex-wrap items-center gap-2">
          <FlowChip tone="brand" index={1} label={`Khám phá (${seedsCount} seed)`} hint="Phát hiện link mới" />
          <ChevronRight className="h-3.5 w-3.5 text-text-quaternary" />
          <FlowChip tone="warning" index={2} label={`Crawl (${sourcesCount} URL)`} hint="Bao gồm cả URL cũ + URL mới đã duyệt" />
          <ChevronRight className="h-3.5 w-3.5 text-text-quaternary" />
          <FlowChip tone="success" index={3} label="Phân tích" hint="Tự động ngay sau crawl" />
        </div>
        <p className="mt-2 text-caption text-text-tertiary">
          Link mới phát hiện ở bước ① sẽ chờ duyệt (hoặc tự duyệt nếu bật bên dưới); link cũ vẫn được crawl &amp; phân tích bình thường ở cùng lượt.
        </p>
      </div>

      {/* 3) Auto-approve panel */}
      <AutoApprovePanel
        enabled={schedule.autoApprove}
        sourceTypes={schedule.autoSourceTypes}
        disabled={disabled}
        onToggle={(v) => onChange((p) => ({ ...p, autoApprove: v }))}
        onChangeSourceTypes={(t) => onChange((p) => ({ ...p, autoSourceTypes: t }))}
      />
    </div>
  );
}

function FlowChip({ tone, index, label, hint }: { tone: 'brand' | 'warning' | 'success'; index: number; label: string; hint: string }) {
  const toneClass: Record<string, string> = {
    brand: 'border-brand/30 bg-brand/10 text-brand',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    success: 'border-success/30 bg-success/10 text-success',
  };
  const dotClass = ACCENT_CLASS[tone].dot;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-caption font-emphasis', toneClass[tone])} title={hint}>
      <span className={cn('inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[10px] font-emphasis text-white', dotClass)}>{index}</span>
      {label}
    </span>
  );
}

function AutoApprovePanel({
  enabled,
  sourceTypes,
  disabled,
  onToggle,
  onChangeSourceTypes,
}: {
  enabled: boolean;
  sourceTypes: string[];
  disabled: boolean;
  onToggle: (next: boolean) => void;
  onChangeSourceTypes: (next: string[]) => void;
}) {
  const allSelected = sourceTypes.length === SOURCE_TYPES.length;
  function toggleType(t: string) {
    if (sourceTypes.includes(t)) onChangeSourceTypes(sourceTypes.filter((x) => x !== t));
    else onChangeSourceTypes([...sourceTypes, t]);
  }
  return (
    <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 p-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={disabled}
          onClick={() => onToggle(!enabled)}
          className={cn(
            'relative mt-0.5 inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors',
            enabled ? 'bg-brand' : 'bg-surface-2 border border-[rgb(var(--border-line))]',
            disabled && 'cursor-not-allowed opacity-60',
          )}
          title={enabled ? 'Tắt tự duyệt' : 'Bật tự duyệt link mới'}
        >
          <span className={cn('inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform', enabled ? 'translate-x-5' : 'translate-x-0.5')} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-caption font-emphasis text-text-primary inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-info" />
            Tự động duyệt link mới
          </p>
          <p className="text-caption text-text-tertiary mt-0.5">
            AI sẽ tự gán mỗi link mới vào 1 trong 6 loại nguồn cố định. Chỉ link có loại thuộc danh sách dưới đây được tự duyệt; loại khác vẫn chờ duyệt thủ công.
          </p>

          {enabled && (
            <div className="mt-2.5 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-caption text-text-tertiary">Loại nguồn được tự duyệt:</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChangeSourceTypes(allSelected ? [] : [...SOURCE_TYPES])}
                  className="text-caption text-brand hover:underline disabled:opacity-60"
                >
                  {allSelected ? 'Bỏ tất cả' : 'Chọn tất cả'}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SOURCE_TYPES.map((t) => {
                  const active = sourceTypes.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      role="checkbox"
                      aria-checked={active}
                      disabled={disabled}
                      onClick={() => toggleType(t)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-caption transition-colors',
                        active
                          ? 'border-brand/40 bg-brand/10 text-brand font-emphasis'
                          : 'border-[rgb(var(--border-line))] bg-surface-1 text-text-secondary hover:bg-surface-2',
                        disabled && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <span className={cn(
                        'inline-flex h-3 w-3 items-center justify-center rounded-sm border',
                        active ? 'border-brand bg-brand text-white' : 'border-[rgb(var(--border-strong))] bg-surface-1',
                      )}>
                        {active && <Check className="h-2.5 w-2.5" />}
                      </span>
                      {SOURCE_TYPE_LABELS[t] ?? t}
                    </button>
                  );
                })}
              </div>
              {sourceTypes.length === 0 && (
                <p className="text-caption text-warning inline-flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Chưa chọn loại nào — tự duyệt sẽ không áp dụng cho link nào.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PipelineArrow() {
  return (
    <div className="flex items-center justify-center text-text-quaternary py-0.5">
      <ChevronRight className="h-3.5 w-3.5 rotate-90" />
    </div>
  );
}

const ACCENT_CLASS: Record<'brand' | 'warning' | 'success', { dot: string }> = {
  brand:   { dot: 'bg-brand' },
  warning: { dot: 'bg-warning' },
  success: { dot: 'bg-success' },
};

const MODE_TABS: { value: ScheduleMode; label: string; description: string; icon: typeof Play }[] = [
  { value: 'manual',   label: 'Thủ công', description: 'Chỉ chạy khi bạn nhấn Chạy ngay.', icon: Hand },
  { value: 'interval', label: 'Định kỳ',  description: 'Lặp lại theo khoảng thời gian cố định.', icon: Repeat },
  { value: 'cron',     label: 'Cron',     description: 'Lịch theo biểu thức cron (xem trước).', icon: Calendar },
];

const MODE_META: Record<ScheduleMode | 'auto', { label: string; icon: typeof Play; toneClass: string; dotClass: string }> = {
  manual:   { label: 'Thủ công', icon: Hand,     toneClass: 'border-text-quaternary/30 bg-surface-2 text-text-secondary', dotClass: 'bg-text-quaternary' },
  interval: { label: 'Định kỳ',  icon: Repeat,   toneClass: 'border-success/30 bg-success/5 text-success',                  dotClass: 'bg-success' },
  cron:     { label: 'Cron',     icon: Calendar, toneClass: 'border-brand/30 bg-brand/5 text-brand',                        dotClass: 'bg-brand' },
  auto:     { label: 'Tự động',  icon: Sparkles, toneClass: 'border-warning/30 bg-warning/5 text-warning',                  dotClass: 'bg-warning' },
};

function ModeBadge({
  stageLabel,
  mode,
  hours,
  cron,
}: {
  stageLabel: string;
  mode: ScheduleMode | 'auto';
  hours?: number;
  cron?: string;
}) {
  const m = MODE_META[mode];
  const Icon = m.icon;
  let detail: string | null = null;
  if (mode === 'interval' && hours !== undefined) detail = `Mỗi ${formatHoursLabel(hours)}`;
  if (mode === 'cron' && cron) detail = cron;
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-caption text-text-quaternary">{stageLabel}</span>
      <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-caption font-emphasis', m.toneClass)}>
        <Icon className="h-3 w-3" />
        {m.label}
        {detail && (
          <>
            <span className="opacity-60">·</span>
            <span className="font-mono">{detail}</span>
          </>
        )}
      </span>
    </div>
  );
}

function PipelineStage({
  index,
  title,
  subtitle,
  meta,
  accent,
  editable,
  mode,
  hours,
  cron,
  disabled,
  onChangeMode,
  onChangeHours,
  onChangeCron,
}: {
  index: number;
  title: string;
  subtitle: string;
  meta: string;
  accent: 'brand' | 'warning' | 'success';
  editable: boolean;
  mode?: ScheduleMode;
  hours?: number;
  cron?: string;
  disabled?: boolean;
  onChangeMode?: (m: ScheduleMode) => void;
  onChangeHours?: (h: number) => void;
  onChangeCron?: (c: string) => void;
}) {
  const a = ACCENT_CLASS[accent];
  return (
    <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 p-3">
      {/* Header row: stage number + title + meta */}
      <div className="flex items-center gap-2">
        <span className={cn('inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-emphasis text-white', a.dot)}>
          {index}
        </span>
        <p className="text-caption font-emphasis text-text-primary">{title}</p>
        <span className="text-text-quaternary">·</span>
        <p className="text-caption text-text-tertiary truncate">{subtitle}</p>
        <span className="ml-auto text-caption text-text-quaternary tabular-nums">{meta}</span>
      </div>

      {editable && mode !== undefined && onChangeMode ? (
        <div className="mt-2.5 pt-2.5 border-t border-[rgb(var(--border-line))] flex flex-wrap items-center gap-2">
          {/* Compact segmented mode picker */}
          <div
            role="radiogroup"
            aria-label="Chế độ chạy"
            className="inline-flex items-center rounded-md border border-[rgb(var(--border-line))] bg-surface-2/40 p-0.5"
          >
            {MODE_TABS.map((t) => {
              const active = mode === t.value;
              const Icon = t.icon;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={t.description}
                  disabled={disabled}
                  onClick={() => onChangeMode(t.value)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded px-2 py-1 text-caption transition-colors',
                    active
                      ? 'bg-surface-1 text-text-primary font-emphasis shadow-sm'
                      : 'text-text-tertiary hover:text-text-primary',
                    disabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Inline config — sibling of mode picker, not nested */}
          {mode === 'interval' && hours !== undefined && onChangeHours && (
            <label className="inline-flex items-center gap-1.5 text-caption text-text-tertiary">
              Tần suất
              <select
                value={hours}
                disabled={disabled}
                onChange={(e) => onChangeHours(Number(e.target.value))}
                className="rounded-md border border-[rgb(var(--border-line))] bg-surface-1 px-2 py-1 text-caption font-emphasis text-text-primary focus:outline-none focus:border-brand/60 disabled:opacity-60"
              >
                {SCHEDULE_OPTIONS.map((h) => (
                  <option key={h} value={h}>Mỗi {formatHoursLabel(h)}</option>
                ))}
              </select>
            </label>
          )}

          {mode === 'cron' && onChangeCron && (
            <label className="inline-flex items-center gap-1.5 text-caption text-text-tertiary flex-1 min-w-[180px]">
              Cron
              <input
                type="text"
                value={cron ?? ''}
                disabled={disabled}
                onChange={(e) => onChangeCron(e.target.value)}
                placeholder="0 9 * * 1-5"
                className="flex-1 rounded-md border border-[rgb(var(--border-line))] bg-surface-1 px-2 py-1 text-caption font-mono text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-brand/60 disabled:opacity-60"
              />
              <span className="inline-flex items-center gap-1 text-warning whitespace-nowrap" title="Cron đang ở giai đoạn xem trước">
                <Info className="h-3 w-3" />
                xem trước
              </span>
            </label>
          )}

          {mode === 'manual' && (
            <span className="text-caption text-text-tertiary">
              Không tự chạy · dùng <span className="text-text-secondary font-emphasis">Chạy ngay</span>.
            </span>
          )}
        </div>
      ) : (
        <div className="mt-2 pt-2 border-t border-[rgb(var(--border-line))] text-caption text-text-tertiary italic">
          Chạy tự động ngay sau khi có dữ liệu crawl mới.
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Pending approval section
// ──────────────────────────────────────────────────────────────────────────
function PendingSection({
  seeds,
  isAdmin,
  onChanged,
}: {
  seeds: Seed[];
  isAdmin: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [openId, setOpenId] = useState<string | null>(seeds[0]?.id ?? null);
  const totalPending = seeds.reduce((sum, s) => sum + s.pending_count, 0);

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/5 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-warning/10 border-b border-warning/20">
        <Sparkles className="h-3.5 w-3.5 text-warning" />
        <span className="text-caption font-emphasis text-warning">
          {totalPending} URL chờ duyệt
        </span>
        <span className="text-caption text-text-tertiary">
          AI đã quét và đề xuất các trang đáng theo dõi. Duyệt để bắt đầu crawl định kỳ.
        </span>
      </div>
      <ul className="divide-y divide-[rgb(var(--border-line))]">
        {seeds.map((seed) => (
          <PendingSeedRow
            key={seed.id}
            seed={seed}
            isOpen={openId === seed.id}
            isAdmin={isAdmin}
            onToggle={() => setOpenId(openId === seed.id ? null : seed.id)}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </div>
  );
}

function PendingSeedRow({
  seed,
  isOpen,
  isAdmin,
  onToggle,
  onChanged,
}: {
  seed: Seed;
  isOpen: boolean;
  isAdmin: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [links, setLinks] = useState<SeedLink[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<Record<string, 'approve' | 'reject' | undefined>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || links !== null) return;
    setLoading(true);
    api.getSeedLinks(seed.id, 'pending')
      .then((res) => {
        const all: SeedLink[] = [];
        for (const arr of Object.values(res.grouped ?? {})) all.push(...(arr as SeedLink[]));
        setLinks(all);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Không tải được danh sách link'))
      .finally(() => setLoading(false));
  }, [isOpen, links, seed.id]);

  async function handleApproveOne(linkId: string) {
    if (!isAdmin) return;
    setBusy((b) => ({ ...b, [linkId]: 'approve' }));
    try {
      await api.approveLinks(seed.id, { link_ids: [linkId] });
      setLinks((prev) => prev?.filter((l) => l.id !== linkId) ?? null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không duyệt được link');
    } finally {
      setBusy((b) => ({ ...b, [linkId]: undefined }));
    }
  }

  async function handleRejectOne(linkId: string) {
    if (!isAdmin) return;
    setBusy((b) => ({ ...b, [linkId]: 'reject' }));
    try {
      await api.rejectLinks(seed.id, { link_ids: [linkId] });
      setLinks((prev) => prev?.filter((l) => l.id !== linkId) ?? null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không bỏ được link');
    } finally {
      setBusy((b) => ({ ...b, [linkId]: undefined }));
    }
  }

  async function handleApproveAll() {
    if (!isAdmin || !links?.length) return;
    setBusy((b) => ({ ...b, __all__: 'approve' }));
    try {
      await api.approveLinks(seed.id, { link_ids: links.map((l) => l.id) });
      setLinks([]);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không duyệt được');
    } finally {
      setBusy((b) => ({ ...b, __all__: undefined }));
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2 hover:bg-warning/5 transition-colors text-left"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 text-text-quaternary flex-shrink-0 transition-transform', isOpen && 'rotate-90')} />
        <div className="min-w-0 flex-1">
          <p className="text-caption text-text-primary truncate">{seed.label || seed.seed_url}</p>
          <p className="text-caption text-text-quaternary truncate">{seed.seed_url}</p>
        </div>
        <span className="text-caption font-emphasis text-warning tabular-nums flex-shrink-0">
          {seed.pending_count}
        </span>
      </button>
      {isOpen && (
        <div className="border-t border-[rgb(var(--border-line))] bg-surface-1">
          {loading && (
            <p className="px-4 py-3 text-caption text-text-tertiary">Đang tải danh sách link…</p>
          )}
          {error && (
            <p className="px-4 py-2 text-caption text-danger">{error}</p>
          )}
          {!loading && links && links.length === 0 && (
            <p className="px-4 py-3 text-caption text-text-tertiary">Không còn link nào chờ duyệt.</p>
          )}
          {!loading && links && links.length > 0 && (
            <>
              {isAdmin && (
                <div className="flex items-center justify-between gap-2 px-4 py-1.5 border-b border-[rgb(var(--border-line))] bg-surface-2/40">
                  <span className="text-caption text-text-tertiary">{links.length} link đang chờ</span>
                  <Button
                    size="xs"
                    variant="primary"
                    leadingIcon={<Check className="h-3 w-3" />}
                    loading={busy.__all__ === 'approve'}
                    onClick={handleApproveAll}
                  >
                    Duyệt tất cả
                  </Button>
                </div>
              )}
              <ul className="divide-y divide-[rgb(var(--border-line))]">
                {links.map((link) => (
                  <li key={link.id} className="group flex items-start gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-caption text-text-primary hover:text-brand inline-flex items-center gap-1 max-w-full"
                      >
                        <span className="truncate">{link.link_text || pathOf(link.url)}</span>
                        <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-0 group-hover:opacity-100" />
                      </a>
                      <p className="text-caption text-text-quaternary truncate">{link.url}</p>
                      {link.ai_reason && (
                        <p className="mt-0.5 text-caption text-text-tertiary italic">
                          AI: {link.ai_reason}
                        </p>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleApproveOne(link.id)}
                          disabled={!!busy[link.id]}
                          title="Duyệt"
                          className="rounded-md p-1 text-success hover:bg-success/10 transition-colors disabled:opacity-40"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRejectOne(link.id)}
                          disabled={!!busy[link.id]}
                          title="Bỏ qua"
                          className="rounded-md p-1 text-text-quaternary hover:bg-danger/10 hover:text-danger transition-colors disabled:opacity-40"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </li>
  );
}
