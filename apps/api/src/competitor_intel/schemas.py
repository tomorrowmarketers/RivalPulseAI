from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from competitor_intel.constants import MARKET_SEGMENTS


def _normalize_market_segment(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if normalized not in MARKET_SEGMENTS:
        raise ValueError(f"segment must be one of: {', '.join(MARKET_SEGMENTS)}")
    return normalized


class SourceCreate(BaseModel):
    competitor_id: str
    url: str
    source_type: str = "other"
    crawl_frequency_hours: int = 48
    extraction_strategy: str = "static_html"
    priority: str = "medium"
    screenshots_enabled: bool = False


class DiscoverRequest(BaseModel):
    seed_url: str
    include_pattern: str | None = None  # optional regex to filter discovered links


class BulkSourceCreate(BaseModel):
    competitor_id: str
    urls: list[str]
    source_type: str = "other"
    crawl_frequency_hours: int = 48
    extraction_strategy: str = "static_html"
    priority: str = "medium"


class DiscoveryPreviewRequest(BaseModel):
    seed_url: str


class PreviewDiscoveredLink(BaseModel):
    url: str
    link_text: str = ""
    page_title: str | None = None
    ai_reason: str = ""
    category: str = "other"


class DiscoverySeedCreate(BaseModel):
    competitor_id: str
    seed_url: str
    label: str | None = None
    scan_frequency_hours: int = 24
    auto_approve_new_links: bool = False
    auto_source_type: str = "other"
    auto_crawl_frequency_hours: int = 48
    discovered_links: list[PreviewDiscoveredLink] = Field(default_factory=list)


class DiscoverySeedUpdate(BaseModel):
    label: str | None = None
    scan_frequency_hours: int | None = None
    auto_approve_new_links: bool | None = None
    auto_source_type: str | None = None
    auto_crawl_frequency_hours: int | None = None
    is_active: bool | None = None


class ApproveLinkRequest(BaseModel):
    link_ids: list[str]
    source_type: str = "other"
    crawl_frequency_hours: int = 48


class RejectLinkRequest(BaseModel):
    link_ids: list[str]


class SourceUpdate(BaseModel):
    source_type: str | None = None
    crawl_frequency_hours: int | None = None
    extraction_strategy: str | None = None
    priority: str | None = None
    screenshots_enabled: bool | None = None
    is_active: bool | None = None


class CompetitorCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    slug: str | None = None
    primary_domain: str
    segment: str | None = None
    notes: str | None = None

    @field_validator("segment")
    @classmethod
    def validate_segment(cls, value: str | None) -> str | None:
        return _normalize_market_segment(value)


class CompetitorUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    primary_domain: str | None = None
    segment: str | None = None
    notes: str | None = None

    @field_validator("segment")
    @classmethod
    def validate_segment(cls, value: str | None) -> str | None:
        return _normalize_market_segment(value)


class EventReviewUpdate(BaseModel):
    action: str
    event_type: str | None = None
    summary: str | None = None
    urgency: str | None = None
    note: str | None = None
    is_report_worthy: bool | None = None


class ReportDefinitionCreate(BaseModel):
    title: str
    report_type: str = "overview"
    cadence: str = "biweekly"
    cadence_days: int = 14
    focal_competitor_id: str | None = None
    comparison_competitor_ids: list[str] = Field(default_factory=list)
    auto_enabled: bool = False
    email_enabled: bool = False
    email_recipients: list[str] = Field(default_factory=list)


class ReportDefinitionUpdate(BaseModel):
    title: str | None = None
    report_type: str | None = None
    cadence: str | None = None
    cadence_days: int | None = None
    focal_competitor_id: str | None = None
    comparison_competitor_ids: list[str] | None = None
    auto_enabled: bool | None = None
    email_enabled: bool | None = None
    email_recipients: list[str] | None = None
    is_active: bool | None = None


class ReportRunCreate(BaseModel):
    """Create a new run for an existing report definition."""
    period_start: date
    period_end: date
    title: str | None = None  # override the default generated title
    event_ids: list[str] = Field(default_factory=list)


class ReportCreate(BaseModel):
    """Legacy: create a definition + immediately run it (used from old flow)."""
    title: str | None = None
    cadence: str = "biweekly"
    period_start: date
    period_end: date
    event_ids: list[str] = Field(default_factory=list)
    report_type: str = "overview"
    focal_competitor_id: str | None = None
    comparison_competitor_ids: list[str] = Field(default_factory=list)


class AskRequest(BaseModel):
    question: str
    competitor_ids: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)


class AdhocReportRequest(BaseModel):
    question: str
    competitor_ids: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    days: int = 14
    title: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class ReviewEventRequest(BaseModel):
    action: str
    event_type: str | None = None
    summary: str | None = None
    urgency: str | None = None
    note: str | None = None
    is_report_worthy: bool | None = None


class EventCard(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    competitor_name: str
    title: str
    event_type: str
    urgency: str
    review_status: str
    detected_at: datetime
    confidence_score: float | None = None
    source_url: str
    is_report_worthy: bool


class DashboardData(BaseModel):
    competitors_tracked: int
    monitored_urls: int
    new_events: int
    high_priority_events: int
    pending_reviews: int
    latest_events: list[dict[str, Any]] = Field(default_factory=list)
    top_competitors: list[dict[str, Any]] = Field(default_factory=list)
