import type { IStorageDriver, StorageDriverKind } from './types';
import { LocalDriver } from './local-driver';
import { R2Driver } from './r2-driver';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

/** Escolhe o driver pelo `STORAGE_DRIVER` (default 'local' em dev). */
export function createStorage(): IStorageDriver {
  const kind = (process.env['STORAGE_DRIVER'] ?? 'local') as StorageDriverKind;
  if (kind === 'r2') {
    return new R2Driver({
      accountId: requireEnv('R2_ACCOUNT_ID'),
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
      bucket: requireEnv('R2_BUCKET'),
    });
  }
  return new LocalDriver({
    basePath: process.env['LOCAL_STORAGE_PATH'] ?? './tmp/storage',
    publicBaseUrl: process.env['STORAGE_PUBLIC_URL'],
  });
}
