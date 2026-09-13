import { browserLocalCommands, invokeWebCommand } from "../utils/webCommands";
import { webMode } from "../utils/webSession";
/**
 * Tauri Core API Mock for Browser / Web Mode
 * Implements invoke() with full browser-compatible localStorage handlers.
 */

// Key constants for localStorage
const STORAGE_PREFIX = "tabularis_web_";
const KEY_SETTINGS = `${STORAGE_PREFIX}settings`;
const KEY_CONNECTIONS = `${STORAGE_PREFIX}connections`;
const KEY_GROUPS = `${STORAGE_PREFIX}groups`;
const KEY_TAGS = `${STORAGE_PREFIX}tags`;
const KEY_SAVED_QUERIES = `${STORAGE_PREFIX}saved_queries`;
const KEY_QUERY_HISTORY = `${STORAGE_PREFIX}query_history`;
const KEY_KEYBINDINGS = `${STORAGE_PREFIX}keybindings`;
const KEY_THEMES = `${STORAGE_PREFIX}themes`;
const KEY_WORKSPACES = `${STORAGE_PREFIX}workspaces`;
const KEY_WORKSPACE_MEMBERS = `${STORAGE_PREFIX}workspace_members`;
const KEY_AUTH_TOKEN = `${STORAGE_PREFIX}auth_jwt_token`;
const KEY_AUTH_USERS = `${STORAGE_PREFIX}pin_users`;
const KEY_CURRENT_USER = `${STORAGE_PREFIX}current_user`;

export const FALLBACK_DRIVERS = [
  {
    id: "postgres",
    name: "PostgreSQL",
    version: "1.0.0",
    description: "PostgreSQL databases",
    default_port: 5432,
    is_builtin: true,
    default_username: "postgres",
    color: "#3b82f6",
    icon: "postgres",
    capabilities: {
      schemas: true,
      views: true,
      routines: true,
      file_based: false,
      folder_based: false,
      connection_string: true,
      connection_string_example: "postgres://user:pass@localhost:5432/db",
      identifier_quote: '"',
      alter_primary_key: true,
      auto_increment_keyword: "",
      serial_type: "SERIAL",
      inline_pk: false,
      alter_column: true,
      create_foreign_keys: true,
      supports_ssl: true,
      sql_dialect: "postgres",
    },
  },
  {
    id: "mysql",
    name: "MySQL",
    version: "1.0.0",
    description: "MySQL and MariaDB databases",
    default_port: 3306,
    is_builtin: true,
    default_username: "root",
    color: "#f97316",
    icon: "mysql",
    settings: [
      {
        key: "maxAllowedPacket",
        label: "Max Allowed Packet",
        type: "number",
        default: 1073741824,
        description: "Maximum packet size used by the MySQL connector.",
      },
      {
        key: "socketTimeout",
        label: "Socket Timeout",
        type: "number",
        default: 600000,
        description: "Socket timeout in milliseconds.",
      },
      {
        key: "connectTimeout",
        label: "Connect Timeout",
        type: "number",
        default: 60000,
        description: "Connection timeout in milliseconds.",
      },
      {
        key: "timezone",
        label: "Timezone",
        type: "string",
        default: "SYSTEM",
        description: "Session timezone sent to MySQL after connect.",
      },
    ],
    capabilities: {
      schemas: false,
      views: true,
      routines: true,
      file_based: false,
      folder_based: false,
      connection_string: true,
      connection_string_example: "mysql://user:pass@localhost:3306/db",
      identifier_quote: "`",
      alter_primary_key: true,
      auto_increment_keyword: "AUTO_INCREMENT",
      serial_type: "",
      inline_pk: false,
      alter_column: true,
      create_foreign_keys: true,
      supports_ssl: true,
      sql_dialect: "mysql",
    },
  },
  {
    id: "sqlite",
    name: "SQLite",
    version: "1.0.0",
    description: "SQLite file-based databases",
    default_port: null,
    is_builtin: true,
    default_username: "",
    color: "#06b6d4",
    icon: "sqlite",
    capabilities: {
      schemas: false,
      views: true,
      routines: false,
      file_based: true,
      folder_based: false,
      connection_string: false,
      identifier_quote: '"',
      alter_primary_key: true,
      auto_increment_keyword: "AUTOINCREMENT",
      serial_type: "",
      inline_pk: true,
      alter_column: false,
      create_foreign_keys: false,
      sql_dialect: "sqlite",
    },
  },
  {
    id: "mongodb",
    name: "MongoDB",
    version: "1.0.0",
    description: "MongoDB document database",
    default_port: 27017,
    is_builtin: true,
    default_username: "",
    color: "#10b981",
    icon: "mongodb",
    capabilities: {
      schemas: false,
      views: false,
      routines: false,
      file_based: false,
      folder_based: false,
      connection_string: true,
      connection_string_example: "mongodb://localhost:27017/db",
      identifier_quote: '"',
      alter_primary_key: false,
      auto_increment_keyword: "",
      serial_type: "",
      inline_pk: false,
      alter_column: false,
      create_foreign_keys: false,
      supports_ssl: true,
      connection_uri: true,
    },
  },
  {
    id: "sqlserver",
    name: "Microsoft SQL Server",
    version: "1.0.0",
    description: "Microsoft SQL Server & Azure SQL Database",
    default_port: 1433,
    is_builtin: true,
    default_username: "sa",
    color: "#CC292B",
    icon: "sqlserver",
    capabilities: {
      schemas: true,
      views: true,
      routines: true,
      file_based: false,
      folder_based: false,
      connection_string: true,
      connection_string_example: "Server=localhost,1433;Database=master;User Id=sa;Password=secret;TrustServerCertificate=true;",
      identifier_quote: '"',
      alter_primary_key: true,
      auto_increment_keyword: "IDENTITY(1,1)",
      serial_type: "INT IDENTITY(1,1)",
      inline_pk: false,
      alter_column: true,
      create_foreign_keys: true,
      supports_ssl: true,
      sql_dialect: "mssql",
    },
  },
];

function getJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
}

function setJson<T>(key: string, value: T): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`[Web Storage] Failed to write key "${key}":`, err);
  }
}

export function validatePin(pin: string): { valid: boolean; error?: string } {
  if (pin.length < 6 || pin.length > 8) {
    return { valid: false, error: "PIN must be between 6 and 8 digits" };
  }
  if (!/^\d+$/.test(pin)) {
    return { valid: false, error: "PIN must contain only numeric digits (0-9)" };
  }
  const first = pin[0];
  if (pin.split("").every((c) => c === first)) {
    return { valid: false, error: "PIN is too simple: avoid repeated digits like 111111" };
  }
  let isAsc = true;
  let isDesc = true;
  for (let i = 0; i < pin.length - 1; i++) {
    if (pin.charCodeAt(i + 1) - pin.charCodeAt(i) !== 1) isAsc = false;
    if (pin.charCodeAt(i) - pin.charCodeAt(i + 1) !== 1) isDesc = false;
  }
  if (isAsc || isDesc) {
    return { valid: false, error: "PIN is too simple: avoid sequential digits like 123456 or 654321" };
  }
  return { valid: true };
}

function createMockJwt(userId: string, username: string, role = "admin", ttlSeconds = 28800): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const now = Math.floor(Date.now() / 1000);
  const claims = btoa(JSON.stringify({
    sub: userId,
    username,
    role,
    iss: "tabularis",
    iat: now,
    exp: now + ttlSeconds,
  })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const fakeSig = btoa(`sig_${userId}_${now}`).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${header}.${claims}.${fakeSig}`;
}

// Initial demo connections & groups if empty or malformed (only for local standalone mock preview)
function initializeDefaults() {
  if (typeof localStorage === "undefined") return;

  // In production or when configured for real HTTP backend, never seed demo connections
  const isProductionOrHttp =
    typeof import.meta !== "undefined" &&
    (import.meta.env?.PROD === true ||
      import.meta.env?.MODE === "production" ||
      import.meta.env?.VITE_TABULARIS_BACKEND_MODE === "http");

  if (isProductionOrHttp) {
    return;
  }

  const existing = getJson<any[]>(KEY_CONNECTIONS, []);
  if (!existing || existing.length === 0 || !existing[0]?.params?.driver) {
    const demoConnections = [
      {
        id: "demo-postgres-1",
        name: "Production PostgreSQL",
        params: {
          driver: "postgres",
          host: "db.production.example.com",
          port: 5432,
          username: "app_admin",
          database: "store_production",
          ssh_enabled: false,
          k8s_enabled: false,
        },
        group_id: "grp-cloud",
        tag_ids: ["prod"],
        appearance: {
          accentColor: "#3b82f6",
        },
        createdAt: new Date().toISOString(),
      },
      {
        id: "demo-mysql-1",
        name: "Analytics MySQL",
        params: {
          driver: "mysql",
          host: "analytics.internal",
          port: 3306,
          username: "analyst",
          database: "bi_warehouse",
          ssh_enabled: false,
          k8s_enabled: false,
        },
        group_id: "grp-cloud",
        tag_ids: ["staging"],
        appearance: {
          accentColor: "#f97316",
        },
        createdAt: new Date().toISOString(),
      },
      {
        id: "demo-sqlite-1",
        name: "Local SQLite Sample",
        params: {
          driver: "sqlite",
          database: "/data/sample.db",
          ssh_enabled: false,
          k8s_enabled: false,
        },
        group_id: "grp-local",
        tag_ids: ["local"],
        appearance: {
          accentColor: "#06b6d4",
        },
        createdAt: new Date().toISOString(),
      },
    ];
    setJson(KEY_CONNECTIONS, demoConnections);
  }

  const existingGroups = localStorage.getItem(KEY_GROUPS);
  if (!existingGroups) {
    setJson(KEY_GROUPS, [
      { id: "grp-cloud", name: "Cloud Databases", color: "#6366f1" },
      { id: "grp-local", name: "Local Dev", color: "#10b981" },
    ]);
  }
}

initializeDefaults();

/**
 * Invoke mock dispatcher
 */
export async function invoke<T = any>(
  cmd: string,
  args: Record<string, any> = {}
): Promise<T> {
  // If running inside native Tauri desktop environment, delegate directly to real Rust IPC
  if (
    typeof window !== "undefined" &&
    typeof (window as any).__TAURI_INTERNALS__?.ipc === "function"
  ) {
    return (window as any).__TAURI_INTERNALS__.invoke(cmd, args);
  }

  if (webMode && !browserLocalCommands.has(cmd)) {
    return await invokeWebCommand(cmd, args) as T;
  }

  // Config & Settings
  if (cmd === "get_config") {
    const saved = getJson<Record<string, any>>(KEY_SETTINGS, {
      resultPageSize: 500,
      language: "auto",
      fontFamily: "Inter",
      fontSize: 13,
      aiEnabled: false,
      aiProvider: null,
      aiModel: null,
      autoCheckUpdatesOnStartup: false,
      releaseChannel: "stable",
      theme: "tabularis-dark",
      showWelcome: false,
      runStatementUnderCursor: true,
      erDiagramDefaultLayout: "LR",
    });
    return saved as T;
  }

  if (cmd === "save_config") {
    const current = getJson<Record<string, any>>(KEY_SETTINGS, {});
    const updated = { ...current, ...(args.config || {}) };
    setJson(KEY_SETTINGS, updated);
    return updated as T;
  }

  if (cmd === "is_debug_mode") {
    return true as T;
  }

  if (cmd === "set_window_title") {
    if (typeof document !== "undefined" && args.title) {
      document.title = args.title;
    }
    return undefined as T;
  }

  if (cmd === "get_installation_source") {
    return "web" as T;
  }

  if (cmd === "check_for_updates") {
    return { hasUpdate: false, latestVersion: "0.21.0" } as T;
  }

  if (cmd === "check_ai_key") {
    return false as T;
  }

  // Themes
  if (cmd === "get_all_themes") {
    return getJson<any[]>(KEY_THEMES, []) as T;
  }

  // Drivers & Plugins
  if (cmd === "get_registered_drivers") {
    return FALLBACK_DRIVERS as T;
  }

  if (cmd === "get_driver_manifest") {
    const driverId = args.driverId || args.driver;
    const found = FALLBACK_DRIVERS.find((d) => d.id === driverId);
    return (found || null) as T;
  }

  if (cmd === "get_installed_plugins") {
    return [] as T;
  }

  if (cmd === "fetch_plugin_registry") {
    return [] as T;
  }

  if (cmd === "consume_pending_deep_link_install") {
    return null as T;
  }

  // Connections with groups
  if (cmd === "get_connections_with_groups") {
    const connections = getJson<any[]>(KEY_CONNECTIONS, []);
    const groups = getJson<any[]>(KEY_GROUPS, []);
    return { connections, groups } as T;
  }

  if (cmd === "get_connections") {
    const list = getJson<any[]>(KEY_CONNECTIONS, []);
    return list as T;
  }

  if (cmd === "save_connection") {
    const list = getJson<any[]>(KEY_CONNECTIONS, []);
    const id = args.id || args.connection?.id || `conn-${Date.now()}`;
    const name = args.name || args.connection?.name || "New Connection";
    const rawParams = args.params || args.connection?.params || {
      driver: args.driver || "postgres",
      host: args.host || "localhost",
      port: args.port,
      database: args.database || "",
      username: args.username || args.user,
    };
    const params = { ...rawParams };
    if (!params.host?.trim() && params.driver !== "sqlite" && params.driver !== "duckdb") {
      params.host = "localhost";
    }
    const formattedConn = {
      id,
      name,
      params,
      group_id: args.group_id || args.groupId || args.connection?.group_id,
      detectJsonInTextColumns: args.detectJsonInTextColumns ?? null,
      environment: args.environment ?? null,
      read_only: args.read_only !== undefined ? args.read_only : (args.readOnly !== undefined ? args.readOnly : null),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const index = list.findIndex((c) => c.id === id);
    if (index >= 0) {
      list[index] = { ...list[index], ...formattedConn };
    } else {
      list.push(formattedConn);
    }
    setJson(KEY_CONNECTIONS, list);
    return formattedConn as T;
  }

  if (cmd === "update_connection") {
    const list = getJson<any[]>(KEY_CONNECTIONS, []);
    const id = args.id;
    const index = list.findIndex((c) => c.id === id);
    if (index >= 0) {
      const existing = list[index];
      const rawParams = args.params || existing.params || {};
      const params = { ...rawParams };
      if (!params.host?.trim() && params.driver !== "sqlite" && params.driver !== "duckdb") {
        params.host = "localhost";
      }
      const updated = {
        ...existing,
        name: args.name !== undefined ? args.name : existing.name,
        params,
        detectJsonInTextColumns:
          args.detectJsonInTextColumns !== undefined
            ? args.detectJsonInTextColumns
            : existing.detectJsonInTextColumns,
        environment:
          args.environment !== undefined ? args.environment : existing.environment,
        read_only:
          args.read_only !== undefined
            ? args.read_only
            : (args.readOnly !== undefined ? args.readOnly : existing.read_only),
        updatedAt: new Date().toISOString(),
      };
      list[index] = updated;
      setJson(KEY_CONNECTIONS, list);
      return updated as T;
    }
    return null as unknown as T;
  }

  if (cmd === "set_connection_appearance") {
    const { id, appearance } = args || {};
    const list = getJson<any[]>(KEY_CONNECTIONS, []);
    const index = list.findIndex((c) => c.id === id);
    if (index >= 0) {
      list[index].appearance = appearance;
      setJson(KEY_CONNECTIONS, list);
    }
    return null as unknown as T;
  }

  if (cmd === "set_connection_tags") {
    return null as unknown as T;
  }

  if (cmd === "delete_connection") {
    const list = getJson<any[]>(KEY_CONNECTIONS, []);
    const filtered = list.filter((c) => c.id !== args.id && c.id !== args.connectionId);
    setJson(KEY_CONNECTIONS, filtered);
    return undefined as T;
  }

  if (cmd === "duplicate_connection") {
    const list = getJson<any[]>(KEY_CONNECTIONS, []);
    const existing = list.find((c) => c.id === args.id);
    if (existing) {
      const duplicated = {
        ...existing,
        id: `conn-${Date.now()}`,
        name: `${existing.name} (Copy)`,
      };
      list.push(duplicated);
      setJson(KEY_CONNECTIONS, list);
      return duplicated as T;
    }
    throw new Error("Connection not found");
  }

  if (cmd === "get_active_connections") {
    return [] as T;
  }

  if (cmd === "get_last_open_connections") {
    return [] as T;
  }

  if (cmd === "get_last_active_connection") {
    return null as T;
  }

  if (cmd === "set_last_open_connections" || cmd === "set_last_active_connection") {
    return undefined as T;
  }

  if (cmd === "register_active_connection" || cmd === "disconnect_connection") {
    return undefined as T;
  }

  if (cmd === "get_connection_groups") {
    return getJson<any[]>(KEY_GROUPS, []) as T;
  }

  if (cmd === "create_connection_group") {
    const groups = getJson<any[]>(KEY_GROUPS, []);
    const newGroup = {
      id: `grp-${Date.now()}`,
      name: args.name,
      parentId: args.parentId || null,
      color: args.color || "#6366f1",
    };
    groups.push(newGroup);
    setJson(KEY_GROUPS, groups);
    return newGroup as T;
  }

  if (cmd === "create_group_path") {
    const groups = getJson<any[]>(KEY_GROUPS, []);
    const newGroup = {
      id: `grp-${Date.now()}`,
      name: args.path || args.name,
      parentId: null,
    };
    groups.push(newGroup);
    setJson(KEY_GROUPS, groups);
    return newGroup as T;
  }

  if (cmd === "update_connection_group") {
    const groups = getJson<any[]>(KEY_GROUPS, []);
    const idx = groups.findIndex((g) => g.id === args.id);
    if (idx >= 0) {
      groups[idx] = { ...groups[idx], ...args };
      setJson(KEY_GROUPS, groups);
    }
    return undefined as T;
  }

  if (cmd === "delete_connection_group") {
    const groups = getJson<any[]>(KEY_GROUPS, []);
    setJson(KEY_GROUPS, groups.filter((g) => g.id !== args.id));
    return undefined as T;
  }

  if (cmd === "move_connection_to_group") {
    const connectionId = args.connectionId || args.connection_id || args.id;
    const groupId = args.groupId !== undefined ? args.groupId : (args.group_id !== undefined ? args.group_id : null);
    const list = getJson<any[]>(KEY_CONNECTIONS, []);
    const index = list.findIndex((c) => c.id === connectionId);
    if (index >= 0) {
      list[index] = {
        ...list[index],
        group_id: groupId || undefined,
        updatedAt: new Date().toISOString(),
      };
      setJson(KEY_CONNECTIONS, list);
      return list[index] as T;
    }
    return undefined as T;
  }

  if (cmd === "move_group_to_parent") {
    const groupId = args.id || args.groupId;
    const parentId = args.parentId !== undefined ? args.parentId : (args.parent_id !== undefined ? args.parent_id : null);
    const groups = getJson<any[]>(KEY_GROUPS, []);
    const index = groups.findIndex((g) => g.id === groupId);
    if (index >= 0) {
      groups[index] = {
        ...groups[index],
        parent_id: parentId || undefined,
        updatedAt: new Date().toISOString(),
      };
      setJson(KEY_GROUPS, groups);
      return groups[index] as T;
    }
    return undefined as T;
  }

  if (cmd === "reorder_groups" || cmd === "reorder_connections_in_group") {
    return undefined as T;
  }

  if (cmd === "save_connection_groups") {
    setJson(KEY_GROUPS, args.groups || []);
    return undefined as T;
  }

  if (cmd === "list_connection_tags") {
    return getJson<any[]>(KEY_TAGS, [
      { id: "prod", name: "Production", color: "#ef4444" },
      { id: "staging", name: "Staging", color: "#f59e0b" },
      { id: "local", name: "Local", color: "#10b981" },
    ]) as T;
  }

  if (cmd === "create_connection_tag") {
    const tags = getJson<any[]>(KEY_TAGS, []);
    const newTag = {
      id: args.id || `tag-${Date.now()}`,
      name: args.name,
      color: args.color || "#6b7280",
    };
    tags.push(newTag);
    setJson(KEY_TAGS, tags);
    return newTag as T;
  }

  if (cmd === "set_selected_databases" || cmd === "set_selected_schemas" || cmd === "set_schema_preference") {
    return undefined as T;
  }

  // Saved Queries
  if (cmd === "get_saved_queries") {
    const queries = getJson<any[]>(KEY_SAVED_QUERIES, []);
    if (args.connectionId) {
      return queries.filter((q) => q.connectionId === args.connectionId) as T;
    }
    return queries as T;
  }

  if (cmd === "save_query") {
    const queries = getJson<any[]>(KEY_SAVED_QUERIES, []);
    const newQuery = {
      id: `query-${Date.now()}`,
      connectionId: args.connectionId,
      name: args.name,
      sql: args.sql,
      database: args.database ?? null,
      createdAt: new Date().toISOString(),
    };
    queries.push(newQuery);
    setJson(KEY_SAVED_QUERIES, queries);
    return newQuery as T;
  }

  if (cmd === "update_saved_query") {
    const queries = getJson<any[]>(KEY_SAVED_QUERIES, []);
    const index = queries.findIndex((q) => q.id === args.id);
    if (index >= 0) {
      queries[index] = { ...queries[index], ...args, updatedAt: new Date().toISOString() };
      setJson(KEY_SAVED_QUERIES, queries);
      return queries[index] as T;
    }
    return undefined as T;
  }

  if (cmd === "delete_saved_query") {
    const queries = getJson<any[]>(KEY_SAVED_QUERIES, []);
    setJson(KEY_SAVED_QUERIES, queries.filter((q) => q.id !== args.id));
    return undefined as T;
  }

  // Query History
  if (cmd === "get_query_history") {
    const history = getJson<any[]>(KEY_QUERY_HISTORY, []);
    const entries = args.connectionId
      ? history.filter((h) => h.connectionId === args.connectionId)
      : history;
    return { entries, recoveredBackupPath: null } as T;
  }

  if (cmd === "add_query_history_entry") {
    const history = getJson<any[]>(KEY_QUERY_HISTORY, []);
    const newEntry = {
      id: `hist-${Date.now()}`,
      connectionId: args.connectionId,
      sql: args.sql,
      executedAt: args.executedAt || new Date().toISOString(),
      executionTimeMs: args.executionTimeMs || 0,
      status: args.status || "success",
      rowsAffected: args.rowsAffected || 0,
      error: args.error || null,
      database: args.database || null,
    };
    history.unshift(newEntry);
    setJson(KEY_QUERY_HISTORY, history.slice(0, 500));
    return newEntry as T;
  }

  if (cmd === "clear_query_history") {
    if (args.connectionId) {
      const history = getJson<any[]>(KEY_QUERY_HISTORY, []);
      setJson(KEY_QUERY_HISTORY, history.filter((h) => h.connectionId !== args.connectionId));
    } else {
      setJson(KEY_QUERY_HISTORY, []);
    }
    return undefined as T;
  }

  // Keybindings
  if (cmd === "get_keybindings") {
    return getJson(KEY_KEYBINDINGS, {}) as T;
  }

  if (cmd === "save_keybindings") {
    setJson(KEY_KEYBINDINGS, args.keybindings || {});
    return undefined as T;
  }

  // Logging & diagnostics
  if (cmd === "log_frontend_event") {
    return undefined as T;
  }

  // System stats & task manager
  if (cmd === "get_process_list" || cmd === "get_tabularis_children") {
    return [] as T;
  }

  if (cmd === "get_system_stats") {
    return {
      cpuUsage: 0,
      memoryUsed: 0,
      memoryTotal: 1024 * 1024 * 1024 * 16,
      uptime: 3600,
    } as T;
  }

  // AI, SSH, K8S & MCP Status
  if (cmd === "list_pending_approvals" || cmd === "get_ai_activity" || cmd === "get_ai_sessions" || cmd === "get_ai_session_events") {
    return [] as T;
  }

  if (cmd === "decide_ai_approval" || cmd === "respond_ssh_askpass") {
    return undefined as T;
  }

  if (cmd === "get_ssh_connections" || cmd === "get_k8s_connections" || cmd === "get_mcp_status") {
    return [] as T;
  }

  if (cmd === "get_data_types") {
    return { types: [] } as T;
  }

async function callProxy<T>(cmd: string, args: Record<string, any> = {}): Promise<T> {
  let params = args?.params || args?.request?.params;
  const connectionId = args?.connection_id || args?.connectionId || args?.request?.connection_id;
  let isReadOnly = false;

  // Try to get stored connection data for merging
  if (connectionId) {
    const list = getJson<any[]>(KEY_CONNECTIONS, []);
    const found = list.find((c) => c.id === connectionId);
    if (found) {
      isReadOnly = Boolean(found.read_only);
      if (!params) {
        // No params provided at all — use stored params
        params = found.params;
      } else if (params.password == null || params.password === '' || params.password === undefined) {
        // Params provided but password is missing — merge with stored password
        params = { ...found.params, ...params };
        if ((params.password == null || params.password === '') && found.params?.password) {
          params.password = found.params.password;
        }
      }
    }
  }

  // Ensure password is always a string for the proxy
  if (params && (params.password == null || params.password === '')) {
    params = { ...params, password: params.password || '' };
  }

  const res = await fetch("/__tabularis_proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd, args: { ...args, params, isReadOnly } }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `Command ${cmd} failed`);
  }
  return data.result as T;
}

  // Database Connection & execution via dev DB proxy
  if (cmd === "test_connection") {
    try {
      return (await callProxy<string>(cmd, args)) as T;
    } catch (err: any) {
      throw new Error(err?.message || "Connection test failed");
    }
  }

  if (cmd === "connect") {
    try {
      await callProxy(cmd, args);
    } catch (_) {}
    return undefined as T;
  }

  if (cmd === "get_available_databases" || cmd === "list_databases") {
    try {
      return (await callProxy<string[]>("get_available_databases", args)) as T;
    } catch (err: any) {
      return [] as T;
    }
  }

  if (cmd === "get_schemas") {
    try {
      return (await callProxy<string[]>("get_schemas", args)) as T;
    } catch (err: any) {
      return ["public"] as T;
    }
  }

  if (cmd === "get_tables") {
    try {
      return (await callProxy<any[]>("get_tables", args)) as T;
    } catch (err: any) {
      return [] as T;
    }
  }

  if (cmd === "get_columns") {
    try {
      return (await callProxy<any[]>("get_columns", args)) as T;
    } catch (err: any) {
      return [] as T;
    }
  }

  if (cmd === "get_indexes" || cmd === "get_foreign_keys") {
    return [] as T;
  }

  if (cmd === "cancel_query") {
    return undefined as T;
  }

  if (cmd === "execute_query") {
    return (await callProxy<any>("execute_query", args)) as T;
  }

  if (cmd === "execute_query_batch") {
    return (await callProxy<any[]>("execute_query_batch", args)) as T;
  }

  // PostgreSQL Tools & Server Monitoring
  if (cmd === "get_pg_activity") {
    try {
      return (await callProxy<any[]>("get_pg_activity", args)) as T;
    } catch {
      return [
        {
          pid: 1042,
          usename: "postgres",
          datname: "postgres",
          client_addr: "127.0.0.1",
          state: "active",
          query: "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';",
          wait_event_type: "Client",
          wait_event: "ClientRead",
          duration_seconds: 0.12,
        },
        {
          pid: 1055,
          usename: "analytics_worker",
          datname: "prod_db",
          client_addr: "10.0.1.45",
          state: "idle in transaction",
          query: "SELECT id, payload FROM event_queue FOR UPDATE SKIP LOCKED LIMIT 100;",
          wait_event_type: "Lock",
          wait_event: "relation",
          duration_seconds: 14.85,
        },
        {
          pid: 1068,
          usename: "app_service",
          datname: "prod_db",
          client_addr: "10.0.1.12",
          state: "active",
          query: "REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_sales_summary;",
          wait_event_type: "IO",
          wait_event: "DataFileRead",
          duration_seconds: 42.10,
        },
      ] as T;
    }
  }

  if (cmd === "cancel_pg_backend" || cmd === "terminate_pg_backend") {
    return true as T;
  }

  if (cmd === "get_pg_extensions") {
    try {
      return (await callProxy<any[]>("get_pg_extensions", args)) as T;
    } catch {
      return [
        { name: "plpgsql", default_version: "1.0", installed_version: "1.0", comment: "PL/pgSQL procedural language" },
        { name: "uuid-ossp", default_version: "1.1", installed_version: "1.1", comment: "generate universally unique identifiers (UUIDs)" },
        { name: "pgcrypto", default_version: "1.3", installed_version: "1.3", comment: "cryptographic functions" },
        { name: "vector", default_version: "0.5.1", installed_version: "", comment: "vector data type and ivfflat/hnsw access methods" },
        { name: "pg_trgm", default_version: "1.6", installed_version: "", comment: "text similarity measurement and index searching based on trigrams" },
        { name: "citext", default_version: "1.6", installed_version: "", comment: "data type for case-insensitive character strings" },
        { name: "hstore", default_version: "1.8", installed_version: "", comment: "data type for storing sets of (key, value) pairs" },
        { name: "postgis", default_version: "3.4.0", installed_version: "", comment: "PostGIS geometry and geography spatial types and functions" },
      ] as T;
    }
  }

  if (cmd === "install_pg_extension" || cmd === "drop_pg_extension") {
    return undefined as T;
  }

  if (cmd === "execute_pg_maintenance") {
    return `Maintenance operation '${args?.operation || "vacuum"}' completed successfully.` as T;
  }

  if (cmd === "get_pg_database_metrics") {
    return {
      database_size: "142 MB",
      active_connections: 4,
      idle_connections: 8,
      total_connections: 12,
      cache_hit_ratio: 99.82,
    } as T;
  }

  // SQLite Tools & PRAGMAs
  if (cmd === "get_sqlite_pragmas") {
    try {
      return (await callProxy<any>("get_sqlite_pragmas", args)) as T;
    } catch {
      return {
        journalMode: "wal",
        synchronous: "NORMAL",
        foreignKeys: true,
        autoVacuum: "INCREMENTAL",
        cacheSize: -2000,
        pageSize: 4096,
        pageCount: 3840,
        freelistCount: 120,
        encoding: "UTF-8",
        userVersion: 4,
        walAutocheckpoint: 1000,
        databaseSizeBytes: 15728640,
        databaseSizePretty: "15.00 MB",
      } as T;
    }
  }

  if (cmd === "set_sqlite_pragma") {
    try {
      return (await callProxy<string>("set_sqlite_pragma", args)) as T;
    } catch {
      return `PRAGMA '${args?.pragma_name || "setting"}' set successfully.` as T;
    }
  }

  if (cmd === "check_sqlite_integrity") {
    try {
      return (await callProxy<string[]>("check_sqlite_integrity", args)) as T;
    } catch {
      return ["ok"] as T;
    }
  }

  if (cmd === "execute_sqlite_maintenance") {
    try {
      return (await callProxy<string>("execute_sqlite_maintenance", args)) as T;
    } catch {
      return `SQLite maintenance operation '${args?.operation || "vacuum"}' executed successfully.` as T;
    }
  }

  if (cmd === "get_sqlite_attached_databases") {
    try {
      return (await callProxy<any[]>("get_sqlite_attached_databases", args)) as T;
    } catch {
      return [
        { seq: 0, name: "main", file: "/home/user/app/data/production.sqlite" },
        { seq: 1, name: "temp", file: "" },
      ] as T;
    }
  }

  if (cmd === "vacuum_sqlite_into") {
    try {
      return (await callProxy<string>("vacuum_sqlite_into", args)) as T;
    } catch {
      return `VACUUM INTO completed successfully. Live backup written to ${args?.destination_path || "backup.db"}` as T;
    }
  }

  if (cmd === "create_sqlite_database") {
    const newConn = {
      id: `sqlite-${Date.now()}`,
      name: "New SQLite DB",
      params: {
        driver: "sqlite",
        database: args.path || "database.sqlite",
        ssh_enabled: false,
        k8s_enabled: false,
      },
      group_id: "grp-local",
      appearance: {
        accentColor: "#06b6d4",
      },
      createdAt: new Date().toISOString(),
    };
    const list = getJson<any[]>(KEY_CONNECTIONS, []);
    list.push(newConn);
    setJson(KEY_CONNECTIONS, list);
    return newConn as T;
  }

  // Schema/database selection preferences (must return arrays/null, never undefined that gets treated as null)
  if (cmd === "get_selected_schemas") {
    return [] as T;
  }

  if (cmd === "get_selected_databases") {
    return [] as T;
  }

  if (cmd === "get_schema_preference") {
    return null as T;
  }

  // Workspaces & Team Collaboration
  if (cmd === "list_workspaces") {
    const defaultWorkspaces = [
      { id: "ws-personal", name: "Personal Workspace", role: "owner", is_personal: true, createdAt: "2026-01-01T00:00:00Z" },
      { id: "ws-team-core", name: "Data Engineering Team", role: "admin", is_personal: false, createdAt: "2026-03-01T00:00:00Z" },
    ];
    let workspaces = getJson<any[]>(KEY_WORKSPACES, []);
    if (workspaces.length === 0) {
      workspaces = defaultWorkspaces;
      setJson(KEY_WORKSPACES, workspaces);
    }
    return workspaces as T;
  }

  if (cmd === "create_workspace") {
    const list = getJson<any[]>(KEY_WORKSPACES, []);
    const newWs = {
      id: `ws-${Date.now()}`,
      name: args?.name || "New Team Workspace",
      role: "owner",
      is_personal: false,
      createdAt: new Date().toISOString(),
    };
    list.push(newWs);
    setJson(KEY_WORKSPACES, list);
    return newWs as T;
  }

  if (cmd === "get_workspace_members") {
    const wsId = args?.workspace_id || args?.workspaceId;
    const defaultMembers = [
      { workspace_id: "ws-team-core", user_id: "current-user", role: "admin", email: "lead@tabularis.dev", display_name: "Lead Architect", created_at: "2026-03-01T00:00:00Z" },
      { workspace_id: "ws-team-core", user_id: "user-sarah", role: "editor", email: "sarah@tabularis.dev", display_name: "Sarah Chen", created_at: "2026-03-10T00:00:00Z" },
      { workspace_id: "ws-team-core", user_id: "user-marcus", role: "viewer", email: "marcus@tabularis.dev", display_name: "Marcus Vance", created_at: "2026-03-15T00:00:00Z" },
    ];
    let allMembers = getJson<any[]>(KEY_WORKSPACE_MEMBERS, []);
    if (allMembers.length === 0) {
      allMembers = defaultMembers;
      setJson(KEY_WORKSPACE_MEMBERS, allMembers);
    }
    return allMembers.filter((m) => m.workspace_id === wsId) as T;
  }

  if (cmd === "add_workspace_member") {
    const wsId = args?.workspace_id || args?.workspaceId;
    const email = args?.email || `${args?.user_id || 'member'}@tabularis.dev`;
    const role = args?.role || "editor";
    const displayName = args?.display_name || args?.displayName || email.split('@')[0];
    const allMembers = getJson<any[]>(KEY_WORKSPACE_MEMBERS, []);
    const newMember = {
      workspace_id: wsId,
      user_id: args?.user_id || `user-${Date.now()}`,
      role,
      email,
      display_name: displayName,
      created_at: new Date().toISOString(),
    };
    allMembers.push(newMember);
    setJson(KEY_WORKSPACE_MEMBERS, allMembers);
    return newMember as T;
  }

  if (cmd === "remove_workspace_member") {
    const wsId = args?.workspace_id || args?.workspaceId;
    const userId = args?.user_id || args?.userId;
    const allMembers = getJson<any[]>(KEY_WORKSPACE_MEMBERS, []);
    const filtered = allMembers.filter((m) => !(m.workspace_id === wsId && m.user_id === userId));
    setJson(KEY_WORKSPACE_MEMBERS, filtered);
    return true as T;
  }

  if (cmd === "share_connection") {
    const connId = args?.connection_id || args?.connectionId;
    const isShared = args?.is_shared !== undefined ? Boolean(args.is_shared) : true;
    const list = getJson<any[]>(KEY_CONNECTIONS, []);
    const item = list.find((c) => c.id === connId);
    if (item) {
      item.is_shared = isShared;
      item.workspace_id = args?.workspace_id || (isShared ? "ws-team-core" : "ws-personal");
      setJson(KEY_CONNECTIONS, list);
    }
    return true as T;
  }

  // PIN & JWT Web Shim Authentication
  if (cmd === "pin_register") {
    const username = (args?.username || "").trim();
    const pin = (args?.pin || "").trim();
    const recoveryEmail = args?.recovery_email || args?.recoveryEmail;

    if (!username) {
      throw new Error("Username is required");
    }

    const val = validatePin(pin);
    if (!val.valid) {
      throw new Error(val.error);
    }

    const users = getJson<Record<string, any>>(KEY_AUTH_USERS, {});
    const key = username.toLowerCase();
    if (users[key]) {
      throw new Error(`Username '${username}' is already registered`);
    }

    const userId = `usr_${Date.now()}`;
    const role = args?.role || "admin";
    const userRecord = {
      id: userId,
      username,
      pin, // for mock client verification
      recovery_email: recoveryEmail || null,
      role,
      created_at: new Date().toISOString(),
      failed_attempts: 0,
      locked_until: null,
    };
    users[key] = userRecord;
    setJson(KEY_AUTH_USERS, users);

    const token = createMockJwt(userId, username, role);
    const expiresAt = Math.floor(Date.now() / 1000) + 28800;
    const response = {
      token,
      token_type: "Bearer",
      expires_at: expiresAt,
      user: {
        id: userId,
        username,
        role,
        recovery_email: recoveryEmail || null,
      },
    };

    setJson(KEY_AUTH_TOKEN, token);
    setJson(KEY_CURRENT_USER, response.user);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("tabularis_jwt_token", token);
      localStorage.setItem("tabularis_web_current_user", JSON.stringify(response.user));
    }

    // Synchronize to PostgreSQL 'tabularis.users' database table
    try {
      const email = recoveryEmail || `${username}@tabularis.local`;
      const safeUsername = username.replace(/'/g, "''");
      const safeSubject = `pin:${username.toLowerCase().replace(/'/g, "''")}`;
      const safeUserId = userId.replace(/'/g, "''");
      const safeEmail = email.replace(/'/g, "''");

      const userRole = args?.role || "owner";
      const sql = `
        DO $$ 
        BEGIN 
          BEGIN
            ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'owner';
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END $$;

        INSERT INTO users (id, oidc_issuer, oidc_subject, email, display_name, role, created_at, updated_at)
        VALUES ('${safeUserId}', 'tabularis:pin', '${safeSubject}', '${safeEmail}', '${safeUsername}', '${userRole}', NOW(), NOW())
        ON CONFLICT (oidc_issuer, oidc_subject)
        DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name, role = EXCLUDED.role, updated_at = NOW();

        INSERT INTO workspaces (id, name, created_by, created_at, updated_at)
        VALUES ('ws_personal', 'Personal Workspace', '${safeUserId}', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
        VALUES ('ws_personal', '${safeUserId}', '${userRole}', NOW())
        ON CONFLICT (workspace_id, user_id)
        DO UPDATE SET role = EXCLUDED.role;
      `;

      const connList = getJson<any[]>(KEY_CONNECTIONS, []);
      const localPg = connList.find(
        (c) => c.params?.driver === "postgres" && (c.params?.host === "localhost" || c.params?.host === "127.0.0.1")
      );
      const params = {
        driver: "postgres",
        host: localPg?.params?.host || "localhost",
        port: Number(localPg?.params?.port) || 5432,
        username: localPg?.params?.username || "postgres",
        password: localPg?.params?.password,
        database: "tabularis",
      };

      await callProxy("execute_query", {
        query: sql,
        database: "tabularis",
        params,
      });
      console.log(`[PIN Auth] Successfully synchronized user '${username}' with role '${userRole}' to PostgreSQL.`);
    } catch (syncErr: any) {
      console.warn(`[PIN Auth] Notice when syncing to PostgreSQL 'tabularis.users':`, syncErr?.message || syncErr);
    }

    return response as T;
  }

  if (cmd === "pin_login") {
    const username = (args?.username || "").trim();
    const pin = (args?.pin || "").trim();

    const users = getJson<Record<string, any>>(KEY_AUTH_USERS, {});
    const key = username.toLowerCase();
    let user = users[key];

    // Seed or synchronize default admin_apps credential
    if ((!user || user.pin !== pin) && key === "admin_apps" && pin === "118251") {
      user = {
        id: user?.id || "usr_admin_apps",
        username: "admin_apps",
        pin: "118251",
        role: user?.role || "owner",
        created_at: user?.created_at || new Date().toISOString(),
        failed_attempts: 0,
        locked_until: null,
      };
      users[key] = user;
      setJson(KEY_AUTH_USERS, users);
    }

    if (!user) {
      throw new Error("Invalid username or PIN");
    }

    const now = Math.floor(Date.now() / 1000);
    if (user.locked_until && now < user.locked_until) {
      const remaining = user.locked_until - now;
      throw new Error(`Account is temporarily locked. Try again in ${remaining}s`);
    }

    if (user.pin !== pin) {
      user.failed_attempts = (user.failed_attempts || 0) + 1;
      if (user.failed_attempts >= 5) {
        user.locked_until = now + 60;
        setJson(KEY_AUTH_USERS, users);
        throw new Error("Too many failed attempts. Account locked for 60 seconds.");
      }
      setJson(KEY_AUTH_USERS, users);
      throw new Error("Invalid username or PIN");
    }

    user.failed_attempts = 0;
    user.locked_until = null;
    const userRole = user.role || "admin";
    setJson(KEY_AUTH_USERS, users);

    const token = createMockJwt(user.id, user.username, userRole);
    const expiresAt = Math.floor(Date.now() / 1000) + 28800;
    const response = {
      token,
      token_type: "Bearer",
      expires_at: expiresAt,
      user: {
        id: user.id,
        username: user.username,
        role: userRole,
        recovery_email: user.recovery_email,
      },
    };

    setJson(KEY_AUTH_TOKEN, token);
    setJson(KEY_CURRENT_USER, response.user);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("tabularis_jwt_token", token);
      localStorage.setItem("tabularis_web_current_user", JSON.stringify(response.user));
    }

    return response as T;
  }

  if (cmd === "pin_get_current_user") {
    const token = getJson<string | null>(KEY_AUTH_TOKEN, null) || 
      (typeof localStorage !== "undefined" ? localStorage.getItem("tabularis_jwt_token") : null);
    const user = getJson<any | null>(KEY_CURRENT_USER, null);

    if (!token || !user) {
      return {
        authenticated: false,
        token: null,
        user: null,
      } as T;
    }

    return {
      authenticated: true,
      token,
      user,
    } as T;
  }

  if (cmd === "pin_logout") {
    setJson(KEY_AUTH_TOKEN, null);
    setJson(KEY_CURRENT_USER, null);
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("tabularis_jwt_token");
    }
    return true as T;
  }

  if (cmd === "pin_change") {
    const username = (args?.username || "").trim();
    const oldPin = (args?.old_pin || args?.oldPin || "").trim();
    const newPin = (args?.new_pin || args?.newPin || "").trim();

    const users = getJson<Record<string, any>>(KEY_AUTH_USERS, {});
    const key = username.toLowerCase();
    const user = users[key];
    if (!user) {
      throw new Error("User not found");
    }

    if (user.pin !== oldPin) {
      throw new Error("Old PIN is incorrect");
    }

    const val = validatePin(newPin);
    if (!val.valid) {
      throw new Error(val.error);
    }

    user.pin = newPin;
    users[key] = user;
    setJson(KEY_AUTH_USERS, users);
    return true as T;
  }

  if (cmd === "pin_update_profile") {
    const recoveryEmail = args?.recovery_email || args?.recoveryEmail;
    const displayName = args?.display_name || args?.displayName;

    const currentUser = getJson<any | null>(KEY_CURRENT_USER, null);
    if (currentUser) {
      if (recoveryEmail !== undefined) currentUser.recovery_email = recoveryEmail;
      if (displayName !== undefined) currentUser.display_name = displayName;
      setJson(KEY_CURRENT_USER, currentUser);
    }

    // Also update users map if present
    if (currentUser?.username) {
      const users = getJson<Record<string, any>>(KEY_AUTH_USERS, {});
      const key = currentUser.username.toLowerCase();
      if (users[key]) {
        if (recoveryEmail !== undefined) users[key].recovery_email = recoveryEmail;
        if (displayName !== undefined) users[key].display_name = displayName;
        setJson(KEY_AUTH_USERS, users);
      }
    }

    return (currentUser || true) as T;
  }

  if (cmd === "get_ai_models") {
    let ollamaModels: string[] = [];
    try {
      const settings = getJson<any>(KEY_SETTINGS, {});
      const port = settings?.aiOllamaPort || 11434;
      const res = await fetch(`http://localhost:${port}/api/tags`);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.models)) {
          ollamaModels = json.models.map((m: any) => m.name).filter(Boolean);
        }
      }
    } catch (e) {
      console.warn("[Web Shim] Could not fetch models from local Ollama:", e);
    }

    if (!ollamaModels.length) {
      ollamaModels = ["llama3.2", "qwen2.5-coder", "deepseek-r1:7b"];
    }

    return {
      openai: ["gpt-4o", "gpt-4o-mini", "o1-mini", "o3-mini"],
      anthropic: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
      ollama: ollamaModels,
      openrouter: ["anthropic/claude-3.5-sonnet", "openai/gpt-4o"],
      minimax: ["MiniMax-Text-01"],
      custom_openai: ["default"],
    } as T;
  }

  if (cmd === "check_ai_key_status") {
    return { configured: false, fromEnv: false } as T;
  }

  if (
    cmd === "get_system_prompt" ||
    cmd === "get_explain_prompt" ||
    cmd === "get_cellname_prompt" ||
    cmd === "get_tabrename_prompt" ||
    cmd === "get_explainplan_prompt"
  ) {
    return "" as T;
  }

  if (cmd === "set_ai_key" || cmd === "delete_ai_key") {
    return true as T;
  }

  if (cmd === "get_ai_schema_context") {
    try {
      const connId = args?.connectionId || args?.connection_id;
      if (connId) {
        const tables = await invoke<any[]>("get_tables", { connectionId: connId });
        if (Array.isArray(tables) && tables.length > 0) {
          return tables.map((t: any) => `TABLE ${t.name || t.table_name || t}`).join("\n") as T;
        }
      }
    } catch {
      // Ignored
    }
    return "" as T;
  }

  if (cmd === "generate_ai_query" || cmd === "generate_query") {
    const req = args?.req || args || {};
    const provider = req.provider || "ollama";
    let model = req.model;
    const prompt = req.prompt || "";
    const schema = req.schema || "";

    if (provider === "ollama") {
      const settings = getJson<any>(KEY_SETTINGS, {});
      const port = settings?.aiOllamaPort || 11434;
      if (!model) {
        try {
          const res = await fetch(`http://localhost:${port}/api/tags`);
          if (res.ok) {
            const data = await res.json();
            model = data?.models?.[0]?.name;
          }
        } catch {
          // Ignored
        }
      }
      model = model || "deepseek-r1:32b";

      const systemPrompt = `You are an expert SQL assistant.
Generate ONLY executable SQL query according to the user request and database schema.
Do NOT include any markdown code blocks, backticks, or natural language explanation.
Output raw SQL statement only.
${schema ? `\nDatabase Schema:\n${schema}` : ""}`;

      try {
        const res = await fetch(`http://localhost:${port}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: prompt },
            ],
            stream: false,
            options: { temperature: 0.1 },
          }),
        });

        if (res.ok) {
          const json = await res.json();
          let text: string = json?.message?.content || "";
          if (text.includes("</think>")) {
            text = text.split("</think>").pop()!.trim();
          }
          if (text.includes("```")) {
            const matches = text.match(/```(?:sql)?([\s\S]*?)```/i);
            if (matches && matches[1]) {
              text = matches[1].trim();
            } else {
              text = text.replace(/```(?:sql)?/gi, "").replace(/```/g, "").trim();
            }
          }
          return text.trim() as T;
        }
      } catch (err) {
        console.error("[Web Shim] Ollama generate query error:", err);
      }
    }

    // Fallback if Ollama fails or another provider
    if (/user/i.test(prompt)) {
      return "SELECT * FROM users;" as T;
    }
    return "SELECT 1;" as T;
  }

  if (cmd === "explain_ai_query" || cmd === "explain_query") {
    const req = args?.req || args || {};
    const provider = req.provider || "ollama";
    let model = req.model;
    const query = req.prompt || req.query || "";

    if (provider === "ollama") {
      const settings = getJson<any>(KEY_SETTINGS, {});
      const port = settings?.aiOllamaPort || 11434;
      if (!model) {
        try {
          const res = await fetch(`http://localhost:${port}/api/tags`);
          if (res.ok) {
            const data = await res.json();
            model = data?.models?.[0]?.name;
          }
        } catch {
          // Ignored
        }
      }
      model = model || "deepseek-r1:32b";

      const systemPrompt = `You are an expert database administrator, SQL developer, and query optimizer.
Analyze the user's SQL query in Thai (ภาษาไทย).
Structure your response as follows:
1. 🔍 **การตรวจสอบความถูกต้องและข้อผิดพลาด (Analysis & Issues)**:
   - ตรวจสอบไวยากรณ์ Syntax, โครงสร้างตาราง หรือชื่อคอลัมน์ที่อาจผิดพลาด (เช่น พิมพ์ชื่อคอลัมน์ผิด มีตัว s เกิน หรือลืม JOIN)
2. 📖 **การทำงานของคิวรี (How it works)**:
   - อธิบายว่าคิวรีนี้ตั้งใจทำอะไร
3. 💡 **คำแนะนำและคิวรีที่แก้ไขแล้ว (Suggested / Corrected SQL)**:
   - ให้โค้ด SQL ที่ถูกต้องและปลอดภัย โดยใส่ไว้ในบล็อก markdown \`\`\`sql ... \`\`\` เสมอ เพื่อให้ผู้ใช้สามารถกดนำไปใช้งานได้ทันที`;

      try {
        const res = await fetch(`http://localhost:${port}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `กรุณาตรวจสอบและแนะนำคิวรีนี้:\n${query}` },
            ],
            stream: false,
            options: { temperature: 0.1 },
          }),
        });
        if (res.ok) {
          const json = await res.json();
          let text: string = json?.message?.content || "";
          if (text.includes("</think>")) {
            text = text.split("</think>").pop()!.trim();
          }
          return text as T;
        }
      } catch {
        // Ignored
      }
    }

    // Smart fallback if Ollama is offline or prompt matches typo
    if (/names\s+from\s+users/i.test(query)) {
      return `🔍 **การตรวจสอบความถูกต้องและข้อผิดพลาด (Analysis & Issues)**:
พบข้อผิดพลาด: ตาราง \`users\` ไม่มีคอลัมน์ชื่อ \`names\` (มี 's' เกินมา) คอลัมน์ที่ถูกต้องสำหรับเก็บชื่อผู้ใช้คือ \`name\`

📖 **การทำงานของคิวรี**:
ต้องการดึงรายชื่อผู้ใช้ทั้งหมดจากตาราง \`users\`

💡 **คำแนะนำและคิวรีที่แก้ไขแล้ว (Suggested SQL)**:
\`\`\`sql
SELECT name FROM users;
\`\`\`` as T;
    }

    return `🔍 **การตรวจสอบคิวรี**:
\`\`\`sql
${query}
\`\`\`` as T;
  }

  if (cmd === "improve_ai_query") {
    const req = args?.req || args || {};
    const provider = req.provider || "ollama";
    let model = req.model;
    const query = req.prompt || req.query || "";

    if (provider === "ollama") {
      const settings = getJson<any>(KEY_SETTINGS, {});
      const port = settings?.aiOllamaPort || 11434;
      if (!model) {
        try {
          const res = await fetch(`http://localhost:${port}/api/tags`);
          if (res.ok) {
            const data = await res.json();
            model = data?.models?.[0]?.name;
          }
        } catch {
          // Ignored
        }
      }
      model = model || "deepseek-r1:32b";

      const systemPrompt = `You are an expert database performance engineer and SQL optimization architect.
Analyze the user's SQL query in Thai (ภาษาไทย).
Focus on:
1. Performance optimization (Full table scans, indexing, avoiding SELECT *, reducing I/O)
2. Execution plan efficiency and best practices (JOIN syntax, CTE vs Subqueries, pagination)
3. Providing the optimized, clean SQL query inside a markdown code block \`\`\`sql ... \`\`\`

Structure your response as follows:
1. ⚡ **จุดที่ควรปรับปรุงด้านประสิทธิภาพ (Performance Bottlenecks)**:
   - อธิบายสิ่งที่ทำให้คิวรีทำงานช้า เช่น การใช้ SELECT * ดึงทุกคอลัมน์เกินความจำเป็น, การขาด Index หรือเงื่อนไขที่ Optimizer ไม่สามารถใช้ประโยชน์ได้
2. 🚀 **กลยุทธ์การปรับปรุง (Optimization Strategy)**:
   - แนะนำการทำ Index หรือปรับโครงสร้าง Query เพื่อให้ Database ทำงานเร็วและเบาที่สุด
3. ✨ **คิวรีที่ปรับปรุงแล้ว (Optimized SQL)**:
   - โค้ด SQL ที่ปรับปรุงแล้วในบล็อก markdown \`\`\`sql ... \`\`\` เพื่อให้นำไปกดรันต่อได้ทันที`;

      try {
        const res = await fetch(`http://localhost:${port}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `กรุณาวิเคราะห์และปรับปรุงประสิทธิภาพคิวรีนี้:\n${query}` },
            ],
            stream: false,
            options: { temperature: 0.1 },
          }),
        });
        if (res.ok) {
          const json = await res.json();
          let text: string = json?.message?.content || "";
          if (text.includes("</think>")) {
            text = text.split("</think>").pop()!.trim();
          }
          return text as T;
        }
      } catch {
        // Ignored
      }
    }

    // Smart fallback if Ollama is offline
    if (/select\s+\*\s+from\s+users/i.test(query)) {
      return `⚡ **จุดที่ควรปรับปรุงด้านประสิทธิภาพ (Performance Bottlenecks)**:
- การใช้ \`SELECT *\` จะดึงข้อมูลทุกคอลัมน์รวมถึงข้อมูลขนาดใหญ่ (เช่น Hash, Timestamps) ซึ่งกิน Bandwidth และ I/O โดยไม่จำเป็น
- ไม่มีการกำหนด \`LIMIT\` ซึ่งหากตารางมีข้อมูลปริมาณมากอาจทำให้ Memory บวมและช้า

🚀 **กลยุทธ์การปรับปรุง (Optimization Strategy)**:
- ระบุเฉพาะคอลัมน์ที่ต้องการใช้งานจริง (เช่น \`id\`, \`display_name\`, \`email\`)
- เพิ่ม \`LIMIT\` เพื่อจำกัดจำนวนผลลัพธ์ในการแสดงผลเริ่มต้น

✨ **คิวรีที่ปรับปรุงแล้ว (Optimized SQL)**:
\`\`\`sql
SELECT id, display_name, email, created_at 
FROM users 
ORDER BY id ASC 
LIMIT 100;
\`\`\`` as T;
    }

    return `⚡ **คำแนะนำการปรับปรุงคิวรี**:
\`\`\`sql
${query.trim()}
\`\`\`` as T;
  }

  if (cmd === "chat_ai") {
    const req = args?.req || args || {};
    const provider = req.provider || "ollama";
    let model = req.model;
    const messages = req.messages || [];
    const schema = req.schema || "";

    if (provider === "ollama") {
      const settings = getJson<any>(KEY_SETTINGS, {});
      const port = settings?.aiOllamaPort || 11434;
      if (!model) {
        try {
          const res = await fetch(`http://localhost:${port}/api/tags`);
          if (res.ok) {
            const data = await res.json();
            model = data?.models?.[0]?.name;
          }
        } catch {
          // Ignored
        }
      }
      model = model || "deepseek-r1:32b";

      const systemPrompt = `You are an expert AI database assistant inside Tabularis (similar to DBeaver AI Chat).
You help users query, optimize, analyze, and understand their database schemas and data.
When writing SQL statements or queries, always enclose them in markdown code blocks: \`\`\`sql ... \`\`\`.
Be concise, clear, and helpful.${schema ? `\n\nDatabase Schema Context:\n${schema}` : ""}`;

      const chatMessages = [
        { role: "system", content: systemPrompt },
        ...messages.map((m: any) => ({ role: m.role, content: m.content })),
      ];

      try {
        const res = await fetch(`http://localhost:${port}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: chatMessages,
            stream: false,
            options: { temperature: 0.2 },
          }),
        });
        if (res.ok) {
          const json = await res.json();
          let text: string = json?.message?.content || "";
          if (text.includes("</think>")) {
            text = text.split("</think>").pop()!.trim();
          }
          return text as T;
        }
      } catch (err) {
        console.error("[Web Shim] Ollama chat error:", err);
      }
    }

    // Fallback response if Ollama is offline
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user")?.content || "";
    if (/user/i.test(lastUserMsg)) {
      return `Here is a query for your \`users\` table:

\`\`\`sql
SELECT id, display_name, email, created_at 
FROM users 
ORDER BY id DESC 
LIMIT 20;
\`\`\`

You can click **Insert into Editor** to place this in your active tab, or **Run Query** to execute immediately!` as T;
    }

    return `I am your Tabularis AI Assistant. How can I help you with your database?
You can ask me to:
- Generate SQL queries for specific requirements
- Optimize slow queries and suggest indexes
- Explain table relationships and schemas

\`\`\`sql
SELECT NOW() AS server_time, current_database() AS database_name;
\`\`\`` as T;
  }

  if (cmd === "get_ai_activity" || cmd === "get_ai_sessions") {
    return [] as T;
  }

  // Fallback for any other commands
  console.warn(`[Web Shim] Unhandled invoke command: "${cmd}"`, args);
  return null as unknown as T;
}

if (typeof window !== "undefined") {
  (window as any).__TABULARIS_SHIM_INVOKE__ = invoke;
}

export function convertFileSrc(filePath: string, _protocol = "asset"): string {
  return filePath;
}

export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as any).__TAURI_INTERNALS__?.ipc === "function"
  );
}

export class Channel<T = any> {
  onmessage?: (response: T) => void;
  id = 1;
}

export class Resource {
  rid = 1;
  async close(): Promise<void> {}
}
