import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { PosQueueOrder } from "../hooks/use-pos-queue";
import { QUEUE_WAIT_LEVEL_CLASS } from "../utils/queue-wait-timer";
import { PosQueuePane } from "./pos-queue-pane";

const CONFIRMED_AT = "2026-08-20T08:00:00.000Z";
const PRODUCT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const idleHandlers = {
  loading: false,
  error: null,
  actionError: null,
  fulfillingId: null,
  payingId: null,
  onRetry: vi.fn(),
  onMarkFulfilled: vi.fn(),
  onMarkPaid: vi.fn(),
};

function order(overrides?: Partial<PosQueueOrder>): PosQueueOrder {
  return {
    sale_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sale_number: "S-000034",
    confirmed_at: CONFIRMED_AT,
    total: 28.5,
    is_paid: false,
    kitchen_note: null,
    lines: [{ product_id: PRODUCT_ID, quantity: 3, name: "Chicken Crepe" }],
    ...overrides,
  };
}

function waitTimer(): HTMLTimeElement {
  return screen.getByLabelText(/Waiting /);
}

describe("PosQueuePane wait timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows a live mm:ss wait clock from confirmed_at at normal color under 5 minutes", () => {
    vi.setSystemTime(new Date("2026-08-20T08:03:45.000Z"));

    render(<PosQueuePane {...idleHandlers} items={[order()]} />);

    const timer = waitTimer();
    expect(timer).toHaveTextContent("3:45");
    expect(timer).toHaveClass(QUEUE_WAIT_LEVEL_CLASS.normal);
    expect(timer).not.toHaveClass(QUEUE_WAIT_LEVEL_CLASS.warning);
    expect(timer).not.toHaveClass(QUEUE_WAIT_LEVEL_CLASS.critical);
  });

  it("uses warning color from exactly 5 minutes", () => {
    vi.setSystemTime(new Date("2026-08-20T08:05:00.000Z"));

    render(<PosQueuePane {...idleHandlers} items={[order()]} />);

    const timer = waitTimer();
    expect(timer).toHaveTextContent("5:00");
    expect(timer).toHaveClass(QUEUE_WAIT_LEVEL_CLASS.warning);
  });

  it("uses critical color from exactly 10 minutes", () => {
    vi.setSystemTime(new Date("2026-08-20T08:10:00.000Z"));

    render(<PosQueuePane {...idleHandlers} items={[order()]} />);

    const timer = waitTimer();
    expect(timer).toHaveTextContent("10:00");
    expect(timer).toHaveClass(QUEUE_WAIT_LEVEL_CLASS.critical);
  });

  it("keeps h:mm:ss readable after an hour in the queue", () => {
    vi.setSystemTime(new Date("2026-08-20T09:05:30.000Z"));

    render(<PosQueuePane {...idleHandlers} items={[order()]} />);

    expect(waitTimer()).toHaveTextContent("1:05:30");
    expect(waitTimer()).toHaveClass(QUEUE_WAIT_LEVEL_CLASS.critical);
  });

  it("does not render a wait timer when confirmed_at is missing", () => {
    vi.setSystemTime(new Date("2026-08-20T08:03:45.000Z"));

    render(
      <PosQueuePane
        {...idleHandlers}
        items={[order({ confirmed_at: null })]}
      />,
    );

    expect(screen.queryByLabelText(/Waiting /)).not.toBeInTheDocument();
    expect(screen.getByText("S-000034")).toBeVisible();
  });
});
