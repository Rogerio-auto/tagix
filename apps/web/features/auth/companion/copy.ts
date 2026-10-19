import type { AuthStep } from './contract';

/**
 * Textos do balão do companheiro (SPEC §5). PT-BR, sem tom de venda, sem promessa nova.
 *
 * Regras:
 * - No máximo dois momentos por fluxo: a chegada (uma vez por sessão) e um momento contextual.
 * - O balão é `aria-hidden`: todo texto repete o que o título ou o lead já dizem, ou é só
 *   saudação (não carrega informação que o leitor de tela perderia).
 * - Uma frase curta com ponto final; cabe em até duas linhas do balão (`max-width: 22ch`).
 */

/** Balão de chegada. Etapas fora do mapa não cumprimentam (sessão expirada, reset, convite, verificação). */
export const ARRIVAL_BUBBLE: Readonly<Partial<Record<AuthStep, string>>> = {
  /** Saudação pura; o título "Entrar" já diz a tarefa. */
  login: 'Que bom que voltou.',
  /** Repete o lead "Comece em minutos." sem prometer um número. */
  signup: 'Leva poucos minutos.',
};

/** Balão do momento contextual, depois do voo de volta ao título. */
export const CONTEXT_BUBBLE: Readonly<Partial<Record<AuthStep, string>>> = {
  /** Título: "Verifique seu email". */
  'signup-sent': 'O link está no seu email.',
  /** Título: "Confira sua caixa de entrada"; lead: "O link de redefinição…". */
  'reset-sent': 'O link já está a caminho.',
};

/** Chave de `sessionStorage` que impede repetir a saudação na mesma sessão. Única coisa guardada. */
export const GREETED_STORAGE_KEY = 'hm:auth-companion:greeted';
