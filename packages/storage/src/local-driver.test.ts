import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDriver } from './local-driver';

let dir = '';

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hm-storage-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('LocalDriver', () => {
  it('put grava, getSignedUrl assina e delete remove', async () => {
    const driver = new LocalDriver({ basePath: dir });
    const key = 'media/a/b/test.txt';

    await driver.put({ key, body: new TextEncoder().encode('hello'), contentType: 'text/plain' });
    expect(await readFile(path.join(dir, key), 'utf8')).toBe('hello');

    const signed = await driver.getSignedUrl(key, 60);
    expect(signed.url).toContain('sig=');
    expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());

    await driver.delete(key);
    await expect(stat(path.join(dir, key))).rejects.toThrow();
  });
});
