'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity, ChevronRight, Clock, Globe, Pencil, Plus, Rss, Search, Trash2,
} from 'lucide-react';
import { AppModalShell } from '@/components/ui/AppModalShell';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ModuleOverview } from '@/components/ui/ModuleOverview';
import { PageListLayout } from '@/components/ui/PageListLayout';
import { ConfirmDeleteCompetitorModal } from '@/components/monitor/ConfirmDeleteCompetitorModal';
import { SegmentTagPicker } from '@/components/monitor/SegmentTagPicker';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { coerceMarketSegment, isMarketSegment, type MarketSegment } from '@/lib/marketSegments';
import { cn } from '@/lib/utils';

type Competitor = { id: string; name: string; primary_domain: string; segment?: string; created_at?: string };
type Seed = { id: string; competitor_id: string; pending_count: number };
type Source = { id: string; competitor_id: string; is_active: boolean; last_crawled_at?: string | null };

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins}p trước`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h trước`;
  return `${Math.floor(hrs / 24)}d trước`;
}

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

export default function MonitorListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editTarget, setEditTarget] = useState<Competitor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Competitor | null>(null);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const [compRes, srcRes, seedRes] = await Promise.all([
          api.getCompetitors() as Promise<{ items: Competitor[] }>,
          api.getSources() as Promise<{ items: Source[] }>,
          api.getDiscoverySeeds() as Promise<{ items: Seed[] }>,
        ]);
        if (ignore) return;
        setCompetitors(compRes.items);
        setSources(srcRes.items);
        setSeeds(seedRes.items);
      } catch (err: unknown) {
        if (!ignore) setError(err instanceof Error ? err.message : 'Không tải được dữ liệu');
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    void load();
    const id = setInterval(load, 30_000);
    return () => { ignore = true; clearInterval(id); };
  }, []);

  const stats = useMemo(() => {
    const totalActive = sources.filter((s) => s.is_active).length;
    const totalPending = seeds.reduce((sum, s) => sum + s.pending_count, 0);
    return {
      total: competitors.length,
      activeSources: totalActive,
      pending: totalPending,
    };
  }, [competitors.length, sources, seeds]);

  const sourceCountByComp = useMemo(() => {
    const m = new Map<string, number>();
    sources.forEach((s) => {
      if (s.is_active) m.set(s.competitor_id, (m.get(s.competitor_id) ?? 0) + 1);
    });
    return m;
  }, [sources]);

  const pendingByComp = useMemo(() => {
    const m = new Map<string, number>();
    seeds.forEach((s) => {
      if (s.pending_count > 0) m.set(s.competitor_id, (m.get(s.competitor_id) ?? 0) + s.pending_count);
    });
    return m;
  }, [seeds]);

  const lastCrawlByComp = useMemo(() => {
    const m = new Map<string, string>();
    for (const src of sources) {
      if (!src.last_crawled_at) continue;
      const cur = m.get(src.competitor_id);
      if (!cur || new Date(src.last_crawled_at) > new Date(cur)) {
        m.set(src.competitor_id, src.last_crawled_at);
      }
    }
    return m;
  }, [sources]);

  return (
    <>
    <PageListLayout
      title="Đối thủ"
      description="Theo dõi đối thủ, quét nguồn và để AI tóm tắt thay đổi quan trọng."
      isLoading={loading}
      defaultView="list"
      searchPlaceholder="Tìm theo tên hoặc domain…"
      action={isAdmin && (
        <Button
          variant="primary"
          size="sm"
          leadingIcon={<Plus className="h-4 w-4" />}
          onClick={() => router.push('/monitor/new')}
        >
          Thêm đối thủ
        </Button>
      )}
      overview={(
        <ModuleOverview
          icon={Globe}
          title="Giám sát đối thủ"
          description="Khai báo đối thủ, hệ thống tự crawl các trang khóa học, giá, tin tức và để AI lọc tín hiệu đáng chú ý."
          badges={['Auto crawl', 'AI summary', 'Discovery']}
          stats={[
            {
              label: 'Tổng đối thủ',
              value: stats.total,
              helper: 'Đang được theo dõi',
            },
            {
              label: 'Nguồn đang crawl',
              value: stats.activeSources,
              helper: 'URL active trên toàn workspace',
            },
            {
              label: 'URL chờ duyệt',
              value: stats.pending,
              helper: stats.pending > 0 ? 'Cần admin xem qua trước khi bật theo dõi' : 'Đã sạch hàng đợi',
            },
          ]}
        />
      )}
    >
      {({ viewMode, filterText }) => {
        const needle = filterText.trim().toLowerCase();
        const filtered = competitors.filter((c) => {
          if (!needle) return true;
          return (
            c.name.toLowerCase().includes(needle) ||
            c.primary_domain.toLowerCase().includes(needle) ||
            (c.segment ?? '').toLowerCase().includes(needle)
          );
        });

        if (error) {
          return (
            <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-caption text-danger">
              {error}
            </div>
          );
        }

        if (competitors.length === 0) {
          return (
            <EmptyState
              icon={Globe}
              title="Chưa có đối thủ nào"
              description="Thêm đối thủ đầu tiên để hệ thống bắt đầu quét và phân tích nguồn."
              action={isAdmin && (
                <Button
                  variant="primary"
                  size="sm"
                  leadingIcon={<Plus className="h-4 w-4" />}
                  onClick={() => router.push('/monitor/new')}
                >
                  Thêm đối thủ đầu tiên
                </Button>
              )}
            />
          );
        }

        if (filtered.length === 0) {
          return (
            <EmptyState
              icon={Search}
              title="Không tìm thấy đối thủ phù hợp"
              description={`Không có kết quả cho "${filterText}".`}
            />
          );
        }

        if (viewMode === 'list') {
          return (
            <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-sm">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[rgb(var(--border-line))] bg-surface-2/50">
                    <th className="px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Đối thủ</th>
                    <th className="px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Phân khúc</th>
                    <th className="px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Nguồn active</th>
                    <th className="px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Crawl gần nhất</th>
                    <th className="px-4 py-2.5 text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Trạng thái</th>
                    <th className="px-4 py-2.5 text-right text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border-line))]">
                  {filtered.map((c) => {
                    const activeCount = sourceCountByComp.get(c.id) ?? 0;
                    const pending = pendingByComp.get(c.id) ?? 0;
                    const lastCrawl = lastCrawlByComp.get(c.id);
                    return (
                      <tr
                        key={c.id}
                        className="group hover:bg-surface-2/30 transition-colors cursor-pointer"
                        onClick={() => router.push(`/monitor/${c.id}`)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-hover text-tiny font-strong text-white">
                              {getInitials(c.name)}
                            </div>
                            <div className="min-w-0">
                              <p className="text-caption font-emphasis text-text-primary truncate">{c.name}</p>
                              <p className="text-tiny text-text-quaternary truncate">{c.primary_domain}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {c.segment ? <Badge tone="neutral">{c.segment}</Badge> : <span className="text-caption text-text-quaternary">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-caption text-text-secondary tabular-nums">{activeCount}</span>
                        </td>
                        <td className="px-4 py-3">
                          {lastCrawl ? (
                            <span className="inline-flex items-center gap-1 text-caption text-text-tertiary">
                              <Clock className="h-3 w-3" />
                              {formatRelative(lastCrawl)}
                            </span>
                          ) : (
                            <span className="text-caption text-text-quaternary">Chưa crawl</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {pending > 0 ? (
                            <Badge tone="warning">{pending} chờ duyệt</Badge>
                          ) : activeCount > 0 ? (
                            <Badge tone="success">Đang theo dõi</Badge>
                          ) : (
                            <Badge tone="neutral">Chưa cấu hình</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isAdmin ? (
                            <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => setEditTarget(c)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-2 hover:text-text-primary transition-colors"
                                title="Sửa"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(c)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-danger/10 hover:text-danger transition-colors"
                                title="Xóa"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                              <ChevronRight className="ml-1 h-4 w-4 text-text-quaternary" />
                            </div>
                          ) : (
                            <ChevronRight className="inline h-4 w-4 text-text-quaternary" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((c) => {
              const activeCount = sourceCountByComp.get(c.id) ?? 0;
              const pending = pendingByComp.get(c.id) ?? 0;
              const lastCrawl = lastCrawlByComp.get(c.id);

              return (
                <div
                  key={c.id}
                  className={cn(
                    'group relative flex flex-col rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4 shadow-linear-sm transition-all',
                    'hover:border-brand/30 hover:shadow-linear',
                  )}
                >
                  {/* Action buttons — appear on hover */}
                  {isAdmin && (
                    <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-10">
                      <button
                        type="button"
                        onClick={() => setEditTarget(c)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[rgb(var(--border-line))] bg-surface-1 text-text-tertiary hover:bg-surface-2 hover:text-text-primary transition-colors shadow-linear-sm"
                        title="Sửa thông tin"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(c)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[rgb(var(--border-line))] bg-surface-1 text-text-tertiary hover:bg-danger/10 hover:text-danger hover:border-danger/30 transition-colors shadow-linear-sm"
                        title="Xóa đối thủ"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => router.push(`/monitor/${c.id}`)}
                    className="flex items-start gap-3 mb-3 text-left min-w-0"
                  >
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-hover text-caption font-strong text-white">
                      {getInitials(c.name)}
                    </div>
                    <div className="flex-1 min-w-0 pr-16">
                      <h3 className="text-small font-emphasis text-text-primary truncate group-hover:text-brand transition-colors">
                        {c.name}
                      </h3>
                      <p className="text-caption text-text-tertiary truncate">{c.primary_domain}</p>
                    </div>
                  </button>

                  {c.segment && (
                    <div className="mb-3">
                      <Badge tone="neutral">{c.segment}</Badge>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => router.push(`/monitor/${c.id}`)}
                    className="grid grid-cols-2 gap-2 mb-3 text-left"
                  >
                    <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2/40 p-2.5">
                      <p className="text-tiny text-text-quaternary">Nguồn active</p>
                      <p className="mt-0.5 text-small font-emphasis text-text-primary tabular-nums">{activeCount}</p>
                    </div>
                    <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2/40 p-2.5">
                      <p className="text-tiny text-text-quaternary">URL chờ duyệt</p>
                      <p className={cn(
                        'mt-0.5 text-small font-emphasis tabular-nums',
                        pending > 0 ? 'text-warning' : 'text-text-primary',
                      )}>
                        {pending}
                      </p>
                    </div>
                  </button>

                  <div className="mt-auto flex items-center justify-between pt-3 border-t border-[rgb(var(--border-line))]">
                    <span className="inline-flex items-center gap-1 text-caption text-text-tertiary">
                      {lastCrawl ? (
                        <>
                          <Clock className="h-3 w-3" />
                          {formatRelative(lastCrawl)}
                        </>
                      ) : (
                        <>
                          <Activity className="h-3 w-3" />
                          Chưa crawl
                        </>
                      )}
                    </span>
                    {pending > 0 ? (
                      <Badge tone="warning" leadingIcon={<Rss />}>Có tín hiệu</Badge>
                    ) : activeCount > 0 ? (
                      <Badge tone="success">Đang chạy</Badge>
                    ) : (
                      <Badge tone="neutral">Chưa cấu hình</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      }}
    </PageListLayout>

    {/* Edit modal */}
    {editTarget && (
      <EditCompetitorInlineModal
        competitor={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={(updated) => {
          setCompetitors((prev) => prev.map((x) => x.id === updated.id ? { ...x, ...updated } : x));
          setEditTarget(null);
        }}
      />
    )}

    {/* Delete confirm modal */}
    {deleteTarget && (
      <ConfirmDeleteCompetitorModal
        competitor={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={(id) => {
          setCompetitors((prev) => prev.filter((x) => x.id !== id));
          setDeleteTarget(null);
        }}
      />
    )}
    </>
  );
}

function EditCompetitorInlineModal({
  competitor, onClose, onSaved,
}: { competitor: Competitor; onClose: () => void; onSaved: (c: Competitor) => void }) {
  const legacySegment = competitor.segment && !isMarketSegment(competitor.segment) ? competitor.segment : '';
  const [form, setForm] = useState({
    name: competitor.name,
    primary_domain: competitor.primary_domain,
    segment: coerceMarketSegment(competitor.segment) as MarketSegment | '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setBusy(true); setError('');
    try {
      const res = await api.updateCompetitor(competitor.id, form as Record<string, unknown>) as { item: Competitor };
      onSaved(res.item);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không lưu được.');
      setBusy(false);
    }
  }

  return (
    <AppModalShell
      title="Chỉnh sửa đối thủ"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Hủy</Button>
          <Button variant="primary" size="sm" onClick={handleSave} loading={busy}>
            {busy ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <p className="rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-caption text-danger">{error}</p>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-emphasis text-text-secondary">Tên</span>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-emphasis text-text-secondary">Domain</span>
          <Input value={form.primary_domain} onChange={(e) => setForm({ ...form, primary_domain: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-emphasis text-text-secondary">Phân khúc</span>
          <SegmentTagPicker value={form.segment} onChange={(segment) => setForm({ ...form, segment })} disabled={busy} />
          {legacySegment && !form.segment && (
            <p className="text-caption text-warning">Tag cũ “{legacySegment}” không còn nằm trong danh sách cố định. Chọn lại nếu muốn giữ phân khúc.</p>
          )}
        </label>
      </div>
    </AppModalShell>
  );
}
