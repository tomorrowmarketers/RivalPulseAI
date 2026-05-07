from __future__ import annotations

import sys
from datetime import date, timedelta

from competitor_intel.bootstrap import bootstrap
from competitor_intel.database import session_scope
from competitor_intel.models import Source, Tenant, User
from competitor_intel.services.pipeline import enqueue_manual_crawl, process_next_crawl_job
from competitor_intel.services.reports import generate_report


def main(argv: list[str] | None = None) -> int:
    argv = argv or sys.argv[1:]
    if not argv:
        print("Usage: python -m competitor_intel.cli [bootstrap|crawl-now|generate-report]")
        return 1

    command = argv[0]
    if command == "bootstrap":
        bootstrap()
        print("Bootstrap completed.")
        return 0

    if command == "crawl-now":
        if len(argv) < 2:
            print("Usage: python -m competitor_intel.cli crawl-now <source-id>")
            return 1
        source_id = argv[1]
        with session_scope() as db:
            source = db.query(Source).filter(Source.id == source_id).first()
            if source is None:
                print("Source not found.")
                return 1
            job = enqueue_manual_crawl(db, source)
            process_next_crawl_job(db)
            print(f"Processed crawl job {job.id}")
            return 0

    if command == "generate-report":
        with session_scope() as db:
            tenant = db.query(Tenant).first()
            admin = db.query(User).filter(User.tenant_id == tenant.id).first()
            end = date.today()
            start = end - timedelta(days=13)
            artifacts = generate_report(db, tenant.id, admin.id if admin else None, start, end)
            print(f"Generated report {artifacts.report.id}")
            return 0

    print(f"Unknown command: {command}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
