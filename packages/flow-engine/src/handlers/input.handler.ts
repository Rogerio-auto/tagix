/**
 * Handler `input` (F31-S09). Captura tipada da proxima resposta do contato, com validacao,
 * retry e timeout. Maquina biestavel espelhando `wait_for_response`:
 *
 *  - 1a chamada: envia o prompt (interpolado, via bridge outbound real) e retorna WAITING com
 *    `nextStepAt = now + timeoutSeconds`, semeando markers `waiting_for_input`/`waiting_for_response`.
 *    O marker `waiting_for_response` e o que faz `resumeFlowWithResponse` (dispatcher) retomar
 *    a execucao quando o contato responde.
 *  - Resumption (`responded === true`): valida `last_response` pelo `validationType`. Sucesso ->
 *    grava `input.<variable>` e segue pela edge `response`. Falha -> reenvia `retryMessage` e
 *    volta a WAITING ate `maxRetries`; ao exceder, segue pela edge `timeout`.
 *  - Timeout (timer venceu sem `responded`): segue pela edge `timeout`.
 *
 * Edges do catalogo (S08): `response`, `timeout`. Variavel utilizavel a jusante via
 * `{{input.<variable>}}`.
 */
import { z } from 'zod';
import { interpolate } from '../utils/interpolate';
import type { FlowHandler, FlowHandlerResult } from '../types';

const VALIDATION_TYPES = ['text', 'email', 'phone', 'number', 'date'] as const;
type ValidationType = (typeof VALIDATION_TYPES)[number];

const inputSchema = z.object({
  /** mensagem de prompt enviada antes de aguardar (interpolada). */
  prompt: z.string().optional(),
  /** variavel onde a resposta validada sera gravada (sem o prefixo `input.`). */
  variable: z.string().min(1),
  /** tipo de validacao aplicado a resposta crua. */
  validationType: z.enum(VALIDATION_TYPES).optional(),
  /** mensagem reenviada quando a validacao falha (default = o proprio prompt). */
  retryMessage: z.string().optional(),
  /** numero maximo de tentativas extras antes de seguir por `timeout`. */
  maxRetries: z.number().int().min(0).optional(),
  /** janela de espera, em segundos, antes de seguir por `timeout`. */
  timeoutSeconds: z.number().int().positive().optional(),
});

type InputData = z.infer<typeof inputSchema>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valida e normaliza a resposta crua conforme o tipo. Retorna o valor coagido ou erro. */
function validate(
  raw: string,
  type: ValidationType,
): { ok: true; value: unknown } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false };

  switch (type) {
    case 'email':
      return EMAIL_RE.test(trimmed) ? { ok: true, value: trimmed } : { ok: false };
    case 'phone': {
      const digits = trimmed.replace(/[^\d]/g, '');
      return digits.length >= 8 && digits.length <= 15 ? { ok: true, value: digits } : { ok: false };
    }
    case 'number': {
      const n = Number(trimmed.replace(',', '.'));
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case 'date': {
      const ts = Date.parse(trimmed);
      return Number.isNaN(ts) ? { ok: false } : { ok: true, value: new Date(ts).toISOString() };
    }
    default:
      return { ok: true, value: trimmed };
  }
}

/** Markers limpos ao sair do estado de espera (sucesso ou timeout). */
const CLEARED_MARKERS = {
  waiting_for_input: false,
  waiting_for_response: false,
  responded: false,
  response_edge: null,
  input_retries: 0,
} as const;

export const inputHandler: FlowHandler<InputData> = {
  schema: inputSchema,
  async execute(node, ctx) {
    const data = inputSchema.parse(node.data);
    const vars = ctx.variables;
    const prompt = data.prompt ?? '';
    const validationType = data.validationType ?? 'text';
    const maxRetries = data.maxRetries ?? 2;
    const timeoutSeconds = data.timeoutSeconds ?? 300;

    const retries = typeof vars['input_retries'] === 'number' ? (vars['input_retries'] as number) : 0;

    // Re-enfileira WAITING reenviando uma mensagem (interpolada) opcional.
    const waitAgain = async (
      text: string | undefined,
      nextRetries: number,
    ): Promise<FlowHandlerResult> => {
      if (ctx.conversationId && text && text.trim().length > 0) {
        await ctx.sendMessage({
          conversationId: ctx.conversationId,
          text: interpolate(text, vars),
        });
      }
      const nextStepAt = new Date(
        ctx.now().getTime() + timeoutSeconds * 1000,
      ).toISOString();
      return {
        status: 'WAITING',
        nextStepAt,
        variables: {
          waiting_for_input: true,
          waiting_for_response: true,
          responded: false,
          response_edge: null,
          input_retries: nextRetries,
        },
      };
    };

    // Resumption: o contato respondeu (markers postos por resumeFlowWithResponse).
    if (vars['responded'] === true && vars['waiting_for_input'] === true) {
      const raw = typeof vars['last_response'] === 'string' ? (vars['last_response'] as string) : '';
      const result = validate(raw, validationType);

      if (result.ok) {
        const current = vars['input'];
        const existing =
          current !== null && typeof current === 'object'
            ? (current as Record<string, unknown>)
            : {};
        return {
          status: 'SUCCESS',
          edgeHandle: 'response',
          variables: {
            ...CLEARED_MARKERS,
            input: { ...existing, [data.variable]: result.value },
          },
        };
      }

      // Validacao falhou: esgotou as tentativas -> timeout; senao reenvia e re-aguarda.
      if (retries >= maxRetries) {
        return { status: 'SUCCESS', edgeHandle: 'timeout', variables: { ...CLEARED_MARKERS } };
      }
      return waitAgain(data.retryMessage ?? prompt, retries + 1);
    }

    // Timeout: ja estava aguardando e o timer venceu sem resposta.
    if (vars['waiting_for_input'] === true) {
      return { status: 'SUCCESS', edgeHandle: 'timeout', variables: { ...CLEARED_MARKERS } };
    }

    // 1a chamada: envia o prompt e entra em espera.
    return waitAgain(prompt, 0);
  },
};
