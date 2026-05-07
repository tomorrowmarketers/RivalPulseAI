'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { AppModalShell } from '@/components/ui/AppModalShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { api } from '@/lib/api';

interface Props {
  competitor: { id: string; name: string };
  onClose: () => void;
  onDeleted: (id: string) => void;
}

interface Impact {
  sources: number;
  seeds: number;
  discovered_links: number;
  crawl_jobs: number;
  snapshots: number;
  events: number;
}

const IMPACT_LABELS: Array<[keyof Impact, string]> = [
  ['sources', 'Nguồn URL đang crawl'],
  ['seeds', 'Seed URL khám phá'],
  ['discovered_links', 'Link đã phát hiện'],
  ['crawl_jobs', 'Lần chạy crawl (jobs)'],
  ['snapshots', 'Snapshot trang đã lưu'],
  ['events', 'Tín hiệu / sự kiện AI'],
];

export function ConfirmDeleteCompetitorModal({ competitor, onClose, onDeleted }: Props) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;
    api.getCompetitorDeleteImpact(competitor.id)
      .then((res) => {
        if (!ignore) setImpact(res.impact);
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : 'Không tải được thông tin xóa.');
      })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [competitor.id]);

  const canDelete = confirmText.trim() === competitor.name && !busy;
  const totalImpact = impact ? Object.values(impact).reduce((sum, v) => sum + v, 0) : 0;

  async function handleDelete() {
    if (!canDelete) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteCompetitor(competitor.id);
      onDeleted(competitor.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xóa thất bại.');
      setBusy(false);
    }
  }

  return (
    <AppModalShell
      title="Xóa đối thủ"
      onClose={busy ? () => {} : onClose}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Hủy
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleDelete}
            disabled={!canDelete}
            leadingIcon={busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          >
            {busy ? 'Đang xóa…' : 'Xóa vĩnh viễn'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-lg border border-danger/20 bg-danger/5 p-3">
          <AlertTriangle className="h-4 w-4 text-danger flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-small font-emphasis text-danger">Hành động không thể hoàn tác</p>
            <p className="mt-1 text-caption text-text-secondary leading-relaxed">
              Toàn bộ dữ liệu liên quan đến <strong className="text-text-primary">{competitor.name}</strong>{' '}
              sẽ bị xóa vĩnh viễn khỏi hệ thống. Báo cáo đã sinh trước đó sẽ giữ nguyên nhưng các tín hiệu
              liên kết bên trong báo cáo sẽ biến mất.
            </p>
          </div>
        </div>

        {/* Impact list */}
        <div>
          <p className="text-tiny font-strong uppercase tracking-[0.08em] text-text-quaternary mb-2">
            Sẽ bị xóa cùng lúc
          </p>
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-text-quaternary" />
            </div>
          ) : impact ? (
            <ul className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 divide-y divide-[rgb(var(--border-line))] overflow-hidden">
              {IMPACT_LABELS.map(([key, label]) => {
                const count = impact[key];
                return (
                  <li
                    key={key}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <span className="text-caption text-text-secondary">{label}</span>
                    <span className={`text-caption font-emphasis tabular-nums ${count > 0 ? 'text-text-primary' : 'text-text-quaternary'}`}>
                      {count}
                    </span>
                  </li>
                );
              })}
              <li className="flex items-center justify-between px-3 py-2 bg-surface-2/50">
                <span className="text-caption font-emphasis text-text-primary">Tổng cộng</span>
                <span className="text-small font-strong tabular-nums text-text-primary">{totalImpact}</span>
              </li>
            </ul>
          ) : (
            <p className="text-caption text-text-tertiary">Không lấy được thông tin tác động.</p>
          )}
        </div>

        {/* Confirm typing */}
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-emphasis text-text-secondary">
            Gõ <code className="rounded bg-surface-2 px-1.5 py-0.5 text-text-primary font-mono text-tiny">{competitor.name}</code> để xác nhận
          </span>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={competitor.name}
            invalid={confirmText.length > 0 && confirmText.trim() !== competitor.name}
            autoFocus
            disabled={busy}
          />
        </label>

        {error && (
          <p className="rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-caption text-danger">
            {error}
          </p>
        )}
      </div>
    </AppModalShell>
  );
}
