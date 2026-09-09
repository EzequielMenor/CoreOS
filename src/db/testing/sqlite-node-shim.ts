import { DatabaseSync } from 'node:sqlite';

// Fidelidad: node:sqlite activa foreign_keys; expo-sqlite no fija ese pragma (SQLite lo deja OFF).
// Fidelidad: expo-sqlite parsea columnas JSON declaradas; este shim devuelve strings.
// ponytail: cubre solo lo que necesita initDb; no es un emulador general de expo-sqlite.

export const defaultDatabaseDirectory = '/tmp/coreos-db-testing';
type SQLiteParam = null | number | bigint | string | Uint8Array;

function bindParams(params: unknown[]): SQLiteParam[] {
  return params.map((param) => {
    if (param === undefined) return null;
    if (typeof param === 'boolean') return param ? 1 : 0;
    return param as SQLiteParam;
  });
}

export class NodeSQLiteDatabase {
  private readonly raw: DatabaseSync;
  private transactionDepth = 0;

  constructor(path: string) {
    this.raw = new DatabaseSync(path);
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

  __raw(): DatabaseSync {
    return this.raw;
  }
}

let connection: NodeSQLiteDatabase | null = null;

export async function openDatabaseAsync(_name: string): Promise<NodeSQLiteDatabase> {
  if (!connection) connection = new NodeSQLiteDatabase(process.env.COREOS_DB_PATH || ':memory:');
  return connection;
}

export type SQLiteDatabase = NodeSQLiteDatabase;

export function __raw(): DatabaseSync {
  if (!connection) throw new Error('Database has not been opened');
  return connection.__raw();
}
