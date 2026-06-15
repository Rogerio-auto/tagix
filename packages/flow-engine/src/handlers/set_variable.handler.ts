/**
 * Handler `set_variable` (ESPINHA — F31-S08). Define/atualiza variaveis da execucao
 * (`flow_executions.variables`). STUB minimo type-safe; F31-S09 implementa a logica real
 * (atribuicao + interpolacao + namespacing em `vars.*`).
 */
import { z } from 'zod';
import type { FlowHandler } from '../types';

const setVariableSchema = z.object({
  /** nome da variavel (sem o prefixo `vars.`). */
  name: z.string().optional(),
  /** valor literal ou expressao `{{...}}` (interpolada no handler real). */
  value: z.string().optional(),
});

export const setVariableHandler: FlowHandler<z.infer<typeof setVariableSchema>> = {
  schema: setVariableSchema,
  async execute(_node, _ctx) {
    return { status: 'SUCCESS' };
  },
};
