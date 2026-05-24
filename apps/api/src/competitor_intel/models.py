from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    JSON,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from competitor_intel.constants import EVENT_TYPES, SOURCE_TYPES, USER_ROLES
from competitor_intel.database import Base


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(UTC)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    users: Mapped[list["User"]] = relationship(back_populates="tenant")
    competitors: Mapped[list["Competitor"]] = relationship(back_populates="tenant")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("tenant_id", "email"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), default="admin")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    tenant: Mapped["Tenant"] = relationship(back_populates="users")


class Competitor(Base, TimestampMixin):
    __tablename__ = "competitors"
    __table_args__ = (UniqueConstraint("tenant_id", "slug"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False)
    primary_domain: Mapped[str] = mapped_column(String(255), nullable=False)
    segment: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="competitors")
    sources: Mapped[list["Source"]] = relationship(back_populates="competitor", cascade="all, delete-orphan")
    events: Mapped[list["Event"]] = relationship(back_populates="competitor")


class Source(Base, TimestampMixin):
    __tablename__ = "sources"
    __table_args__ = (UniqueConstraint("tenant_id", "url"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    competitor_id: Mapped[str] = mapped_column(String(36), ForeignKey("competitors.id", ondelete="CASCADE"), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), default="other")
    crawl_frequency_hours: Mapped[int] = mapped_column(Integer, default=48)
    extraction_strategy: Mapped[str] = mapped_column(String(32), default="static_html")
    include_patterns: Mapped[list] = mapped_column(JSON, default=list)
    exclude_patterns: Mapped[list] = mapped_column(JSON, default=list)
    priority: Mapped[str] = mapped_column(String(16), default="medium")
    screenshots_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    page_category: Mapped[str] = mapped_column(String(16), default="other")
    last_crawled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    competitor: Mapped["Competitor"] = relationship(back_populates="sources")
    crawl_jobs: Mapped[list["CrawlJob"]] = relationship(back_populates="source")
    snapshots: Mapped[list["PageSnapshot"]] = relationship(back_populates="source")


class CrawlJob(Base):
    __tablename__ = "crawl_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    trigger_type: Mapped[str] = mapped_column(String(16), default="scheduled")
    status: Mapped[str] = mapped_column(String(16), default="queued")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    http_status: Mapped[int | None] = mapped_column(Integer)
    error_message: Mapped[str | None] = mapped_column(Text)
    log_lines: Mapped[list] = mapped_column(JSON, default=list)
    bytes_fetched: Mapped[int | None] = mapped_column(Integer)
    changes_found: Mapped[int | None] = mapped_column(Integer)
    events_created: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    source: Mapped["Source"] = relationship(back_populates="crawl_jobs")
    snapshot: Mapped["PageSnapshot"] = relationship(back_populates="crawl_job", uselist=False)


class PageSnapshot(Base):
    __tablename__ = "page_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    crawl_job_id: Mapped[str] = mapped_column(String(36), ForeignKey("crawl_jobs.id", ondelete="CASCADE"), nullable=False, unique=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    final_url: Mapped[str] = mapped_column(Text, nullable=False)
    http_status: Mapped[int] = mapped_column(Integer, nullable=False)
    page_title: Mapped[str | None] = mapped_column(Text)
    h1: Mapped[str | None] = mapped_column(Text)
    meta_description: Mapped[str | None] = mapped_column(Text)
    canonical_url: Mapped[str | None] = mapped_column(Text)
    raw_html_object_key: Mapped[str | None] = mapped_column(Text)
    screenshot_object_key: Mapped[str | None] = mapped_column(Text)
    extracted_text: Mapped[str] = mapped_column(Text, nullable=False)
    extracted_blocks: Mapped[list] = mapped_column(JSON, default=list)
    extracted_links: Mapped[list] = mapped_column(JSON, default=list)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    source: Mapped["Source"] = relationship(back_populates="snapshots")
    crawl_job: Mapped["CrawlJob"] = relationship(back_populates="snapshot")
    current_diffs: Mapped[list["DiffRecord"]] = relationship(
        back_populates="current_snapshot",
        foreign_keys="DiffRecord.current_snapshot_id",
    )
    previous_diffs: Mapped[list["DiffRecord"]] = relationship(
        back_populates="previous_snapshot",
        foreign_keys="DiffRecord.previous_snapshot_id",
    )


class SnapshotChunk(Base):
    __tablename__ = "snapshot_chunks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    snapshot_id: Mapped[str] = mapped_column(String(36), ForeignKey("page_snapshots.id", ondelete="CASCADE"), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list] = mapped_column(JSON, default=list)
    embedding_model: Mapped[str | None] = mapped_column(String(64))
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DiffRecord(Base):
    __tablename__ = "diff_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    previous_snapshot_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("page_snapshots.id", ondelete="SET NULL"))
    current_snapshot_id: Mapped[str] = mapped_column(String(36), ForeignKey("page_snapshots.id", ondelete="CASCADE"), nullable=False)
    diff_status: Mapped[str] = mapped_column(String(16), default="detected")
    added_blocks: Mapped[list] = mapped_column(JSON, default=list)
    removed_blocks: Mapped[list] = mapped_column(JSON, default=list)
    changed_headings: Mapped[list] = mapped_column(JSON, default=list)
    changed_ctas: Mapped[list] = mapped_column(JSON, default=list)
    extracted_entities: Mapped[dict] = mapped_column(JSON, default=dict)
    noise_score: Mapped[float | None] = mapped_column(Numeric(5, 4))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    previous_snapshot: Mapped[PageSnapshot | None] = relationship(
        back_populates="previous_diffs",
        foreign_keys=[previous_snapshot_id],
    )
    current_snapshot: Mapped[PageSnapshot] = relationship(
        back_populates="current_diffs",
        foreign_keys=[current_snapshot_id],
    )
    events: Mapped[list["Event"]] = relationship(back_populates="diff_record", cascade="all, delete-orphan")


class Event(Base, TimestampMixin):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    competitor_id: Mapped[str] = mapped_column(String(36), ForeignKey("competitors.id", ondelete="CASCADE"), nullable=False)
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    diff_record_id: Mapped[str] = mapped_column(String(36), ForeignKey("diff_records.id", ondelete="CASCADE"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), default="other")
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_excerpt: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    confidence_score: Mapped[float | None] = mapped_column(Numeric(5, 4))
    impact_score: Mapped[float | None] = mapped_column(Numeric(5, 4))
    urgency: Mapped[str] = mapped_column(String(16), default="medium")
    review_status: Mapped[str] = mapped_column(String(16), default="pending")
    is_report_worthy: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_rationale: Mapped[str | None] = mapped_column(Text)
    prompt_version: Mapped[str | None] = mapped_column(String(64))
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    competitor: Mapped["Competitor"] = relationship(back_populates="events")
    diff_record: Mapped["DiffRecord"] = relationship(back_populates="events")
    reviews: Mapped[list["EventReview"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    report_links: Mapped[list["ReportEvent"]] = relationship(back_populates="event")


class EventReview(Base):
    __tablename__ = "event_reviews"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    reviewer_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    old_value: Mapped[dict | None] = mapped_column(JSON)
    new_value: Mapped[dict | None] = mapped_column(JSON)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    event: Mapped["Event"] = relationship(back_populates="reviews")


class ReportDefinition(Base, TimestampMixin):
    """A named, reusable report configuration. Each time it is triggered, a Report (run) is created."""
    __tablename__ = "report_definitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    report_type: Mapped[str] = mapped_column(String(32), default="overview")
    cadence: Mapped[str] = mapped_column(String(16), default="biweekly")
    cadence_days: Mapped[int] = mapped_column(Integer, default=14)
    focal_competitor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("competitors.id", ondelete="SET NULL"))
    comparison_competitor_ids: Mapped[list] = mapped_column(JSON, default=list)
    auto_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    email_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    email_recipients: Mapped[list] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    runs: Mapped[list["Report"]] = relationship(
        back_populates="definition",
        cascade="all, delete-orphan",
        order_by="Report.created_at.desc()",
    )


class Report(Base, TimestampMixin):
    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    definition_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("report_definitions.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(Text, nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    cadence: Mapped[str] = mapped_column(String(16), default="biweekly")
    report_type: Mapped[str] = mapped_column(String(32), default="overview")
    focal_competitor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("competitors.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(16), default="draft")
    generated_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    approved_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    published_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    executive_summary: Mapped[str | None] = mapped_column(Text)
    key_changes_json: Mapped[list] = mapped_column(JSON, default=list)
    cross_market_patterns: Mapped[str | None] = mapped_column(Text)
    recommended_actions: Mapped[str | None] = mapped_column(Text)
    html_object_key: Mapped[str | None] = mapped_column(Text)
    pdf_object_key: Mapped[str | None] = mapped_column(Text)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    definition: Mapped["ReportDefinition | None"] = relationship(back_populates="runs")
    event_links: Mapped[list["ReportEvent"]] = relationship(back_populates="report", cascade="all, delete-orphan")


class ReportEvent(Base):
    __tablename__ = "report_events"

    report_id: Mapped[str] = mapped_column(String(36), ForeignKey("reports.id", ondelete="CASCADE"), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)
    section: Mapped[str] = mapped_column(String(32), default="key_changes")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    report: Mapped["Report"] = relationship(back_populates="event_links")
    event: Mapped["Event"] = relationship(back_populates="report_links")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(36))
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    changes: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ─── Discovery Seed & Link Models ──────────────────────────────────────────────

LINK_CATEGORIES = ("course", "pricing", "promotion", "enrollment", "news", "other")
# Status of a discovered link: pending = awaiting user decision
LINK_STATUSES = ("pending", "approved", "rejected")


class DiscoverySeed(Base, TimestampMixin):
    """Represents a seed URL that the system periodically scans for new links."""

    __tablename__ = "discovery_seeds"
    __table_args__ = (UniqueConstraint("tenant_id", "seed_url"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    competitor_id: Mapped[str] = mapped_column(String(36), ForeignKey("competitors.id", ondelete="CASCADE"), nullable=False)
    seed_url: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str | None] = mapped_column(String(255))
    scan_frequency_hours: Mapped[int] = mapped_column(Integer, default=24)
    last_scanned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Count of links with status=pending (denormalised for fast badge queries)
    pending_count: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # When True, newly discovered links are auto-approved (Source created) without user review
    auto_approve_new_links: Mapped[bool] = mapped_column(Boolean, default=False)
    # Default source_type and crawl frequency used when auto-approving
    auto_source_type: Mapped[str] = mapped_column(String(32), default="other")
    # When auto_approve_new_links=True, only links whose AI-classified source_type is in
    # this list get auto-approved; others stay pending. Empty/None = all types qualify.
    auto_approve_source_types: Mapped[list] = mapped_column(JSON, default=list)
    auto_crawl_frequency_hours: Mapped[int] = mapped_column(Integer, default=48)

    competitor: Mapped["Competitor"] = relationship()
    links: Mapped[list["DiscoveredLink"]] = relationship(back_populates="seed", cascade="all, delete-orphan")


class DiscoveredLink(Base):
    """An individual link discovered from a DiscoverySeed, categorised by AI."""

    __tablename__ = "discovered_links"
    __table_args__ = (UniqueConstraint("seed_id", "url"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    seed_id: Mapped[str] = mapped_column(String(36), ForeignKey("discovery_seeds.id", ondelete="CASCADE"), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    link_text: Mapped[str | None] = mapped_column(Text)
    page_title: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(32), default="other")
    # AI-classified source_type (course_page/pricing_page/promotion_page/landing_page/blog/other)
    source_type: Mapped[str] = mapped_column(String(32), default="other")
    ai_reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    # Whether this link appeared for the first time in the most recent scan
    is_new: Mapped[bool] = mapped_column(Boolean, default=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # If approved, the Source that was created
    source_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("sources.id", ondelete="SET NULL"))

    seed: Mapped["DiscoverySeed"] = relationship(back_populates="links")


def validate_model_constants() -> None:
    assert USER_ROLES
    assert EVENT_TYPES
    assert SOURCE_TYPES
