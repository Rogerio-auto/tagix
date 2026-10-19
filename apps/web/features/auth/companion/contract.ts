import type { ReactNode, RefCallback } from 'react';

/**
 * Contrato do companheiro das telas de acesso (F76-S10; ADR-006 §9; SPEC em
 * docs/design/auth-companion/SPEC.md).
 *
 * Só tipos. A implementação mora em `index.ts` (stub no-op até o F76-S11 trocar pelo motor).
 * Os nomes de estado, `MascotLook` e as props da figura espelham `MASCOTE_ANIMACOES.md`
 * §3.2/§6.1: quando o `@hm/ui` `Mascot` existir (F76-S03), este módulo vira adaptador fino.
 *
 * PRIVACIDADE É CONTRATO: nenhuma função deste módulo recebe valor de campo, tecla ou texto
 * digitado. O que a tela conta ao companheiro é só o que a PESSOA fez (enviou, deu certo,
 * deu erro, mudou de etapa). O foco é lido pelo próprio motor (tipo e posição do elemento).
 */

/** Estados do personagem (spec §3.2) + `avert`, criado pela emenda ADR-006 §9. */
export type MascotState =
  | 'idle'
  | 'blink'
  | 'wave'
  | 'play'
  | 'thinking'
  | 'celebrate'
  | 'sleep'
  | 'confused'
  | 'peek'
  | 'avert';

/** Para onde os olhos apontam (spec §3.2 `look`). */
export type MascotLook = 'none' | 'up' | 'left' | 'right';

/**
 * Posto = significado (SPEC §3).
 * - `heading`: "agora é aqui", em pé na linha do eyebrow do título (lg+).
 * - `perch`: "olho de longe enquanto você trabalha", no painel editorial (lg+).
 * - `inline`: caixa 40×40 na linha do logotipo (< lg). Nunca voa.
 */
export type CompanionStation = 'heading' | 'perch' | 'inline';

/** Etapas das telas de acesso. Uma rota pode passar por várias (cadastro → `signup-sent`). */
export type AuthStep =
  | 'login'
  | 'signup'
  | 'signup-sent'
  | 'verify-pending'
  | 'verify-done'
  | 'verify-invalid'
  | 'reset-request'
  | 'reset-sent'
  | 'reset-new'
  | 'reset-done'
  | 'invite'
  | 'invite-done';

/** Tipo de erro que a tela reporta. Nunca carrega a mensagem nem o campo. */
export type CompanionErrorKind = 'validation' | 'credentials' | 'server';

/**
 * O que a tela conta ao companheiro. União fechada e sem carga útil livre: não há
 * onde pôr valor de campo, por construção.
 * - `submit`: o envio começou (o `thinking` só aparece se passar de 300 ms).
 * - `settled`: o envio terminou sem resultado a celebrar nem erro a mostrar.
 * - `error`: a tela mostrou um erro do tipo `kind`.
 * - `success`: deu certo; `final: true` quando a tela de sucesso fica (pose final).
 */
export type CompanionSignal =
  | { type: 'submit' }
  | { type: 'settled' }
  | { type: 'error'; kind: CompanionErrorKind }
  | { type: 'success'; final: boolean };

/** API que os formulários recebem de `useAuthCompanion()`. */
export interface AuthCompanionApi {
  /** Fora do provider é no-op: a tela funciona igual sem o companheiro. */
  signal(s: CompanionSignal): void;
}

/** Âncoras medidas por ref (nunca por coordenada fixa). */
export type CompanionAnchorName = 'heading';

/** Assinaturas públicas (implementadas em `index.ts`). */
export type UseAuthCompanion = () => AuthCompanionApi;
export type UseAuthCompanionStep = (step: AuthStep) => void;
export type UseCompanionAnchor = <T extends HTMLElement>(
  name: CompanionAnchorName,
) => RefCallback<T>;

/** Tamanho da figura: 48 = LOD `md` desenhado na grade de 48; 40 = LOD de celular, braços fundidos. */
export type CompanionSize = 40 | 48;

/** `off` = poses estáticas (movimento reduzido); não existe `subtle` nas telas de acesso. */
export type CompanionMotion = 'live' | 'off';

/** Props da figura (subconjunto de `MascotProps`, spec §6.1). */
export interface CompanionFigureProps {
  state: MascotState;
  look: MascotLook;
  size: CompanionSize;
  motion: CompanionMotion;
  autoBlink?: boolean;
  onStateEnd?: (s: MascotState) => void;
}

export interface AuthCompanionRootProps {
  children: ReactNode;
}
