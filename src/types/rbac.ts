export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

export interface RoleMenuPermissions {
  connections: boolean;      // Database Connections (/connections)
  editor: boolean;           // SQL Editor & Console (/editor)
  mcp: boolean;              // MCP Server (/mcp)
  monitor: boolean;          // Server & Database Monitor (Live telemetry, QPS, Active Queries)
  team: boolean;             // Team Collaboration modal
  postgres_tools: boolean;   // PostgreSQL Tools modal
  sqlite_tools: boolean;     // SQLite Diagnostics modal
  design_system: boolean;    // Design System modal
  settings: boolean;         // Settings page (/settings)
  discord: boolean;          // Community Discord button in sidebar
}

export interface RoleActionPermissions {
  write_queries: boolean;      // Execute INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE
  create_connections: boolean; // Add, update, or remove database connections
  export_data: boolean;        // Export query results / data transfer wizard
  manage_members: boolean;     // Invite or remove workspace members
}

export interface RolePolicy {
  menus: RoleMenuPermissions;
  actions: RoleActionPermissions;
}

export type RolePermissionsMap = Record<WorkspaceRole, RolePolicy>;

export const DEFAULT_ROLE_POLICIES: RolePermissionsMap = {
  owner: {
    menus: {
      connections: true,
      editor: true,
      mcp: true,
      monitor: true,
      team: true,
      postgres_tools: true,
      sqlite_tools: true,
      design_system: true,
      settings: true,
      discord: true,
    },
    actions: {
      write_queries: true,
      create_connections: true,
      export_data: true,
      manage_members: true,
    },
  },
  admin: {
    menus: {
      connections: true,
      editor: true,
      mcp: true,
      monitor: true,
      team: true,
      postgres_tools: true,
      sqlite_tools: true,
      design_system: true,
      settings: true,
      discord: true,
    },
    actions: {
      write_queries: true,
      create_connections: true,
      export_data: true,
      manage_members: true,
    },
  },
  editor: {
    menus: {
      connections: true,
      editor: true,
      mcp: false,
      monitor: true,
      team: false,
      postgres_tools: true,
      sqlite_tools: true,
      design_system: false,
      settings: true,
      discord: false,
    },
    actions: {
      write_queries: true,
      create_connections: true,
      export_data: true,
      manage_members: false,
    },
  },
  viewer: {
    menus: {
      connections: false,
      editor: true,
      mcp: false,
      monitor: true,
      team: false,
      postgres_tools: false,
      sqlite_tools: false,
      design_system: false,
      settings: true,
      discord: false,
    },
    actions: {
      write_queries: false,
      create_connections: false,
      export_data: false,
      manage_members: false,
    },
  },
};

export interface MenuDefinition {
  id: keyof RoleMenuPermissions;
  labelKey: string;
  description: string;
  category: "navigation" | "tools" | "admin";
}

export const MENU_DEFINITIONS: MenuDefinition[] = [
  {
    id: "connections",
    labelKey: "Connections (/connections)",
    description: "เข้าถึงหน้ารายการและการตั้งค่าการเชื่อมต่อฐานข้อมูล",
    category: "navigation",
  },
  {
    id: "editor",
    labelKey: "SQL Editor (/editor)",
    description: "เข้าถึงหน้าจอเขียนและรันคำสั่ง SQL Query",
    category: "navigation",
  },
  {
    id: "mcp",
    labelKey: "MCP Server (/mcp)",
    description: "เข้าถึง Model Context Protocol Server สำหรับเชื่อมต่อ AI Agents",
    category: "navigation",
  },
  {
    id: "monitor",
    labelKey: "Server & Database Monitor",
    description: "ระบบมอนิเตอร์ประสิทธิภาพฐานข้อมูล, QPS, Active Queries และสถานะเซิร์ฟเวอร์แบบเรียลไทม์",
    category: "tools",
  },
  {
    id: "team",
    labelKey: "Team Collaboration",
    description: "เปิดหน้าต่างจัดการสมาชิกใน Workspace และกำหนด Role",
    category: "admin",
  },
  {
    id: "postgres_tools",
    labelKey: "PostgreSQL Tools (#16)",
    description: "เครื่องมือวิเคราะห์ Slow Queries, Database Lock และ Activity ของ Postgres",
    category: "tools",
  },
  {
    id: "sqlite_tools",
    labelKey: "SQLite Tools (#17)",
    description: "เครื่องมือตรวจสุขภาพฐานข้อมูล SQLite (Integrity Check, VACUUM, WAL)",
    category: "tools",
  },
  {
    id: "design_system",
    labelKey: "UI Design System (#195)",
    description: "หน้าต่างตรวจสอบโทเคนสี ดีไซน์ และคอมโพเนนต์สำหรับนักพัฒนา",
    category: "tools",
  },
  {
    id: "discord",
    labelKey: "Discord Community",
    description: "ปุ่มลิงก์ Discord ชุมชน Tabularis ในแถบ Sidebar",
    category: "navigation",
  },
  {
    id: "settings",
    labelKey: "Settings (/settings)",
    description: "เข้าถึงหน้าจอตั้งค่าระบบ ธีม ปลั๊กอิน และโปรไฟล์ผู้ใช้",
    category: "admin",
  },
];

export interface ActionDefinition {
  id: keyof RoleActionPermissions;
  labelKey: string;
  description: string;
  isDangerous?: boolean;
}

export const ACTION_DEFINITIONS: ActionDefinition[] = [
  {
    id: "write_queries",
    labelKey: "รันคำสั่งเขียน/แก้ไขข้อมูล (Write Queries)",
    description: "อนุญาตให้รัน INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE",
    isDangerous: true,
  },
  {
    id: "create_connections",
    labelKey: "สร้าง/แก้ไข Database Connections",
    description: "อนุญาตให้เพิ่มการเชื่อมต่อใหม่และแก้ไขข้อมูล Credentials",
    isDangerous: true,
  },
  {
    id: "export_data",
    labelKey: "ส่งออกข้อมูล (Export & Data Transfer)",
    description: "อนุญาตให้ดาวน์โหลด CSV/JSON และย้ายข้อมูลข้ามตาราง",
    isDangerous: false,
  },
  {
    id: "manage_members",
    labelKey: "จัดการสมาชิกทีม (Team Management)",
    description: "อนุญาตให้เชิญสมาชิกใหม่และลบสมาชิกออกจาก Workspace",
    isDangerous: true,
  },
];
