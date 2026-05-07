'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ExternalLink, MessageSquare, Sparkles } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type ScopeCompetitor = { id: string; name: string; primary_domain?: string };
type ScopeSource = { id: string; competitor_id: string; url: string; source_type: string };
type Citation = {
  snapshot_id: string;
  source_id: string;
  source_url: string;
  competitor_name: string | null;
  fetched_at: string;
  snippet: string;
  score: number;
  chunk_index: number;
};

type Turn = {
  id: string;
  question: string;
  answer: string;
  citations: Citation[];
  loading?: boolean;
  error?: string;
};

const SUGGESTIONS = [
  'Đối thủ vừa thay đổi gì về giá?',
  'Có chương trình khuyến mãi nào mới không?',
  'Liệt kê các CTA mới trên trang pricing.',
  'Đối thủ có nhắm enterprise gần đây không?',
];

export default function AskPage() {
  const [scope, setScope] = useState<{ competitors: ScopeCompetitor[]; sources: ScopeSource[] } | null>(null);
  const [selectedCompetitorIds, setSelectedCompetitorIds] = useState<string[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .getAskScope()
      .then((res) => setScope(res as unknown as { competitors: ScopeCompetitor[]; sources: ScopeSource[] }))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const filteredSources = useMemo(() => {
    if (!scope) return [];
    if (selectedCompetitorIds.length === 0) return scope.sources;
    return scope.sources.filter((s) => selectedCompetitorIds.includes(s.competitor_id));
  }, [scope, selectedCompetitorIds]);

  useEffect(() => {
    const allowed = new Set(filteredSources.map((source) => source.id));
    setSelectedSourceIds((prev) => prev.filter((id) => allowed.has(id)));
  }, [filteredSources]);

  function toggle<T>(set: T[], value: T): T[] {
    return set.includes(value) ? set.filter((v) => v !== value) : [...set, value];
  }

  async function submit(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    const turnId = crypto.randomUUID();
    setTurns((prev) => [
      ...prev,
      { id: turnId, question: text, answer: '', citations: [], loading: true },
    ]);
    setQuestion('');
    setBusy(true);
    setError('');
    try {
      const res = (await api.ask({
        question: text,
        competitor_ids: selectedCompetitorIds.length ? selectedCompetitorIds : undefined,
        source_ids: selectedSourceIds.length ? selectedSourceIds : undefined,
      })) as unknown as { answer: string; citations: Citation[]; provider: string; detail: string };
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? { ...t, answer: res.answer, citations: res.citations || [], loading: false }
            : t,
        ),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi gọi Ask';
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId ? { ...t, answer: '', citations: [], loading: false, error: msg } : t,
        ),
      );
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-[calc(100vh-0px)] gap-0" style={{ gridTemplateColumns: 'minmax(260px, 320px) minmax(0, 1fr)' }}>
      {/* LEFT: scope */}
      <aside className="flex flex-col border-r border-[rgb(var(--border-subtle)/0.08)] bg-surface-1 overflow-hidden">
        <div className="px-4 py-4 border-b border-[rgb(var(--border-subtle)/0.08)]">
          <p className="text-tiny font-strong uppercase tracking-[0.12em] text-text-quaternary">Phạm vi</p>
          <p className="mt-0.5 text-caption text-text-tertiary">
            Tick để giới hạn AI chỉ đọc nội dung của đối thủ / nguồn được chọn. Không tick = đọc tất cả.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-4">
          <section>
            <p className="px-1 mb-1.5 text-tiny font-strong uppercase tracking-[0.12em] text-text-quaternary">
              Đối thủ ({scope?.competitors.length ?? 0})
            </p>
            <div className="flex flex-col gap-0.5">
              {scope?.competitors.map((c) => {
                const checked = selectedCompetitorIds.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors',
                      checked ? 'bg-brand/8' : 'hover:bg-surface-2',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setSelectedCompetitorIds((p) => toggle(p, c.id))}
                      className="h-3.5 w-3.5 accent-brand"
                    />
                    <span className="text-caption text-text-primary truncate flex-1">{c.name}</span>
                  </label>
                );
              })}
            </div>
          </section>

          <section>
            <p className="px-1 mb-1.5 text-tiny font-strong uppercase tracking-[0.12em] text-text-quaternary">
              Nguồn ({filteredSources.length})
            </p>
            <div className="flex flex-col gap-0.5">
              {filteredSources.map((s) => {
                const checked = selectedSourceIds.includes(s.id);
                return (
                  <label
                    key={s.id}
                    className={cn(
                      'flex items-start gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors',
                      checked ? 'bg-brand/8' : 'hover:bg-surface-2',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setSelectedSourceIds((p) => toggle(p, s.id))}
                      className="mt-0.5 h-3.5 w-3.5 accent-brand"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-caption text-text-secondary truncate">{s.url}</p>
                      <p className="text-tiny text-text-quaternary">{s.source_type}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          {(selectedCompetitorIds.length > 0 || selectedSourceIds.length > 0) && (
            <button
              type="button"
              onClick={() => {
                setSelectedCompetitorIds([]);
                setSelectedSourceIds([]);
              }}
              className="text-tiny font-emphasis text-text-tertiary hover:text-brand transition-colors px-1"
            >
              Bỏ tất cả lựa chọn
            </button>
          )}
        </div>
      </aside>

      {/* RIGHT: chat */}
      <main className="flex flex-col overflow-hidden">
        <header className="px-6 py-4 border-b border-[rgb(var(--border-subtle)/0.08)]">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand" />
            <h1 className="text-small font-emphasis text-text-primary">Hỏi AI về dữ liệu đã crawl</h1>
          </div>
          <p className="mt-1 text-caption text-text-tertiary">
            Chọn scope bên trái nếu muốn bó hẹp câu trả lời. Không chọn gì = AI đọc trên toàn bộ nguồn đã crawl.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-[rgb(var(--border-subtle)/0.10)] bg-surface-1 px-2 py-0.5 text-tiny text-text-tertiary">
              {selectedCompetitorIds.length > 0 ? `${selectedCompetitorIds.length} đối thủ được chọn` : 'Đang đọc tất cả đối thủ'}
            </span>
            <span className="rounded-full border border-[rgb(var(--border-subtle)/0.10)] bg-surface-1 px-2 py-0.5 text-tiny text-text-tertiary">
              {selectedSourceIds.length > 0 ? `${selectedSourceIds.length} nguồn được chọn` : 'Đang đọc tất cả nguồn'}
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {turns.length === 0 ? (
            <EmptyState onSuggest={submit} />
          ) : (
            <div className="mx-auto max-w-3xl flex flex-col gap-6">
              {turns.map((turn) => (
                <ChatTurn key={turn.id} turn={turn} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="border-t border-[rgb(var(--border-subtle)/0.08)] bg-surface-1 px-6 py-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(question);
            }}
            className="mx-auto max-w-3xl"
          >
            <div className="flex items-end gap-2 rounded-xl border border-[rgb(var(--border-subtle)/0.12)] bg-surface-0 p-2 focus-within:border-brand/50 focus-within:shadow-focus-brand transition-all">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit(question);
                  }
                }}
                placeholder="Hỏi gì đó về đối thủ… (Enter để gửi, Shift+Enter xuống dòng)"
                rows={1}
                className="flex-1 resize-none bg-transparent px-2 py-1.5 text-caption text-text-primary placeholder:text-text-quaternary outline-none max-h-[160px]"
              />
              <button
                type="submit"
                disabled={busy || !question.trim()}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand text-white shadow-linear hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
            {error && <p className="mt-2 text-caption text-danger">{error}</p>}
          </form>
        </div>
      </main>
    </div>
  );
}

function EmptyState({ onSuggest }: { onSuggest: (q: string) => void }) {
  return (
    <div className="mx-auto max-w-2xl flex flex-col items-center text-center pt-12">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 mb-4">
        <MessageSquare className="h-6 w-6 text-brand" />
      </div>
      <h2 className="text-caption font-strong text-text-primary mb-2">Hỏi về bất cứ điều gì đã crawl</h2>
      <p className="text-caption text-text-tertiary mb-6 max-w-md">
        AI đọc lại các snapshot trong DB và trả lời kèm trích dẫn nguồn. Tick scope bên trái để giới hạn câu trả lời.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSuggest(s)}
            className="rounded-lg border border-[rgb(var(--border-subtle)/0.1)] bg-surface-1 px-4 py-3 text-left text-caption text-text-secondary hover:border-brand/40 hover:bg-brand/4 hover:text-text-primary transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatTurn({ turn }: { turn: Turn }) {
  return (
    <div className="flex flex-col gap-3">
      {/* User question */}
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-brand px-4 py-2.5 text-caption text-white">
          {turn.question}
        </div>
      </div>

      {/* Answer */}
      <div className="flex flex-col gap-2">
        <div className="rounded-2xl rounded-tl-md border border-[rgb(var(--border-subtle)/0.1)] bg-surface-1 px-4 py-3">
          {turn.loading ? (
            <div className="flex items-center gap-2 text-caption text-text-tertiary">
              <span className="inline-block h-2 w-2 rounded-full bg-brand animate-pulse" />
              <span className="inline-block h-2 w-2 rounded-full bg-brand animate-pulse [animation-delay:150ms]" />
              <span className="inline-block h-2 w-2 rounded-full bg-brand animate-pulse [animation-delay:300ms]" />
              <span className="ml-1">đang tìm trong dữ liệu…</span>
            </div>
          ) : turn.error ? (
            <p className="text-caption text-danger">{turn.error}</p>
          ) : (
            <div className="prose prose-sm max-w-none text-caption text-text-primary whitespace-pre-wrap leading-relaxed">
              {turn.answer}
            </div>
          )}
        </div>

        {turn.citations.length > 0 && (
          <Panel
            title={`Nguồn trích dẫn (${turn.citations.length})`}
            description="Các đoạn nội dung gốc AI dùng để trả lời. Click để xem snapshot đầy đủ."
            className="!p-4"
          >
            <div className="flex flex-col gap-2">
              {turn.citations.map((c, idx) => (
                <a
                  key={`${c.snapshot_id}-${c.chunk_index}`}
                  href={c.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group rounded-lg border border-[rgb(var(--border-subtle)/0.08)] bg-surface-0 p-3 hover:border-brand/30 hover:bg-brand/3 transition-colors"
                >
                  <div className="flex items-start gap-2 mb-1">
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-brand/10 text-tiny font-strong text-brand">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-caption font-emphasis text-text-primary truncate">
                        {c.competitor_name || 'Unknown'} · {new Date(c.fetched_at).toLocaleDateString('vi-VN')}
                      </p>
                      <p className="text-tiny text-text-quaternary truncate">{c.source_url}</p>
                    </div>
                    <span className="text-tiny text-text-quaternary tabular-nums flex-shrink-0">
                      {(c.score * 100).toFixed(0)}%
                    </span>
                    <ExternalLink className="h-3 w-3 text-text-quaternary group-hover:text-brand transition-colors flex-shrink-0" />
                  </div>
                  <p className="text-caption text-text-secondary line-clamp-3 leading-relaxed">{c.snippet}</p>
                </a>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
