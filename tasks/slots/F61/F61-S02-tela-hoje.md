---
id: F61-S02
title: Tela Hoje — a visão de dono
phase: F61
status: available
priority: critical
estimated_size: M
depends_on: []
blocks: [F61-S08]
source_docs:
  - docs/features/APP_MOBILE_PLAN.md
  - docs/MOBILE_UX.md
---

# F61-S02 — Tela Hoje: a visão de dono

## Objetivo

A tela que o dono do negócio abre no celular entre uma tarefa e outra, e que responde três
perguntas: entrou lead e alguém respondeu? o que eu tenho hoje? como está o mês?

## Contexto

`APP_MOBILE_PLAN` §3.1. Hoje o mobile é o produto inteiro encolhido com carinho — 34 telas
responsivas da F36 — mas não existe a tela do **dono**, que não é atendente e não quer navegar.

O número que fecha venda é o **tempo de resposta**: quem pede orçamento pede três, e quem responde
primeiro ganha. Ele fica em destaque.

## Escopo

### files_allowed

- `apps/web/app/(app)/hoje/**`
- `apps/web/features/today/**`
- `apps/web/shared/components/layout/nav.ts`
- `apps/web/shared/components/layout/BottomNav.tsx`
- `apps/api/src/routes/dashboard/today.ts`
- `apps/api/src/routes/dashboard/index.ts`
- `apps/api/src/routes/dashboard/*.test.ts`

### files_forbidden

- `apps/web/features/dashboard/**`
- `packages/db/src/schema/**`

## Escopo (faz)

- `GET /api/dashboard/today` — leads sem resposta com o tempo correndo, compromissos de hoje,
  resultado do mês corrente contra o anterior. Uma chamada, não três.
- Rota `/hoje` mobile-first, usando os padrões do `MOBILE_UX` (thumb-first, alvos ≥44px, safe-area).
- Entra na bottom nav como primeiro destino.
- **Linguagem segura para o cliente**: "Aguardando resposta", "Receita atribuída", "Próximas ações".
  Nada de termo interno de fila, worker ou custo de modelo.

## Fora de escopo

- Service worker e instalação (F61-S01/S05).
- Push (F61-S03).
- Substituir o dashboard existente — `/hoje` convive com `/`.

## Definition of Done

- [ ] Uma chamada só alimenta a tela; nada de três requisições em cascata no 4G.
- [ ] O tempo de espera do lead é exibido em linguagem humana ("há 12 min"), não em timestamp.
- [ ] Resultado do mês compara com o anterior e é honesto quando o mês está ruim.
- [ ] Nenhum termo interno de infraestrutura aparece na tela.
- [ ] Tudo que é ação fica na zona do polegar; nenhuma ação destrutiva sem confirmação.
- [ ] A tela responde a workspace sem dado nenhum sem parecer quebrada.
- [ ] RLS: o endpoint devolve só o workspace da sessão; teste cobre isolamento.

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/web typecheck
pnpm lint
```

## Notas

- O dono abre isto no semáforo. Se precisar de dois toques para saber se tem lead esperando, falhou.
- Zero é um número honesto; "—" não é. Workspace sem dado mostra zero e o que fazer a respeito.
