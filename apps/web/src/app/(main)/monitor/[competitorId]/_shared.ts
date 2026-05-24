// Shared types & helpers for the competitor detail tabs.

export type Competitor = {
  id: string;
  name: string;
  primary_domain: string;
  segment?: string;
  created_at?: string;
};

export type Seed = {
  id: string;
  competitor_id: string;
  seed_url: string;
  label: string;
  scan_frequency_hours: number;
  last_scanned_at: string | null;
  pending_count: number;
  is_active: boolean;
  auto_approve_new_links: boolean;
  auto_source_type: string;
  auto_approve_source_types?: string[];
  auto_crawl_frequency_hours: number;
};

export type Source = {
  id: string;
  url: string;
  source_type: string;
  page_category: string;
  page_title?: string | null;
  competitor_id: string;
  created_at?: string | null;
  last_crawled_at?: string | null;
  crawl_frequency_hours: number;
  is_active: boolean;
};

export type SeedLink = {
  id: string;
  url: string;
  link_text: string;
  category: string;
  ai_reason: string;
  status: string;
  is_new: boolean;
  source_id: string | null;
};

export type EventItem = {
  id: string;
  title: string;
  event_type: string;
  summary: string;
  urgency: 'high' | 'medium' | 'low';
  review_status: string;
  is_report_worthy: boolean;
  detected_at?: string;
  captured_at?: string;
  source_url?: string;
  ai_rationale?: string;
  diff?: {
    added_blocks?: string[];
    removed_blocks?: string[];
    changed_headings?: string[];
    changed_ctas?: string[];
  };
};

export type CrawlJob = {
  id: string;
  source_id: string;
  source_url: string | null;
  trigger_type: 'manual' | 'scheduled';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  http_status: number | null;
  error_message: string | null;
  log_lines: { ts: string; level: string; msg: string }[];
  bytes_fetched: number | null;
  changes_found: number | null;
  events_created: number | null;
  created_at: string;
};

export type DetailTab = 'overview' | 'sources' | 'signals' | 'tech' | 'history';
export type TechSubTab = 'pipeline' | 'logs';

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  course_page: 'Trang khóa học',
  pricing_page: 'Trang giá',
  promotion_page: 'Trang khuyến mãi',
  landing_page: 'Landing page',
  blog: 'Blog / Tin tức',
  other: 'Nguồn khác',
};

export const SOURCE_TYPES = ['course_page', 'pricing_page', 'promotion_page', 'landing_page', 'blog', 'other'];

export const CATEGORY_LABELS: Record<string, string> = {
  course: 'Khóa học',
  pricing: 'Bảng giá',
  promotion: 'Khuyến mãi',
  enrollment: 'Tuyển sinh',
  news: 'Tin tức',
  other: 'Khác',
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  product_launch: 'Ra mắt sản phẩm mới',
  product_update: 'Cập nhật sản phẩm',
  pricing_change: 'Thay đổi giá',
  promotion_launch: 'Ra mắt khuyến mãi',
  promotion_update: 'Cập nhật khuyến mãi',
  positioning_change: 'Thay đổi định vị',
  content_campaign: 'Chiến dịch nội dung',
  schedule_change: 'Thay đổi lịch học',
  partnership_update: 'Cập nhật đối tác',
  hiring_signal: 'Tín hiệu tuyển dụng',
  testimonial_or_social_proof: 'Phản hồi / Bằng chứng xã hội',
  enterprise_offer_change: 'Thay đổi gói doanh nghiệp',
  other: 'Thay đổi khác',
};

export const URGENCY_LABELS: Record<string, string> = {
  high: 'Quan trọng',
  medium: 'Bình thường',
  low: 'Thấp',
};

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Đã từ chối',
};

export const CATEGORY_TONES: Record<string, 'brand' | 'success' | 'warning' | 'info' | 'neutral'> = {
  course: 'brand',
  pricing: 'success',
  promotion: 'warning',
  enrollment: 'info',
  news: 'neutral',
  other: 'neutral',
};

export function sourceTypeLabel(value: string): string {
  return SOURCE_TYPE_LABELS[value] ?? value;
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins}p trước`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h trước`;
  return `${Math.floor(hrs / 24)}d trước`;
}

export function formatDuration(secs: number): string {
  if (secs < 60) return `${secs.toFixed(1)}s`;
  return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function logLevelClass(level: string): string {
  if (level === 'error') return 'text-danger';
  if (level === 'warning') return 'text-warning';
  if (level === 'info') return 'text-text-secondary';
  return 'text-text-quaternary';
}
