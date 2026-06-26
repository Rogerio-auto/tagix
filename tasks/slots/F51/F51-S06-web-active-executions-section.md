---
id: F51-S06
title: Web UI — seção "Execuções Ativas" + cards no Cockpit
phase: F51
status: review
priority: high
estimated_size: M
depends_on: [F51-S05]
blocks: []
agent_id: frontend-engineer
source_docs:
  - docs/features/FLOW_BUILDER.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-06-26T21:43:25Z
completed_at: 2026-06-26T21:47:44Z

---
# F51-S06 — Seção Execuções Ativas no Cockpit

## Objetivo

Criar a seção "Execuções Ativas" no cockpit com cards por execução (status, countdown, progresso,
ícones, ações) e integrá-la no `ContactInfoPanel`, no padrão premium do DS v2.

## Escopo (faz)

- `apps/web/features/conversations/components/ActiveExecutionsSection.tsx` (novo):
  - Consome `useCockpitExecutions` + `useFlowExecutionsLive` (monta o listener) + `useCountdown` +
    `useCancelConversationExecution`.
  - Recorte: `active = running|waiting`; `recent = terminais com completedAt ≤ ~10 min`. Esconde a seção
    se ambos vazios.
  - Card por execução: nome (`flowName ?? 'Flow'`), ícone + label + cor por status (DS v2:
    running→accent + animação `motion-safe`; waiting→warning; completed→success; cancelled→text-low;
    failed→danger; ícones lucide Activity/Timer/CheckCircle2/XCircle/AlertTriangle), "iniciado em",
    countdown (waiting → "Próximo passo em mm:ss" + horário), barra (waiting determinística até
    nextStepAt; running indeterminada), ações:
    - **Cancelar** (só running|waiting; gate `can(role,'flow.cancel')` via useAuthStore) → `Modal` de
      confirmação (`@hm/ui`) → `cancel.mutateAsync` + `toast`.
    - **Ver detalhes** → reusa `ExecutionDetailDrawer` (flow-builder/livechat).
    - **Expandir info técnica** → `useState` por card (currentNodeId, lastError, executionId).
- `apps/web/features/conversations/components/ContactInfoPanel.tsx`: inserir `<Section title="Execuções
  Ativas" icon={Zap}>` entre "Agente IA" e "Roteamento", renderizando `<ActiveExecutionsSection
  conversationId={conversationId} />`. Reusa `Section`/`Card` locais.

## Fora de escopo

- Camada de dados (S05). Backend (S01–S04).

## Arquivos permitidos

- `apps/web/features/conversations/components/ActiveExecutionsSection.tsx`
- `apps/web/features/conversations/components/ContactInfoPanel.tsx`

## Arquivos proibidos

- `apps/web/features/flow-builder/**` (só importar, não editar), demais.

## Definition of Done

- [ ] Seção aparece quando há execuções ativas/recentes; some quando vazio.
- [ ] Status com identidade visual própria (tokens, sem hex); animação só para ativos (`motion-safe`).
- [ ] Countdown ao vivo para waiting; cancelar pede confirmação; detalhes reusa o drawer.
- [ ] Em tempo real: novo flow/cancel reflete sem refresh (via socket).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web test` verdes; build do web ok.

## UX considerations

- **Estado honesto (UX_PRINCIPLES §2):** não prometer ETA do flow inteiro — só countdown ao próximo passo.
- **Hierarquia/clareza (§3):** ativos em destaque; recém-finalizados discretos; ação destrutiva (cancelar)
  com confirmação explícita.
- **Movimento com propósito:** animação discreta só em execução ativa, respeitando `motion-safe`.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

- e2e não hidrata socket → validar por typecheck/lint/test/build + smoke manual em prod.
