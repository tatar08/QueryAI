import type { Plugin, Connect } from 'vite';
import pg from 'pg';
import { MongoClient } from 'mongodb';
import { Connection as TediousConnection, Request as TediousRequest } from 'tedious';

const { Client } = pg;

function getMongoUri(params: any): string {
  if (params?.connection_uri && typeof params.connection_uri === 'string' && params.connection_uri.trim()) {
    return params.connection_uri.trim();
  }
  const host = params?.host || 'localhost';
  const port = Number(params?.port) || 27017;
  const user = params?.username ? encodeURIComponent(params.username) : '';
  const password = params?.password ? encodeURIComponent(params.password) : '';
  const auth = user ? (password ? `${user}:${password}@` : `${user}@`) : '';
  let db = '';
  if (typeof params?.database === 'string') db = params.database;
  else if (params?.database?.Single) db = params.database.Single;

  return `mongodb://${auth}${host}:${port}/${db}`;
}

function getMongoDatabaseName(params: any, overrideDb?: string): string {
  if (overrideDb && overrideDb.trim()) return overrideDb.trim();
  if (typeof params?.database === 'string' && params.database.trim()) return params.database.trim();
  if (params?.database?.Single && params.database.Single.trim()) return params.database.Single.trim();
  return 'testdb';
}

async function handleMongoCommand(cmd: string, args: any, params: any): Promise<any> {
  const uri = getMongoUri(params);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();

  try {
    if (cmd === 'test_connection') {
      const buildInfo = await client.db().admin().command({ buildInfo: 1 });
      const ver = buildInfo.version || '7.0';
      return `Connection successful! (MongoDB v${ver})`;
    }

    if (cmd === 'get_available_databases') {
      const admin = client.db().admin();
      const dbs = await admin.listDatabases();
      return dbs.databases.map((d: any) => d.name);
    }

    if (cmd === 'get_schemas') {
      return ['public'];
    }

    if (cmd === 'get_tables') {
      const targetDb = getMongoDatabaseName(params, args?.database || args?.schema);
      const collections = await client.db(targetDb).listCollections().toArray();
      return collections.map((col: any) => ({
        name: col.name,
        schema: 'public',
        type: 'table',
        approximate_row_count: null,
      }));
    }

    if (cmd === 'get_columns') {
      const targetDb = getMongoDatabaseName(params, args?.database || args?.schema);
      const collName = args?.table_name || args?.table;
      const docs = await client.db(targetDb).collection(collName).find().limit(50).toArray();
      const colSet = new Set<string>();
      colSet.add('_id');
      docs.forEach((doc: any) => {
        Object.keys(doc).forEach((k) => colSet.add(k));
      });
      return Array.from(colSet).map((k) => ({
        name: k,
        data_type: k === '_id' ? 'ObjectId' : 'JSON',
        nullable: true,
        default_value: null,
        is_primary_key: k === '_id',
      }));
    }

async function runMongoQuery(db: any, rawQuery: string): Promise<{ columns: string[]; rows: unknown[][]; affected_rows: number }> {
  const q = (rawQuery || '').trim();
  if (!q) {
    return { columns: [], rows: [], affected_rows: 0 };
  }

  let docs: any[] = [];
  const matchFind = q.match(/^(?:db\.)?([a-zA-Z0-9_-]+)\.find\((.*)\)/s);
  const matchAggregate = q.match(/^(?:db\.)?([a-zA-Z0-9_-]+)\.aggregate\((.*)\)/s);
  const matchInsert = q.match(/^(?:db\.)?([a-zA-Z0-9_-]+)\.insertOne\((.*)\)/s);
  const matchUpdate = q.match(/^(?:db\.)?([a-zA-Z0-9_-]+)\.update(?:Many|One)?\((.*)\)/s);
  const matchDelete = q.match(/^(?:db\.)?([a-zA-Z0-9_-]+)\.delete(?:Many|One)?\((.*)\)/s);
  const matchSql = q.match(/^SELECT\s+.*?\s+FROM\s+(?:["`']?[a-zA-Z0-9_-]+["`']?\.)?["`']?([a-zA-Z0-9_-]+)["`']?/i);

  function evalArg(argStr: string): any {
    const trimmed = (argStr || '').trim();
    if (!trimmed) return {};
    try {
      return new Function(`return (${trimmed});`)();
    } catch {
      return JSON.parse(trimmed);
    }
  }

  if (matchFind) {
    const coll = matchFind[1];
    const filter = evalArg(matchFind[2]);
    docs = await db.collection(coll).find(filter).limit(1000).toArray();
  } else if (matchAggregate) {
    const coll = matchAggregate[1];
    const pipeline = evalArg(matchAggregate[2]);
    docs = await db.collection(coll).aggregate(Array.isArray(pipeline) ? pipeline : [pipeline]).toArray();
  } else if (matchInsert) {
    const coll = matchInsert[1];
    const doc = evalArg(matchInsert[2]);
    const res = await db.collection(coll).insertOne(doc);
    docs = [{ acknowledged: res.acknowledged, insertedId: res.insertedId }];
  } else if (matchUpdate) {
    const coll = matchUpdate[1];
    const args = evalArg(`[${matchUpdate[2]}]`);
    const filter = args[0] || {};
    const update = args[1] || {};
    const res = await db.collection(coll).updateMany(filter, update);
    docs = [{ acknowledged: res.acknowledged, matchedCount: res.matchedCount, modifiedCount: res.modifiedCount }];
  } else if (matchDelete) {
    const coll = matchDelete[1];
    const filter = evalArg(matchDelete[2]);
    const res = await db.collection(coll).deleteMany(filter);
    docs = [{ acknowledged: res.acknowledged, deletedCount: res.deletedCount }];
  } else if (matchSql) {
    const coll = matchSql[1];
    let limit = 1000;
    const limitMatch = q.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      limit = parseInt(limitMatch[1], 10);
    }
    docs = await db.collection(coll).find({}).limit(limit).toArray();
  } else if (q.startsWith('{')) {
    const parsed = JSON.parse(q);
    if (parsed.collection) {
      docs = await db.collection(parsed.collection).find(parsed.filter || {}).limit(1000).toArray();
    } else {
      const cmdRes = await db.command(parsed);
      docs = [cmdRes];
    }
  } else if (q) {
    const collName = q.replace(/;$/, '').trim();
    docs = await db.collection(collName).find({}).limit(1000).toArray();
  }

  const colSet = new Set<string>();
  if (docs.some((d) => d && typeof d === 'object' && '_id' in d)) {
    colSet.add('_id');
  }
  docs.forEach((doc: any) => {
    if (doc && typeof doc === 'object') {
      Object.keys(doc).forEach((k) => colSet.add(k));
    }
  });
  const columns = Array.from(colSet);

  const rows = docs.map((doc: any) => {
    if (!doc || typeof doc !== 'object') {
      return [String(doc)];
    }
    return columns.map((col) => {
      const val = doc[col];
      if (val === undefined) return null;
      if (val && typeof val === 'object') {
        if (val._bsontype === 'ObjectID' || val.constructor?.name === 'ObjectId') {
          return val.toString();
        }
        if (val instanceof Date) {
          return val.toISOString();
        }
        return JSON.stringify(val);
      }
      return val;
    });
  });

  return {
    columns: columns.length > 0 ? columns : ['result'],
    rows,
    affected_rows: rows.length,
  };
}

    if (cmd === 'execute_query') {
      const targetDb = getMongoDatabaseName(params, args?.database || args?.schema);
      const db = client.db(targetDb);
      const startTime = Date.now();
      const res = await runMongoQuery(db, args?.query || '');
      const duration_ms = Date.now() - startTime;
      return {
        ...res,
        row_count: res.rows.length,
        duration_ms,
      };
    }

    if (cmd === 'execute_query_batch') {
      const targetDb = getMongoDatabaseName(params, args?.database || args?.schema);
      const db = client.db(targetDb);
      const queries: string[] = args?.queries || [];
      const results = [];
      for (const sql of queries) {
        if (!sql.trim()) continue;
        const start = Date.now();
        try {
          const res = await runMongoQuery(db, sql);
          results.push({
            result: res,
            error: null,
            execution_time_ms: Date.now() - start,
          });
        } catch (queryErr: any) {
          results.push({
            result: null,
            error: queryErr?.message || String(queryErr),
            execution_time_ms: Date.now() - start,
          });
        }
      }
      return results;
    }

    throw new Error(`Command "${cmd}" not implemented for MongoDB proxy.`);
  } finally {
    await client.close().catch(() => {});
  }
}

function parseSqlServerConnectionString(str: string): Record<string, string> {
  const res: Record<string, string> = {};
  if (!str) return res;

  if (str.startsWith('mssql://') || str.startsWith('sqlserver://') || str.startsWith('jdbc:sqlserver://')) {
    try {
      const clean = str.replace(/^jdbc:sqlserver:\/\//, 'mssql://').replace(/^sqlserver:\/\//, 'mssql://');
      const url = new URL(clean);
      if (url.hostname) res.host = url.hostname;
      if (url.port) res.port = url.port;
      if (url.username) res.username = decodeURIComponent(url.username);
      if (url.password) res.password = decodeURIComponent(url.password);
      if (url.pathname && url.pathname.length > 1) res.database = decodeURIComponent(url.pathname.slice(1));
      return res;
    } catch {}
  }

  const parts = str.split(';');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx > 0) {
      const key = part.slice(0, eqIdx).trim().toLowerCase();
      const val = part.slice(eqIdx + 1).trim();
      if (key === 'server' || key === 'data source' || key === 'addr' || key === 'address') {
        const hostParts = val.split(',');
        res.host = hostParts[0].trim();
        if (hostParts[1]) res.port = hostParts[1].trim();
      } else if (key === 'database' || key === 'initial catalog') {
        res.database = val;
      } else if (key === 'user id' || key === 'uid' || key === 'user') {
        res.username = val;
      } else if (key === 'password' || key === 'pwd') {
        res.password = val;
      } else if (key === 'port') {
        res.port = val;
      }
    }
  }
  return res;
}

function getSqlServerConfig(params: any, databaseOverride?: string) {
  const connStr = params?.connection_string || params?.connection_uri || '';
  const parsed = parseSqlServerConnectionString(connStr);

  const server = parsed.host || params?.host || 'localhost';
  const port = Number(parsed.port || params?.port) || 1433;
  const userName = parsed.username || params?.username || 'sa';
  const password = (parsed.password !== undefined) ? parsed.password : (params?.password != null ? String(params.password) : '');

  let database = (databaseOverride && databaseOverride.trim()) ? databaseOverride.trim() : '';
  if (!database) {
    database = parsed.database || (typeof params?.database === 'string' ? params.database.trim() : '') || params?.database?.Single || 'master';
  }

  return {
    server,
    authentication: {
      type: 'default' as const,
      options: {
        userName,
        password,
      },
    },
    options: {
      port,
      database,
      trustServerCertificate: true,
      encrypt: false,
      connectTimeout: 8000,
      requestTimeout: 30000,
    },
  };
}

function connectSqlServer(config: any): Promise<TediousConnection> {
  return new Promise((resolve, reject) => {
    const conn = new TediousConnection(config);
    conn.on('connect', (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(conn);
      }
    });
    conn.on('error', () => {});
    conn.connect();
  });
}

function runTediousSql(conn: TediousConnection, sql: string): Promise<{ columns: string[]; rows: unknown[][]; affectedRows: number }> {
  return new Promise((resolve, reject) => {
    const columns: string[] = [];
    const rows: unknown[][] = [];
    let affectedRows = 0;

    const request = new TediousRequest(sql, (err, rowCount) => {
      if (err) {
        return reject(err);
      }
      affectedRows = rowCount !== undefined ? rowCount : rows.length;
      resolve({ columns, rows, affectedRows });
    });

    request.on('columnMetadata', (columnsMeta: any) => {
      if (Array.isArray(columnsMeta)) {
        columnsMeta.forEach((col: any) => {
          columns.push(col.colName);
        });
      }
    });

    request.on('row', (columnsData) => {
      const row = columnsData.map((col: any) => {
        const val = col.value;
        if (val === null || val === undefined) return null;
        if (val instanceof Date) {
          return val.toISOString();
        }
        if (typeof val === 'bigint') {
          return val.toString();
        }
        return val;
      });
      rows.push(row);
    });

    conn.execSql(request);
  });
}

async function handleSqlServerCommand(cmd: string, args: any, params: any): Promise<any> {
  const dbOverride = args?.database || args?.request?.database;
  const config = getSqlServerConfig(params, typeof dbOverride === 'string' ? dbOverride : undefined);
  const conn = await connectSqlServer(config);

  try {
    if (cmd === 'test_connection') {
      const { rows } = await runTediousSql(conn, 'SELECT @@VERSION as version;');
      const ver = String(rows[0]?.[0] || 'SQL Server');
      const firstLine = ver.split('\n')[0].trim();
      return `Connection successful! (${firstLine})`;
    }

    if (cmd === 'get_available_databases') {
      const { rows } = await runTediousSql(conn, "SELECT name FROM sys.databases WHERE state = 0 AND name NOT IN ('model', 'tempdb') ORDER BY name;");
      return rows.map((r) => String(r[0]));
    }

    if (cmd === 'get_schemas') {
      const { rows } = await runTediousSql(conn, `
        SELECT schema_name FROM information_schema.schemata 
        WHERE schema_name NOT IN ('guest', 'INFORMATION_SCHEMA', 'sys', 'db_owner', 'db_accessadmin', 'db_securityadmin', 'db_ddladmin', 'db_backupoperator', 'db_datareader', 'db_datawriter', 'db_denydatareader', 'db_denydatawriter')
        ORDER BY schema_name;
      `);
      return rows.map((r) => String(r[0]));
    }

    if (cmd === 'get_tables') {
      const schema = (args?.schema || 'dbo').replace(/'/g, "''");
      const { rows } = await runTediousSql(conn, `
        SELECT TABLE_NAME as name, TABLE_SCHEMA as [schema], TABLE_TYPE as type
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = '${schema}'
        ORDER BY TABLE_NAME;
      `);
      return rows.map((r) => ({
        name: String(r[0]),
        schema: String(r[1]),
        type: String(r[2]).toUpperCase() === 'VIEW' ? 'view' : 'table',
        approximate_row_count: null,
      }));
    }

    if (cmd === 'get_columns') {
      const schema = (args?.schema || 'dbo').replace(/'/g, "''");
      const table = (args?.table_name || args?.table || '').replace(/'/g, "''");
      const { rows } = await runTediousSql(conn, `
        SELECT 
          c.COLUMN_NAME as name, 
          c.DATA_TYPE as data_type, 
          CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END as nullable, 
          c.COLUMN_DEFAULT as default_value, 
          c.CHARACTER_MAXIMUM_LENGTH as character_maximum_length,
          CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as is_primary_key
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN (
          SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
          JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc 
            ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
          WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        ) pk ON c.TABLE_SCHEMA = pk.TABLE_SCHEMA AND c.TABLE_NAME = pk.TABLE_NAME AND c.COLUMN_NAME = pk.COLUMN_NAME
        WHERE c.TABLE_NAME = '${table}' AND c.TABLE_SCHEMA = '${schema}'
        ORDER BY c.ORDINAL_POSITION;
      `);
      return rows.map((r) => ({
        name: String(r[0]),
        data_type: String(r[1]),
        nullable: Boolean(r[2]),
        default_value: r[3] != null ? String(r[3]) : null,
        character_maximum_length: r[4] != null ? Number(r[4]) : null,
        is_primary_key: Boolean(r[5]),
      }));
    }

    if (cmd === 'execute_query') {
      const sql = args?.query || '';
      const start = Date.now();
      const res = await runTediousSql(conn, sql);
      const duration_ms = Date.now() - start;
      return {
        columns: res.columns,
        rows: res.rows,
        affected_rows: res.affectedRows,
        duration_ms,
      };
    }

    if (cmd === 'execute_query_batch') {
      const queries: string[] = args?.queries || [];
      const results = [];
      for (const sql of queries) {
        if (!sql.trim()) continue;
        const start = Date.now();
        try {
          const res = await runTediousSql(conn, sql);
          results.push({
            result: {
              columns: res.columns,
              rows: res.rows,
              affected_rows: res.affectedRows,
            },
            error: null,
            execution_time_ms: Date.now() - start,
          });
        } catch (queryErr: any) {
          results.push({
            result: null,
            error: queryErr?.message || String(queryErr),
            execution_time_ms: Date.now() - start,
          });
        }
      }
      return results;
    }

    throw new Error(`Command "${cmd}" not implemented for SQL Server proxy.`);
  } finally {
    conn.close();
  }
}

function getDbClient(params: any, databaseOverride?: string) {
  const host = params?.host || 'localhost';
  const port = Number(params?.port) || 5432;
  const user = params?.username || 'postgres';
  const password = (params?.password != null && params.password !== '') ? String(params.password) : (process.env.PGPASSWORD || 'postgres');
  let database = (databaseOverride && databaseOverride.trim()) ? databaseOverride.trim() : 'postgres';
  if (!databaseOverride || !databaseOverride.trim()) {
    if (typeof params?.database === 'string' && params.database.trim()) {
      database = params.database.trim();
    } else if (params?.database?.Single) {
      database = params.database.Single;
    }
  }

  return new Client({
    host,
    port,
    user,
    password,
    database,
    connectionTimeoutMillis: 6000,
    ssl: params?.ssl_mode && params.ssl_mode !== 'disable' ? { rejectUnauthorized: false } : undefined,
  });
}

export function devDbProxyPlugin(): Plugin {
  return {
    name: 'tabularis-dev-db-proxy',
    configureServer(server) {
      server.middlewares.use(async (req: Connect.IncomingMessage, res, next) => {
        if (req.url !== '/__tabularis_proxy' || req.method !== 'POST') {
          return next();
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');
          try {
            const { cmd, args } = JSON.parse(body || '{}');
            const result = await handleProxyCommand(cmd, args);
            res.statusCode = 200;
            res.end(JSON.stringify({ result }));
          } catch (err: any) {
            console.error('[Tabularis DB Proxy Error]:', err?.message || err);
            res.statusCode = 400;
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
        });
      });
    },
  };
}

async function handleProxyCommand(cmd: string, args: any): Promise<any> {
  const params = args?.request?.params || args?.params || {};
  const driver = (params?.driver || 'postgres').toLowerCase();

  if (driver === 'mongodb') {
    return await handleMongoCommand(cmd, args, params);
  }

  if (driver === 'sqlserver' || driver === 'mssql') {
    return await handleSqlServerCommand(cmd, args, params);
  }

  if (driver !== 'postgres' && driver !== 'postgresql') {
    throw new Error(`Direct browser proxy supports PostgreSQL, MongoDB, and SQL Server. Driver "${driver}" is not supported yet.`);
  }

  const dbOverride = args?.database || args?.request?.database;
  const client = getDbClient(params, typeof dbOverride === 'string' ? dbOverride : undefined);

  if (cmd === 'test_connection') {
    await client.connect();
    try {
      const versionRes = await client.query('SELECT version();');
      const versionStr = versionRes.rows[0]?.version || 'PostgreSQL';
      return `Connection successful! (${versionStr.split(',')[0]})`;
    } finally {
      await client.end().catch(() => {});
    }
  }

  if (cmd === 'get_available_databases') {
    await client.connect();
    try {
      const q = await client.query(
        'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;'
      );
      return q.rows.map((r: any) => r.datname);
    } finally {
      await client.end().catch(() => {});
    }
  }

  if (cmd === 'get_schemas') {
    await client.connect();
    try {
      const q = await client.query(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema' ORDER BY schema_name;"
      );
      return q.rows.map((r: any) => r.schema_name);
    } finally {
      await client.end().catch(() => {});
    }
  }

  if (cmd === 'get_tables') {
    const schema = args?.schema || 'public';
    await client.connect();
    try {
      const q = await client.query(
        `SELECT table_name as name, table_schema as schema, table_type as type
         FROM information_schema.tables
         WHERE table_schema = $1
         ORDER BY table_name;`,
        [schema]
      );
      return q.rows.map((r: any) => ({
        name: r.name,
        schema: r.schema,
        type: r.type === 'VIEW' ? 'view' : 'table',
        approximate_row_count: null,
      }));
    } finally {
      await client.end().catch(() => {});
    }
  }

  if (cmd === 'get_columns') {
    const table = args?.table_name || args?.table;
    const schema = args?.schema || 'public';
    await client.connect();
    try {
      const q = await client.query(
        `SELECT c.column_name as name,
                c.data_type as data_type,
                c.is_nullable = 'YES' as nullable,
                c.column_default as default_value,
                c.character_maximum_length,
                kcu.column_name IS NOT NULL as is_primary_key
         FROM information_schema.columns c
         LEFT JOIN (
           SELECT kcu.column_name, kcu.table_name, kcu.table_schema
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
           WHERE tc.constraint_type = 'PRIMARY KEY'
         ) kcu ON kcu.column_name = c.column_name
              AND kcu.table_name = c.table_name
              AND kcu.table_schema = c.table_schema
         WHERE c.table_name = $1 AND c.table_schema = $2
         ORDER BY c.ordinal_position;`,
        [table, schema]
      );
      return q.rows.map((r: any) => ({
        name: r.name,
        data_type: r.data_type,
        nullable: Boolean(r.nullable),
        is_primary_key: Boolean(r.is_primary_key),
        default_value: r.default_value,
        character_maximum_length: r.character_maximum_length,
      }));
    } finally {
      await client.end().catch(() => {});
    }
  }

  if (cmd === 'execute_query') {
    const sql = args?.query;
    if (!sql || !sql.trim()) {
      return { columns: [], rows: [], affected_rows: 0 };
    }
    await client.connect();
    try {
      const q = await client.query({ text: sql, rowMode: 'array' });
      const columns = q.fields ? q.fields.map((f: any) => f.name) : [];
      const rows = q.rows || [];
      return {
        columns,
        rows,
        affected_rows: q.rowCount ?? 0,
      };
    } finally {
      await client.end().catch(() => {});
    }
  }

  if (cmd === 'execute_query_batch') {
    const queries: string[] = args?.queries || [];
    await client.connect();
    try {
      const results = [];
      for (const sql of queries) {
        if (!sql.trim()) continue;
        const start = Date.now();
        try {
          const q = await client.query({ text: sql, rowMode: 'array' });
          const columns = q.fields ? q.fields.map((f: any) => f.name) : [];
          results.push({
            result: {
              columns,
              rows: q.rows || [],
              affected_rows: q.rowCount ?? 0,
            },
            error: null,
            execution_time_ms: Date.now() - start,
          });
        } catch (queryErr: any) {
          results.push({
            result: null,
            error: queryErr?.message || String(queryErr),
            execution_time_ms: Date.now() - start,
          });
        }
      }
      return results;
    } finally {
      await client.end().catch(() => {});
    }
  }

  throw new Error(`Unknown proxy command: ${cmd}`);
}
