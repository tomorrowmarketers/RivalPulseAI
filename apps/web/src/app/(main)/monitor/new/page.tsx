'use client';

import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, CheckSquare, ChevronDown, ChevronUp, Clock3, ExternalLink, Globe,
  Loader2, Search, Settings2, Sparkles, Square,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SegmentTagPicker } from '@/components/monitor/SegmentTagPicker';
import { api } from '@/lib/api';
import type { MarketSegment } from '@/lib/marketSegments';
import { cn } from '@/lib/utils';

interface DiscoveredLink {
  id?: string;
  url: string;
  link_text: string;
  page_title?: string;
  ai_reason?: string;
  category: string;
}

const CATEGORIES = ['san_pham', 'khuyen_mai', 'other'] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_LABELS: Record<Category, string> = {
  san_pham: 'Sản phẩm',
  khuyen_mai: 'Khuyến mãi',
  other: 'Khác',
};

const CATEGORY_TONES: Record<Category, 'brand' | 'success' | 'warning' | 'neutral'> = {
  san_pham: 'brand',
  khuyen_mai: 'warning',
  other: 'neutral',
};

const CATEGORY_DESCRIPTION: Record<Category, string> = {
  san_pham: 'Trang khóa học, giá cả, sản phẩm, dịch vụ',
  khuyen_mai: 'Ưu đãi, học bổng, khuyến mãi',
  other: 'Blog, tin tức, trang khác',
};

const AUTO_SELECT_CATEGORIES: Category[] = ['san_pham', 'khuyen_mai'];
const SCHEDULE_OPTIONS = [6, 12, 24, 48, 72, 168] as const;

const PIPELINE_STEPS: Array<{ label: string; description: string; icon: LucideIcon }> = [
  { label: 'Thiết lập đối thủ', description: 'Tên, domain và ngữ cảnh thị trường', icon: Globe },
  { label: 'Quét liên kết nội bộ', description: 'Mở trang gốc và tìm URL liên quan', icon: Search },
  { label: 'AI nhóm nguồn', description: 'Ưu tiên trang sản phẩm, ưu đãi và tin tức', icon: Sparkles },
  { label: 'Chọn nguồn và lịch', description: 'Chốt URL theo dõi và lịch crawl tự động', icon: Clock3 },
];

function normalizeDomain(value: string) {
  return value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
}

function buildSeedUrl(domain: string) {
  return `https://${normalizeDomain(domain)}`;
}

function discoveryStreamUrl(seedUrl: string) {
  // Use same origin so the request goes through Nginx/Next.js proxy (/api/* rewrite)
  const base = process.env.NEXT_PUBLIC_API_ORIGIN
    || `${window.location.protocol}//${window.location.host}`;
  return `${base}/api/discovery/preview-stream?seed_url=${encodeURIComponent(seedUrl)}`;
}

function hostOf(value: string) {
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return normalizeDomain(value).replace(/^www\./, '');
  }
}

function flattenGrouped(grouped: Record<string, DiscoveredLink[]>) {
  return CATEGORIES.flatMap((cat) => grouped[cat] ?? []);
}

function formatHoursLabel(hours: number) {
  if (hours % 24 === 0 && hours >= 24) {
    const days = hours / 24;
    return days === 1 ? '24 giờ' : `${days} ngày`;
  }
  return `${hours} giờ`;
}

function getCurrentStage(step: 'info' | 'select', busy: boolean, busyLabel: string, progressLogs: string[]) {
  if (step === 'select') return 3;
  if (!busy) return 0;
  const latest = progressLogs[progressLogs.length - 1] || busyLabel;
  if (latest.includes('AI đang nhóm') || latest.includes('Đang nhóm')) return 2;
  return 1;
}

export default function NewCompetitorPage() {
  const router = useRouter();
  const [step, setStep] = useState<'info' | 'select'>('info');
  const [info, setInfo] = useState<{ name: string; primary_domain: string; segment: MarketSegment | ''; }>({ name: '', primary_domain: '', segment: '' });
  const [schedule, setSchedule] = useState({ discoveryHours: 24, crawlHours: 48 });
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [progressLogs, setProgressLogs] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [grouped, setGrouped] = useState<Record<string, DiscoveredLink[]>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const previewSourceRef = useRef<EventSource | null>(null);

  useEffect(() => () => previewSourceRef.current?.close(), []);

  function appendProgress(message: string) {
    setProgressLogs((prev) => {
      if (prev[prev.length - 1] === message) return prev;
      return [...prev, message].slice(-12);
    });
  }

  async function handleStartScan() {
    const domain = normalizeDomain(info.primary_domain);
    const seedUrl = buildSeedUrl(domain);
    if (!info.name.trim() || !domain) { setError('Vui lòng nhập tên và domain.'); return; }
    setError('');
    setBusy(true);
    setBusyLabel('Đang mở trang và nhóm các URL quan trọng...');
    setProgressLogs([`Bắt đầu quét từ ${seedUrl}`]);
    try {
      const seedsRes = await api.getDiscoverySeeds();
      const existingSeed = seedsRes.items.find((item) => hostOf(item.seed_url) === hostOf(seedUrl));
      if (existingSeed) {
        throw new Error(`Domain này đã được theo dõi bởi ${existingSeed.competitor_name || 'một đối thủ khác'}.`);
      }

      await new Promise<void>((resolve, reject) => {
        previewSourceRef.current?.close();
        const stream = new EventSource(discoveryStreamUrl(seedUrl), { withCredentials: true });
        previewSourceRef.current = stream;
        let finished = false;

        stream.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data) as {
              type?: string;
              message?: string;
              grouped?: Record<string, DiscoveredLink[]>;
            };
            if (payload.type === 'log' && payload.message) {
              appendProgress(payload.message);
              setBusyLabel(payload.message);
              return;
            }
            if (payload.type === 'error') {
              finished = true;
              stream.close();
              previewSourceRef.current = null;
              reject(new Error(payload.message || 'Không quét được domain.'));
              return;
            }
            if (payload.type === 'result') {
              const nextGrouped = payload.grouped ?? {};
              setGrouped(nextGrouped);
              const auto = new Set<string>();
              AUTO_SELECT_CATEGORIES.forEach((cat) => {
                (nextGrouped[cat] ?? []).forEach((link) => auto.add(link.url));
              });
              setSelected(auto);
              setStep('select');
              finished = true;
              stream.close();
              previewSourceRef.current = null;
              resolve();
            }
          } catch {
            // Ignore malformed stream chunks and keep listening.
          }
        };

        stream.onerror = () => {
          if (finished) return;
          stream.close();
          previewSourceRef.current = null;
          reject(new Error('Không quét được domain.'));
        };
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra.');
    } finally { setBusy(false); setBusyLabel(''); }
  }

  async function handleFinalize() {
    if (selected.size === 0) { setError('Vui lòng chọn ít nhất 1 trang để theo dõi.'); return; }
    const domain = normalizeDomain(info.primary_domain);
    const seedUrl = buildSeedUrl(domain);
    setBusy(true);
    setBusyLabel('Đang lưu đối thủ và danh sách trang...');
    setError('');
    let createdCompetitorId = '';
    try {
      const compRes = await api.createCompetitor({
        name: info.name.trim(),
        primary_domain: domain,
        segment: info.segment.trim() || undefined,
      } as Record<string, unknown>) as { item: { id: string } };
      createdCompetitorId = compRes.item.id;

      const discoveredLinks = flattenGrouped(grouped).map((link) => ({
        url: link.url,
        link_text: link.link_text,
        page_title: link.page_title ?? null,
        ai_reason: link.ai_reason ?? '',
        category: link.category,
      }));

      const seedRes = await api.createDiscoverySeed({
        competitor_id: createdCompetitorId,
        seed_url: seedUrl,
        scan_frequency_hours: schedule.discoveryHours,
        auto_approve_new_links: false,
        auto_source_type: 'other',
        auto_crawl_frequency_hours: schedule.crawlHours,
        discovered_links: discoveredLinks,
      }) as { item: { id: string } };

      const linksRes = await api.getSeedLinks(seedRes.item.id) as { grouped: Record<string, DiscoveredLink[]> };
      const selectedIds = flattenGrouped(linksRes.grouped)
        .filter((link) => !!link.id && selected.has(link.url))
        .map((link) => link.id as string);

      if (!selectedIds.length) {
        throw new Error('Không tìm thấy các trang đã chọn sau khi lưu seed.');
      }

      await api.finalizeSeed(seedRes.item.id, { selected_ids: selectedIds, crawl_frequency_hours: schedule.crawlHours });
      router.push(`/monitor/${createdCompetitorId}?tab=overview`);
    } catch (err: unknown) {
      if (createdCompetitorId) {
        await api.deleteCompetitor(createdCompetitorId).catch(() => undefined);
      }
      setError(err instanceof Error ? err.message : 'Không lưu được cài đặt.');
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }

  function toggleLink(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url); else next.add(url);
      return next;
    });
  }

  function selectAll(cat: Category) {
    setSelected((prev) => {
      const next = new Set(prev);
      (grouped[cat] ?? []).forEach((link) => next.add(link.url));
      return next;
    });
  }

  function deselectAll(cat: Category) {
    setSelected((prev) => {
      const next = new Set(prev);
      (grouped[cat] ?? []).forEach((link) => next.delete(link.url));
      return next;
    });
  }

  const totalFound = flattenGrouped(grouped).length;
  const normalizedDomain = normalizeDomain(info.primary_domain);
  const previewSeedUrl = normalizedDomain ? buildSeedUrl(normalizedDomain) : 'Chưa có domain';
  const currentStage = getCurrentStage(step, busy, busyLabel, progressLogs);
  const actionLabel = busy ? 'Đang lưu...' : `Bắt đầu theo dõi (${selected.size} trang)`;

  return (
    <div className="w-full px-4 py-5 text-caption xl:px-8">
      <Link href="/monitor" className="inline-flex items-center gap-1.5 text-caption font-emphasis text-text-tertiary hover:text-brand transition-colors mb-5">
        <ArrowLeft className="h-4 w-4" /> Quay lại
      </Link>

      {error && (
        <div className="mb-4 rounded-md border border-danger/20 bg-danger/5 px-3 py-2.5 text-caption text-danger">{error}</div>
      )}

      {/* ── STEP 1: form ── */}
      {step === 'info' && !busy && (
        <div className="w-full">
          <StepProgressBar activeIndex={0} />

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_400px]">
            {/* Left: main form */}
            <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-sm">
              <div className="px-5 pt-5 pb-4 border-b border-[rgb(var(--border-line))]">
                <h1 className="text-caption font-emphasis text-text-primary">Thêm đối thủ mới</h1>
                <p className="mt-0.5 text-caption text-text-tertiary">Nhập thông tin cơ bản để pipeline tự động quét và nhóm các trang quan trọng.</p>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Tên đối thủ" required>
                    <Input
                      size="sm"
                      autoFocus
                      value={info.name}
                      onChange={(e) => setInfo({ ...info, name: e.target.value })}
                      placeholder="Ví dụ: MindX Education"
                      onKeyDown={(e) => e.key === 'Enter' && handleStartScan()}
                    />
                  </Field>

                  <Field label="Domain chính" required>
                    <div className="relative">
                      <Globe className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-quaternary pointer-events-none" />
                      <Input
                        size="sm"
                        value={info.primary_domain}
                        onChange={(e) => setInfo({ ...info, primary_domain: e.target.value })}
                        placeholder="mindx.edu.vn"
                        className="pl-7"
                        onKeyDown={(e) => e.key === 'Enter' && handleStartScan()}
                      />
                    </div>
                    <p className="text-caption text-text-quaternary">Không cần nhập https://</p>
                  </Field>
                </div>

                <Field label="Phân khúc thị trường">
                  <SegmentTagPicker value={info.segment} onChange={(segment) => setInfo({ ...info, segment })} disabled={busy} />
                </Field>
              </div>

              <div className="px-5 pb-5 flex items-center justify-between gap-3">
                <p className="text-caption text-text-quaternary">
                  Crawl mỗi {formatHoursLabel(schedule.discoveryHours)} · nội dung mỗi {formatHoursLabel(schedule.crawlHours)}
                </p>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleStartScan}
                  disabled={!info.name.trim() || !info.primary_domain.trim()}
                >
                  Bắt đầu quét →
                </Button>
              </div>
            </div>

            {/* Right: schedule + pipeline preview */}
            <div className="flex flex-col gap-3">
              <ScheduleAccordion
                discoveryHours={schedule.discoveryHours}
                crawlHours={schedule.crawlHours}
                disabled={false}
                onDiscoveryChange={(hours) => setSchedule((prev) => ({ ...prev, discoveryHours: hours }))}
                onCrawlChange={(hours) => setSchedule((prev) => ({ ...prev, crawlHours: hours }))}
              />

              {/* Pipeline preview card */}
              <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-sm p-4">
                <p className="text-caption font-emphasis text-text-secondary mb-3">Pipeline tự động</p>
                <ol className="space-y-3">
                  {PIPELINE_STEPS.map((s, i) => {
                    const Icon = s.icon;
                    return (
                      <li key={s.label} className="flex items-start gap-2.5">
                        <span className={cn('mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-emphasis', i === 0 ? 'bg-brand/15 text-brand' : 'bg-surface-2 text-text-quaternary')}>
                          <Icon className="h-2.5 w-2.5" />
                        </span>
                        <div className="min-w-0">
                          <p className={cn('text-caption font-emphasis', i === 0 ? 'text-text-primary' : 'text-text-secondary')}>{s.label}</p>
                          <p className="text-caption text-text-quaternary">{s.description}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 1: scanning ── */}
      {step === 'info' && busy && (
        <div className="w-full">
          <StepProgressBar activeIndex={currentStage} busy />

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_400px]">
            {/* Left: progress log */}
            <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-sm p-5">
              <div className="flex items-center gap-3 mb-4">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </span>
                <div>
                  <p className="text-caption font-emphasis text-text-primary">{busyLabel}</p>
                  <p className="text-caption text-text-tertiary">{previewSeedUrl}</p>
                </div>
              </div>

              <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2/30 p-3 max-h-[400px] overflow-y-auto">
                {progressLogs.length === 0 ? (
                  <p className="text-caption text-text-quaternary italic">Đang khởi động...</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {progressLogs.map((log, index) => {
                      const isLast = index === progressLogs.length - 1;
                      return (
                        <div key={`${index}-${log}`} className={cn('flex items-start gap-2 text-caption', isLast ? 'text-text-primary' : 'text-text-quaternary')}>
                          <span className={cn('mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full', isLast ? 'bg-brand' : 'bg-border-line')} />
                          <span className="break-words leading-5">{log}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right: pipeline steps progress */}
            <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-sm p-4">
              <p className="text-caption font-emphasis text-text-secondary mb-3">Pipeline đang chạy</p>
              <ol className="space-y-3">
                {PIPELINE_STEPS.map((s, i) => {
                  const Icon = s.icon;
                  const done = i < currentStage;
                  const active = i === currentStage;
                  const loading = busy && active;
                  return (
                    <li key={s.label} className="flex items-start gap-2.5">
                      <span className={cn('mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full', done ? 'bg-brand/15 text-brand' : active ? 'bg-brand/15 text-brand' : 'bg-surface-2 text-text-quaternary')}>
                        {done ? <CheckCircle2 className="h-2.5 w-2.5" /> : loading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Icon className="h-2.5 w-2.5" />}
                      </span>
                      <div className="min-w-0">
                        <p className={cn('text-caption font-emphasis', done || active ? 'text-text-primary' : 'text-text-quaternary')}>{s.label}</p>
                        <p className="text-caption text-text-quaternary">{s.description}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: source selection ── */}
      {step === 'select' && (
        <div>
          {/* Sticky action bar */}
          <div className="sticky top-0 z-20 -mx-4 xl:-mx-8 mb-4">
            <div className="border-b border-[rgb(var(--border-line))] bg-surface-1/95 px-4 py-3 backdrop-blur xl:px-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <StepProgressBar activeIndex={3} inline />
                  <span className="hidden sm:block h-4 w-px bg-[rgb(var(--border-line))]" />
                  <span className="text-caption text-text-tertiary">
                    Tìm thấy <strong className="text-text-primary">{totalFound}</strong> trang
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-caption text-text-secondary">
                    Đã chọn <strong className={cn(selected.size === 0 ? 'text-text-quaternary' : 'text-brand')}>{selected.size}</strong>/{totalFound}
                  </span>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={handleFinalize}
                    disabled={busy || selected.size === 0}
                  >
                    {actionLabel}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Schedule summary row */}
          <div className="mb-3 flex items-center gap-2 px-1">
            <Clock3 className="h-3.5 w-3.5 text-text-quaternary shrink-0" />
            <span className="text-caption text-text-tertiary">
              Quét link mới mỗi <strong className="text-text-secondary">{formatHoursLabel(schedule.discoveryHours)}</strong>
              {' · '}Crawl lại mỗi <strong className="text-text-secondary">{formatHoursLabel(schedule.crawlHours)}</strong>
            </span>
          </div>

          {/* Category sections */}
          <div className="space-y-2 pb-6">
            {CATEGORIES.map((cat) => {
              const links = grouped[cat] ?? [];
              if (!links.length) return null;
              return (
                <CategorySection
                  key={cat}
                  cat={cat}
                  links={links}
                  selected={selected}
                  onToggle={toggleLink}
                  onSelectAll={() => selectAll(cat)}
                  onDeselectAll={() => deselectAll(cat)}
                />
              );
            })}
          </div>

          {/* Mobile sticky bottom bar — only shown on truly small screens where top bar wraps */}
          <div className="fixed bottom-0 left-0 right-0 z-30 sm:hidden border-t border-[rgb(var(--border-line))] bg-surface-1/95 px-4 py-3 backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <p className="text-caption text-text-secondary">
                <strong className={cn(selected.size === 0 ? 'text-text-quaternary' : 'text-brand')}>{selected.size}</strong>/{totalFound} trang đã chọn
              </p>
              <Button size="sm" variant="primary" onClick={handleFinalize} disabled={busy || selected.size === 0}>
                {actionLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Horizontal step progress bar */
function StepProgressBar({ activeIndex, busy, inline }: { activeIndex: number; busy?: boolean; inline?: boolean }) {
  if (inline) {
    const step = PIPELINE_STEPS[activeIndex];
    const Icon = step?.icon ?? CheckCircle2;
    return (
      <div className="flex items-center gap-1.5 text-caption font-emphasis text-brand">
        <Icon className="h-3.5 w-3.5" />
        <span>{step?.label}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      {PIPELINE_STEPS.map((step, index) => {
        const Icon = step.icon;
        const done = index < activeIndex;
        const active = index === activeIndex;
        const loading = busy && active;
        return (
          <div key={step.label} className="flex items-center gap-1 flex-1 min-w-0">
            <div className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-emphasis transition-colors',
              done ? 'bg-brand/10 text-brand' : active ? 'bg-brand/10 text-brand' : 'bg-surface-2 text-text-quaternary',
            )}>
              {done ? (
                <CheckCircle2 className="h-3 w-3 shrink-0" />
              ) : loading ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              ) : (
                <Icon className="h-3 w-3 shrink-0" />
              )}
              <span className={cn('truncate', index > 0 && !active && !done && 'hidden sm:inline')}>
                {step.label}
              </span>
            </div>
            {index < PIPELINE_STEPS.length - 1 && (
              <div className={cn('h-px flex-1 transition-colors', done ? 'bg-brand/30' : 'bg-[rgb(var(--border-line))]')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Collapsible schedule accordion inside the form */
function ScheduleAccordion({
  discoveryHours,
  crawlHours,
  disabled,
  onDiscoveryChange,
  onCrawlChange,
}: {
  discoveryHours: number;
  crawlHours: number;
  disabled: boolean;
  onDiscoveryChange: (hours: number) => void;
  onCrawlChange: (hours: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-[rgb(var(--border-line))] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-caption font-emphasis text-text-secondary hover:bg-surface-2/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings2 className="h-3.5 w-3.5 text-text-quaternary" />
          <span>Lịch crawl tự động</span>
          <span className="font-normal text-text-quaternary">
            — {formatHoursLabel(discoveryHours)} · {formatHoursLabel(crawlHours)}
          </span>
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-text-quaternary" /> : <ChevronDown className="h-3.5 w-3.5 text-text-quaternary" />}
      </button>

      {open && (
        <div className="border-t border-[rgb(var(--border-line))] bg-surface-2/20 px-3 py-3 grid gap-4 sm:grid-cols-2">
          <ScheduleSelector label="Quét link mới" value={discoveryHours} disabled={disabled} onChange={onDiscoveryChange} />
          <ScheduleSelector label="Crawl lại nội dung" value={crawlHours} disabled={disabled} onChange={onCrawlChange} />
        </div>
      )}
    </div>
  );
}

/** Collapsible category section in step 2 */
function CategorySection({
  cat,
  links,
  selected,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: {
  cat: Category;
  links: DiscoveredLink[];
  selected: Set<string>;
  onToggle: (url: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const selCount = links.filter((link) => selected.has(link.url)).length;
  const allSel = selCount === links.length;

  return (
    <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-sm">
      {/* Category header */}
      <div className="flex items-center gap-3 border-b border-[rgb(var(--border-line))] bg-surface-2/50 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
        >
          {collapsed ? <ChevronDown className="h-3.5 w-3.5 text-text-quaternary shrink-0" /> : <ChevronUp className="h-3.5 w-3.5 text-text-quaternary shrink-0" />}
          <Badge tone={CATEGORY_TONES[cat]} size="md">{CATEGORY_LABELS[cat]}</Badge>
          <span className="text-caption text-text-tertiary">{links.length} trang</span>
          <span className="hidden text-caption text-text-quaternary sm:inline truncate">— {CATEGORY_DESCRIPTION[cat]}</span>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <span className={cn('text-caption font-emphasis tabular-nums', selCount > 0 ? 'text-brand' : 'text-text-quaternary')}>
            {selCount}/{links.length}
          </span>
          <button
            type="button"
            onClick={() => (allSel ? onDeselectAll() : onSelectAll())}
            className="text-caption font-emphasis text-brand hover:text-brand/70 transition-colors"
          >
            {allSel ? 'Bỏ tất cả' : 'Chọn tất cả'}
          </button>
        </div>
      </div>

      {/* URL list */}
      {!collapsed && (
        <ul className="divide-y divide-[rgb(var(--border-line))]">
          {links.map((link) => {
            const checked = selected.has(link.url);
            return (
              <li
                key={link.url}
                onClick={() => onToggle(link.url)}
                className={cn(
                  'flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors',
                  checked ? 'bg-brand/3 hover:bg-brand/5' : 'hover:bg-surface-2/40',
                )}
              >
                <div className="shrink-0">
                  {checked
                    ? <CheckSquare className="h-4 w-4 text-brand" />
                    : <Square className="h-4 w-4 text-text-quaternary" />}
                </div>

                <div className="min-w-0 flex-1">
                  {link.page_title
                    ? (
                      <>
                        <p className="text-caption font-emphasis text-text-primary truncate leading-5">{link.page_title}</p>
                        <p className="text-caption text-text-quaternary truncate">{link.url}</p>
                      </>
                    )
                    : <p className="text-caption font-emphasis text-text-primary truncate">{link.url}</p>
                  }
                  {link.ai_reason && (
                    <p className="text-caption italic text-text-quaternary truncate">{link.ai_reason}</p>
                  )}
                </div>

                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 text-text-quaternary hover:text-brand transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-caption font-emphasis text-text-primary flex items-center gap-1">
        {label}{required && <span className="text-danger">*</span>}
      </label>
      {children}
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
      <p className="mb-2 text-caption font-emphasis text-text-secondary">{label}</p>
      <div className="grid grid-cols-3 gap-1.5">
        {SCHEDULE_OPTIONS.map((hours) => {
          const active = value === hours;
          return (
            <button
              key={hours}
              type="button"
              disabled={disabled}
              onClick={() => onChange(hours)}
              className={cn('rounded-md border px-2 py-2 text-caption font-emphasis transition-colors disabled:cursor-not-allowed disabled:opacity-60', active ? 'border-brand/40 bg-brand/8 text-brand' : 'border-[rgb(var(--border-line))] bg-surface-2/40 text-text-secondary hover:bg-surface-2')}
            >
              {formatHoursLabel(hours)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
