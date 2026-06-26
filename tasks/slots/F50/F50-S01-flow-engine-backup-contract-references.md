---
id: F50-S01
title: Contrato do backup + módulo puro de referências (@hm/flow-engine)
phase: F50
status: available
priority: high
estimated_size: M
depends_on: []
blocks: [F50-S03, F50-S05]
agent_id: backend-engineer
source_docs:
  - docs/features/FLOW_BUILDER.md
---

# F50-S01 — Contrato do backup + módulo puro de referências

## Objetivo

Criar a base isomórfica (sem DB) do backup de Flows em `@hm/flow-engine`: schema Zod estrito do
envelope, extração/reescrita de referências workspace-específicas no grafo, e serialização canônica
para checksum. Tudo puro e testável (mesmo perfil de `validateFlow`).

## Contexto

Nós de flow carregam UUIDs workspace-específicos no jsonb (tag/stage/agent/channel/member/flow/
pipeline/conversionType) — ver levantamento em `docs/features/FLOW_BUILDER.md` e handlers. O backup
precisa extrair essas referências (para enriquecer com nomes no export e remapear no import) sem
acoplar a infra. Este slot entrega o contrato consumido por S03 (serviço) e S05 (UI).

## Escopo (faz)

- `backup/envelope.ts`: Zod `.strict()` do `backupEnvelopeSchema` `{ formatVersion: literal(1),
  app: literal('leadium'), exportedAt: datetime, schemaVersion, checksum:{algo:'sha256',value:/^[a-f0-9]{64}$/},
  flows: [flowBackupEntrySchema].min(1).max(MAX_FLOWS), references: referenceIndexSchema }`. Caps
  `MAX_FLOWS=200`, `MAX_NODES_PER_FLOW=500`. `flowBackupEntrySchema` = `{ sourceId, name, description,
  triggerType(enum TRIGGER_TYPES), triggerConfig, filterStatus, filterStageIds, filterTagIds,
  channelIds, nodes(passthrough.max), edges(passthrough), schemaVersion }`. `referenceIndexSchema`
  por kind: tags/stages(+pipelineId,pipelineName)/pipelines/agents/channels/members/flows/conversionTypes.
  Tipos derivados + interfaces `PreviewResult`/`ImportResult` (compartilhadas com S03/S05).
- `backup/references.ts` (PURO): `extractReferences(entry): RefOccurrence[]` cobrindo TODOS os campos
  confirmados — node.data: condition(tagId/stageId, varrer `conditions[]` se array), move_stage
  (stageId/pipelineId), add_tag(tagId), remove_tag(tagId), ai_action(agentId), assign(memberId),
  go_to_flow(flowId), external_notify(channelId), register_conversion(conversionTypeKey|conversionType
  by key), message(mediaStorageKey → kind 'media', só aviso); nível flow: filterStageIds/filterTagIds/
  channelIds; triggerConfig: stage_change(from/to_stage_id), tag_added(tag_id). `rewriteReferences(entry,
  idMap): FlowBackupEntry` remapeia UUID ou limpa (`null`=no-op seguro; `remove_tag` limpa o campo inteiro).
  NÃO inserir descritores inline — manter UUID no node.data.
- `backup/canonical.ts`: `canonicalize({flows,references}): string` com chaves ordenadas recursivamente
  (exclui `exportedAt`/`checksum`). Determinístico.
- `backup/index.ts` + `export * from './backup'` em `packages/flow-engine/src/index.ts`.

## Fora de escopo

- Checksum sha256 (usa `node:crypto`, fica no serviço da API — S03).
- Resolução por nome/DB (S03). Rotas (S04). UI (S05).

## Arquivos permitidos

- `packages/flow-engine/src/backup/**`
- `packages/flow-engine/src/index.ts` (apenas adicionar `export * from './backup'`)

## Arquivos proibidos

- `apps/api/**`, `apps/web/**`, `packages/db/**`, `packages/shared/**`
- Demais handlers/dispatcher de `packages/flow-engine` (sem mudança)

## Contratos de saída

- `BackupEnvelope`, `FlowBackupEntry`, `ReferenceIndex`, `ReferenceKind`, `RefOccurrence`,
  `PreviewResult`, `ImportResult` exportados de `@hm/flow-engine`.
- `extractReferences`, `rewriteReferences`, `canonicalize`, `backupEnvelopeSchema` exportados.

## Definition of Done

- [ ] `extractReferences` cobre todas as kinds (incl. `condition.conditions[]`, filtros de flow, triggerConfig).
- [ ] `rewriteReferences` remapeia por idMap e limpa referência ausente sem quebrar shape dos handlers.
- [ ] `canonicalize` é estável (independe da ordem de chaves de entrada).
- [ ] Zod rejeita: chave extra, `app`≠'leadium', `formatVersion`≠1, `flows`/`nodes` acima do cap.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/flow-engine test` verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
```

## Notas

- Espelha o padrão de `validation.ts` (puro, isomórfico). Reusar `FLOW_NODE_TYPES`/`TRIGGER_TYPES`
  de `@hm/flow-engine`/`@hm/shared` para enums.
- `mediaStorageKey` (R2) não é resolvível entre ambientes → só marca aviso (kind 'media').
