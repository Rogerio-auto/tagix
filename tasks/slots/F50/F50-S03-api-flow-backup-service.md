---
id: F50-S03
title: Serviço de backup + checksum + resolver de referências (API)
phase: F50
status: in-progress
priority: high
estimated_size: L
depends_on: [F50-S01]
blocks: [F50-S04]
agent_id: backend-engineer
source_docs:
  - docs/features/FLOW_BUILDER.md
claimed_at: 2026-06-26T19:45:48Z

---
# F50-S03 — Serviço de backup (export/preview/import) + checksum

## Objetivo

Implementar a camada com DB do backup sob RLS: checksum sha256, resolução UUID↔descritor por
nome/chave no workspace destino, montagem do bundle de export, e preview/apply do import (aditivo,
sempre draft).

## Contexto

Consome o contrato puro de F50-S01. A resolução por nome/chave é o que torna o backup portável entre
ambientes (decisão aprovada). Import é aditivo e seguro: cria novos rascunhos, nunca sobrescreve, nunca
auto-dispara. `workspaceId`/`createdBy` SEMPRE do auth.

## Escopo (faz)

- `services/flow-backup/checksum.ts`: `computeChecksum(payload)` / `verifyChecksum(envelope)` via
  `canonicalize` (S01) + `node:crypto` sha256.
- `services/flow-backup/resolver.ts` (recebe `tx` já sob RLS): `buildReferenceIndex(tx, occurrences)`
  em batch (`inArray` por tabela, JOIN stages→pipelines p/ `pipelineName`); `resolveReferences(tx,
  index): { idMap, resolved[], unresolved[] }` casando tag/stage/agent por nome, member por email,
  conversionType por key, channel por label/type. Cross-tenant → unresolved (RLS isola).
- `services/flow-backup/export.ts`: `buildExportBundle(tx, {flowIds?})` — SELECT `flows` (todos por
  default), grafo DRAFT + metadata → `FlowBackupEntry[]`, extrai refs → índice, `computeChecksum`,
  monta envelope. Exclui versions/executions/logs.
- `services/flow-backup/import.ts`: `previewImport(tx, envelope): PreviewResult` (SEM escrita — valida
  checksum, por entry nodeCount/edgeCount + `validateFlow` warnings + colisão de nome + refs
  resolved/unresolved + avisos de versão/tipo de nó desconhecido). `applyImport(tx, envelope, {mode:'add'},
  {workspaceId, memberId}): ImportResult` — pré-aloca `newId` por entry (Map `sourceId→newId` p/ remap
  intra-bundle de go_to_flow), `resolveReferences`, `rewriteReferences`, sufixa nome `(importado)` em
  colisão, INSERT com `id=newId`, `workspaceId`/`createdBy` do auth, `status='draft'` SEMPRE.
- `services/flow-backup/index.ts`: barrel.
- Testes (`resolver.test.ts`, `import.test.ts`) com harness de DB (`withWorkspace`).

## Fora de escopo

- Rotas HTTP/parser (S04). UI (S05). Permissão (S02).

## Arquivos permitidos

- `apps/api/src/services/flow-backup/**`

## Arquivos proibidos

- `apps/api/src/routes/**`, `apps/api/src/app.ts` (S04)
- `packages/**`, `apps/web/**`

## Contratos

- `buildExportBundle(tx, opts?) → BackupEnvelope`
- `previewImport(tx, envelope) → PreviewResult`
- `applyImport(tx, envelope, {mode}, {workspaceId, memberId}) → ImportResult`
- `verifyChecksum(envelope) → boolean`

## Definition of Done

- [ ] Export produz envelope com checksum verificável; refs enriquecidas com nome/key.
- [ ] Resolver batcheia (sem N+1) e isola cross-tenant (refs de outro ws → unresolved).
- [ ] `previewImport` não escreve e reporta colisão/resolved/unresolved/warnings de versão.
- [ ] `applyImport` força `status='draft'`, `workspaceId`/`createdBy` do auth, remapeia go_to_flow
      intra-bundle, sufixa nome, limpa refs não resolvidas.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Conferir nomes reais de tabelas/colunas em `@hm/db` (tags.name, stages.name+pipeline, agents, channels,
  members.email, conversionTypes.key). Reusar `validateFlow` e `FLOW_NODE_TYPES` de `@hm/flow-engine`.
- `remove_tag` exige uuid → ao não resolver, limpar o campo inteiro (não string vazia).
- NUNCA fazer fetch de http_request/external_notify (anti-SSRF); só shape.
