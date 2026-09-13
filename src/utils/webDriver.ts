import type { PluginManifest } from '../types/plugins';

export const webPostgresDriver: PluginManifest = {
  id: 'postgres', name: 'PostgreSQL', version: '1.0.0', description: 'PostgreSQL through the workspace server',
  default_port: 5432, default_username: 'postgres', is_builtin: true, icon: 'postgres', color: '#3b82f6',
  capabilities: {
    schemas: true, views: true, routines: false, triggers: false, materialized_views: true,
    file_based: false, folder_based: false, connection_string: true, identifier_quote: '"',
    alter_primary_key: false, alter_column: false, create_foreign_keys: false, manage_tables: false,
    supports_ssl: true, sql_dialect: 'postgres',
  },
};
