import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { formatDateTime } from "@/lib/date";
import type { AuditDashboard } from "@/features/audit-dashboard/types/audit-dashboard";
import { AuditReportingWidget } from "./audit-reporting-widget";

const RAW_TIMESTAMP = "2026-07-25T16:42:00.000Z";

function data(overrides?: Partial<AuditDashboard>): AuditDashboard {
  return {
    total_audit_events: 20,
    events_today: 0,
    events_last_7_days: 0,
    failed_operations: 2,
    user_activity_count: 0,
    production_events: 0,
    inventory_events: 0,
    sales_events: 0,
    purchase_events: 0,
    last_audit_event_at: RAW_TIMESTAMP,
    ...overrides,
  };
}

describe("AuditReportingWidget", () => {
  afterEach(() => {
    cleanup();
  });

  it("formats last_audit_event_at instead of the raw timestamp", () => {
    render(<AuditReportingWidget title="Audit Dashboard" data={data()} />);

    expect(screen.getByText(formatDateTime(RAW_TIMESTAMP))).toBeInTheDocument();
    expect(screen.queryByText(RAW_TIMESTAMP)).not.toBeInTheDocument();
  });

  it("renders a presentation dash when last_audit_event_at is null", () => {
    render(
      <AuditReportingWidget
        title="Audit Dashboard"
        data={data({ last_audit_event_at: null })}
      />,
    );

    expect(screen.getByText(formatDateTime(null))).toBeInTheDocument();
  });
});
