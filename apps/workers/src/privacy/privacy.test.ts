/**
 * F10-S02 — processador de export LGPD. Integração real contra o Postgres dev:
 * seed de PII + job pendente → processPendingExports (storage MOCKADO) reúne o
 * artefato, grava via storage e marca o job `done` com chave + expiração. Também
 * cobre o claim sob RLS (job marcado processing) e o conteúdo do artefato.
 *
 * `@hm/workers` não tem dotenv; carregamos DATABASE_URL do .env da raiz (mesmo
 * padrão do teste de webhooks).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

beforeAll(() => {
  if (process.env['DATABASE_URL']) return;
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.env');
  try {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1]!;
      let val = m[2]!;
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // Sem .env → getDb() lança com mensagem clara.
  }
});

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { createLogger } from '@hm/logger';
import type { IStorageDriver, PutObjectInput } from '@hm/storage';
import { artifactKey, processPendingExports } from './index';
import type { ExportArtifact } from './index';

const { workspaces, contacts, channels, conversations, messages, dataExportJobs } = schema;
const logger = createLogger('error');

let ws = '';

/** Storage em memória — captura os puts para inspeção do artefato. */
class MemoryStorage implements IStorageDriver {
  readonly objects = new Map<string, Uint8Array>();
  async put(input: PutObjectInput): Promise<void> {
    this.objects.set(input.key, input.body as Uint8Array);
  }
  async getSignedUrl(key: string) {
    return { url: `mem://${key}`, expiresAt: new Date(Date.now() + 60_000) };
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

beforeAll(async () => {
  const [w] = await getDb()
    .insert(workspaces)
    .values({ name: 'PRV', slug: `prv-${randomUUID().slice(0, 8)}` })
    .returning();
  if (!w) throw new Error('ws');
  ws = w.id;
});

afterAll(async () => {
  if (ws) await getDb().delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

describe('processPendingExports', () => {
  it('monta o artefato de um job de contato, grava no storage e marca done', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);
    const [ch] = await db
      .insert(channels)
      .values({ workspaceId: ws, provider: 'meta_whatsapp', name: `WA ${sfx}`, phoneNumberId: `p-${sfx}`, wabaId: `w-${sfx}` })
      .returning();
    const [ct] = await db
      .insert(contacts)
      .values({ workspaceId: ws, displayName: 'Maria', phone: '+5511970000000', email: `maria-${sfx}@t.local` })
      .returning();
    if (!ch || !ct) throw new Error('setup');
    const [conv] = await db
      .insert(conversations)
      .values({ workspaceId: ws, channelId: ch.id, contactId: ct.id, remoteId: `r-${sfx}` })
      .returning();
    if (!conv) throw new Error('conv');
    await db.insert(messages).values({
      workspaceId: ws,
      conversationId: conv.id,
      direction: 'inbound',
      senderType: 'contact',
      content: 'olá, quero comprar',
    });

    const [job] = await db
      .insert(dataExportJobs)
      .values({ workspaceId: ws, scope: { kind: 'contact', contactId: ct.id } })
      .returning();
    if (!job) throw new Error('job');

    const storage = new MemoryStorage();
    const result = await processPendingExports({ storage, logger });
    expect(result.done).toBeGreaterThanOrEqual(1);

    const [after] = await db.select().from(dataExportJobs).where(eq(dataExportJobs.id, job.id));
    expect(after?.status).toBe('done');
    expect(after?.artifactKey).toBe(artifactKey(ws, job.id));
    expect(after?.expiresAt).toBeTruthy();
    expect(after?.completedAt).toBeTruthy();

    const blob = storage.objects.get(artifactKey(ws, job.id));
    expect(blob).toBeDefined();
    const artifact = JSON.parse(Buffer.from(blob!).toString('utf8')) as ExportArtifact;
    expect(artifact.workspaceId).toBe(ws);
    expect(artifact.scope).toEqual({ kind: 'contact', contactId: ct.id });
    expect(artifact.contacts).toHaveLength(1);
    expect(artifact.messages).toHaveLength(1);
  });

  it('é idempotente: job já done não volta a pending nem é reprocessado', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);
    const [ct] = await db
      .insert(contacts)
      .values({ workspaceId: ws, displayName: 'Ana', phone: `+551196000${sfx.slice(0, 4)}` })
      .returning();
    if (!ct) throw new Error('contact');
    const [job] = await db
      .insert(dataExportJobs)
      .values({ workspaceId: ws, scope: { kind: 'contact', contactId: ct.id } })
      .returning();
    if (!job) throw new Error('job');

    const storage = new MemoryStorage();
    await processPendingExports({ storage, logger });
    const [first] = await db.select().from(dataExportJobs).where(eq(dataExportJobs.id, job.id));
    expect(first?.status).toBe('done');
    const firstCompletedAt = first?.completedAt?.getTime();

    // Segunda passada: o job já está done → claim sob RLS não o repega.
    await processPendingExports({ storage, logger });
    const [second] = await db.select().from(dataExportJobs).where(eq(dataExportJobs.id, job.id));
    expect(second?.status).toBe('done');
    expect(second?.completedAt?.getTime()).toBe(firstCompletedAt);
  });
});
