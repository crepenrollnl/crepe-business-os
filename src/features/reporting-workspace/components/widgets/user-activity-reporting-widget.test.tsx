import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { formatDateTime } from "@/lib/date";
import type { UserActivityDashboard } from "@/features/user-activity-dashboard/types/user-activity-dashboard";
import { UserActivityReportingWidget } from "./user-activity-reporting-widget";

const RAW_TIMESTAMP = "2026-07-25T16:42:00.000Z";

function data(
  overrides?: Partial<UserActivityDashboard>,
): UserActivityDashboard {
  return {
    active_users_today: 3,
    active_users_last_7_days: 0,
    total_user_actions: 0,
    production_actions: 0,
    inventory_actions: 0,
    purchase_actions: 0,
    sales_actions: 0,
    last_user_activity_at: RAW_TIMESTAMP,
    most_active_user: "Ada Admin",
    average_actions_per_user: null,
    ...overrides,
  };
}

describe("UserActivityReportingWidget", () => {
  afterEach(() => {
    cleanup();
  });

  it("formats last_user_activity_at instead of the raw timestamp", () => {
    render(
      <UserActivityReportingWidget title="User Activity Dashboard" data={data()} />,
    );

    expect(screen.getByText(formatDateTime(RAW_TIMESTAMP))).toBeInTheDocument();
    expect(screen.queryByText(RAW_TIMESTAMP)).not.toBeInTheDocument();
  });

  it("renders a presentation dash when last_user_activity_at is null", () => {
    render(
      <UserActivityReportingWidget
        title="User Activity Dashboard"
        data={data({ last_user_activity_at: null })}
      />,
    );

    expect(screen.getByText(formatDateTime(null))).toBeInTheDocument();
  });
});
