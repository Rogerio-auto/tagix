/**
 * Handler `set_variable` (F31-S09). Define/atualiza uma variavel da execucao no namespace
 * `vars.*` de `flow_executions.variables`. O valor pode referenciar outras variaveis via
 * tokens `{{...}}` (interpolados) e e coagido pelo `valueType` declarado.
 *
 * Merge: o dispatcher faz `{ ...variables, ...result.variables }` (shallow). Para nao
 * sobrescrever o objeto `vars` inteiro a cada passo, lemos o `vars` corrente do contexto e
 * devolvemos uma copia com a chave nova mesclada. A variavel fica utilizavel a jusante via
 * `{{vars.<name>}}` (lookup aninhado de `interpolate`).
 */
import { z } from 'zod';
import { interpolate } from '../utils/interpolate';
import type { FlowHandler } from '../types';

const VALUE_TYPES = ['string', 'number', 'boolean', 'json'] as const;
type ValueType = (typeof VALUE_TYPES)[number];

const setVariableSchema = z.object({
  /** nome da variavel (sem o prefixo `vars.`). */
  name: z.string().min(1),
  /** valor literal ou expressao `{{...}}` (interpolada antes da coercao). */
  value: z.string().optional(),
  /** tipo do valor gravado; default `string`. */
  valueType: z.enum(VALUE_TYPES).optional(),
});

type SetVariableData = z.infer<typeof setVariableSchema>;

/** Coage o valor interpolado conforme o `valueType`. Falha de parse cai no literal. */
function coerce(raw: string, valueType: ValueType): unknown {
  switch (valueType) {
    case 'number': {
      const n = Number(raw.trim());
      return Number.isFinite(n) ? n : raw;
    }
    case 'boolean': {
      const v = raw.trim().toLowerCase();
      return v === 'true' || v === '1' || v === 'yes' || v === 'sim';
    }
    case 'json': {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return raw;
      }
    }
    default:
      return raw;
  }
}

export const setVariableHandler: FlowHandler<SetVariableData> = {
  schema: setVariableSchema,
  async execute(node, ctx) {
    const data = setVariableSchema.parse(node.data);
    const rawValue = data.value ?? '';
    const valueType = data.valueType ?? 'string';
    const value = coerce(interpolate(rawValue, ctx.variables), valueType);

    const current = ctx.variables['vars'];
    const existing =
      current !== null && typeof current === 'object' ? (current as Record<string, unknown>) : {};

    return {
      status: 'SUCCESS',
      variables: { vars: { ...existing, [data.name]: value } },
    };
  },
};
