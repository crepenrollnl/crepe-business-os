/**
 * Write-off requests page by role: a seller asks and sees only their own
 * requests; owner/partner decide. No cost is shown to anyone.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { WriteOffRequest } from "../types/write-off-request";

const { useRoleMock, listRequestsMock, listItemOptionsMock, approveMock, rejectMock } =
  vi.hoisted(() => ({
    useRoleMock: vi.fn(),
    listRequestsMock: vi.fn(),
    listItemOptionsMock: vi.fn(),
    approveMock: vi.fn(),
    rejectMock: vi.fn(),
  }));

vi.mock("@/hooks/use-role", () => ({
  useRole: () => useRoleMock(),
}));

vi.mock("@/components/layout/dashboard-layout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../services/write-off-request-service", () => ({
  writeOffRequestService: {
    listRequests: () => listRequestsMock(),
    listItemOptions: () => listItemOptionsMock(),
    approve: (id: string, quantity: number | null) => approveMock(id, quantity),
    reject: (id: string, note: string | null) => rejectMock(id, note),
    requestWriteOff: vi.fn(),
  },
}));

import { WriteOffRequestsPage } from "./write-off-requests-page";

const PENDING_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function request(overrides?: Partial<WriteOffRequest>): WriteOffRequest {
  return {
    id: PENDING_ID,
    item_type: "ingredient",
    ingredient_id: "i-1",
    product_id: null,
    item_name: "Milk",
    unit: "l",
    quantity: 2,
    approved_quantity: null,
    reason: "spoilage",
    note: "Sour",
    status: "pending",
    requested_by: "u-1",
    requested_at: "2026-10-15T10:00:00.000Z",
    decided_by: null,
    decided_at: null,
    decision_note: null,
    is_mine: true,
    ...overrides,
  };
}

function asRole(role: string) {
  useRoleMock.mockReturnValue({ role, loading: false, reload: () => undefined });
}

describe("WriteOffRequestsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listItemOptionsMock.mockResolvedValue({
      data: { dish: [], finished_good: [], ingredient: [] },
      error: null,
    });
    listRequestsMock.mockResolvedValue({
      data: [
        request(),
        request({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          item_name: "Flour",
          unit: "kg",
          status: "approved",
          approved_quantity: 1.5,
          decided_at: "2026-10-15T12:00:00.000Z",
        }),
        request({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          item_name: "Eggs",
          unit: "pcs",
          status: "rejected",
          decision_note: "Not spoiled",
          decided_at: "2026-10-15T12:30:00.000Z",
        }),
      ],
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("gives a seller the form and their own requests, with no Approve or Reject", async () => {
    asRole("seller");

    render(<WriteOffRequestsPage />);

    expect(screen.getByTestId("write-off-request-form")).toBeInTheDocument();
    const mine = await screen.findByTestId("write-off-request-mine");
    expect(mine).toHaveTextContent("Milk");
    expect(mine).toHaveTextContent("Pending");
    expect(mine).toHaveTextContent("Approved (1.5 kg)");
    expect(mine).toHaveTextContent("Rejected");
    expect(mine).toHaveTextContent("Not spoiled");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.queryByText(/€/)).not.toBeInTheDocument();
  });

  it("gives the owner the pending queue with an editable quantity, and the form collapsed", async () => {
    asRole("owner");

    render(<WriteOffRequestsPage />);

    const queue = await screen.findByTestId("write-off-request-queue");
    expect(queue).toHaveTextContent("Milk");
    expect(screen.getByLabelText("Quantity (l)")).toHaveValue("2");
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByTestId("write-off-request-decided")).toHaveTextContent("Flour");
    expect(screen.queryByTestId("write-off-request-form")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New request" }));
    expect(screen.getByTestId("write-off-request-form")).toBeInTheDocument();
  });

  it("approves with the corrected quantity", async () => {
    asRole("partner");
    approveMock.mockResolvedValue({
      data: { id: PENDING_ID, status: "approved", approved_quantity: 1.5 },
      error: null,
    });

    render(<WriteOffRequestsPage />);
    const input = await screen.findByLabelText("Quantity (l)");
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith(PENDING_ID, 1.5));
  });

  it("approves an unchanged quantity as requested (null)", async () => {
    asRole("owner");
    approveMock.mockResolvedValue({
      data: { id: PENDING_ID, status: "approved", approved_quantity: 2 },
      error: null,
    });

    render(<WriteOffRequestsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith(PENDING_ID, null));
  });

  it("keeps the row and shows the error when approval fails", async () => {
    asRole("owner");
    approveMock.mockResolvedValue({
      data: null,
      error: "Insufficient ingredient stock for this write-off.",
    });

    render(<WriteOffRequestsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    expect(
      await screen.findByTestId(`write-off-request-error-${PENDING_ID}`),
    ).toHaveTextContent("Insufficient ingredient stock for this write-off.");
    expect(screen.getByTestId("write-off-request-queue")).toHaveTextContent("Milk");
  });

  it("rejects with the optional note", async () => {
    asRole("owner");
    rejectMock.mockResolvedValue({
      data: { id: PENDING_ID, status: "rejected" },
      error: null,
    });

    render(<WriteOffRequestsPage />);
    fireEvent.change(await screen.findByLabelText("Reject note (optional)"), {
      target: { value: "Not spoiled" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() =>
      expect(rejectMock).toHaveBeenCalledWith(PENDING_ID, "Not spoiled"),
    );
  });

  it("renders only the queue and history on the Inventory Requests tab", async () => {
    asRole("owner");

    render(<WriteOffRequestsPage embedded queueOnly />);

    expect(await screen.findByTestId("write-off-request-queue")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Write-off requests" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New request" })).toBeNull();
  });
});
