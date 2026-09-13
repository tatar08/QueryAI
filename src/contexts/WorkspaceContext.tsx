import { getWebSession, selectWebWorkspace, webMode } from "../utils/webSession";
import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  type WorkspaceRole,
  type RolePermissionsMap,
  type RolePolicy,
  type RoleMenuPermissions,
  type RoleActionPermissions,
  DEFAULT_ROLE_POLICIES,
} from "../types/rbac";

export interface Workspace {
  id: string;
  name: string;
  role: WorkspaceRole;
  is_personal: boolean;
  createdAt?: string;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  email?: string;
  display_name?: string;
  created_at?: string;
}

export interface WorkspaceContextType {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  setActiveWorkspace: (ws: Workspace) => void;
  members: WorkspaceMember[];
  isLoading: boolean;
  isMembersLoading: boolean;
  createWorkspace: (name: string) => Promise<Workspace>;
  loadMembers: (workspaceId: string) => Promise<void>;
  addMember: (workspaceId: string, email: string, role: string) => Promise<void>;
  removeMember: (workspaceId: string, userId: string) => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  isTeamModalOpen: boolean;
  setIsTeamModalOpen: (open: boolean) => void;
  // RBAC & Menu Visibility
  rolePermissions: RolePermissionsMap;
  updateRolePermissions: (role: WorkspaceRole, partialPolicy: Partial<RolePolicy>) => void;
  resetRolePermissions: () => void;
  canAccessMenu: (menuId: keyof RoleMenuPermissions) => boolean;
  canPerformAction: (actionId: keyof RoleActionPermissions) => boolean;
  previewRole: WorkspaceRole | null;
  setPreviewRole: (role: WorkspaceRole | null) => void;
  effectiveRole: WorkspaceRole;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

const ACTIVE_WORKSPACE_KEY = "tabularis_active_workspace_id";
const PERMISSIONS_STORAGE_PREFIX = "tabularis_workspace_permissions_";

export const WorkspaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspaceState] = useState<Workspace | null>(() => webMode ? getWebSession().workspace : null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMembersLoading, setIsMembersLoading] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);

  const refreshWorkspaces = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await invoke<Workspace[]>("list_workspaces");
      if (Array.isArray(list) && list.length > 0) {
        setWorkspaces(list);
        const savedId = webMode ? getWebSession().workspace?.id : localStorage.getItem(ACTIVE_WORKSPACE_KEY);
        const matched = list.find((w) => w.id === savedId) || list[0];
        setActiveWorkspaceState(matched);
      } else {
        setWorkspaces([]);
        setActiveWorkspaceState(null);
      }
    } catch (e) {
      console.error("Failed to load workspaces:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshWorkspaces();
  }, [refreshWorkspaces]);

  const setActiveWorkspace = (ws: Workspace) => {
    if (webMode) selectWebWorkspace(ws);
    setActiveWorkspaceState(ws);
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, ws.id);
  };

  const loadMembers = useCallback(async (workspaceId: string) => {
    setIsMembersLoading(true);
    try {
      const list = await invoke<WorkspaceMember[]>("get_workspace_members", { workspaceId });
      setMembers(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error("Failed to load workspace members:", e);
    } finally {
      setIsMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeWorkspace?.id) {
      loadMembers(activeWorkspace.id);
    }
  }, [activeWorkspace?.id, loadMembers]);

  const createWorkspace = async (name: string): Promise<Workspace> => {
    try {
      const newWs = await invoke<Workspace>("create_workspace", { name });
      await refreshWorkspaces();
      if (newWs) {
        setActiveWorkspace(newWs);
      }
      return newWs;
    } catch (e) {
      console.error("Failed to create workspace:", e);
      throw e;
    }
  };

  const addMember = async (workspaceId: string, email: string, role: string) => {
    try {
      await invoke("add_workspace_member", { workspaceId, email, role });
      await loadMembers(workspaceId);
    } catch (e) {
      console.error("Failed to add workspace member:", e);
      throw e;
    }
  };

  const removeMember = async (workspaceId: string, userId: string) => {
    try {
      await invoke("remove_workspace_member", { workspaceId, userId });
      await loadMembers(workspaceId);
    } catch (e) {
      console.error("Failed to remove workspace member:", e);
      throw e;
    }
  };

  const [previewRole, setPreviewRole] = useState<WorkspaceRole | null>(null);
  const [rolePermissions, setRolePermissions] = useState<RolePermissionsMap>(DEFAULT_ROLE_POLICIES);

  // Load permissions whenever active workspace changes
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    try {
      const stored = localStorage.getItem(`${PERMISSIONS_STORAGE_PREFIX}${activeWorkspace.id}`);
      if (stored) {
        setRolePermissions(JSON.parse(stored));
      } else {
        setRolePermissions(DEFAULT_ROLE_POLICIES);
      }
    } catch {
      setRolePermissions(DEFAULT_ROLE_POLICIES);
    }
  }, [activeWorkspace?.id]);

  const updateRolePermissions = useCallback((role: WorkspaceRole, partialPolicy: Partial<RolePolicy>) => {
    setRolePermissions((prev) => {
      const current = prev[role];
      const updated: RolePolicy = {
        menus: { ...current.menus, ...(partialPolicy.menus || {}) },
        actions: { ...current.actions, ...(partialPolicy.actions || {}) },
      };
      const nextMap = { ...prev, [role]: updated };
      if (activeWorkspace?.id) {
        try {
          localStorage.setItem(`${PERMISSIONS_STORAGE_PREFIX}${activeWorkspace.id}`, JSON.stringify(nextMap));
        } catch {
          // Ignored
        }
      }
      return nextMap;
    });
  }, [activeWorkspace?.id]);

  const resetRolePermissions = useCallback(() => {
    setRolePermissions(DEFAULT_ROLE_POLICIES);
    if (activeWorkspace?.id) {
      try {
        localStorage.setItem(`${PERMISSIONS_STORAGE_PREFIX}${activeWorkspace.id}`, JSON.stringify(DEFAULT_ROLE_POLICIES));
      } catch {
        // Ignored
      }
    }
  }, [activeWorkspace?.id]);

  const effectiveRole: WorkspaceRole = webMode ? (activeWorkspace?.role || "viewer") : (previewRole || activeWorkspace?.role || "admin");

  const canAccessMenu = useCallback((menuId: keyof RoleMenuPermissions): boolean => {
    if (webMode) {
      if (["mcp", "monitor", "postgres_tools", "sqlite_tools", "design_system"].includes(menuId)) return false;
      if (menuId === "connections") return true;
      if (menuId === "team") return effectiveRole === "owner" || effectiveRole === "admin";
    }
    if (effectiveRole === "owner") {
      // Allow owner to explicitly hide optional/community items like discord
      if (menuId === "discord") {
        return rolePermissions.owner?.menus?.discord !== false;
      }
      return true;
    }
    const policy = rolePermissions[effectiveRole];
    if (!policy || !policy.menus) return true;
    return policy.menus[menuId] !== false;
  }, [effectiveRole, rolePermissions]);

  const canPerformAction = useCallback((actionId: keyof RoleActionPermissions): boolean => {
    if (webMode) return DEFAULT_ROLE_POLICIES[effectiveRole].actions[actionId];
    if (effectiveRole === "owner") return true;
    const policy = rolePermissions[effectiveRole];
    if (!policy || !policy.actions) return true;
    return policy.actions[actionId] !== false;
  }, [effectiveRole, rolePermissions]);

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspace,
        setActiveWorkspace,
        members,
        isLoading,
        isMembersLoading,
        createWorkspace,
        loadMembers,
        addMember,
        removeMember,
        refreshWorkspaces,
        isTeamModalOpen,
        setIsTeamModalOpen,
        rolePermissions,
        updateRolePermissions,
        resetRolePermissions,
        canAccessMenu,
        canPerformAction,
        previewRole,
        setPreviewRole,
        effectiveRole,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return context;
};
