/**
 * F70-S18 (L9) — guarda do seed da Arcada. Pura: nenhum teste abre conexão, e importar o
 * módulo não roda o seed (o `main` só dispara como CLI).
 */
import { describe, expect, it } from 'vitest';
import { assertSeedTargetAllowed, isProductionDatabaseName } from './agent_templates_arcada.run';

const DEV = 'postgres://hm:hm@localhost:5442/highermind';
const PROD_REMOTE = 'postgresql://leadium:x@10.0.0.5:5432/leadium';

describe('assertSeedTargetAllowed', () => {
  it('banco local de dev → roda', () => {
    expect(assertSeedTargetAllowed({ DATABASE_URL: DEV, NODE_ENV: 'development' })).toEqual({
      host: 'localhost',
      database: 'highermind',
    });
    expect(
      assertSeedTargetAllowed({ DATABASE_URL: 'postgres://u:p@[::1]:5432/highermind' }),
    ).toEqual({ host: '[::1]', database: 'highermind' });
  });

  it('NODE_ENV=production recusa SEMPRE, mesmo com as duas confirmações', () => {
    for (const NODE_ENV of ['production', ' Production ']) {
      expect(() => assertSeedTargetAllowed({ DATABASE_URL: DEV, NODE_ENV })).toThrow(
        /NODE_ENV=production/,
      );
      expect(() =>
        assertSeedTargetAllowed({
          DATABASE_URL: PROD_REMOTE,
          NODE_ENV,
          ARCADA_SEED_ALLOW_REMOTE: '1',
          ARCADA_SEED_CONFIRM_DATABASE: 'leadium',
        }),
      ).toThrow(/NODE_ENV=production/);
    }
  });

  it('banco com nome de produção recusa mesmo em localhost (túnel SSH)', () => {
    for (const db of ['leadium', 'LEADIUM', 'tagix_prod', 'app-production']) {
      expect(() =>
        assertSeedTargetAllowed({ DATABASE_URL: `postgres://u:p@localhost:5432/${db}` }),
      ).toThrow(/nome de produção/);
    }
  });

  it('ALLOW_REMOTE sozinho não basta: precisa confirmar o nome EXATO do banco', () => {
    expect(() =>
      assertSeedTargetAllowed({ DATABASE_URL: PROD_REMOTE, ARCADA_SEED_ALLOW_REMOTE: '1' }),
    ).toThrow(/ARCADA_SEED_CONFIRM_DATABASE/);
    expect(() =>
      assertSeedTargetAllowed({
        DATABASE_URL: PROD_REMOTE,
        ARCADA_SEED_ALLOW_REMOTE: '1',
        ARCADA_SEED_CONFIRM_DATABASE: 'highermind',
      }),
    ).toThrow(/nome de produção/);
    expect(() =>
      assertSeedTargetAllowed({
        DATABASE_URL: PROD_REMOTE,
        ARCADA_SEED_CONFIRM_DATABASE: 'leadium',
      }),
    ).toThrow();
  });

  it('host remoto com nome qualquer também exige as duas confirmações', () => {
    const url = 'postgres://u:p@db.example.com:5432/staging';
    expect(() => assertSeedTargetAllowed({ DATABASE_URL: url })).toThrow(/não-local/);
    expect(
      assertSeedTargetAllowed({
        DATABASE_URL: url,
        ARCADA_SEED_ALLOW_REMOTE: '1',
        ARCADA_SEED_CONFIRM_DATABASE: 'staging',
      }),
    ).toEqual({ host: 'db.example.com', database: 'staging' });
  });

  it('com as duas confirmações (e fora de NODE_ENV=production) o alvo de produção é aceito', () => {
    expect(
      assertSeedTargetAllowed({
        DATABASE_URL: PROD_REMOTE,
        ARCADA_SEED_ALLOW_REMOTE: '1',
        ARCADA_SEED_CONFIRM_DATABASE: 'leadium',
      }),
    ).toEqual({ host: '10.0.0.5', database: 'leadium' });
  });

  it('URL ausente, ilegível ou sem nome de banco → recusa', () => {
    expect(() => assertSeedTargetAllowed({})).toThrow(/ausente/);
    expect(() => assertSeedTargetAllowed({ DATABASE_URL: '   ' })).toThrow(/ausente/);
    expect(() => assertSeedTargetAllowed({ DATABASE_URL: 'não é url' })).toThrow(/ilegível/);
    expect(() => assertSeedTargetAllowed({ DATABASE_URL: 'postgres://u:p@localhost:5432/' })).toThrow(
      /sem nome de banco/,
    );
  });
});

describe('isProductionDatabaseName', () => {
  it.each([
    ['leadium', true],
    ['Leadium', true],
    ['prod', true],
    ['leadium_prod', true],
    ['highermind', false],
    ['leadium_dev', false],
    ['tagix_test', false],
  ])('%s → %s', (name, expected) => {
    expect(isProductionDatabaseName(name)).toBe(expected);
  });
});
