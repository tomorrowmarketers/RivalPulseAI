'use client';

import { useEffect, useState } from 'react';
import { Clock, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface SnapshotVersion {
  version: number;
  snapshot_id: string;
  fetched_at: string;
  content_hash: string;
  page_title?: string;
  http_status?: number;
  has_changes: boolean;
  change_count: number;
}

interface SourceHistory {
  id: string;
  url: string;
  page_category: string;
  source_type: string;
  is_active: boolean;
  last_crawled_at?: string;
  snapshot_count: number;
  snapshots: SnapshotVersion[];
}

const CAT_LABELS: Record<string, string> = { san_pham: 'San pham', khuyen_mai: 'Khuyen mai', other: 'Khac' };
const CAT_TONES: Record<string, 'brand' | 'warning' | 'neutral'> = { san_pham: 'brand', khuyen_mai: 'warning', other: 'neutral' };

export function HistoryTab({ competitorId }: { competitorId: string }) {
  const [sources, setSources] = useState<SourceHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    api.getCompetitorHistory(competitorId)
      .then((res) => {
        const data = res as { sources: SourceHistory[] };
        setSources(data.sources ?? []);
        if (data.sources?.length) setSelected(data.sources[0].id);
      })
      .finally(() => setLoading(false));
  }, [competitorId]);

  const grouped = sources.reduce<Record<string, SourceHistory[]>>((acc, s) => {
    (acc[s.page_category] ??= []).push(s); return acc;
  }, {});

  const active = sources.find((s) => s.id === selected);

  if (loading) {
    return <div className="py-12 text-center text-caption text-text-tertiary">Dang tai lich su...</div>;
  }
  if (!sources.length) {
    return <div className="py-12 text-center text-caption text-text-tertiary">Chua co du lieu lich su.</div>;
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        {(['san_pham', 'khuyen_mai', 'other'] as const).map((cat) => {
          const items = (grouped[cat] ?? []) as SourceHistory[];
          if (!items.length) return null;
          return (
            <div key={cat} className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 overflow-hidden">
              <div className="px-3 py-2 bg-surface-2/50 border-b border-[rgb(var(--border-line))] flex items-center gap-2">
                <Badge tone={CAT_TONES[cat]}>{CAT_LABELS[cat]}</Badge>
                <span className="text-caption text-text-quaternary">{items.length} trang</span>
              </div>
              <ul className="divide-y divide-[rgb(var(--border-line))]">
                {items.map((src) => {
                  let pathname = src.url;
                  try { pathname = new URL(src.url).pathname || '/'; } catch (_) {}
                  return (
                    <li
                      key={src.id}
                      onClick={() => setSelected(src.id)}
                      className={cn(
                        'px-3 py-2.5 cursor-pointer transition-colors',
                        selected === src.id ? 'bg-brand/8' : 'hover:bg-surface-2/50',
                      )}
                    >
                      <p className="text-caption font-emphasis text-text-primary truncate">{pathname}</p>
                      <p className="text-caption text-text-quaternary">{src.snapshot_count} phien ban</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {active && (
        <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[rgb(var(--border-line))] bg-surface-2/40">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-caption font-emphasis text-text-primary truncate">{active.url}</p>
                <p className="text-caption text-text-quaternary mt-0.5">
                  {active.snapshot_count} phien ban &middot; {active.is_active ? 'Dang theo doi' : 'Da luu tru'}
                </p>
              </div>
              <a href={active.url} target="_blank" rel="noopener noreferrer" className="text-text-quaternary hover:text-brand transition-colors mt-0.5">
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>
          {active.snapshots.length === 0 ? (
            <div className="py-10 text-center text-caption text-text-tertiary">Chua co du lieu. Lich su se hien thi sau lan crawl dau tien.</div>
          ) : (
            <div className="p-5">
              <div className="flex flex-col gap-0">
                {[...active.snapshots].reverse().map((snap, idx) => (
                  <div key={snap.snapshot_id} className="flex gap-3 pb-5 last:pb-0">
                    <div className="flex flex-col items-center flex-shrink-0 w-4">
                      <div className={cn(
                        'w-2.5 h-2.5 rounded-full mt-1 z-10 border-2',
                        snap.has_changes ? 'bg-warning border-warning'
                          : snap.version === 1 ? 'bg-success border-success'
                          : 'bg-surface-3 border-[rgb(var(--border-strong))]',
                      )} />
                      {idx < active.snapshots.length - 1 && (
                        <div className="w-px flex-1 bg-[rgb(var(--border-line))] mt-1" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 pb-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-caption font-emphasis text-text-primary">v{snap.version}</span>
                        {snap.has_changes ? (
                          <Badge tone="warning">{snap.change_count} thay doi</Badge>
                        ) : snap.version === 1 ? (
                          <Badge tone="success">Lan dau</Badge>
                        ) : (
                          <Badge tone="neutral">Khong thay doi</Badge>
                        )}
                        {snap.http_status && snap.http_status !== 200 && (
                          <Badge tone="danger">HTTP {snap.http_status}</Badge>
                        )}
                      </div>
                      {snap.page_title && (
                        <p className="text-caption text-text-secondary mt-0.5">{snap.page_title}</p>
                      )}
                      <p className="text-caption text-text-quaternary mt-0.5 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(snap.fetched_at).toLocaleString('vi-VN')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
