import type { MascotState } from './contract';

/**
 * Máquina de estados do companheiro (F76-S11). PURA: sem DOM, sem timers, sem React.
 *
 * Regras (SPEC §4, PLANO §2):
 * - Fila de no máximo 1: o estado pedido enquanto outro toca espera; um pedido novo
 *   substitui o que esperava.
 * - `thinking` interrompe qualquer coisa e descarta a fila (é o único que fura).
 * - Estados com fim (`blink`, `celebrate` sem `final`, `wave`, `play`, `peek`) voltam ao
 *   próximo da fila ou a `idle` quando a figura avisa o fim (`end`).
 * - Estados que seguram (`thinking`, `avert`, `confused`, `sleep`, `celebrate` final) só
 *   saem por `release` (foco saiu, resposta chegou, próximo foco).
 * - `blink` nunca espera na fila e cede a qualquer pedido.
 */

export interface MachineModel {
  readonly current: MascotState;
  readonly queued: MascotState | null;
  /** `current === 'celebrate'` e a tela de sucesso fica: a pose final nunca termina. */
  readonly final: boolean;
  readonly queuedFinal: boolean;
}

export type MachineEvent =
  | { readonly type: 'request'; readonly state: MascotState; readonly final?: boolean }
  | { readonly type: 'end'; readonly state: MascotState }
  | { readonly type: 'release'; readonly state: MascotState };

export const INITIAL_MODEL: MachineModel = Object.freeze({
  current: 'idle',
  queued: null,
  final: false,
  queuedFinal: false,
});

const HELD: ReadonlySet<MascotState> = new Set<MascotState>([
  'thinking',
  'avert',
  'confused',
  'sleep',
]);

/** O estado atual só termina por `release` (nunca por `end`). */
export function isHeld(model: MachineModel): boolean {
  return HELD.has(model.current) || (model.current === 'celebrate' && model.final);
}

function advance(model: MachineModel): MachineModel {
  if (model.queued === null) return INITIAL_MODEL;
  return {
    current: model.queued,
    queued: null,
    final: model.queued === 'celebrate' && model.queuedFinal,
    queuedFinal: false,
  };
}

export function reduce(model: MachineModel, event: MachineEvent): MachineModel {
  switch (event.type) {
    case 'request': {
      const { state } = event;
      const final = state === 'celebrate' && event.final === true;

      if (state === 'thinking') {
        if (model.current === 'thinking') return model;
        return { current: 'thinking', queued: null, final: false, queuedFinal: false };
      }
      if (state === model.current) {
        // Pedir `celebrate` final enquanto toca a celebração só marca que ela fica.
        if (state === 'celebrate' && final && !model.final) return { ...model, final: true };
        return model;
      }
      if (model.current === 'idle' || model.current === 'blink') {
        return { current: state, queued: null, final, queuedFinal: false };
      }
      if (state === 'blink' || state === 'idle') return model;
      return { ...model, queued: state, queuedFinal: final };
    }
    case 'end': {
      if (event.state !== model.current || isHeld(model)) return model;
      return advance(model);
    }
    case 'release': {
      if (event.state === model.current) return advance(model);
      if (event.state === model.queued) return { ...model, queued: null, queuedFinal: false };
      return model;
    }
  }
}
