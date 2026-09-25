/**
 * F70-S05 — contrato das colunas de atribuição de anúncio em `contacts` e `deals`.
 * Unitário (sem Postgres): confere o schema Drizzle contra a migração 0082, para
 * que um dos dois não mude sem o outro.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { contacts, deals } from './index';

const AD_COLUMNS = [
  'ad_channel',
  'ad_source_type',
  'ad_source_id',
  'ad_source_url',
  'ad_headline',
  'ad_body',
  'ad_media_type',
  'ad_ctwa_clid',
  'ad_referred_at',
] as const;

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  path.resolve(here, '../../drizzle/0082_f70_ad_attribution.sql'),
  'utf-8',
);
const journal: unknown = JSON.parse(
  readFileSync(path.resolve(here, '../../drizzle/meta/_journal.json'), 'utf-8'),
);

describe.each<[string, PgTable]>([
  ['contacts', contacts],
  ['deals', deals],
])('%s — atribuição de anúncio', (name, table) => {
  const cfg = getTableConfig(table);

  it('tem as 9 colunas ad_*, todas nullable (migração aditiva)', () => {
    for (const col of AD_COLUMNS) {
      const c = cfg.columns.find((x) => x.name === col);
      expect(c, col).toBeDefined();
      expect(c?.notNull, col).toBe(false);
      expect(c?.hasDefault, col).toBe(false);
    }
    const referredAt = cfg.columns.find((x) => x.name === 'ad_referred_at');
    expect(referredAt?.getSQLType()).toBe('timestamp with time zone');
  });

  it('CHECKs de canal e de tudo-ou-nada', () => {
    const names = cfg.checks.map((c) => c.name);
    expect(names).toContain(`${name}_ad_channel_chk`);
    expect(names).toContain(`${name}_ad_attribution_chk`);
  });

  it('índice parcial (workspace_id, ad_source_id)', () => {
    const idx = cfg.indexes.find((i) => i.config.name === `idx_${name}_ad_source`);
    expect(idx).toBeDefined();
    expect(idx?.config.where).toBeDefined();
  });

  it('a migração 0082 cria exatamente o que o schema declara', () => {
    for (const col of AD_COLUMNS) {
      expect(migration).toMatch(new RegExp(`ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS ${col} `));
    }
    expect(migration).toContain(`${name}_ad_channel_chk`);
    expect(migration).toContain(`${name}_ad_attribution_chk`);
    expect(migration).toContain(`idx_${name}_ad_source`);
    expect(migration).not.toMatch(/ADD COLUMN[^;]*(NOT NULL|DEFAULT)/i);
  });
});

describe('journal', () => {
  it('registra a 0082 logo depois da 0081', () => {
    const entries =
      typeof journal === 'object' &&
      journal !== null &&
      'entries' in journal &&
      Array.isArray(journal.entries)
        ? (journal.entries as ReadonlyArray<{ idx: number; tag: string }>)
        : [];
    const e82 = entries.find((e) => e.tag === '0082_f70_ad_attribution');
    expect(e82?.idx).toBe(82);
  });
});
