'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function LoginPage() {
  const { login, status } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    email: 'admin@rivalpulse.local',
    password: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/overview');
    }
  }, [status, router]);

  function updateField(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await login(form);
      router.replace('/overview');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-0 px-6 py-8"
         style={{
           backgroundImage:
             'radial-gradient(circle at top right, rgba(113,112,255,0.16), transparent 22%), radial-gradient(circle at 15% 0%, rgba(94,106,210,0.08), transparent 24%)',
         }}
    >
      <div className="w-full" style={{ maxWidth: '1120px' }}>
        <div className="grid gap-10 items-center" style={{ gridTemplateColumns: 'minmax(0,1.25fr) minmax(360px,420px)' }}>
          {/* Hero */}
          <div className="flex flex-col gap-[18px]">
            <span className="inline-flex items-center rounded-full border border-[rgb(var(--border-subtle)/0.08)] bg-[rgb(var(--surface-1)/0.4)] px-3 py-1.5 text-tiny font-emphasis text-text-tertiary w-fit">
              Workspace theo phong cách Linear
            </span>
            <h1 className="max-w-xl text-display font-emphasis tracking-display text-text-primary">
              Theo dõi đối thủ trước khi thị trường kịp nhận ra.
            </h1>
            <p className="max-w-lg text-body-lg text-text-tertiary">
              RivalPulse chuyển thay đổi website thành hàng đợi duyệt gọn gàng, rồi thành báo cáo để team hành động ngay.
            </p>
            <div className="flex flex-col gap-3 mt-1">
              {[
                'Cài một lần. Theo dõi các trang chủ chốt. Chỉ duyệt những thay đổi quan trọng.',
                'Thiết kế để giữ workspace luôn gọn dù tín hiệu đầu vào nhiễu loạn.',
              ].map((line) => (
                <p key={line} className="text-caption text-text-secondary flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-brand flex-shrink-0" />
                  {line}
                </p>
              ))}
            </div>
          </div>

          {/* Login form */}
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-5 rounded-[22px] border border-[rgb(var(--border-subtle)/0.08)] bg-surface-1 p-7 shadow-linear-lg"
          >
            <div className="flex flex-col gap-1">
              <p className="text-tiny font-strong uppercase tracking-[0.12em] text-text-quaternary">
                Truy cập workspace
              </p>
              <h2 className="text-caption font-strong text-text-primary">Đăng nhập</h2>
            </div>

            {error && (
              <div className="rounded-lg border border-danger/30 bg-danger/8 px-3 py-2.5 text-caption text-danger">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-caption font-emphasis text-text-secondary">Email</label>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={updateField}
                required
                className="w-full rounded-md border border-[rgb(var(--border-subtle)/0.12)] bg-surface-0 px-3.5 py-2.5 text-caption text-text-primary placeholder:text-text-quaternary outline-none focus:border-brand/55 focus:shadow-focus-brand transition-all"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-caption font-emphasis text-text-secondary">Mật khẩu</label>
              <input
                name="password"
                type="password"
                value={form.password}
                onChange={updateField}
                required
                className="w-full rounded-md border border-[rgb(var(--border-subtle)/0.12)] bg-surface-0 px-3.5 py-2.5 text-caption text-text-primary placeholder:text-text-quaternary outline-none focus:border-brand/55 focus:shadow-focus-brand transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-brand px-4 py-2.5 text-caption font-emphasis text-white shadow-linear transition-all hover:bg-brand-hover disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
