/**
 * Handler `template` (ESPINHA — F31-S08). Envia um template/HSM aprovado (WhatsApp Business)
 * com variaveis de corpo/cabecalho. STUB minimo type-safe; F31-S10 implementa o envio real
 * via ctx.sendMessage (interactivePayload/HSM).
 */
import { z } from 'zod';
import type { FlowHandler } from '../types';

const templateSchema = z.object({
  /** nome do template aprovado. */
  templateName: z.string().optional(),
  /** codigo de idioma (ex.: `pt_BR`). */
  language: z.string().optional(),
  /** variaveis posicionais do corpo (interpoladas no handler real). */
  variables: z.array(z.string()).optional(),
});

export const templateHandler: FlowHandler<z.infer<typeof templateSchema>> = {
  schema: templateSchema,
  async execute(_node, _ctx) {
    return { status: 'SUCCESS' };
  },
};
