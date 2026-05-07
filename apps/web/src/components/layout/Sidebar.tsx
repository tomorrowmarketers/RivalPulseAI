'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  FileText,
  Globe,
  LayoutDashboard,
  LogOut,
  MessageSquare,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [pendingLinks, setPendingLinks] = useState(0);
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  useEffect(() => {
    function fetchPending() {
      api.getDiscoverySeeds().then((res) => {
        setPendingLinks(res.items.reduce((sum, s) => sum + s.pending_count, 0));
      }).catch(() => {});
    }
    fetchPending();
    const id = setInterval(fetchPending, 30_000);
    return () => clearInterval(id);
  }, []);

  const NAV_ITEMS: NavItem[] = [
    { label: 'Tổng quan', href: '/overview', icon: <LayoutDashboard className="h-4 w-4" /> },
    { label: 'Theo dõi đối thủ', href: '/monitor', icon: <Globe className="h-4 w-4" />, badge: pendingLinks || undefined },
    { label: 'Hỏi AI', href: '/ask', icon: <MessageSquare className="h-4 w-4" /> },
    { label: 'Báo cáo', href: '/reports', icon: <FileText className="h-4 w-4" /> },
  ];

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-[rgb(var(--border-subtle)/0.08)] bg-surface-1 transition-all duration-200',
        isCollapsed ? 'w-14' : 'w-[248px]',
      )}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 py-5">
        <Link
          href="/overview"
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl',
            'bg-gradient-to-br from-brand to-brand-hover text-white text-label font-strong shadow-linear',
          )}
        >
          <BarChart3 className="h-4 w-4" />
        </Link>
        {!isCollapsed && (
          <div className="min-w-0">
            <p className="text-caption font-emphasis text-text-primary truncate">RivalPulse</p>
            <p className="text-tiny text-text-quaternary truncate">Giám sát đối thủ</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-1">
        <div>
          {!isCollapsed && (
            <p className="px-2.5 mb-1.5 text-tiny font-strong uppercase tracking-[0.12em] text-text-quaternary">
              Workspace
            </p>
          )}
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'group flex items-center rounded-lg transition-colors',
                      isCollapsed ? 'h-8 w-8 mx-auto justify-center' : 'h-8 px-2.5 gap-2.5',
                      active
                        ? 'bg-surface-2 text-text-primary'
                        : 'text-text-tertiary hover:bg-surface-2 hover:text-text-primary',
                    )}
                    title={isCollapsed ? item.label : undefined}
                  >
                    <span className={cn('flex-shrink-0 relative', active ? 'text-brand' : 'text-text-tertiary group-hover:text-text-secondary')}>
                      {item.icon}
                      {isCollapsed && item.badge ? (
                        <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-warning" />
                      ) : null}
                    </span>
                    {!isCollapsed && (
                      <>
                        <span className="text-caption font-emphasis truncate flex-1">{item.label}</span>
                        {item.badge ? (
                          <span className="flex-shrink-0 rounded-full bg-warning/15 border border-warning/30 px-1.5 text-tiny font-strong text-warning">
                            {item.badge}
                          </span>
                        ) : null}
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {/* Bottom: user + collapse */}
      <div className="border-t border-[rgb(var(--border-subtle)/0.08)]">
        {user && (
          <div className="px-2 pt-2">
            <button
              onClick={handleLogout}
              className={cn(
                'w-full flex items-center rounded-lg transition-colors hover:bg-surface-2',
                isCollapsed ? 'justify-center py-2' : 'gap-2 px-2 py-1.5',
              )}
              title={isCollapsed ? 'Đăng xuất' : undefined}
            >
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand text-tiny font-strong text-white">
                {getInitials(user.full_name || user.email)}
              </div>
              {!isCollapsed && (
                <>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-caption font-emphasis text-text-primary">
                      {user.full_name || user.email}
                    </p>
                    <p className="truncate text-tiny text-text-quaternary">{user.email}</p>
                  </div>
                  <LogOut className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary" />
                </>
              )}
            </button>
          </div>
        )}
        <div className="p-2">
          <button
            onClick={() => setIsCollapsed((v) => !v)}
            className="flex w-full items-center justify-center rounded-lg h-7 text-text-tertiary hover:bg-surface-2 hover:text-text-primary transition-colors"
            title={isCollapsed ? 'Mở rộng' : 'Thu gọn'}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <span className="inline-flex items-center gap-1.5 text-tiny font-emphasis">
                <ChevronLeft className="h-3.5 w-3.5" />
                Thu gọn
              </span>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
