import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { DEFAULT_ROLE_POLICIES } from "../../../src/types/rbac";

const updateRolePermissions = vi.fn();
const resetRolePermissions = vi.fn();
const setPreviewRole = vi.fn();

let mockWorkspace = {
  id: "ws-test-1",
  name: "Production Workspace",
  role: "admin",
  is_personal: false,
};

let mockRolePermissions = JSON.parse(JSON.stringify(DEFAULT_ROLE_POLICIES));

vi.mock("../../../src/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    activeWorkspace: mockWorkspace,
    rolePermissions: mockRolePermissions,
    updateRolePermissions,
    resetRolePermissions,
    previewRole: null,
    setPreviewRole,
    effectiveRole: "admin",
    canAccessMenu: (menuId: string) => true,
    canPerformAction: (actionId: string) => true,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { RolesPermissionsTab } from "../../../src/components/settings/RolesPermissionsTab";

describe("RolesPermissionsTab Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRolePermissions = JSON.parse(JSON.stringify(DEFAULT_ROLE_POLICIES));
  });

  it("renders RBAC header, simulator, and permission matrix tables", () => {
    render(<RolesPermissionsTab />);

    expect(
      screen.getByText("จัดการสิทธิ์ & การมองเห็นเมนู (RBAC & Menu Visibility)"),
    ).toBeTruthy();
    expect(screen.getByText("จำลองมุมมองบทบาท (Role Simulator)")).toBeTruthy();
    expect(
      screen.getByText("การมองเห็นเมนูในแถบ Sidebar (Menu Visibility Matrix)"),
    ).toBeTruthy();
    expect(
      screen.getByText("สิทธิ์การทำงาน & ความปลอดภัยของข้อมูล (Feature & Query Actions)"),
    ).toBeTruthy();
  });

  it("allows switching role simulator preview", () => {
    render(<RolesPermissionsTab />);

    const viewerBtn = screen.getByRole("button", { name: "👁️ Viewer" });
    fireEvent.click(viewerBtn);

    expect(setPreviewRole).toHaveBeenCalledWith("viewer");

    const editorBtn = screen.getByRole("button", { name: "✏️ Editor" });
    fireEvent.click(editorBtn);

    expect(setPreviewRole).toHaveBeenCalledWith("editor");
  });

  it("toggles menu access for a role", () => {
    render(<RolesPermissionsTab />);

    const toggleBtn = screen.getByLabelText("Toggle Viewer access for SQLite Tools (#17)");
    fireEvent.click(toggleBtn);

    expect(updateRolePermissions).toHaveBeenCalledWith(
      "viewer",
      expect.objectContaining({
        menus: expect.objectContaining({
          sqlite_tools: true,
        }),
      }),
    );
  });

  it("toggles action capability for a role", () => {
    render(<RolesPermissionsTab />);

    const toggleBtn = screen.getByLabelText(
      "Toggle Viewer action for รันคำสั่งเขียน/แก้ไขข้อมูล (Write Queries)",
    );
    fireEvent.click(toggleBtn);

    expect(updateRolePermissions).toHaveBeenCalledWith(
      "viewer",
      expect.objectContaining({
        actions: expect.objectContaining({
          write_queries: true,
        }),
      }),
    );
  });

  it("handles reset to defaults button click", () => {
    render(<RolesPermissionsTab />);

    const resetBtn = screen.getByText("รีเซ็ตค่าเริ่มต้น");
    fireEvent.click(resetBtn);

    expect(resetRolePermissions).toHaveBeenCalled();
  });
});
