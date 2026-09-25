/**
 * Quando a versão nova do service worker pode assumir (F70-S28).
 *
 * A F61-S01 proibiu o `skipWaiting` automático — trocar o worker no meio de uma
 * resposta a cliente é como recarregar a tela sozinho — e deixou a troca para "a
 * próxima navegação". Mas um worker em `waiting` só assume quando NENHUMA janela
 * controlada pela versão velha está aberta, e o PWA no iOS vive em memória por dias:
 * a versão velha ficava presa, e junto com ela qualquer bug que a nova corrigia.
 *
 * O meio-termo: a página pede a troca (`skip-waiting`) num momento em que ninguém
 * está no meio de nada:
 *  - numa tela pública (login, cadastro…), onde não há trabalho em andamento;
 *  - com o app em segundo plano (`visibilityState === 'hidden'`), onde ninguém vê.
 *
 * A troca não recarrega nada: o worker novo só passa a atender os próximos pedidos.
 */
import { isPublicPath } from '@/shared/lib/public-routes';

export interface ActivationMoment {
  readonly pathname: string;
  readonly hidden: boolean;
}

/** `true` quando é seguro mandar `skip-waiting` para o worker em espera. */
export function canActivateWaitingWorker({ pathname, hidden }: ActivationMoment): boolean {
  return hidden || isPublicPath(pathname);
}
