---
id: F31-S02
title: Node de mensagem rico (texto / mídia / voz / áudio-arquivo)
phase: F31
status: blocked
priority: high
estimated_size: M
depends_on: [F31-S01]
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md
---

# F31-S02 — Node de mensagem rico

## Objetivo

O node `message` passa a enviar, num único node com seletor de tipo: **texto**, **imagem+legenda**, **vídeo+legenda**, **documento/anexo**, **áudio como voz** (`voice`) e **áudio como arquivo encaminhado** (`audio`). Exatamente o exemplo do Rogério.

## Contexto

Hoje o `MessageInspector` só edita kind+body; não há upload nem mídia rica nem distinção voz/arquivo. O handler e o contrato `FlowOutboundMessage` (S01) já suportam o shape — falta a UI produzir e o handler mapear.

## Escopo (faz)

- `apps/web/features/flow-builder/nodes/message/MessageInspector.tsx` + `MessageNode.tsx` + `metadata.ts` — seletor de tipo; upload de mídia reusando o pipeline do web (captura de imagem de deal); preview da bolha; toggle voz vs arquivo para áudio; interpolação de variáveis no texto/legenda.
- `packages/flow-engine/src/handlers/message.handler.ts` — expandir schema (se faltar `audioMessageKind`/mídia rica) e mapear node → `FlowOutboundMessage`.
- Capability-aware: esconder tipos que o canal alvo não envia.

## Fora de escopo

- Contrato `FlowOutboundMessage` e bridge (S01). Outros inspectors (Onda 2).

## Arquivos permitidos

- `apps/web/features/flow-builder/nodes/message/**`
- `packages/flow-engine/src/handlers/message.handler.ts`

## Arquivos proibidos

- `packages/flow-engine/src/types.ts` (dono: S01), `registry.ts`, `node-catalog.ts`.

## Definition of Done

- [ ] Envia texto, imagem+legenda, vídeo, voz e áudio-arquivo via WAHA dev (tipo correto no provider).
- [ ] Upload persiste `key`; preview na bolha do inspector.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## UX considerations

- Aplica `UX_PRINCIPLES`: inspector inline (não modal full-screen); preview da bolha (WYSIWYG); evita campos de id cru (mídia via upload, não URL colada).
- Estados de erro DS v2 em upload falho / mime inválido.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
pnpm --filter @hm/web test
```

## Notas

- Reusar o componente de upload de mídia do deal (já existe no web). Relacionado: [[tagix-flow-builder-v2-survey]].
