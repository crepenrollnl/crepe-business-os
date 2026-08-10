import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { formatDateTime } from "@/lib/date";
import type { ProductionDashboard } from "@/features/production-dashboard/types/production-dashboard";
import { ProductionReportingWidget } from "./production-reporting-widget";

const RAW_TIMESTAMP = "2026-07-25T16:42:00.000Z";

function data(overrides?: Partial<ProductionDashboard>): ProductionDashboard {
  return {
    total_batches: 6,
    completed_batches: 5,
    failed_batches: 0,
    total_finished_goods: 0,
    last_production_date: RAW_TIMESTAMP,
    average_batch_duration: null,
    ...overrides,
  };
}

describe("ProductionReportingWidget", () => {
  afterEach(() => {
    cleanup();
  });

  it("formats last_production_date instead of the raw timestamp", () => {
    render(<ProductionReportingWidget title="Production Dashboard" data={data()} />);

    expect(screen.getByText(formatDateTime(RAW_TIMESTAMP))).toBeInTheDocument();
    expect(screen.queryByText(RAW_TIMESTAMP)).not.toBeInTheDocument();
  });

  it("renders a presentation dash when last_production_date is null", () => {
    render(
      <ProductionReportingWidget
        title="Production Dashboard"
        data={data({ last_production_date: null })}
      />,
    );

    expect(screen.getByText(formatDateTime(null))).toBeInTheDocument();
  });
});
