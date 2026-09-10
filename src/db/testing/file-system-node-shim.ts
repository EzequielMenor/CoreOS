import { copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function pathFromUri(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

export class File {
  private readonly path: string;

  // ponytail: en estos tests la DB vive bajo tmpdir(), no en
  // defaultDatabaseDirectory, así que `exists` da false y backupDatabase()
  // queda como no-op. El backup real no está cubierto por este arnés.
  constructor(directoryOrUri: string, name?: string) {
    this.path = name === undefined
      ? pathFromUri(directoryOrUri)
      : join(pathFromUri(directoryOrUri), name);
  }

  get exists(): boolean {
    return existsSync(this.path);
  }

  async copy(destination: File): Promise<void> {
    await copyFile(this.path, destination.path);
  }
}
