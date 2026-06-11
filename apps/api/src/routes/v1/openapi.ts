/**
 * Geração da spec OpenAPI 3.1 da API pública v1 (F9-S03) a partir do registry Zod.
 *
 * Registra os paths (reusando os schemas de `./schemas`) e serializa o documento.
 * Tudo deriva dos mesmos Zod que validam o runtime — a spec não pode divergir do
 * comportamento real. Servido como JSON + Swagger UI em `/api/v1/docs`.
 */
import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import {
  API_SCOPES,
  conversationResponse,
  conversationsListResponse,
  contactResponse,
  errorSchema,
  listConversationsQuery,
  messageResponse,
  registry,
  sendMessageBody,
  sendTemplateBody,
  triggerFlowBody,
  triggerFlowResponse,
  upsertContactBody,
} from './schemas';

const SECURITY = [{ ApiKeyAuth: [] }];

const jsonBody = <T>(schema: T) => ({
  content: { 'application/json': { schema } },
});

const errorResponses = {
  400: { description: 'Requisição inválida.', ...jsonBody(errorSchema) },
  401: { description: 'API key ausente, inválida, expirada ou revogada.', ...jsonBody(errorSchema) },
  403: { description: 'API key sem o scope necessário.', ...jsonBody(errorSchema) },
  404: { description: 'Recurso não encontrado no workspace.', ...jsonBody(errorSchema) },
  429: { description: 'Rate limit por chave excedido.', ...jsonBody(errorSchema) },
};

let cached: ReturnType<OpenApiGeneratorV31['generateDocument']> | null = null;

/** Registra os paths uma única vez e gera o documento OpenAPI 3.1 (memoizado). */
export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  if (cached) return cached;

  registry.registerPath({
    method: 'post',
    path: '/api/v1/send_message',
    summary: 'Envia uma mensagem de texto para uma conversa.',
    tags: ['Messaging'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.sendMessages}\`.`,
    request: { body: jsonBody(sendMessageBody) },
    responses: {
      201: { description: 'Mensagem enfileirada para envio.', ...jsonBody(messageResponse) },
      ...errorResponses,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/send_template',
    summary: 'Envia um template (HSM) para uma conversa.',
    tags: ['Messaging'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.sendTemplates}\`.`,
    request: { body: jsonBody(sendTemplateBody) },
    responses: {
      201: { description: 'Template enfileirado para envio.', ...jsonBody(messageResponse) },
      ...errorResponses,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/upsert_contact',
    summary: 'Cria ou atualiza um contato (upsert por id/phone/email).',
    tags: ['Contacts'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.writeContacts}\`.`,
    request: { body: jsonBody(upsertContactBody) },
    responses: {
      200: { description: 'Contato criado ou atualizado.', ...jsonBody(contactResponse) },
      ...errorResponses,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/trigger_flow',
    summary: 'Dispara um flow para um contato/conversa.',
    tags: ['Flows'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.triggerFlows}\`.`,
    request: { body: jsonBody(triggerFlowBody) },
    responses: {
      202: { description: 'Flow disparado; execução enfileirada.', ...jsonBody(triggerFlowResponse) },
      ...errorResponses,
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/conversations',
    summary: 'Lista conversas do workspace.',
    tags: ['Conversations'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.readConversations}\`.`,
    request: { query: listConversationsQuery },
    responses: {
      200: { description: 'Lista de conversas.', ...jsonBody(conversationsListResponse) },
      ...errorResponses,
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/conversations/{id}',
    summary: 'Detalhe de uma conversa.',
    tags: ['Conversations'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.readConversations}\`.`,
    responses: {
      200: { description: 'Conversa.', ...jsonBody(conversationResponse) },
      ...errorResponses,
    },
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  cached = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Highermind Public API',
      version: '1.0.0',
      description:
        'API pública v1 do Highermind (tagix). Autenticação por API key de workspace; rate limit por chave.',
    },
    servers: [{ url: '/' }],
  });
  return cached;
}
