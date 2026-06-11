/**
 * Schemas Zod da API pública v1 (F9-S03) + registry OpenAPI.
 *
 * Fonte única de verdade dos contratos: cada endpoint valida o input com estes
 * schemas e a spec OpenAPI 3.1 (`/api/v1/docs`) é GERADA a partir deles — sem
 * spec escrita à mão que possa divergir do runtime.
 *
 * `extendZodWithOpenApi` precisa rodar antes de qualquer `.openapi()`; importar este
 * módulo garante o patch (efeito colateral no topo).
 */
import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

/** Registry compartilhado — endpoints e o gerador OpenAPI consomem o mesmo. */
export const registry = new OpenAPIRegistry();

/**
 * Scopes da API pública. Convenção `acao:recurso`. A chave (F9-S04) carrega um
 * subconjunto; `requireScope` (F9-S02) barra o que faltar.
 */
export const API_SCOPES = {
  sendMessages: 'write:messages',
  sendTemplates: 'write:templates',
  writeContacts: 'write:contacts',
  triggerFlows: 'write:flows',
  readConversations: 'read:conversations',
} as const;

export type ApiScope = (typeof API_SCOPES)[keyof typeof API_SCOPES];

const MAX_TEXT_LEN = 5000;

// ─── Security scheme (Bearer hm_...) ─────────────────────────────────────────
registry.registerComponent('securitySchemes', 'ApiKeyAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'hm_<token>',
  description:
    'API key do workspace no header `Authorization: Bearer hm_...`. Crie/gerencie em Settings → Dev.',
});

// ─── Erro padronizado ────────────────────────────────────────────────────────
export const errorSchema = registry.register(
  'Error',
  z
    .object({
      error: z.string().openapi({ example: 'unauthorized' }),
      message: z.string().openapi({ example: 'API key inválida, expirada ou revogada.' }),
    })
    .openapi('Error'),
);

// ─── send_message ────────────────────────────────────────────────────────────
export const sendMessageBody = registry.register(
  'SendMessageRequest',
  z
    .object({
      conversationId: z.string().uuid().openapi({ description: 'Conversa de destino (mesmo workspace da chave).' }),
      text: z.string().trim().min(1).max(MAX_TEXT_LEN).openapi({ example: 'Olá!' }),
    })
    .openapi('SendMessageRequest'),
);

export const messageResponse = registry.register(
  'MessageResponse',
  z
    .object({
      message: z.object({
        id: z.string().uuid(),
        conversationId: z.string().uuid(),
        direction: z.string(),
        viewStatus: z.string(),
        content: z.string().nullable(),
        createdAt: z.string().datetime().nullable(),
      }),
    })
    .openapi('MessageResponse'),
);

// ─── send_template ───────────────────────────────────────────────────────────
const templateComponent = z.object({
  type: z.enum(['header', 'body', 'button']),
  parameters: z.array(z.unknown()).optional(),
});

export const sendTemplateBody = registry.register(
  'SendTemplateRequest',
  z
    .object({
      conversationId: z.string().uuid(),
      templateName: z.string().trim().min(1).openapi({ example: 'order_confirmation' }),
      languageCode: z.string().trim().min(1).openapi({ example: 'pt_BR' }),
      components: z.array(templateComponent).default([]),
    })
    .openapi('SendTemplateRequest'),
);

// ─── upsert_contact ──────────────────────────────────────────────────────────
export const upsertContactBody = registry.register(
  'UpsertContactRequest',
  z
    .object({
      // Identidade de upsert: phone (preferencial) ou id explícito.
      id: z.string().uuid().optional().openapi({ description: 'Atualiza um contato específico se informado.' }),
      phone: z.string().trim().min(1).max(40).optional().openapi({ example: '+5511999990000' }),
      email: z.string().trim().email().max(200).optional(),
      displayName: z.string().trim().min(1).max(200).optional(),
      notes: z.string().trim().max(MAX_TEXT_LEN).optional(),
      language: z.string().trim().max(16).optional(),
      source: z.string().trim().max(120).optional(),
      customFields: z.record(z.string(), z.unknown()).optional(),
    })
    .refine((v) => Boolean(v.id ?? v.phone ?? v.email), {
      message: 'Informe ao menos id, phone ou email para identificar o contato.',
    })
    .openapi('UpsertContactRequest'),
);

export const contactResponse = registry.register(
  'ContactResponse',
  z
    .object({
      contact: z.object({
        id: z.string().uuid(),
        displayName: z.string().nullable(),
        phone: z.string().nullable(),
        email: z.string().nullable(),
        source: z.string().nullable(),
        createdAt: z.string().datetime().nullable(),
      }),
      created: z.boolean().openapi({ description: 'true se um novo contato foi criado; false em update.' }),
    })
    .openapi('ContactResponse'),
);

// ─── trigger_flow ────────────────────────────────────────────────────────────
export const triggerFlowBody = registry.register(
  'TriggerFlowRequest',
  z
    .object({
      flowId: z.string().uuid(),
      conversationId: z.string().uuid().optional(),
      contactId: z.string().uuid().optional(),
      triggerData: z.record(z.string(), z.unknown()).optional(),
    })
    .openapi('TriggerFlowRequest'),
);

export const triggerFlowResponse = registry.register(
  'TriggerFlowResponse',
  z.object({ executionId: z.string().uuid() }).openapi('TriggerFlowResponse'),
);

// ─── conversations (list + get) ──────────────────────────────────────────────
export const listConversationsQuery = z.object({
  status: z.enum(['open', 'pending', 'closed', 'resolved', 'snoozed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const conversationShape = z.object({
  id: z.string().uuid(),
  channelId: z.string().uuid(),
  status: z.string(),
  lastMessagePreview: z.string().nullable(),
  lastMessageAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime().nullable(),
});

export const conversationsListResponse = registry.register(
  'ConversationsListResponse',
  z.object({ conversations: z.array(conversationShape) }).openapi('ConversationsListResponse'),
);

export const conversationResponse = registry.register(
  'ConversationResponse',
  z.object({ conversation: conversationShape }).openapi('ConversationResponse'),
);
