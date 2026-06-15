---
id: F31-S10
title: Nodes assign + template/HSM (atendimento)
phase: F31
status: blocked
priority: medium
estimated_size: M
depends_on: [F31-S08, F31-S01]
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md
  - docs/features/PERMISSIONS.md
---

# F31-S10 — Nodes assign + template/HSM

## Objetivo

Dois nodes novos: `assign` (atribui a conversa a agente/time) e `template`/HSM (envia template aprovado, reabrindo a janela 24h do WhatsApp com params dinâmicos).

## Contexto

`assign` reusa a engine de auto-assign do F30-S09 (round-robin/least-busy/manual). `template` é node de saída → depende do bridge (S01) e do caminho de template do worker outbound. Stubs criados em S08.

## Escopo (faz)

- `packages/flow-engine/src/handlers/assign.handler.ts` — atribui conversa (member específico ou estratégia de time); grava routing_history.
- `packages/flow-engine/src/handlers/template.handler.ts` — monta envio de template (nome + params), via bridge S01.
- `apps/web/features/flow-builder/nodes/assign/**` + `nodes/template/**` — inspectors (picker de agente/time; seletor de template + params) usando S03.

## Fora de escopo

- Espinha/registry (S08). Outros novos nodes (S09/S11).

## Arquivos permitidos

- `packages/flow-engine/src/handlers/assign.handler.ts`
- `packages/flow-engine/src/handlers/template.handler.ts`
- `apps/web/features/flow-builder/nodes/assign/**`
- `apps/web/features/flow-builder/nodes/template/**`

## Arquivos proibidos

- `registry.ts`, `validation.ts`, `node-catalog.ts`, `nodeTypes.ts`, `nodeInspectors.ts`.

## Definition of Done

- [ ] assign atribui via member/estratégia e registra histórico.
- [ ] template envia HSM com params e reabre a janela 24h.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## Permission scope

- `assign` no flow age como sistema; respeitar o escopo de routing do F30 (não atribuir fora do workspace). Ver `PERMISSIONS.md §2`.

## UX considerations

- `UX_PRINCIPLES`: agente/time e template via picker; params do template com labels (não posicionais opacos).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
pnpm --filter @hm/web test
```

## Notas

- Reusar `pickAutoAssignee` (F30-S01) para a estratégia de time. Relacionado: [[tagix-flow-builder-v2-survey]], [[tagix-f30-livechat-ops]].
