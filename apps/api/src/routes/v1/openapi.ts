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
  contactGetResponse,
  contactsListResponse,
  conversionCreatedResponse,
  conversionsListResponse,
  createConversionBody,
  createEventBody,
  dealGetResponse,
  dealsListResponse,
  eventCreatedResponse,
  eventsListResponse,
  errorSchema,
  flowsListResponse,
  listContactsQuery,
  listConversationsQuery,
  listConversionsQuery,
  listDealsQuery,
  listEventsQuery,
  listFlowsQuery,
  messageResponse,
  moveDealBody,
  registry,
  sendMediaBody,
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

  registry.registerPath({
    method: 'get',
    path: '/api/v1/contacts',
    summary: 'Lista contatos do workspace.',
    tags: ['Contacts'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.readContacts}\`.`,
    request: { query: listContactsQuery },
    responses: { 200: { description: 'Lista de contatos.', ...jsonBody(contactsListResponse) }, ...errorResponses },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/contacts/{id}',
    summary: 'Detalhe de um contato.',
    tags: ['Contacts'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.readContacts}\`.`,
    responses: { 200: { description: 'Contato.', ...jsonBody(contactGetResponse) }, ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/messages/media',
    summary: 'Envia uma mídia (imagem/vídeo/documento/áudio) para uma conversa.',
    tags: ['Messaging'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.sendMessages}\`.`,
    request: { body: jsonBody(sendMediaBody) },
    responses: { 201: { description: 'Mídia enfileirada para envio.', ...jsonBody(messageResponse) }, ...errorResponses },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/deals',
    summary: 'Lista negócios (deals) do workspace.',
    tags: ['Deals'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.readDeals}\`.`,
    request: { query: listDealsQuery },
    responses: { 200: { description: 'Lista de deals.', ...jsonBody(dealsListResponse) }, ...errorResponses },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/deals/{id}',
    summary: 'Detalhe de um deal.',
    tags: ['Deals'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.readDeals}\`.`,
    responses: { 200: { description: 'Deal.', ...jsonBody(dealGetResponse) }, ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/deals/{id}/move',
    summary: 'Move um deal para outro estágio do pipeline.',
    tags: ['Deals'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.writeDeals}\`. Valida as regras de transição do estágio destino.`,
    request: { body: jsonBody(moveDealBody) },
    responses: {
      200: { description: 'Deal movido.', ...jsonBody(dealGetResponse) },
      422: { description: 'Transição bloqueada por regra do estágio.', ...jsonBody(errorSchema) },
      ...errorResponses,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/conversions',
    summary: 'Registra uma conversão para um contato.',
    tags: ['Conversions'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.writeConversions}\`. Idempotente no mesmo dia (dedup).`,
    request: { body: jsonBody(createConversionBody) },
    responses: {
      201: { description: 'Conversão registrada.', ...jsonBody(conversionCreatedResponse) },
      200: { description: 'Conversão deduplicada (já existia hoje).', ...jsonBody(conversionCreatedResponse) },
      422: { description: 'Valor obrigatório ausente para o tipo.', ...jsonBody(errorSchema) },
      ...errorResponses,
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/conversions',
    summary: 'Lista conversões do workspace.',
    tags: ['Conversions'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.readConversions}\`.`,
    request: { query: listConversionsQuery },
    responses: { 200: { description: 'Lista de conversões.', ...jsonBody(conversionsListResponse) }, ...errorResponses },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/flows',
    summary: 'Lista flows do workspace.',
    tags: ['Flows'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.readFlows}\`.`,
    request: { query: listFlowsQuery },
    responses: { 200: { description: 'Lista de flows.', ...jsonBody(flowsListResponse) }, ...errorResponses },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/events',
    summary: 'Lista eventos de calendário do workspace.',
    tags: ['Calendar'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.readCalendar}\`.`,
    request: { query: listEventsQuery },
    responses: { 200: { description: 'Lista de eventos.', ...jsonBody(eventsListResponse) }, ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/events',
    summary: 'Cria um evento de calendário.',
    tags: ['Calendar'],
    security: SECURITY,
    description: `Requer o scope \`${API_SCOPES.writeCalendar}\`.`,
    request: { body: jsonBody(createEventBody) },
    responses: { 201: { description: 'Evento criado.', ...jsonBody(eventCreatedResponse) }, ...errorResponses },
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  cached = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Leadium API',
      version: '1.0.0',
      description:
        'API pública v1 da Leadium. Autenticação por API key de workspace; rate limit por chave.',
    },
    servers: [{ url: '/' }],
  });
  return cached;
}
