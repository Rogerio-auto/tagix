---
id: F51-S05
title: Web dados — query enriquecida + hooks (live + countdown)
phase: F51
status: in-progress
priority: high
estimated_size: M
depends_on: [F51-S01, F51-S04]
blocks: [F51-S06]
agent_id: frontend-engineer
source_docs:
  - docs/features/FLOW_BUILDER.md
claimed_at: 2026-06-26T21:41:12Z

---
# F51-S05 — Camada de dados do cockpit (execuções)

## Objetivo

Entregar a query enriquecida (com flowName/nextStepAt/terminais), o hook de socket em tempo real e o
hook de countdown que a UI (S06) consome.

## Escopo (faz)

- `apps/web/features/flow-builder/livechat/queries.ts`:
  - Estender `ConversationExecution` com `flowName: string | null; nextStepAt: string | null;
    completedAt: string | null; lastError: string | null` (não quebra o badge, que lê subset).
  - `useCockpitExecutions(conversationId)`: GET `/api/flows/executions?conversationId=` SEM filtro
    ACTIVE (retorna tudo), mesma queryKey `['flow-executions','conversation',id]`, `refetchInterval:8000`.
  - Reusar `useCancelConversationExecution`/`useExecutionDetail` existentes.
- `apps/web/features/conversations/hooks/useFlowExecutionsLive.ts` (novo): espelha
  `useConversationDetailLive` — `socket.on('flow_execution:updated')` filtra por conversationId →
  `invalidateQueries(['flow-executions','conversation',id])`. `socket` no dep array.
- `apps/web/features/conversations/hooks/useCountdown.ts` (novo): `useCountdown(targetIso: string|null)`
  → `{ remainingMs: number; isExpired: boolean }`. `setInterval(1000)`; no-op quando null; cleanup.

## Fora de escopo

- Componentes de UI / integração no painel (S06).

## Arquivos permitidos

- `apps/web/features/flow-builder/livechat/queries.ts`
- `apps/web/features/conversations/hooks/useFlowExecutionsLive.ts`
- `apps/web/features/conversations/hooks/useCountdown.ts`

## Arquivos proibidos

- `ContactInfoPanel.tsx` e demais componentes (S06).

## Definition of Done

- [ ] `useCockpitExecutions` retorna terminais + ativos com `flowName`/`nextStepAt`.
- [ ] `useFlowExecutionsLive` invalida a query no evento socket (filtrando conversa).
- [ ] `useCountdown(null)` é no-op; com ISO conta regressivo de 1s e limpa no unmount.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web test` verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

- e2e não hidrata socket ([[e2e-no-hydration-this-host]]) → validar por typecheck/lint/test/build.
