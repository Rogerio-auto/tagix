/**
 * F70-S19 (achado L3) — aviso no boot dos workers quando `META_APP_ID` está vazio.
 *
 * O aviso mora na composição da coexistência (`coexistence/worker.ts`), mas protege a
 * IA: sem o id do app, o eco do Instagram de uma resposta do agente pode pausar a IA
 * como se fosse resposta humana. Fica aqui porque os testes de `coexistence/` estão
 * fora da fronteira do slot.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ownMetaAppIdsFromEnv,
  resetOwnMetaAppIdsWarningForTests,
  warnIfOwnMetaAppIdsMissing,
} from '../coexistence/worker';

describe('aviso de META_APP_ID vazio (F70-S19)', () => {
  beforeEach(() => resetOwnMetaAppIdsWarningForTests());

  it('vazio ou só espaços/vírgulas → um warn, uma vez por processo', () => {
    const logger = { warn: vi.fn() };
    expect(warnIfOwnMetaAppIdsMissing(ownMetaAppIdsFromEnv({}), logger)).toBe(true);
    expect(warnIfOwnMetaAppIdsMissing(ownMetaAppIdsFromEnv({ META_APP_ID: ' , ' }), logger)).toBe(
      false,
    );
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0]?.[0]).toContain('META_APP_ID');
  });

  it('com o id do app → não avisa', () => {
    const logger = { warn: vi.fn() };
    expect(
      warnIfOwnMetaAppIdsMissing(ownMetaAppIdsFromEnv({ META_APP_ID: '1241342414558641' }), logger),
    ).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
