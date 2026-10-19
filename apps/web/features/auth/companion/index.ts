import { createElement } from 'react';
import type { ReactNode, RefCallback } from 'react';
import type {
  AuthCompanionApi,
  AuthCompanionRootProps,
  AuthStep,
  CompanionAnchorName,
} from './contract';

/**
 * API pública do companheiro das telas de acesso.
 *
 * ESTADO ATUAL: stub inofensivo (F76-S10). Os formulários já podem importar e chamar tudo
 * daqui; nada anima, nada é medido, nada roda. O F76-S11 troca a implementação mantendo
 * exatamente estas assinaturas (ver `contract.ts`) e a fronteira de privacidade: nenhuma
 * função recebe valor de campo.
 */

export type {
  AuthCompanionApi,
  AuthStep,
  CompanionAnchorName,
  CompanionErrorKind,
  CompanionFigureProps,
  CompanionMotion,
  CompanionSignal,
  CompanionSize,
  CompanionStation,
  MascotLook,
  MascotState,
} from './contract';

const NOOP_API: AuthCompanionApi = Object.freeze({
  signal: () => undefined,
});

const noopRef: RefCallback<HTMLElement> = () => undefined;

/** Fora do provider (e, por ora, sempre): `signal` é no-op. Referência estável. */
export function useAuthCompanion(): AuthCompanionApi {
  return NOOP_API;
}

/** Anuncia a etapa atual. No stub não faz nada. */
export function useAuthCompanionStep(_step: AuthStep): void {
  // implementado no F76-S11
}

/** Ref de âncora (ex.: o `<header>` do `AuthHeading`). No stub, ref inerte e estável. */
export function useCompanionAnchor<T extends HTMLElement>(
  _name: CompanionAnchorName,
): RefCallback<T> {
  return noopRef;
}

/** Provider + palco. No stub, só repassa os filhos. */
export function AuthCompanionRoot({ children }: AuthCompanionRootProps): ReactNode {
  return children;
}

/** Âncora do posto `perch` dentro do `BrandPanel`. No stub, nada. */
export function CompanionPerch(): null {
  return null;
}

/**
 * Posto `inline` (< lg) na linha do logotipo. Já reserva a caixa de 40×40 para a figura
 * entrar depois sem deslocar o layout (CLS zero desde o primeiro deploy). Vazia e
 * `aria-hidden`; some no lg+, onde os postos são `heading` e `perch`.
 */
export function CompanionInlineSlot(): ReactNode {
  return createElement('span', {
    'aria-hidden': true,
    'data-companion-slot': 'inline',
    className: 'block size-10 shrink-0 lg:hidden',
  });
}
