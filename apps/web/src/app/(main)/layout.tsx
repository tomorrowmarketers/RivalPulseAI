'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { useAuth } from '@/contexts/AuthContext';

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-0">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-brand to-brand-hover animate-pulse" />
        <p className="text-caption text-text-tertiary font-emphasis">Đang tải workspace…</p>
      </div>
    </div>
  );
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return <LoadingScreen />;
  }

  if (status !== 'authenticated') {
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-0">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
