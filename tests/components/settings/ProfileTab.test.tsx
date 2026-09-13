import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

vi.mock("../../../src/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    activeWorkspace: {
      id: "ws-test-1",
      name: "Test Workspace",
      role: "Owner",
    },
    effectiveRole: "admin",
    canPerformAction: vi.fn(() => true),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { ProfileTab } from "../../../src/components/settings/ProfileTab";

describe("ProfileTab Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders unauthenticated state when user is not logged in", async () => {
    mockInvoke.mockResolvedValueOnce({
      authenticated: false,
      token: null,
      user: null,
    });

    render(<ProfileTab />);

    await waitFor(() => {
      expect(screen.getByText("ยังไม่ได้เข้าสู่ระบบ (Not Authenticated)")).toBeTruthy();
    });

    expect(screen.getByText("เข้าสู่ระบบ / ลงทะเบียนด้วย PIN")).toBeTruthy();
  });

  it("renders profile details when user is authenticated", async () => {
    const fakePayload = btoa(JSON.stringify({ iss: "tabularis", sub: "usr_alice", exp: Math.floor(Date.now() / 1000) + 3600 }));
    const fakeToken = `header.${fakePayload}.signature`;

    mockInvoke.mockResolvedValueOnce({
      authenticated: true,
      token: fakeToken,
      user: {
        id: "usr_alice_12345",
        username: "alice",
        display_name: "Alice Developer",
        recovery_email: "alice@example.com",
      },
    });

    render(<ProfileTab />);

    await waitFor(() => {
      expect(screen.getByText("Alice Developer")).toBeTruthy();
    });

    expect(screen.getByText("JWT Active (HS256)")).toBeTruthy();
    expect(screen.getByText("Owner")).toBeTruthy();
    expect(screen.getByText("Test Workspace")).toBeTruthy();
    expect(screen.getByText("ออกจากระบบ (Logout)")).toBeTruthy();
    expect(screen.getByText("Active JWT Token (HS256)")).toBeTruthy();
  });

  it("toggles Change PIN form and validates input", async () => {
    const fakePayload = btoa(JSON.stringify({ iss: "tabularis", sub: "usr_bob" }));
    const fakeToken = `h.${fakePayload}.s`;

    mockInvoke.mockResolvedValueOnce({
      authenticated: true,
      token: fakeToken,
      user: {
        id: "usr_bob_12345",
        username: "bob",
        display_name: "Bob Builder",
      },
    });

    render(<ProfileTab />);

    await waitFor(() => {
      expect(screen.getByText("Bob Builder")).toBeTruthy();
    });

    const toggleBtn = screen.getByText("เปลี่ยนรหัส PIN (Change PIN)");
    fireEvent.click(toggleBtn);

    expect(screen.getByText("กำหนดรหัส PIN ใหม่")).toBeTruthy();

    const submitBtn = screen.getByText("บันทึกรหัส PIN ใหม่") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });
});
