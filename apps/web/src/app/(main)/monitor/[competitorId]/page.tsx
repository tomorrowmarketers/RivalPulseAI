'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  Activity, ArrowLeft, ChevronDown, ChevronUp, Globe, Loader2,
  Pencil, Play, Rss, Settings,
} from 'lucide-react';
import { AppModalShell } from '@/components/ui/AppModalShell';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { SegmentTagPicker } from '@/components/monitor/SegmentTagPicker';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { coerceMarketSegment, isMarketSegment, type MarketSegment } from '@/lib/marketSegments';
import { cn } from '@/lib/utils';

import { OverviewTab } from './OverviewTab';
import { SourcesTab } from './SourcesTab';
import { SignalsTab } from './SignalsTab';
import { TechTab } from './TechTab';
import { HistoryTab } from './HistoryTab';
import { Competitor, DetailTab, Seed, Source, TechSubTab } from './_shared';

type PrimaryTab = Exclude<DetailTab, 'tech' | 'history'>;
type UtilityView = Extract<DetailTab, 'tech' | 'history'>;

const PRIMARY_TAB_KEYS: PrimaryTab[] = ['overview', 'sources', 'signals'];

const PRIMARY_TAB_DEFS: { key: PrimaryTab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Tổng quan', icon: <Activity className="h-3.5 w-3.5" /> },
  { key: 'sources',  label: 'Nguồn & URL', icon: <Globe className="h-3.5 w-3.5" /> },
  { key: 'signals',  label: 'Tín hiệu', icon: <Rss className="h-3.5 w-3.5" /> },
];

const UTILITY_TAB_DEFS: { key: UtilityView; label: string; icon: React.ReactNode }[] = [
  { key: 'tech', label: 'Kỹ thuật', icon: <Settings className="h-3.5 w-3.5" /> },
  { key: 'history', label: 'Lịch sử', icon: <Activity className="h-3.5 w-3.5" /> },
];

function isValidPrimaryTab(t: string | null): t is PrimaryTab {
  return Boolean(t) && (PRIMARY_TAB_KEYS as string[]).includes(t!);
}

function isUtilityView(t: string | null): t is UtilityView {
  return t === 'tech' || t === 'history';
}

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

export default function CompetitorDetailPage() {
  const router = useRouter();
  const params = useParams<{ competitorId: string }>();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const competitorId = params.competitorId;

  const paramTab = searchParams.get('tab');
  const paramModal = searchParams.get('modal');
  const initialTab: PrimaryTab = isValidPrimaryTab(paramTab) ? paramTab : 'overview';
  const initialUtilityView: UtilityView | null = isUtilityView(paramModal)
    ? paramModal
    : isUtilityView(paramTab)
      ? paramTab
      : null;
  const paramSub = searchParams.get('sub');
  const initialSub: TechSubTab = paramSub === 'logs' ? 'logs' : 'pipeline';

  const [tab, setTab] = useState<PrimaryTab>(initialTab);
  const [utilityView, setUtilityView] = useState<UtilityView | null>(initialUtilityView);
  const [techSubTab, setTechSubTab] = useState<TechSubTab>(initialSub);

  const [competitor, setCompetitor] = useState<Competitor | null>(null);
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const [compRes, srcRes, seedRes] = await Promise.all([
        api.getCompetitor(competitorId) as Promise<{ competitor: Competitor }>,
        api.getSources() as Promise<{ items: Source[] }>,
        api.getDiscoverySeeds() as Promise<{ items: Seed[] }>,
      ]);
      setCompetitor(compRes.competitor);
      setSources(srcRes.items);
      setSeeds(seedRes.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không tải được dữ liệu đối thủ.');
    } finally {
      setLoading(false);
    }
  }, [competitorId]);

  useEffect(() => {
    void loadAll();
    const id = setInterval(loadAll, 30_000);
    return () => clearInterval(id);
  }, [loadAll]);

  // Keep URL ?tab=... in sync.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    if (utilityView) {
      url.searchParams.set('modal', utilityView);
    } else {
      url.searchParams.delete('modal');
    }
    if (utilityView === 'tech') {
      url.searchParams.set('sub', techSubTab);
    } else {
      url.searchParams.delete('sub');
    }
    window.history.replaceState(window.history.state, '', url.toString());
  }, [tab, techSubTab, utilityView]);

  const compSources = useMemo(
    () => sources.filter((s) => s.competitor_id === competitorId && s.is_active),
    [sources, competitorId],
  );

  const pendingTotal = useMemo(
    () => seeds.filter((s) => s.competitor_id === competitorId).reduce((sum, s) => sum + s.pending_count, 0),
    [seeds, competitorId],
  );

  function openView(next: DetailTab) {
    if (next === 'tech' || next === 'history') {
      setUtilityView(next);
      return;
    }
    setTab(next);
  }

  async function handleRunAll() {
    if (!competitor) return;
    await Promise.allSettled(compSources.map((src) => api.enqueueCrawlJob(src.id)));
    setUtilityView('tech');
    setTechSubTab('pipeline');
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-quaternary" />
      </div>
    );
  }

  if (error || !competitor) {
    return (
      <div className="px-6 py-6 xl:px-8">
        <EmptyState
          icon={Globe}
          title="Không tìm thấy đối thủ"
          description={error || 'Đối thủ này có thể đã bị xóa hoặc bạn không có quyền xem.'}
          action={
            <Button variant="primary" size="sm" onClick={() => router.push('/monitor')}>
              Quay lại danh sách
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="px-6 py-6 xl:px-8">
      {/* Breadcrumb */}
      <Link
        href="/monitor"
        className="inline-flex items-center gap-1.5 text-caption font-emphasis text-text-tertiary hover:text-brand transition-colors mb-3"
      >
        <ArrowLeft className="h-4 w-4" />
        Quay lại danh sách đối thủ
      </Link>

      {/* Header card */}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-hover text-small font-strong text-white shadow-linear-sm">
            {getInitials(competitor.name)}
          </div>
          <div className="min-w-0">
            <h1 className="text-h1 font-emphasis text-text-primary truncate">{competitor.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <a
                href={`https://${competitor.primary_domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-brand transition-colors"
              >
                <Globe className="h-3 w-3" />
                {competitor.primary_domain}
              </a>
              {competitor.segment && <Badge tone="neutral">{competitor.segment}</Badge>}
              {pendingTotal > 0 && (
                <Badge tone="warning">{pendingTotal} URL mới chờ duyệt</Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && compSources.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              leadingIcon={<Play className="h-3.5 w-3.5" />}
              onClick={handleRunAll}
            >
              Chạy lại tất cả
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Pencil className="h-3.5 w-3.5" />}
              onClick={() => setEditOpen(true)}
            >
              Sửa
            </Button>
          )}
        </div>
      </header>

      {/* Help / context line (collapsible) */}
      <div className="mb-4 rounded-lg border border-[rgb(var(--border-line))] bg-surface-1">
        <button
          type="button"
          onClick={() => setShowInfo((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
        >
          <p className="text-caption text-text-tertiary">
            <span className="text-text-secondary font-emphasis">Quy trình đề xuất:</span>{' '}
            Tổng quan → Nguồn & URL → Tín hiệu → (Kỹ thuật khi cần debug)
          </p>
          {showInfo
            ? <ChevronUp className="h-4 w-4 text-text-quaternary flex-shrink-0" />
            : <ChevronDown className="h-4 w-4 text-text-quaternary flex-shrink-0" />}
        </button>
        {showInfo && (
          <div className="px-4 pb-3 text-caption text-text-tertiary leading-relaxed">
            Bắt đầu ở Tổng quan để xem tình trạng crawl, vào Nguồn & URL để chỉnh độ phủ,
            và Tín hiệu để duyệt các thay đổi AI đã tóm tắt. Kỹ thuật và Lịch sử được gom
            vào modal riêng để thanh điều hướng chính gọn hơn.
          </div>
        )}
      </div>

      {/* Tab nav */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[rgb(var(--border-line))]">
        <div className="flex flex-wrap">
          {PRIMARY_TAB_DEFS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-2.5 text-caption font-emphasis transition-colors border-b-2 -mb-px',
                tab === t.key
                  ? 'text-brand border-brand'
                  : 'text-text-tertiary border-transparent hover:text-text-primary',
              )}
            >
              {t.icon}
              <span>{t.label}</span>
              {t.key === 'sources' && pendingTotal > 0 && (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-warning/15 border border-warning/30 px-1.5 text-tiny font-strong text-warning">
                  {pendingTotal}
                </span>
              )}
            </button>
          ))}
        </div>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Settings className="h-3.5 w-3.5" />}
          onClick={() => setUtilityView('tech')}
        >
          Kỹ thuật & lịch sử
        </Button>
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <OverviewTab
          competitor={competitor}
          seeds={seeds}
          sources={sources}
          onOpenTab={openView}
        />
      )}
      {tab === 'sources' && (
        <SourcesTab
          competitor={competitor}
          seeds={seeds}
          sources={sources}
          isAdmin={isAdmin}
          onRefresh={loadAll}
        />
      )}
      {tab === 'signals' && (
        <SignalsTab competitor={competitor} />
      )}
      {utilityView && (
        <DetailUtilityModal
          view={utilityView}
          onClose={() => setUtilityView(null)}
          onViewChange={setUtilityView}
          competitor={competitor}
          sources={sources}
          isAdmin={isAdmin}
          techSubTab={techSubTab}
          onTechSubTabChange={setTechSubTab}
        />
      )}

      {editOpen && (
        <EditCompetitorModal
          competitor={competitor}
          onClose={() => setEditOpen(false)}
          onSaved={(c) => { setCompetitor(c); setEditOpen(false); }}
        />
      )}
    </div>
  );
}

function DetailUtilityModal({
  view,
  onClose,
  onViewChange,
  competitor,
  sources,
  isAdmin,
  techSubTab,
  onTechSubTabChange,
}: {
  view: UtilityView;
  onClose: () => void;
  onViewChange: (view: UtilityView) => void;
  competitor: Competitor;
  sources: Source[];
  isAdmin: boolean;
  techSubTab: TechSubTab;
  onTechSubTabChange: (sub: TechSubTab) => void;
}) {
  return (
    <AppModalShell
      title="Kỹ thuật & lịch sử"
      description="Nhóm các màn hình phụ vào một modal để phần detail chính tập trung hơn vào nguồn và tín hiệu."
      onClose={onClose}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-1 rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 p-1 self-start">
          {UTILITY_TAB_DEFS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onViewChange(item.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-emphasis transition-colors',
                view === item.key
                  ? 'bg-surface-3 text-text-primary'
                  : 'text-text-tertiary hover:text-text-primary',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        {view === 'tech' ? (
          <TechTab
            competitor={competitor}
            sources={sources}
            isAdmin={isAdmin}
            initialSubTab={techSubTab}
            onSubTabChange={onTechSubTabChange}
          />
        ) : (
          <HistoryTab competitorId={competitor.id} />
        )}
      </div>
    </AppModalShell>
  );
}

function EditCompetitorModal({
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppModalShell
      title="Chỉnh sửa đối thủ"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Hủy</Button>
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
