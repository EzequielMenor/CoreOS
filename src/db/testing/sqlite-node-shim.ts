import Database from 'better-sqlite3';

// Backend del arnes de tests: better-sqlite3 (dev-only) en lugar de node:sqlite.
// Motivo: la build de node:sqlite del runner de CI carece de ENABLE_FTS5
// ("no such module: fts5"), mientras better-sqlite3 trae SQLite con FTS5 real
// en sus prebuilds. Expo-sqlite sigue siendo el motor de produccion: este modulo
// solo se usa desde src/**/__tests__ y nunca lo empaqueta Metro.
//
// Fidelidad: better-sqlite3 deja foreign_keys ON por defecto (igual que node:sqlite);
// se fija el pragma explicitamente para que el arnes no dependa de defaults del backend.
// Fidelidad: expo-sqlite parsea columnas JSON declaradas; este shim devuelve strings.
// ponytail: cubre solo lo que necesita initDb; no es un emulador general de expo-sqlite.

export const defaultDatabaseDirectory = '/tmp/coreos-db-testing';
type SQLiteParam = null | number | bigint | string | Uint8Array;

// Handle crudo del backend (mejor-sqlite3). Los tests lo usan para seeds y aserciones.
export type RawSqlite = Database.Database;

function bindParams(params: unknown[]): SQLiteParam[] {
  return params.map((param) => {
    if (param === undefined) return null;
    if (typeof param === 'boolean') return param ? 1 : 0;
    return param as SQLiteParam;
  });
}

// Fabrica de handles crudos para seeds y helpers de test, con la fidelidad
// del arnes aplicada (foreign_keys ON). Sustituye a new DatabaseSync('node:sqlite').
export function createNodeDatabase(path: string): RawSqlite {
  const raw = new Database(path);
  raw.pragma('foreign_keys = ON');
  return raw;
}

export class NodeSQLiteDatabase {
  private readonly raw: RawSqlite;
  private transactionDepth = 0;

  constructor(path: string) {
    this.raw = createNodeDatabase(path);
  }

  async execAsync(sql: string): Promise<void> {
    this.raw.exec(sql);
  }

  async runAsync(
    sql: string,
    ...params: unknown[]
  ): Promise<{ lastInsertRowId: number; changes: number }> {
    const result = this.raw.prepare(sql).run(...bindParams(params));
    return {
      lastInsertRowId: Number(result.lastInsertRowid),
      changes: Number(result.changes),
    };
  }

  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...bindParams(params)) as T[];
  }

  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    return (this.raw.prepare(sql).get(...bindParams(params)) as T | undefined) ?? null;
  }

  async withTransactionAsync(callback: () => Promise<void>): Promise<void> {
    if (this.transactionDepth > 0) {
      this.transactionDepth += 1;
      try {
        await callback();
      } finally {
        this.transactionDepth -= 1;
      }
      return;
    }
    this.raw.exec('BEGIN');
    this.transactionDepth = 1;
    try {
      await callback();
      this.raw.exec('COMMIT');
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth = 0;
    }
  }

  async withExclusiveTransactionAsync(callback: () => Promise<void>): Promise<void> {
    return this.withTransactionAsync(callback);
  }

  closeSync(): void {}

  __raw(): RawSqlite {
    return this.raw;
  }
}

let connection: NodeSQLiteDatabase | null = null;

export async function openDatabaseAsync(_name: string): Promise<NodeSQLiteDatabase> {
  if (!connection) connection = new NodeSQLiteDatabase(process.env.COREOS_DB_PATH || ':memory:');
  return connection;
}

export type SQLiteDatabase = NodeSQLiteDatabase;

export function __raw(): RawSqlite {
  if (!connection) throw new Error('Database has not been opened');
  return connection.__raw();
}
