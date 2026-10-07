import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import PrivacyPage, { metadata } from "./page";

describe("Privacy page", () => {
  it("renders the public policy and does not use AuthGuard", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/privacy/page.tsx"),
      "utf8",
    );
    expect(source).not.toContain("AuthGuard");
    expect(metadata.title).toBe("Privacy Policy — Crepe'n Roll OS");

    render(<PrivacyPage />);

    expect(
      screen.getByRole("heading", { name: "Privacy Policy — Crepe'n Roll OS" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/permission "drive\.file"/)).toBeInTheDocument();
    expect(screen.getByText("crepenroll.nl@gmail.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});
