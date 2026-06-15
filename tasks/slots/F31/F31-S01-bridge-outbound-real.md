---
id: F31-S01
title: Bridge de saída real do flow (FlowOutboundMessage → OutboundJob)
phase: F31
status: review
priority: critical
estimated_size: M
depends_on: []
blocks: [F31-S02, F31-S04, F31-S06, F31-S09, F31-S10]
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T12:45:38Z
completed_at: 2026-06-15T12:46:53Z

---
# F31-S01 — Bridge de saída real do flow

## Objetivo

Fazer um flow **enviar mensagem de verdade em produção**: substituir o `noopPublisher` por um publisher real que persiste a message e enfileira no `hm.q.outbound`, espelhando o composer da API. Define também o contrato rico de `FlowOutboundMessage` (texto/mídia/áudio voz-vs-arquivo) que a Onda 1 consome.

## Contexto

🔴 BLOCKER da fase. Hoje `createFlowWorkerDeps` (`apps/workers/src/flows/worker.ts`) não injeta publisher → `outbound` cai no `noopPublisher` (`packages/flow-engine/src/ports/outbound.port.ts:19-26`). `ctx.sendMessage`/`sendPresence` são no-op end-to-end. Sem isto, `message`/`interactive`/`meta_flow`/`external_notify` + presença não enviam nada. Todos os slots de node de saída dependem deste.

## Escopo (faz)

- `packages/flow-engine/src/types.ts` — expandir `FlowOutboundMessage` para o contrato rico: texto; imagem/vídeo/documento com `mediaUrl`+`mediaMime`+caption; áudio com `audioMessageKind` (`voice` | `audio`). `FlowPresenceAction` (typing/online).
- `apps/workers/src/flows/outbound-publisher.ts` (novo) — `OutboundPublisher` real: persiste `message` `pending` (direction `outbound`, RLS), resolve mídia via `storage.getSignedUrl(key, ttl)` → `publicMediaUrl`, e `publishOutboundJob` no shape EXATO de `parseOutboundJob`. Espelha `apps/api/src/routes/conversations/messages.ts` (`buildOutboundJob`/`publishOutboundJob`). Presence real capability-aware.
- `apps/workers/src/flows/worker.ts` — injetar o publisher real no `createFlowWorkerDeps`.
- `packages/flow-engine/src/ports/outbound.port.ts` — manter contrato; ajustar doc (não é mais no-op em prod).
- Capability-aware via `AdapterCapabilities` (WAHA vs Meta WA vs IG): degrada com elegância.

## Fora de escopo

- UI do node de mensagem (S02). Inspectors (Onda 2). Novos nodes (Onda 4).

## Arquivos permitidos

- `packages/flow-engine/src/types.ts`
- `packages/flow-engine/src/ports/outbound.port.ts`
- `apps/workers/src/flows/outbound-publisher.ts`
- `apps/workers/src/flows/worker.ts`
- `apps/workers/src/flows/outbound-publisher.test.ts`

## Arquivos proibidos

- `packages/flow-engine/src/registry.ts` (dono: S08), `node-catalog.ts`, qualquer `nodes/**`.

## Contratos

- Entrada: `FlowOutboundMessage` (do handler). Saída: `OutboundJob` em `hm.q.outbound` (shape de `parseOutboundJob`, `apps/workers/src/outbound/job.ts`).

## Definition of Done

- [ ] Flow com node `message` (texto) envia via WAHA dev; status reconcilia (sent/delivered/failed) em `messages.view_status`.
- [ ] `FlowOutboundMessage` cobre texto/imagem/vídeo/documento/áudio(voice|audio).
- [ ] Presence (typing) emitido quando o canal suporta; no-op silencioso quando não.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/workers test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
pnpm --filter @hm/flow-engine test
```

## Notas

- Não reinventar o job: reusar `publishOutboundJob`/`buildOutboundJob` da API como referência exata (worker outbound já valida via `parseOutboundJob`).
- `storage.getSignedUrl(key, ttl)` já existe (confirmado). Mídia do flow guarda `key`; URL pública é temporária no envio.
- Este é o caminho crítico — priorizar. Relacionado: [[tagix-flow-builder-v2-survey]].
