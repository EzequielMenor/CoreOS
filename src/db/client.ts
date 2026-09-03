import * as SQLite from 'expo-sqlite';
import { defaultDatabaseDirectory } from 'expo-sqlite';

export const DB_NAME = 'coreos.db';
export const DB_DIR: string = defaultDatabaseDirectory as string;

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync(DB_NAME);
  return _db;
}

export function closeDb() {
  if (_db) {
    _db.closeSync();
    _db = null;
  }
}
