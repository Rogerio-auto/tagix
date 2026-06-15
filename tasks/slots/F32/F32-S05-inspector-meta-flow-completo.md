---
id: F32-S05
title: Inspector meta_flow completo (body, flowToken, screen, payload)
phase: F32
status: in-progress
priority: medium
estimated_size: S
depends_on: []
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T21:33:00Z

---
# F32-S05 — Inspector meta_flow completo

## Objetivo

Completar o `MetaFlowInspector` expondo todos os campos do handler: `body`, `flowToken`, `screen` e `flowActionPayload` (JSON livre) — atualmente só `metaFlowId` e `ctaText` são editáveis.

## Contexto

O handler `meta_flow.handler.ts` suporta: `metaFlowId, ctaText, body, flowToken, screen, flowActionPayload`. O inspector atual expõe apenas os 2 primeiros via `TextField`. Os outros 4 campos são necessários para configurar o WhatsApp Flow completo (ex: `flowToken` de autenticação, `screen` inicial, `flowActionPayload` com dados iniciais do form).

`meta_flow` é exclusivo do canal WhatsApp Cloud API (não WAHA) — deixar isso claro na UI com um aviso de compatibilidade de canal.

## Escopo (faz)

- **`MetaFlowInspector.tsx`** — adicionar campos:
  - `body` — `TextareaField` (texto de acompanhamento da mensagem, opcional, ≤1024 chars).
  - `flowToken` — `TextField` com hint "Token de autenticidade do flow (gerado no Meta Business Suite)".
  - `screen` — `TextField` com hint "ID da tela inicial (ex: WELCOME)".
  - `flowActionPayload` — editor de JSON simples (`TextareaField` com `font-mono`, `placeholder="{}"`, validação JSON on-blur; armazena como `Record<string, unknown>`).
  - Banner de compatibilidade: "Este node funciona apenas em canais WhatsApp Cloud API" (DS v2 info badge, não error).
- Handler `meta_flow.handler.ts` — verificar se já consome todos os campos; não deve precisar de mudança.

## Fora de escopo

- Integração com Meta Business API para listar flows disponíveis (future: `metaFlowId` via picker)
- WAHA compatibility

## Arquivos permitidos

- `apps/web/features/flow-builder/nodes/meta_flow/**`
- `packages/flow-engine/src/handlers/meta_flow.handler.ts` (só se schema precisar de ajuste)

## Arquivos proibidos

- `nodeInspectors.ts`, `node-catalog.ts`, `inspector-fields.tsx`

## Definition of Done

- [ ] Todos os 6 campos (`metaFlowId`, `ctaText`, `body`, `flowToken`, `screen`, `flowActionPayload`) editáveis.
- [ ] `flowActionPayload` valida JSON on-blur; exibe erro de parse inline.
- [ ] Banner de canal visível.
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## UX considerations

- Agrupar campos em seções: **Identificação** (`metaFlowId`, `flowToken`), **Mensagem** (`ctaText`, `body`), **Configuração** (`screen`, `flowActionPayload`).
- JSON editor: `font-mono text-xs`, min-height 80px, sem syntax highlighting (fora de escopo).
- Campos opcionais marcados com hint "(opcional)".

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

`flowActionPayload` é `z.record(z.unknown()).optional()` no handler. Armazenar como string no node data e fazer `JSON.parse` no submit. Se o usuário deixar o campo vazio, enviar `undefined` (não `{}`).
