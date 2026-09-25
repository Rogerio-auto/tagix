/**
 * Suporte de teste F70-S17: rollback forçado da transação do produtor.
 *
 * {@link armableWithWorkspace} embrulha o `withWorkspace` real para, quando armado,
 * lançar DEPOIS de todo o trabalho do produtor (dado + outbox) e antes do COMMIT.
 * Prova que o evento foi gravado na MESMA transação: o rollback leva a linha da
 * outbox junto.
 *
 * Só importa tipos de `@hm/db`: o `vi.mock('@hm/db', …)` do teste carrega este módulo
 * dentro da própria fábrica, e importar `@hm/db` aqui recursaria no mock.
 */
import type { DbTx } from '@hm/db';

/** Erro lançado pelo rollback forçado — o teste o reconhece pela mensagem. */
export const FORCED_ROLLBACK_MESSAGE = 'F70-S17: rollback forçado pelo teste';

type WithWorkspace = <T>(workspaceId: string, fn: (tx: DbTx) => Promise<T>) => Promise<T>;

/** Liga/desliga o rollback forçado (estado compartilhado com a fábrica do mock). */
export interface RollbackSwitch {
  armed: boolean;
}

/**
 * `withWorkspace` que, armado, roda o trabalho inteiro do produtor (dado + outbox) e
 * lança antes do COMMIT — a transação volta toda.
 */
export function armableWithWorkspace(real: WithWorkspace, sw: RollbackSwitch): WithWorkspace {
  return <T>(workspaceId: string, fn: (tx: DbTx) => Promise<T>): Promise<T> =>
    real(workspaceId, async (tx) => {
      const out = await fn(tx);
      if (sw.armed) throw new Error(FORCED_ROLLBACK_MESSAGE);
      return out;
    });
}
