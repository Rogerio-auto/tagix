/**
 * API pública do companheiro das telas de acesso (F76-S11).
 *
 * Troca o stub do S10 pelo motor real mantendo EXATAMENTE os nomes e as assinaturas de
 * `contract.ts` (os formulários do S12 importam daqui). Só o provider, as âncoras e o
 * diretor entram no bundle inicial; a figura vive no chunk lazy (`CompanionFigure.tsx`,
 * carregado por `next/dynamic` dentro de `AuthCompanionRoot`).
 *
 * PRIVACIDADE: nenhuma função recebe valor de campo, tecla ou texto digitado.
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

export { AuthCompanionRoot, useAuthCompanion, useAuthCompanionStep } from './AuthCompanionRoot';
export { CompanionInlineSlot, CompanionPerch, useCompanionAnchor } from './anchors';
