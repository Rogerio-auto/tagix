---
id: F51-S07
title: Refino — painel de execuções no topo + card neon compacto (só ativas)
phase: F51
status: done
priority: high
estimated_size: M
depends_on: [F51-S06]
blocks: []
agent_id: frontend-engineer
source_docs:
  - docs/features/FLOW_BUILDER.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-06-27T02:19:33Z
completed_at: 2026-06-27T02:23:21Z

---
# F51-S07 — Painel de execuções premium no topo do Cockpit

## Objetivo

Refinar a seção "Execuções Ativas": movê-la para o TOPO do cockpit (primeiro elemento), card
compacto e elegante com borda neon viva (verde de marca) só nas execuções ativas, exibindo APENAS
execuções realmente ativas (running/waiting) — recém-finalizadas saem.

## Contexto

A F51-S06 colocou a seção entre IA e Roteamento e mostrava ativas + recém-finalizadas. O Rogério quer
o painel no topo (visível sem rolar), card compacto com destaque neon animado (reusar `.hm-flow-neon`,
mesmo efeito da conversa selecionada, intensidade moderada), e que a lista mostre só ativas — ao
cancelar/concluir, o card some sozinho (o socket já invalida; o filtro só-ativas tira da lista).

## Escopo (faz)

- `apps/web/features/conversations/components/ContactInfoPanel.tsx`: mover
  `<ActiveExecutionsSection conversationId={conversationId} />` para o TOPO do corpo do painel (antes da
  seção "Status"), removendo a inserção atual entre IA e Roteamento.
- `apps/web/features/conversations/components/ActiveExecutionsSection.tsx`:
  - Mostrar APENAS `running|waiting` (remover o bloco de recém-finalizadas e o helper `recentFinished`).
  - Esconder a seção inteira quando não há ativas (sem mensagem — interface limpa).
  - Card COMPACTO: nome + status (dot pulsante + label), linha com countdown + horário previsto do
    próximo passo (`nextStepAt`), barra discreta animada, ação **Cancelar** (gate `flow.cancel`,
    Modal de confirmação já existente) + ícone **Detalhes** (reusa `ExecutionDetailDrawer`). Remover o
    expand "Técnico" inline (o drawer já cobre).
  - Destaque neon: aplicar `hm-flow-neon relative` ao card de execução ATIVA (borda neon + glow +
    animação percorrendo, respeitando `prefers-reduced-motion` — já no CSS). Sem hex; tokens DS v2.

## Fora de escopo

- Backend (já entregue em F51-S01..S04). Progresso determinístico do wait (precisaria `waitStartedAt`).

## Arquivos permitidos

- `apps/web/features/conversations/components/ActiveExecutionsSection.tsx`
- `apps/web/features/conversations/components/ContactInfoPanel.tsx`
- `apps/web/app/globals.css` (apenas se precisar de uma variante neon dedicada; preferir reusar `.hm-flow-neon`)

## Arquivos proibidos

- `apps/web/features/flow-builder/**` (só importar), backend, demais.

## Definition of Done

- [ ] Seção é o PRIMEIRO elemento do cockpit (topo), visível sem rolar quando há execução ativa.
- [ ] Lista mostra só ativas; ao cancelar/concluir, o card some sem reload (socket + filtro).
- [ ] Card compacto com nome/status/countdown/horário previsto/barra/cancelar; borda neon animada nos ativos.
- [ ] Vazio → seção oculta (não ocupa espaço).
- [ ] Cancelar pede confirmação e mostra toast discreto.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web test` verdes; build do web ok.

## UX considerations

- **Hierarquia (UX_PRINCIPLES §3):** painel é o ponto de atenção (topo + neon), mas a intensidade é
  moderada (`.hm-flow-neon` < `.hm-chat-neon`) para não competir.
- **Movimento com propósito:** animação só nos ativos; respeita `prefers-reduced-motion` (já no CSS).
- **Estado honesto (§2):** sem ETA do flow inteiro — só countdown ao próximo passo.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

- Reusar `.hm-flow-neon` (globals.css) — o card precisa `position: relative` + `border-radius` (o `::before`
  herda o raio). e2e não hidrata socket → validar por typecheck/lint/test/build + smoke em prod.
