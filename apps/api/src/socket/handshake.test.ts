/**
 * F70-S28: a mensagem do `connect_error` do handshake é contrato com o web
 * (`apps/web/shared/realtime/session-guard.ts`). `unauthorized` leva ao login;
 * qualquer outra é temporária. Trocar estas strings desloga (ou prende) todo mundo.
 */
import { describe, expect, it } from 'vitest';
import { handshakeErrorMessage } from './index';

describe('handshakeErrorMessage', () => {
  it('sessão morta → `unauthorized` (o web vai ao login e para de tentar)', () => {
    expect(handshakeErrorMessage('invalid')).toBe('unauthorized');
  });

  it('provider de auth fora do ar → `auth_unavailable` (o web tenta de novo, sem deslogar)', () => {
    expect(handshakeErrorMessage('unavailable')).toBe('auth_unavailable');
  });
});
