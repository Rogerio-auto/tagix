/**
 * @hm/storage — abstração de storage de mídia. LocalDriver (dev) + R2Driver (prod),
 * atrás de `IStorageDriver`. A mídia nunca acumula na VPS (R2 é S3-compatível, sem egress).
 */
export * from './types';
export { LocalDriver, type LocalDriverOptions } from './local-driver';
export { R2Driver, type R2DriverOptions } from './r2-driver';
export { createStorage } from './factory';

export const STORAGE_PKG = '@hm/storage' as const;
