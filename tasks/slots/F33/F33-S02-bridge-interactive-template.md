---
id: F33-S02
title: Bridge interactive + template no outbound-publisher do flow
phase: F33
status: done
priority: high
estimated_size: M
depends_on: []
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T21:54:30Z
completed_at: 2026-06-15T21:56:59Z

---
# F33-S02 — Bridge interactive + template

## Objetivo

Substituir o "no-op conservador" do `outbound-publisher.ts` para `interactivePayload` por roteamento real: mensagens `interactive` (botões/listas) e `template` (HSM) passam a ser persistidas e enfileiradas como `OutboundJob` correto — o outbound worker já suporta ambos os kinds.

## Contexto

O `outbound-publisher.ts` (F31-S01) cuida de `text` e `media` mas tem:
```ts
if (message.interactivePayload) {
  logger.warn('flow-outbound: interactivePayload sem bridge — no-op', ...);
  return;
}
```

O outbound worker (`apps/workers/src/outbound/job.ts`) já suporta:
- `kind: 'interactive'` com `payload: InteractivePayloadSchema` (buttons/list)
- `kind: 'template'` com `templateName`, `languageCode`, `components[]`

Os handlers produzem:
- `interactive.handler` → `ctx.sendMessage({ interactivePayload: { kind:'buttons'|'list', body, buttons/sections, ... } })`
- `template.handler` → `ctx.sendMessage({ interactivePayload: { kind:'template', template:{ name, language:{ code }, components } } })`

O gap é só a tradução em `outbound-publisher.ts`.

## Escopo (faz)

- **`apps/workers/src/flows/outbound-publisher.ts`** — substituir o bloco no-op por roteamento baseado em `message.interactivePayload.kind`:

  **`'buttons'` ou `'list'` → OutboundJob `interactive`:**
  1. Persistir message `pending` (type=`interactive`, content=null, mediaUrl=null).
  2. Publicar `{ kind: 'interactive', channelId, conversationId, messageId, chatId, payload: message.interactivePayload }`.

  **`'template'` → OutboundJob `template`:**
  1. Persistir message `pending` (type=`template`, content=templateName).
  2. Extrair `{ name, language: { code }, components }` de `interactivePayload.template`.
  3. Publicar `{ kind: 'template', channelId, conversationId, messageId, chatId, templateName: name, languageCode: code, components }`.

  **Outros `kind` desconhecidos** (ex: `meta_flow`) → manter no-op logado (não silenciar).

- Tipos: `FlowOutboundMessage.interactivePayload` em `packages/flow-engine/src/types.ts` pode continuar `Record<string, unknown>` (duck-typing); o publisher valida o `kind` via string comparison simples — não precisa Zod aqui (o `parseOutboundJob` no worker já valida o shape final).

- Remover comentários de seam do `outbound-publisher.ts` para `interactive`/`template`.
- Remover comentário de seam do `template.handler.ts`.

## Fora de escopo

- `external_notify` (envolve conversas de terceiros — complexidade diferente, future slot)
- `meta_flow` (requer Meta Cloud API flow endpoint — fora do escopo do publisher)
- Mudanças no outbound worker (`apps/workers/src/outbound/`) — já suporta ambos os kinds
- Mudanças no `interactive.handler` ou `template.handler` — a lógica de composição está correta

## Arquivos permitidos

- `apps/workers/src/flows/outbound-publisher.ts`
- `packages/flow-engine/src/handlers/template.handler.ts` (só remover comentário de seam)

## Arquivos proibidos

- `apps/workers/src/outbound/**` (não tocar — já funciona)
- `packages/flow-engine/src/types.ts`
- `packages/flow-engine/src/handlers/interactive.handler.ts`
- `apps/web/**`

## Definition of Done

- [ ] `publishMessage` com `interactivePayload.kind === 'buttons'` → persiste message + publica `OutboundJob { kind: 'interactive' }`.
- [ ] `publishMessage` com `interactivePayload.kind === 'template'` → persiste message + publica `OutboundJob { kind: 'template' }` com templateName/languageCode/components extraídos.
- [ ] `interactivePayload` sem `kind` conhecido → log.warn + no-op (não quebra).
- [ ] Comentários de seam removidos nos 2 arquivos.
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

O `persistOutboundMessage` já existe no publisher e recebe `type: string` — usar `'interactive'` e `'template'` como type (compatível com o enum `message_type` do schema, verificar se `interactive`/`template` são valores válidos ou se é necessário usar `'text'` como fallback de persistência). Se o schema não aceitar esses types, persistir como `'text'` com content=body/templateName e adicionar um TODO honesto.

O outbound worker filtra compatibilidade de canal: `template` só em `meta_whatsapp`, `interactive` em `meta_whatsapp` + `meta_instagram` — isso já está em `dispatch.ts:49-50`. O publisher não precisa replicar essa lógica.
