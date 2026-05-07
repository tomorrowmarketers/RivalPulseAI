'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart2, ChevronDown, ChevronRight, ChevronUp, Clock, FileText, GitCompare, Plus, RefreshCw, Search, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { AppModalShell } from '@/components/ui/AppModalShell';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ModuleOverview } from '@/components/ui/ModuleOverview';
import { PageListLayout } from '@/components/ui/PageListLayout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

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
  next_run?: { days_until_next: number; next_period_end: string; is_overdue: boolean } | null;
  created_at: string;
};
type ScopeCompetitor = { id: string; name: string };
type ScopeSource = { id: string; competitor_id: string; url: string; source_type: string };
type AdhocResponse = {
  title: string;
  answer: string;
  period_start: string;
  period_end: string;
  competitors_used: { id: string; name: string }[];
  sources_used: { id: string; url: string; source_type: string }[];
  event_count: number;
  diff_count: number;
  provider: string;
  detail: string;
};

const inputClass =
  'w-full rounded-md border border-[rgb(var(--border-subtle)/0.12)] bg-surface-0 px-3 py-2.5 text-caption text-text-primary placeholder:text-text-quaternary outline-none focus:border-brand/55 transition-all';
const labelClass = 'flex flex-col gap-1.5 text-caption font-emphasis text-text-secondary';

// ── helpers ────────────────────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  'Liệt kê 3 thay đổi quan trọng nhất 14 ngày qua và lý do tại sao quan trọng.',
  'Đối thủ nào đang giảm giá hoặc khuyến mãi?',
  'Có dấu hiệu nào về việc đối thủ nhắm tới khách hàng enterprise?',
  'So sánh sự khác biệt giữa các đối thủ về định vị sản phẩm.',
];

const STATUS_VI: Record<string, string> = {
  draft: 'nháp',
  published: 'đã phát hành',
  archived: 'lưu trữ',
};

const REPORT_TYPE_VI: Record<string, string> = {
  overview: 'Tổng quan',
  single_domain: 'Chuyên sâu',
  comparison: 'So sánh',
};

function fmt(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const router = useRouter();
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // modal visibility
  const [showCreate, setShowCreate] = useState(false);
  const [showAdhoc, setShowAdhoc] = useState(false);
  const [showComparison, setShowComparison] = useState(false);

  // create form
  const [createStep, setCreateStep] = useState<'type' | 'config'>('type');
  const [createType, setCreateType] = useState<'overview' | 'single_domain' | 'comparison'>('overview');
  const [focalCompetitorId, setFocalCompetitorId] = useState('');
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [form, setForm] = useState({ title: '', cadence: 'biweekly', cadence_days: 14, auto_enabled: false });
  const [createBusy, setCreateBusy] = useState(false);

  // adhoc
  const [scope, setScope] = useState<{ competitors: ScopeCompetitor[]; sources: ScopeSource[] } | null>(null);
  const [adhocQuestion, setAdhocQuestion] = useState('');
  const [adhocDays, setAdhocDays] = useState(14);
  const [adhocCompetitors, setAdhocCompetitors] = useState<string[]>([]);
  const [adhocSources, setAdhocSources] = useState<string[]>([]);
  const [adhocBusy, setAdhocBusy] = useState(false);
  const [adhocResult, setAdhocResult] = useState<AdhocResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getReportDefinitions();
      setDefinitions((res as { items: ReportDefinition[] }).items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi tải dữ liệu');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    api
      .getAskScope()
      .then((res) => setScope(res as unknown as { competitors: ScopeCompetitor[]; sources: ScopeSource[] }))
      .catch(() => undefined);
  }, [load]);

  const filteredAdhocSources = useMemo(() => {
    if (!scope) return [];
    if (adhocCompetitors.length === 0) return scope.sources;
    return scope.sources.filter((s) => adhocCompetitors.includes(s.competitor_id));
  }, [scope, adhocCompetitors]);

  function updateField(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: name === 'cadence_days' ? Number(value) : value }));
  }

  function openCreateModal() {
    setCreateStep('type');
    setCreateType('overview');
    setFocalCompetitorId('');
    setComparisonIds([]);
    setForm({ title: '', cadence: 'biweekly', cadence_days: 14, auto_enabled: false });
    setShowCreate(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateBusy(true);
    setError('');
    try {
      const res = await api.createReportDefinition({
        title: form.title || undefined,
        cadence: form.cadence,
        cadence_days: form.cadence_days,
        auto_enabled: form.auto_enabled,
        report_type: createType,
        focal_competitor_id: createType !== 'overview' ? focalCompetitorId || undefined : undefined,
        comparison_competitor_ids: createType === 'comparison' ? comparisonIds : [],
      } as Record<string, unknown>);
      setShowCreate(false);
      const newDef = (res as { item: ReportDefinition }).item;
      router.push(`/reports/${newDef.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi tạo báo cáo');
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleAdhoc(e: React.FormEvent) {
    e.preventDefault();
    if (!adhocQuestion.trim()) return;
    setAdhocBusy(true);
    setError('');
    try {
      const res = (await api.adhocReport({
        question: adhocQuestion.trim(),
        competitor_ids: adhocCompetitors.length ? adhocCompetitors : undefined,
        source_ids: adhocSources.length ? adhocSources : undefined,
        days: adhocDays,
      })) as unknown as AdhocResponse;
      setAdhocResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi tổng hợp AI');
    } finally {
      setAdhocBusy(false);
    }
  }

  async function handleDeleteDef(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm('Xác nhận xóa báo cáo này? Tất cả lịch sử chạy sẽ bị xóa.')) return;
    setDeletingId(id);
    try {
      await api.deleteReportDefinition(id);
      setDefinitions((prev) => prev.filter((d) => d.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi xóa');
    } finally {
      setDeletingId(null);
    }
  }

  function toggle<T>(set: T[], value: T): T[] {
    return set.includes(value) ? set.filter((v) => v !== value) : [...set, value];
  }

  const stats = useMemo(() => {
    const autoCount = definitions.filter((d) => d.auto_enabled).length;
    const overdueCount = definitions.filter((d) => d.next_run?.is_overdue).length;
    return { total: definitions.length, autoCount, overdueCount };
  }, [definitions]);

  return (
    <>
      <PageListLayout
        title="Báo cáo"
        description="Báo cáo định kỳ AI · Hỏi AI tuỳ chỉnh · So sánh đối thủ theo danh mục"
        isLoading={loading}
        viewToggle={false}
        searchable={false}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Wand2 className="h-3.5 w-3.5" />}
              onClick={() => { setAdhocResult(null); setShowAdhoc(true); }}
            >
              Hỏi AI
            </Button>
            <Button
              variant="primary"
              size="sm"
              leadingIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={openCreateModal}
            >
              Tạo báo cáo
            </Button>
          </div>
        }
        overview={
          <ModuleOverview
            icon={FileText}
            title="Báo cáo tình báo cạnh tranh"
            description="Mỗi report definition = một loại báo cáo có lịch và cấu hình riêng. Mỗi lần chạy (tự động hoặc thủ công) tạo ra một bản phân tích mới."
            badges={['AI synthesis', 'Định kỳ', 'On-demand']}
            stats={[
              { label: 'Báo cáo đã tạo', value: stats.total, helper: 'Số loại báo cáo đang cấu hình' },
              { label: 'Tự động chạy', value: stats.autoCount, helper: 'Định nghĩa có auto_enabled = bật' },
              {
                label: 'Quá hạn',
                value: stats.overdueCount > 0 ? `${stats.overdueCount} báo cáo` : 'Không có',
                helper: stats.overdueCount > 0 ? 'Cần chạy ngay' : 'Tất cả đúng lịch',
              },
            ]}
          />
        }
      >
        {() => {
          if (error) {
            return (
              <div className="rounded-lg border border-danger/30 bg-danger/8 px-3 py-2.5 text-caption text-danger">
                {error}
              </div>
            );
          }

          return (
            <>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-tiny font-strong uppercase tracking-[0.12em] text-text-quaternary">
                  {definitions.length} báo cáo
                </p>
                <button
                  type="button"
                  onClick={() => setShowComparison((v) => !v)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-caption transition-all',
                    showComparison
                      ? 'border-brand/40 bg-brand/8 text-brand'
                      : 'border-[rgb(var(--border-line))] text-text-tertiary hover:text-text-secondary',
                  )}
                >
                  <BarChart2 className="h-3.5 w-3.5" />
                  So sánh đối thủ
                  {showComparison ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              </div>

              {showComparison && (
                <div className="mb-4">
                  <ComparisonSection />
                </div>
              )}

              {definitions.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="Chưa có báo cáo nào"
                  description="Tạo báo cáo đầu tiên để bắt đầu theo dõi đối thủ định kỳ với AI."
                  action={
                    <Button
                      variant="primary"
                      size="sm"
                      leadingIcon={<Plus className="h-3.5 w-3.5" />}
                      onClick={openCreateModal}
                    >
                      Tạo báo cáo đầu tiên
                    </Button>
                  }
                />
              ) : (
                <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-sm">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-[rgb(var(--border-line))] bg-surface-2/50">
                        <th className="px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Tên báo cáo</th>
                        <th className="px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Loại</th>
                        <th className="px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Chu kỳ</th>
                        <th className="px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Số lần chạy</th>
                        <th className="px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Lần chạy gần nhất</th>
                        <th className="px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Chạy tiếp theo</th>
                        <th className="px-4 py-2.5 text-right text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgb(var(--border-line))]">
                      {definitions.map((item) => (
                        <tr
                          key={item.id}
                          className="group cursor-pointer hover:bg-surface-2/30 transition-colors"
                          onClick={() => router.push(`/reports/${item.id}`)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand/10">
                                <FileText className="h-4 w-4 text-brand" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-caption font-emphasis text-text-primary truncate max-w-[260px]">
                                  {item.title}
                                </p>
                                {item.auto_enabled && (
                                  <span className="text-tiny text-success">● Tự động</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              tone={
                                item.report_type === 'comparison' ? 'brand'
                                  : item.report_type === 'single_domain' ? 'info' : 'neutral'
                              }
                            >
                              {REPORT_TYPE_VI[item.report_type ?? 'overview']}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-caption text-text-secondary">
                            Mỗi {item.cadence_days} ngày
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-caption font-emphasis text-text-primary">{item.run_count}</span>
                            <span className="ml-1 text-tiny text-text-quaternary">lần</span>
                          </td>
                          <td className="px-4 py-3">
                            {item.last_run ? (
                              <span className="text-caption text-text-secondary">
                                {fmt(item.last_run.period_end)}
                              </span>
                            ) : (
                              <span className="text-caption text-text-quaternary">Chưa chạy</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {item.next_run ? (
                              <span className={cn(
                                'text-caption',
                                item.next_run.is_overdue ? 'text-danger font-emphasis' : 'text-text-secondary',
                              )}>
                                {item.next_run.is_overdue ? 'Quá hạn' : `${item.next_run.days_until_next} ngày nữa`}
                              </span>
                            ) : (
                              <span className="text-caption text-text-quaternary">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={(e) => handleDeleteDef(item.id, e)}
                              disabled={deletingId === item.id}
                              className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-text-quaternary opacity-0 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger transition-all disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                            <ChevronRight className="inline h-4 w-4 text-text-quaternary" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          );
        }}
      </PageListLayout>

      {/* Create periodic report modal — 2-step: choose type → configure */}
      {showCreate && (
        <AppModalShell
          size="md"
          title={createStep === 'type' ? 'Chọn loại báo cáo' : 'Cấu hình báo cáo'}
          description={
            createStep === 'type'
              ? 'Mỗi loại báo cáo mang lại góc nhìn khác nhau. Chọn loại phù hợp với mục tiêu phân tích.'
              : 'Điền thông tin chi tiết rồi bấm Tạo để AI bắt đầu tổng hợp.'
          }
          onClose={() => setShowCreate(false)}
        >
          {createStep === 'type' ? (
            <div className="flex flex-col gap-3">
              {/* Type cards */}
              {(
                [
                  {
                    type: 'overview' as const,
                    icon: <BarChart2 className="h-5 w-5" />,
                    label: 'Tổng quan thị trường',
                    desc: 'AI tổng hợp tất cả tín hiệu từ mọi đối thủ trong kỳ — phù hợp để nắm bức tranh chung hàng tuần/tháng.',
                    value: [
                      'Executive summary toàn thị trường',
                      'Pattern xu hướng nhiều đối thủ',
                      'Khuyến nghị ưu tiên cao nhất',
                    ],
                  },
                  {
                    type: 'single_domain' as const,
                    icon: <Search className="h-5 w-5" />,
                    label: 'Phân tích chuyên sâu 1 đối thủ',
                    desc: 'AI tập trung 100% vào một đối thủ — phân tích chiến lược, xu hướng đầu tư, điểm mạnh/yếu và dự báo bước đi tiếp theo.',
                    value: [
                      'Định hướng chiến lược và giai đoạn phát triển',
                      'Pattern hành vi & điểm mạnh/yếu cụ thể',
                      'Hành động đối phó gắn theo bộ phận',
                    ],
                  },
                  {
                    type: 'comparison' as const,
                    icon: <GitCompare className="h-5 w-5" />,
                    label: 'So sánh đối thủ',
                    desc: 'AI so sánh một đối thủ chính với nhiều đối thủ khác — ai đang dẫn, ở mặt nào, và ta nên làm gì.',
                    value: [
                      'So sánh đa chiều: giá, sản phẩm, định vị, tốc độ',
                      'Xác định ai đang thắng kỳ này và tại sao',
                      'Hành động phòng thủ & tấn công theo dữ liệu',
                    ],
                  },
                ] as const
              ).map(({ type, icon, label, desc, value }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => { setCreateType(type); setCreateStep('config'); }}
                  className={cn(
                    'flex flex-col gap-2 rounded-[14px] border p-4 text-left transition-all hover:border-brand/40 hover:bg-brand/4',
                    createType === type
                      ? 'border-brand/50 bg-brand/6'
                      : 'border-[rgb(var(--border-subtle)/0.12)] bg-surface-1',
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
                      {icon}
                    </span>
                    <span className="text-caption font-emphasis text-text-primary">{label}</span>
                  </div>
                  <p className="text-tiny text-text-tertiary leading-relaxed">{desc}</p>
                  <ul className="flex flex-col gap-1 pl-1">
                    {value.map((v) => (
                      <li key={v} className="flex items-start gap-1.5 text-tiny text-text-secondary">
                        <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand/50" />
                        {v}
                      </li>
                    ))}
                  </ul>
                </button>
              ))}
            </div>
          ) : (
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              {/* Back link */}
              <button
                type="button"
                onClick={() => setCreateStep('type')}
                className="self-start text-tiny text-text-tertiary hover:text-brand transition-colors"
              >
                ← Đổi loại báo cáo
              </button>

              {/* Competitor selectors for non-overview types */}
              {createType !== 'overview' && (
                scope === null ? (
                  <div className="flex items-center gap-2 rounded-md border border-[rgb(var(--border-subtle)/0.1)] bg-surface-0 px-3 py-2.5">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-text-quaternary" />
                    <span className="text-tiny text-text-tertiary">Đang tải danh sách đối thủ...</span>
                  </div>
                ) : scope.competitors.length === 0 ? (
                  <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
                    <p className="text-caption font-emphasis text-warning">Chưa có đối thủ nào</p>
                    <p className="mt-0.5 text-tiny text-text-tertiary">
                      Cần thêm ít nhất 1 đối thủ trước khi tạo báo cáo loại này.
                    </p>
                    <a
                      href="/monitor/new"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-tiny font-emphasis text-brand hover:underline"
                    >
                      + Thêm đối thủ →
                    </a>
                  </div>
                ) : (
                  <label className={labelClass}>
                    {createType === 'single_domain' ? 'Đối thủ cần phân tích *' : 'Đối thủ chính *'}
                    <select
                      value={focalCompetitorId}
                      onChange={(e) => setFocalCompetitorId(e.target.value)}
                      required
                      className={inputClass}
                    >
                      <option value="">— Chọn đối thủ —</option>
                      {scope.competitors.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                )
              )}

              {createType === 'comparison' && scope && (
                scope.competitors.length < 2 ? (
                  <div className="rounded-lg border border-[rgb(var(--border-subtle)/0.1)] bg-surface-0 px-4 py-3">
                    <p className="text-caption font-emphasis text-text-secondary">Đối thủ đối chiếu *</p>
                    <p className="mt-1 text-tiny text-text-tertiary">
                      Cần ít nhất 2 đối thủ để so sánh.{
                        scope.competitors.length === 1
                          ? ' Hiện chỉ có 1 đối thủ — hãy thêm thêm ở '
                          : ' Hãy thêm đối thủ ở '
                      }
                      <a href="/monitor/new" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">Theo dõi đối thủ</a>.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <p className={cn(labelClass, 'mb-0')}>
                      Đối thủ đối chiếu *{' '}
                      <span className="font-normal text-text-quaternary">({comparisonIds.length} đã chọn)</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5 rounded-md border border-[rgb(var(--border-subtle)/0.1)] bg-surface-0 p-2.5">
                      {scope.competitors
                        .filter((c) => c.id !== focalCompetitorId)
                        .map((c) => {
                          const checked = comparisonIds.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => setComparisonIds((p) => toggle(p, c.id))}
                              className={cn(
                                'rounded-full border px-2.5 py-1 text-tiny transition-colors',
                                checked
                                  ? 'border-brand bg-brand text-white'
                                  : 'border-[rgb(var(--border-subtle)/0.1)] bg-surface-1 text-text-secondary hover:border-brand/40',
                              )}
                            >
                              {c.name}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )
              )}

              {/* Common fields */}
              <label className={labelClass}>
                Tiêu đề{' '}
                <span className="font-normal text-text-quaternary">(tùy chọn)</span>
                <input
                  name="title"
                  placeholder={
                    createType === 'single_domain'
                      ? 'Phân tích đối thủ chính - tháng này'
                      : createType === 'comparison'
                      ? 'So sánh đối thủ A vs đối thủ B vs đối thủ C'
                      : 'Competitor Watch — May 2026'
                  }
                  value={form.title}
                  onChange={updateField}
                  className={inputClass}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelClass}>
                  Chu kỳ
                  <select name="cadence" value={form.cadence} onChange={updateField} className={inputClass}>
                    <option value="biweekly">Hai tuần/lần</option>
                    <option value="monthly">Hàng tháng</option>
                    <option value="custom">Tuỳ chỉnh</option>
                  </select>
                </label>
                <label className={labelClass}>
                  Số ngày / kỳ
                  <input
                    name="cadence_days"
                    type="number"
                    min={1}
                    max={365}
                    value={form.cadence_days}
                    onChange={updateField}
                    required
                    className={inputClass}
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-caption text-text-secondary">
                <input
                  type="checkbox"
                  checked={form.auto_enabled}
                  onChange={(e) => setForm((p) => ({ ...p, auto_enabled: e.target.checked }))}
                  className="h-4 w-4 accent-brand rounded"
                />
                Tự động chạy theo lịch
              </label>


              {/* Validation hints — only show when there are competitors to select */}
              {createType === 'comparison' && scope && scope.competitors.length >= 2 && comparisonIds.length === 0 && (
                <p className="text-tiny text-warning">
                  Cần chọn ít nhất 1 đối thủ đối chiếu để AI có thể so sánh.
                </p>
              )}
              {createType !== 'overview' && scope && scope.competitors.length > 0 && !focalCompetitorId && (
                <p className="text-tiny text-warning">
                  Cần chọn đối thủ chính để AI tập trung phân tích.
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-[rgb(var(--border-subtle)/0.12)] px-4 py-2 text-caption text-text-secondary hover:bg-surface-2 transition-colors"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={
                    createBusy ||
                    (createType !== 'overview' && scope !== null && scope.competitors.length === 0) ||
                    (createType !== 'overview' && scope !== null && scope.competitors.length > 0 && !focalCompetitorId) ||
                    (createType === 'comparison' && scope !== null && scope.competitors.length >= 2 && comparisonIds.length === 0)
                  }
                  className="rounded-lg bg-brand px-5 py-2 text-caption font-emphasis text-white shadow-linear hover:bg-brand-hover transition-all disabled:opacity-50"
                >
                  {createBusy ? 'Đang tạo…' : 'Tạo báo cáo'}
                </button>
              </div>
            </form>
          )}
        </AppModalShell>
      )}

      {/* Adhoc / AI query modal */}
      {showAdhoc && (
        <AppModalShell
          size="lg"
          title="Hỏi AI tuỳ chỉnh"
          description="Đặt câu hỏi — AI tổng hợp từ diffs & events đã thu thập. Kết quả không lưu vào danh sách."
          onClose={() => setShowAdhoc(false)}
        >
          <div
            className="grid gap-5"
            style={{ gridTemplateColumns: adhocResult || adhocBusy ? '1fr 1fr' : '1fr' }}
          >
            {/* Form column */}
            <form onSubmit={handleAdhoc} className="flex flex-col gap-4">
              <label className={labelClass}>
                Câu hỏi / yêu cầu
                <textarea
                  value={adhocQuestion}
                  onChange={(e) => setAdhocQuestion(e.target.value)}
                  required
                  placeholder="Ví dụ: Đối thủ A có thay đổi gì về giá tuần qua?"
                  rows={3}
                  className={cn(inputClass, 'resize-none')}
                />
              </label>

              <div>
                <p className="mb-1.5 text-tiny font-strong uppercase tracking-[0.12em] text-text-quaternary">
                  Gợi ý nhanh
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setAdhocQuestion(p)}
                      className="rounded-full border border-[rgb(var(--border-subtle)/0.1)] bg-surface-0 px-2.5 py-1 text-tiny text-text-secondary hover:border-brand/30 hover:bg-brand/4 transition-colors"
                    >
                      {p.length > 55 ? p.slice(0, 53) + '…' : p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className={labelClass}>
                  Khoảng thời gian
                  <select
                    value={adhocDays}
                    onChange={(e) => setAdhocDays(Number(e.target.value))}
                    className={inputClass}
                  >
                    <option value={3}>3 ngày qua</option>
                    <option value={7}>7 ngày qua</option>
                    <option value={14}>14 ngày qua</option>
                    <option value={30}>30 ngày qua</option>
                    <option value={60}>60 ngày qua</option>
                  </select>
                </label>
                {scope && scope.competitors.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-tiny font-strong uppercase tracking-[0.12em] text-text-quaternary">
                      Đối thủ
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {scope.competitors.map((c) => {
                        const checked = adhocCompetitors.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setAdhocCompetitors((p) => toggle(p, c.id))}
                            className={cn(
                              'rounded-full border px-2.5 py-1 text-tiny transition-colors',
                              checked
                                ? 'border-brand bg-brand text-white'
                                : 'border-[rgb(var(--border-subtle)/0.1)] bg-surface-0 text-text-secondary hover:border-brand/40',
                            )}
                          >
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {scope && filteredAdhocSources.length > 0 && adhocCompetitors.length > 0 && (
                <div>
                  <p className="mb-1.5 text-tiny font-strong uppercase tracking-[0.12em] text-text-quaternary">
                    Lọc theo nguồn ({adhocSources.length || 'tất cả'})
                  </p>
                  <div className="flex flex-col gap-0.5 max-h-36 overflow-y-auto rounded-md border border-[rgb(var(--border-subtle)/0.08)] bg-surface-0 p-1">
                    {filteredAdhocSources.map((s) => {
                      const checked = adhocSources.includes(s.id);
                      return (
                        <label
                          key={s.id}
                          className={cn(
                            'flex items-center gap-2 rounded px-2 py-1 cursor-pointer transition-colors',
                            checked ? 'bg-brand/8' : 'hover:bg-surface-2',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setAdhocSources((p) => toggle(p, s.id))}
                            className="h-3 w-3 accent-brand"
                          />
                          <span className="text-tiny text-text-secondary truncate flex-1">{s.url}</span>
                          <span className="text-tiny text-text-quaternary">{s.source_type}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={adhocBusy || !adhocQuestion.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-4 py-2.5 text-caption font-emphasis text-white shadow-linear hover:bg-brand-hover transition-all disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {adhocBusy ? 'AI đang tổng hợp…' : 'Tổng hợp ngay'}
              </button>
            </form>

            {/* Result column */}
            {adhocBusy && (
              <div className="flex flex-col items-center justify-center gap-3 rounded-[18px] border border-[rgb(var(--border-subtle)/0.1)] bg-surface-0 px-6 py-12 text-center">
                <div className="flex items-center gap-1.5">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="inline-block h-2 w-2 rounded-full bg-brand animate-pulse"
                      style={{ animationDelay: String(delay) + 'ms' }}
                    />
                  ))}
                </div>
                <p className="text-caption text-text-tertiary">AI đang tổng hợp… (10–30s)</p>
              </div>
            )}
            {adhocResult && !adhocBusy && (
              <div className="flex flex-col gap-3 overflow-y-auto">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-caption font-emphasis text-text-primary">{adhocResult.title}</p>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <StatusBadge tone={adhocResult.provider === 'openai' ? 'accent' : 'neutral'}>
                      {adhocResult.provider}
                    </StatusBadge>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(adhocResult.answer)}
                      className="text-tiny text-text-tertiary hover:text-brand transition-colors"
                    >
                      Sao chép
                    </button>
                  </div>
                </div>
                <p className="text-tiny text-text-quaternary">
                  {adhocResult.period_start.slice(0, 10)} → {adhocResult.period_end.slice(0, 10)}
                  {' · '}{adhocResult.diff_count} thay đổi · {adhocResult.event_count} sự kiện
                </p>
                <div className="rounded-[14px] border border-[rgb(var(--border-subtle)/0.08)] bg-surface-0 p-4 max-h-80 overflow-y-auto">
                  <p className="whitespace-pre-wrap text-caption leading-relaxed text-text-primary">
                    {adhocResult.answer}
                  </p>
                </div>
                {adhocResult.competitors_used.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {adhocResult.competitors_used.map((c) => (
                      <span
                        key={c.id}
                        className="rounded-full border border-[rgb(var(--border-subtle)/0.1)] bg-surface-0 px-2.5 py-0.5 text-tiny font-emphasis text-text-secondary"
                      >
                        {c.name}
                      </span>
                    ))}
                    <span className="text-tiny text-text-quaternary">
                      · {adhocResult.sources_used.length} nguồn
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </AppModalShell>
      )}
    </>
  );
}

// ── Comparison Section ─────────────────────────────────────────────────────────────────────────────

const CAT_KEYS = ['san_pham', 'khuyen_mai', 'other'] as const;
const CAT_LABELS: Record<string, string> = { san_pham: 'Sản phẩm', khuyen_mai: 'Khuyến mại', other: 'Khác' };
const CAT_TONES: Record<string, string> = {
  san_pham: 'text-brand',
  khuyen_mai: 'text-warning',
  other: 'text-text-tertiary',
};

type CompEvent = {
  id: string;
  title: string;
  event_type: string;
  urgency: string;
  detected_at: string;
  source_url?: string;
};
type CompRow = {
  name: string;
  domain: string;
  san_pham: { count: number; latest: CompEvent[] };
  khuyen_mai: { count: number; latest: CompEvent[] };
  other: { count: number; latest: CompEvent[] };
};
type CompData = {
  days: number;
  competitors: { id: string; name: string; domain: string }[];
  data: Record<string, CompRow>;
};

function ComparisonSection() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<CompData | null>(null);
  const [loadingComp, setLoadingComp] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoadingComp(true);
    api
      .getComparisonReport(days)
      .then((res) => setData(res as unknown as CompData))
      .catch(() => setData(null))
      .finally(() => setLoadingComp(false));
  }, [days]);

  return (
    <div className="rounded-[18px] border border-[rgb(var(--border-subtle)/0.1)] bg-surface-1 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-caption font-emphasis text-text-primary">So sánh đối thủ theo danh mục</p>
          <p className="mt-0.5 text-tiny text-text-tertiary">
            Số lượng thay đổi phát hiện được phân nhóm theo Sản phẩm / Khuyến mại / Khác.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {[7, 14, 30, 60].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={cn(
                'rounded-md px-3 py-1 text-tiny font-emphasis transition-colors',
                days === d
                  ? 'bg-brand text-white'
                  : 'bg-surface-2 text-text-secondary hover:bg-surface-3',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loadingComp ? (
        <div className="flex items-center justify-center gap-2 py-10 text-caption text-text-tertiary">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>Đang tải…</span>
        </div>
      ) : !data || !data.competitors.length ? (
        <div className="py-10 text-center text-caption text-text-tertiary">
          Chưa có dữ liệu. Thêm đối thủ và chạy crawl trước.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))]">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[rgb(var(--border-line))] bg-surface-2/50">
                <th className="w-44 px-4 py-3 text-tiny font-emphasis uppercase tracking-[0.1em] text-text-quaternary">
                  Đối thủ
                </th>
                {CAT_KEYS.map((cat) => (
                  <th
                    key={cat}
                    className="px-4 py-3 text-tiny font-emphasis uppercase tracking-[0.1em] text-text-quaternary"
                  >
                    {CAT_LABELS[cat]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgb(var(--border-line))]">
              {data.competitors.map((comp) => {
                const row = data.data[comp.id];
                if (!row) return null;
                const isOpen = expanded === comp.id;
                return (
                  <>
                    <tr
                      key={comp.id}
                      onClick={() => setExpanded(isOpen ? null : comp.id)}
                      className="cursor-pointer hover:bg-surface-2/40 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <p className="text-caption font-emphasis text-text-primary">{comp.name}</p>
                        <p className="text-tiny text-text-quaternary">{comp.domain}</p>
                      </td>
                      {CAT_KEYS.map((cat) => {
                        const cell = row[cat];
                        return (
                          <td key={cat} className="px-4 py-3">
                            <span
                              className={cn(
                                'text-h3 font-strong',
                                cell.count > 0 ? CAT_TONES[cat] : 'text-text-quaternary',
                              )}
                            >
                              {cell.count}
                            </span>
                            <span className="ml-1 text-tiny text-text-quaternary">thay đổi</span>
                          </td>
                        );
                      })}
                    </tr>
                    {isOpen && (
                      <tr key={comp.id + '-detail'} className="bg-surface-2/20">
                        <td colSpan={4} className="px-4 py-3">
                          <div className="grid grid-cols-3 gap-4">
                            {CAT_KEYS.map((cat) => {
                              const cell = row[cat];
                              return (
                                <div key={cat}>
                                  <p className="mb-2 text-tiny font-emphasis text-text-tertiary">
                                    {CAT_LABELS[cat]}
                                  </p>
                                  {cell.latest.length === 0 ? (
                                    <p className="text-tiny text-text-quaternary">Không có thay đổi</p>
                                  ) : (
                                    <ul className="space-y-1.5">
                                      {cell.latest.map((ev) => (
                                        <li key={ev.id} className="text-tiny leading-snug text-text-secondary">
                                          — {ev.title}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
