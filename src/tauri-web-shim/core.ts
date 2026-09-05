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

// Initial demo connections & groups if empty or malformed
function initializeDefaults() {
  if (typeof localStorage === "undefined") return;
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
  if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__?.invoke) {
    return (window as any).__TAURI_INTERNALS__.invoke(cmd, args);
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
    const conn = args.connection || args.conn || args;
    const list = getJson<any[]>(KEY_CONNECTIONS, []);
    const id = conn.id || `conn-${Date.now()}`;
    const formattedConn = {
      ...conn,
      id,
      params: conn.params || {
        driver: conn.driver || "postgres",
        host: conn.host,
        port: conn.port,
        database: conn.database || "",
        username: conn.username || conn.user,
      },
      updatedAt: new Date().toISOString(),
    };
    const index = list.findIndex((c) => c.id === id);
    if (index >= 0) {
      list[index] = formattedConn;
    } else {
      list.push(formattedConn);
    }
    setJson(KEY_CONNECTIONS, list);
    return formattedConn as T;
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

  if (cmd === "move_group_to_parent" || cmd === "move_connection_to_group" || cmd === "reorder_groups" || cmd === "reorder_connections_in_group") {
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

  // Database Connection & execution
  if (cmd === "test_connection" || cmd === "connect") {
    throw new Error("Direct database connections are disabled in Web Preview mode. Use desktop build for direct native database connectivity.");
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

  // Fallback for any other commands
  console.warn(`[Web Shim] Unhandled invoke command: "${cmd}"`, args);
  return null as unknown as T;
}

export function convertFileSrc(filePath: string, _protocol = "asset"): string {
  return filePath;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);
}

export class Channel<T = any> {
  onmessage?: (response: T) => void;
  id = 1;
}

export class Resource {
  rid = 1;
  async close(): Promise<void> {}
}
