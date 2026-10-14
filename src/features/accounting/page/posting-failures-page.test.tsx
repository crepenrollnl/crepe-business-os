import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { useRoleMock, listUnresolvedMock } = vi.hoisted(() => ({
  useRoleMock: vi.fn(),
  listUnresolvedMock: vi.fn(),
}));

vi.mock("@/components/layout/dashboard-layout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/use-role", () => ({
  useRole: () => useRoleMock(),
}));

function asRole(role: string | null) {
  useRoleMock.mockReturnValue({ role, loading: false, reload: () => undefined });
}

vi.mock("../services/posting-failures-service", () => ({
  postingFailuresService: {
    listUnresolved: () => listUnresolvedMock(),
    resolve: vi.fn(),
    repost: vi.fn(),
  },
}));

import { PostingFailuresPage } from "./posting-failures-page";

describe("PostingFailuresPage", () => {
  afterEach(cleanup);

  it("tells a seller that only the owner or a partner can see posting failures", async () => {
    asRole("seller");

    render(<PostingFailuresPage />);

    await waitFor(() =>
      expect(screen.getByTestId("posting-failures-denied")).toHaveTextContent(
        "Only the owner or a partner can see posting failures.",
      ),
    );
    expect(listUnresolvedMock).not.toHaveBeenCalled();
  });

  it("shows the list for the owner", async () => {
    asRole("owner");
    listUnresolvedMock.mockResolvedValue({ data: [], error: null });

    render(<PostingFailuresPage />);

    await waitFor(() =>
      expect(
        screen.getByText("No unresolved posting failures"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("posting-failures-denied")).not.toBeInTheDocument();
  });
});
