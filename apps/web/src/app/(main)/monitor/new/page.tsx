'use client';

import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, CheckSquare, Clock3, ExternalLink, Globe, Loader2, Search, Sparkles, Square,
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
  const base = process.env.NEXT_PUBLIC_API_ORIGIN
    || `${window.location.protocol}//${window.location.hostname}:8410`;
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
    <div className="mx-auto max-w-6xl px-4 py-5 text-caption xl:px-8">
      <Link href="/monitor" className="inline-flex items-center gap-1.5 text-caption font-emphasis text-text-tertiary hover:text-brand transition-colors mb-4">
        <ArrowLeft className="h-4 w-4" /> Quay lại danh sách đối thủ
      </Link>
      <header className="mb-4 space-y-1">
        <p className="text-caption font-emphasis uppercase tracking-[0.16em] text-text-tertiary">Thiết lập pipeline theo dõi</p>
        <h1 className="text-caption font-emphasis text-text-primary">Thêm đối thủ mới</h1>
        <p className="max-w-3xl text-caption text-text-tertiary">Nhập domain, theo dõi tiến trình quét theo thời gian thực, rồi chốt nguồn và lịch crawl tự động ngay trong cùng một màn.</p>
      </header>
      {error && <div className="mb-5 rounded-md border border-danger/20 bg-danger/5 px-3 py-2.5 text-caption text-danger">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-6 self-start">
          <PipelinePanel
            activeIndex={currentStage}
            busy={busy}
            step={step}
            totalFound={totalFound}
            selectedCount={selected.size}
          />

          <SchedulePanel
            discoveryHours={schedule.discoveryHours}
            crawlHours={schedule.crawlHours}
            disabled={busy}
            onDiscoveryChange={(hours) => setSchedule((prev) => ({ ...prev, discoveryHours: hours }))}
            onCrawlChange={(hours) => setSchedule((prev) => ({ ...prev, crawlHours: hours }))}
          />

          {step === 'select' && (
            <div className="hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4 shadow-linear-sm lg:block">
              <p className="text-caption font-emphasis text-text-primary">Tạo pipeline theo dõi</p>
              <p className="mt-1 text-caption text-text-tertiary">Nguồn đã chọn sẽ crawl lại mỗi {formatHoursLabel(schedule.crawlHours)}. Hệ thống cũng quét link mới mỗi {formatHoursLabel(schedule.discoveryHours)}.</p>
              <Button className="mt-3 w-full" size="sm" variant="primary" onClick={handleFinalize} disabled={busy || selected.size === 0}>
                {actionLabel}
              </Button>
            </div>
          )}
        </aside>

        <section className="min-w-0">
          {step === 'info' && !busy && (
            <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4 shadow-linear-sm sm:p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[rgb(var(--border-line))] pb-4">
                <div>
                  <p className="text-caption font-emphasis text-text-primary">1. Nhập thông tin đầu vào</p>
                  <p className="mt-1 text-caption text-text-tertiary">Pipeline sẽ chạy theo 4 bước cố định: quét link, nhóm bằng AI, chọn nguồn và chốt lịch crawl.</p>
                </div>
                <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2/40 px-3 py-2">
                  <p className="text-caption font-emphasis text-text-secondary">Lịch hiện tại</p>
                  <p className="mt-1 text-caption text-text-tertiary">Quét link mới {formatHoursLabel(schedule.discoveryHours)} · Crawl lại {formatHoursLabel(schedule.crawlHours)}</p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Tên đối thủ" required>
                  <Input size="sm" autoFocus value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} placeholder="Ví dụ: Đối thủ A" onKeyDown={(e) => e.key === 'Enter' && handleStartScan()} />
                </Field>

                <Field label="Domain chính" required hint="Không cần https://, chỉ cần tên miền.">
                  <div className="relative">
                    <Globe className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-quaternary" />
                    <Input size="sm" value={info.primary_domain} onChange={(e) => setInfo({ ...info, primary_domain: e.target.value })} placeholder="mindx.edu.vn" className="pl-7" onKeyDown={(e) => e.key === 'Enter' && handleStartScan()} />
                  </div>
                </Field>

                <div className="md:col-span-2">
                  <Field label="Phân khúc thị trường" hint="Chọn một tag cố định để AI hiểu ngữ cảnh và dữ liệu luôn đồng nhất.">
                    <SegmentTagPicker value={info.segment} onChange={(segment) => setInfo({ ...info, segment })} disabled={busy} />
                  </Field>
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <Button size="sm" variant="primary" onClick={handleStartScan} disabled={!info.name.trim() || !info.primary_domain.trim()}>
                  Bắt đầu quét →
                </Button>
              </div>
            </div>
          )}

          {step === 'info' && busy && (
            <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4 shadow-linear-sm sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[rgb(var(--border-line))] pb-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="rounded-lg bg-brand/10 p-2 text-brand">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-caption font-emphasis text-text-primary">{busyLabel}</p>
                    <p className="mt-1 max-w-2xl text-caption text-text-tertiary">Pipeline đang mở trang gốc, lần theo liên kết nội bộ, rồi chuyển sang AI nhóm nguồn. Nhật ký được giữ trong khung riêng để màn hình không bị kéo dài thêm.</p>
                  </div>
                </div>
                <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2/40 px-3 py-2">
                  <p className="text-caption font-emphasis text-text-secondary">Bản ghi gần nhất</p>
                  <p className="mt-1 text-caption text-text-tertiary">{progressLogs.length} dòng nhật ký</p>
                </div>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
                <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-2/30 p-4">
                  <p className="mb-3 text-caption font-emphasis text-text-secondary">Nhật ký pipeline</p>
                  <div className="max-h-[320px] overflow-y-auto pr-1">
                    <div className="flex flex-col gap-2">
                      {progressLogs.map((log, index) => (
                        <div key={`${index}-${log}`} className={cn('flex items-start gap-2 text-caption', index === progressLogs.length - 1 ? 'text-text-primary' : 'text-text-tertiary')}>
                          <span className={cn('mt-1.5 inline-block h-1.5 w-1.5 rounded-full', index === progressLogs.length - 1 ? 'bg-brand' : 'bg-text-quaternary')} />
                          <span className="break-words leading-5">{log}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 self-start">
                  <MetricCard label="Domain đang quét" value={previewSeedUrl} />
                  <MetricCard label="Quét link mới" value={formatHoursLabel(schedule.discoveryHours)} />
                  <MetricCard label="Crawl lại nội dung" value={formatHoursLabel(schedule.crawlHours)} />
                </div>
              </div>
            </div>
          )}

          {step === 'select' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4 shadow-linear-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-caption font-emphasis text-text-primary">4. Xác nhận nguồn cần theo dõi</p>
                    <p className="mt-1 text-caption text-text-tertiary">Tìm thấy {totalFound} trang. Nút tạo và lịch crawl giờ luôn nằm cố định ở khung bên cạnh để không phải cuộn xuống cuối mới bấm tiếp.</p>
                  </div>
                  <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2/40 px-3 py-2">
                    <p className="text-caption font-emphasis text-text-secondary">Đã chọn</p>
                    <p className="mt-1 text-caption text-text-tertiary">{selected.size}/{totalFound} trang · Crawl lại {formatHoursLabel(schedule.crawlHours)}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pb-20 lg:pb-4">
                {CATEGORIES.map((cat) => {
                  const links = grouped[cat] ?? [];
                  if (!links.length) return null;
                  const selCount = links.filter((link) => selected.has(link.url)).length;
                  const allSel = selCount === links.length;

                  return (
                    <div key={cat} className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgb(var(--border-line))] bg-surface-2/50 px-4 py-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                          <Badge tone={CATEGORY_TONES[cat]}>{CATEGORY_LABELS[cat]}</Badge>
                          <span className="text-caption text-text-tertiary">{links.length} trang</span>
                          <span className="hidden text-caption text-text-quaternary sm:inline">— {CATEGORY_DESCRIPTION[cat]}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-caption font-emphasis text-text-secondary">{selCount}/{links.length}</span>
                          <button onClick={() => (allSel ? deselectAll(cat) : selectAll(cat))} className="text-caption font-emphasis text-brand transition-colors hover:text-brand/80">
                            {allSel ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                          </button>
                        </div>
                      </div>

                      <ul className="divide-y divide-[rgb(var(--border-line))]">
                        {links.map((link) => {
                          const checked = selected.has(link.url);
                          return (
                            <li key={link.url} onClick={() => toggleLink(link.url)} className={cn('flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors', checked ? 'bg-brand/3 hover:bg-brand/5' : 'hover:bg-surface-2/40')}>
                              <div className="mt-0.5 flex-shrink-0">
                                {checked ? <CheckSquare className="h-4 w-4 text-brand" /> : <Square className="h-4 w-4 text-text-quaternary" />}
                              </div>

                              <div className="min-w-0 flex-1">
                                {link.page_title && <p className="text-caption font-emphasis text-text-primary leading-5">{link.page_title}</p>}
                                <p className={cn('break-all text-caption text-text-tertiary', !link.page_title && 'font-emphasis text-text-primary')}>{link.url}</p>
                                {link.ai_reason && <p className="mt-1 text-caption italic text-text-tertiary">{link.ai_reason}</p>}
                              </div>

                              <a href={link.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="mt-0.5 flex-shrink-0 text-text-quaternary transition-colors hover:text-brand">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>

              <div className="sticky bottom-4 z-10 lg:hidden">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[rgb(var(--border-line))] bg-surface-1/95 px-4 py-3 shadow-linear-sm backdrop-blur">
                  <div className="min-w-0">
                    <p className="text-caption font-emphasis text-text-primary">Đã chọn {selected.size}/{totalFound} trang</p>
                    <p className="truncate text-caption text-text-tertiary">Quét link mới {formatHoursLabel(schedule.discoveryHours)} · Crawl lại {formatHoursLabel(schedule.crawlHours)}</p>
                  </div>
                  <Button className="shrink-0" size="sm" variant="primary" onClick={handleFinalize} disabled={busy || selected.size === 0}>
                    {actionLabel}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode; }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-caption font-emphasis text-text-primary flex items-center gap-1.5">
        {label}{required && <span className="text-danger">*</span>}
      </label>
      {children}
      {hint && <p className="text-caption text-text-tertiary">{hint}</p>}
    </div>
  );
}

function PipelinePanel({
  activeIndex,
  busy,
  step,
  totalFound,
  selectedCount,
}: {
  activeIndex: number;
  busy: boolean;
  step: 'info' | 'select';
  totalFound: number;
  selectedCount: number;
}) {
  return (
    <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4 shadow-linear-sm">
      <p className="text-caption font-emphasis text-text-primary">Pipeline thiết lập</p>
      <p className="mt-1 text-caption text-text-tertiary">Luồng được chia thành 4 bước rõ ràng để dễ theo dõi tiến trình và tránh mất nút hành động khỏi màn hình.</p>

      <div className="mt-4 flex flex-col gap-2.5">
        {PIPELINE_STEPS.map((item, index) => {
          const Icon = item.icon;
          const done = index < activeIndex;
          const active = index === activeIndex;
          const loading = busy && active && step === 'info';

          return (
            <div key={item.label} className={cn('rounded-lg border px-3 py-3', done ? 'border-brand/30 bg-brand/5' : active ? 'border-brand/40 bg-brand/6' : 'border-[rgb(var(--border-line))] bg-surface-2/40')}>
              <div className="flex items-start gap-2.5">
                <span className={cn('mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full', done || active ? 'bg-brand/10 text-brand' : 'bg-surface-1 text-text-quaternary')}>
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                </span>

                <div className="min-w-0">
                  <p className="text-caption font-emphasis text-text-primary">{index + 1}. {item.label}</p>
                  <p className="mt-1 text-caption text-text-tertiary">{item.description}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg border border-[rgb(var(--border-line))] bg-surface-2/40 px-3 py-3">
        <p className="text-caption font-emphasis text-text-secondary">Tóm tắt nhanh</p>
        <p className="mt-1 text-caption text-text-tertiary">{step === 'select' ? `Đã tìm thấy ${totalFound} trang và đang chọn ${selectedCount} trang để theo dõi.` : 'Chưa tạo nguồn nào, đang chờ bạn nhập domain để khởi chạy pipeline.'}</p>
      </div>
    </div>
  );
}

function SchedulePanel({
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
  return (
    <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4 shadow-linear-sm">
      <p className="text-caption font-emphasis text-text-primary">Lịch crawl tự động</p>
      <p className="mt-1 text-caption text-text-tertiary">Thiết lập ngay từ màn này thay vì để hệ thống âm thầm dùng lịch mặc định.</p>

      <div className="mt-4 space-y-4">
        <ScheduleSelector
          label="Quét link mới"
          description="Kiểm tra lại domain để phát hiện URL mới hoặc menu mới."
          value={discoveryHours}
          disabled={disabled}
          onChange={onDiscoveryChange}
        />

        <ScheduleSelector
          label="Crawl lại trang đã chọn"
          description="Lấy lại nội dung của các URL bạn đã duyệt để phát hiện thay đổi."
          value={crawlHours}
          disabled={disabled}
          onChange={onCrawlChange}
        />
      </div>
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

function MetricCard({ label, value }: { label: string; value: string; }) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2/40 px-3 py-3">
      <p className="text-caption font-emphasis text-text-secondary">{label}</p>
      <p className="mt-1 break-words text-caption text-text-primary">{value}</p>
    </div>
  );
}
