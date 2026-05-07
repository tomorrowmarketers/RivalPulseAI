interface ApiError extends Error {
  status?: number;
  payload?: unknown;
}

async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    },
    ...options,
  });

  if (response.status === 204) {
    return null as T;
  }

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'detail' in data
        ? String((data as Record<string, unknown>).detail)
        : 'Request failed';
    const error: ApiError = new Error(message);
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data as T;
}

export const api = {
  login: (payload: { email: string; password: string }) =>
    request<{ user: { id: string; email: string; full_name?: string; role?: string } }>(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify(payload) }
    ),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  getMe: () =>
    request<{ user: { id: string; email: string; full_name?: string; role?: string } }>(
      '/api/auth/me'
    ),
  getOverview: (days = 14) => request<Record<string, unknown>>(`/api/overview?days=${days}`),
  getSystemStatus: () => request<Record<string, unknown>>('/api/system/status'),
  getCompetitors: () => request<Record<string, unknown>>('/api/competitors'),
  createCompetitor: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>('/api/competitors', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getCompetitor: (competitorId: string) =>
    request<Record<string, unknown>>(`/api/competitors/${competitorId}`),
  updateCompetitor: (competitorId: string, payload: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/competitors/${competitorId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getCompetitorDeleteImpact: (competitorId: string) =>
    request<{
      competitor: { id: string; name: string };
      impact: { sources: number; seeds: number; discovered_links: number; crawl_jobs: number; snapshots: number; events: number };
    }>(`/api/competitors/${competitorId}/delete-impact`),
  deleteCompetitor: (competitorId: string) =>
    request<{ deleted: boolean; id: string }>(`/api/competitors/${competitorId}`, {
      method: 'DELETE',
    }),
  getSources: () => request<Record<string, unknown>>('/api/sources'),
  createSource: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>('/api/sources', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSource: (sourceId: string, payload: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/sources/${sourceId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  discoverSources: (payload: { seed_url: string; include_pattern?: string }) =>
    request<{ seed_url: string; discovered: { url: string; text: string }[]; count: number }>(
      '/api/sources/discover',
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  bulkAddSources: (payload: {
    competitor_id: string;
    urls: string[];
    source_type?: string;
    crawl_frequency_hours?: number;
  }) =>
    request<{ created: number; skipped: number; created_urls: string[] }>('/api/sources/bulk-add', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  runCrawl: (sourceId: string) =>
    request<Record<string, unknown>>(`/api/sources/${sourceId}/crawl`, { method: 'POST' }),
  getSourceTimeline: (sourceId: string) =>
    request<Record<string, unknown>>(`/api/sources/${sourceId}/timeline`),
  getSnapshot: (snapshotId: string, includeHtml = false) =>
    request<Record<string, unknown>>(
      `/api/snapshots/${snapshotId}${includeHtml ? '?include_html=true' : ''}`,
    ),
  getSnapshotDiff: (currentId: string, previousId: string) =>
    request<Record<string, unknown>>(`/api/snapshots/${currentId}/diff/${previousId}`),
  getEvents: (params: Record<string, string> = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    const query = search.toString();
    return request<Record<string, unknown>>(`/api/events${query ? `?${query}` : ''}`);
  },
  reviewEvent: (eventId: string, payload: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/events/${eventId}/review`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  // ── Report Definitions ─────────────────────────────────────────────────────
  getReportDefinitions: () => request<Record<string, unknown>>('/api/reports'),
  createReportDefinition: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>('/api/reports', { method: 'POST', body: JSON.stringify(payload) }),
  getReportDefinition: (defId: string) =>
    request<Record<string, unknown>>(`/api/reports/${defId}`),
  updateReportDefinition: (defId: string, payload: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/reports/${defId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteReportDefinition: (defId: string) =>
    request<Record<string, unknown>>(`/api/reports/${defId}`, { method: 'DELETE' }),
  // ── Report Runs ────────────────────────────────────────────────────────────
  getReportRuns: (defId: string) =>
    request<Record<string, unknown>>(`/api/reports/${defId}/runs`),
  createReportRun: (defId: string, payload: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/reports/${defId}/runs`, { method: 'POST', body: JSON.stringify(payload) }),
  getReportRun: (defId: string, runId: string) =>
    request<Record<string, unknown>>(`/api/reports/${defId}/runs/${runId}`),
  publishReportRun: (defId: string, runId: string) =>
    request<Record<string, unknown>>(`/api/reports/${defId}/runs/${runId}/publish`, { method: 'POST' }),
  sendReportRunEmail: (defId: string, runId: string) =>
    request<Record<string, unknown>>(`/api/reports/${defId}/runs/${runId}/send-email`, { method: 'POST' }),
  // ── Legacy / global ────────────────────────────────────────────────────────
  /** @deprecated Use getReportDefinitions() */
  getReports: () => request<Record<string, unknown>>('/api/reports'),
  getReportSchedule: () => request<Record<string, unknown>>('/api/reports/schedule'),
  /** @deprecated Use createReportDefinition() then createReportRun() */
  createReport: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>('/api/reports', { method: 'POST', body: JSON.stringify(payload) }),
  /** @deprecated Use getReportRun(defId, runId) */
  getReport: (reportId: string) =>
    request<Record<string, unknown>>(`/api/reports/${reportId}`),
  publishReport: (reportId: string) =>
    request<Record<string, unknown>>(`/api/reports/runs/${reportId}/publish`, { method: 'POST' }),
  sendReportEmail: (reportId: string) =>
    request<Record<string, unknown>>(`/api/reports/runs/${reportId}/send-email`, { method: 'POST' }),
  getAskScope: () => request<Record<string, unknown>>('/api/ask/scope'),
  ask: (payload: { question: string; competitor_ids?: string[]; source_ids?: string[] }) =>
    request<Record<string, unknown>>('/api/ask', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adhocReport: (payload: {
    question: string;
    competitor_ids?: string[];
    source_ids?: string[];
    days?: number;
    title?: string;
  }) =>
    request<Record<string, unknown>>('/api/reports/adhoc', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  // ── Discovery ──────────────────────────────────────────────────────────────
  discoveryPreview: (payload: { seed_url: string }) =>
    request<{
      seed_url: string;
      total: number;
      categories: Record<string, string>;
      grouped: Record<string, { url: string; link_text: string; ai_reason: string }[]>;
    }>('/api/discovery/preview', { method: 'POST', body: JSON.stringify(payload) }),
  getDiscoverySeeds: () =>
    request<{
      items: {
        id: string;
        competitor_id: string;
        competitor_name: string;
        seed_url: string;
        label: string;
        scan_frequency_hours: number;
        last_scanned_at: string | null;
        pending_count: number;
        is_active: boolean;
        auto_approve_new_links: boolean;
        auto_source_type: string;
        auto_crawl_frequency_hours: number;
      }[];
    }>('/api/discovery/seeds'),
  createDiscoverySeed: (payload: {
    competitor_id: string;
    seed_url: string;
    label?: string;
    scan_frequency_hours?: number;
    auto_approve_new_links?: boolean;
    auto_source_type?: string;
    auto_crawl_frequency_hours?: number;
    discovered_links?: {
      url: string;
      link_text?: string;
      page_title?: string | null;
      ai_reason?: string;
      category?: string;
    }[];
  }) =>
    request<Record<string, unknown>>('/api/discovery/seeds', { method: 'POST', body: JSON.stringify(payload) }),
  deleteDiscoverySeed: (seedId: string) =>
    request<Record<string, unknown>>(`/api/discovery/seeds/${seedId}`, { method: 'DELETE' }),
  getSeedLinks: (seedId: string, status?: string) =>
    request<{
      seed: Record<string, unknown>;
      grouped: Record<string, { id: string; url: string; link_text: string; category: string; ai_reason: string; status: string; is_new: boolean; source_id: string | null }[]>;
      categories: Record<string, string>;
      total: number;
    }>(`/api/discovery/seeds/${seedId}/links${status ? `?status=${status}` : ''}`),
  approveLinks: (seedId: string, payload: { link_ids: string[]; source_type?: string; crawl_frequency_hours?: number }) =>
    request<{ created_sources: number; source_ids: string[] }>(`/api/discovery/seeds/${seedId}/approve`, {
      method: 'POST', body: JSON.stringify(payload),
    }),
  rejectLinks: (seedId: string, payload: { link_ids: string[] }) =>
    request<{ rejected: number }>(`/api/discovery/seeds/${seedId}/reject`, {
      method: 'POST', body: JSON.stringify(payload),
    }),
  rescanSeed: (seedId: string) =>
    request<{ new_links_found: number }>(`/api/discovery/seeds/${seedId}/rescan`, { method: 'POST' }),
  finalizeSeed: (seedId: string, payload: { selected_ids: string[]; crawl_frequency_hours?: number }) =>
    request<{ active: number; archived: number }>(`/api/discovery/seeds/${seedId}/finalize`, {
      method: 'POST', body: JSON.stringify(payload),
    }),
  updateSeed: (seedId: string, payload: {
    label?: string;
    scan_frequency_hours?: number;
    auto_approve_new_links?: boolean;
    auto_source_type?: string;
    auto_crawl_frequency_hours?: number;
    is_active?: boolean;
  }) =>
    request<{ item: Record<string, unknown> }>(`/api/discovery/seeds/${seedId}`, {
      method: 'PATCH', body: JSON.stringify(payload),
    }),
  getCompetitorEvents: (competitorId: string, params?: { review_status?: string }) => {
    const qs = new URLSearchParams({ competitor_id: competitorId, ...(params ?? {}) }).toString();
    return request<{ competitors: unknown[]; items: unknown[] }>(`/api/events?${qs}`);
  },
  // ── Crawl Jobs ────────────────────────────────────────────────────────────────
  getCrawlJobs: (params?: { competitor_id?: string; source_id?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.competitor_id) qs.set('competitor_id', params.competitor_id);
    if (params?.source_id) qs.set('source_id', params.source_id);
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return request<{
      items: {
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
      }[];
    }>(`/api/crawl-jobs${query ? `?${query}` : ''}`);
  },
  enqueueCrawlJob: (source_id: string) =>
    request<{ item: { id: string; status: string }; already_queued: boolean }>('/api/crawl-jobs', {
      method: 'POST',
      body: JSON.stringify({ source_id }),
    }),
  cancelCrawlJob: (job_id: string) =>
    request<{ item: { id: string; status: string } }>(`/api/crawl-jobs/${job_id}/cancel`, {
      method: 'POST',
    }),
  getCompetitorHistory: (competitorId: string) =>
    request<Record<string, unknown>>(`/api/competitors/${competitorId}/history`),
  getComparisonReport: (days = 30) =>
    request<Record<string, unknown>>(`/api/reports/comparison?days=${days}`),
};
