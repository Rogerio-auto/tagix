---
id: F71-S08
title: Seletor de empresa no shell e aviso de trial, convite pendente e modo só leitura
phase: F71
status: in-progress
priority: high
estimated_size: M
ui: true
depends_on: [F71-S03, F71-S06]
blocks: [F71-S10]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/UX_PRINCIPLES.md
  - docs/DESIGN_SYSTEM.md
agent_id: backend-engineer
claimed_at: 2026-10-07T01:31:16Z

---
# F71-S08 — Seletor de empresa e avisos de conta

## Objetivo

Quem está em mais de uma empresa troca entre elas em dois cliques e sempre sabe em qual está. Quem está em trial, tem convite pendente ou caiu para só leitura vê isso com clareza e sabe o que fazer.

## Escopo (faz)

- Seletor de empresa no cabeçalho da `Sidebar` (desktop) e no `UserMenu` (mobile):
  - nome da empresa ativa sempre visível;
  - lista de `memberships` com papel e atalho de teclado; só aparece como seletor se houver 2+;
  - a troca chama `POST /api/me/workspace` e depois limpa **todo** o cache do React Query, reconecta o socket e vai para `/`, sem vazar dado da empresa anterior na tela;
  - estado da troca (carregando, erro).
- `auth.store.ts` guarda `memberships`.
- Faixa de conta no shell (`(app)/layout.tsx`), uma por vez, por prioridade:
  1. só leitura (`expired`/`canceled`): "Sua empresa está em modo só leitura. Escolha um plano para voltar a editar." + CTA para billing;
  2. trial ≤ 3 dias: "Seu teste termina em N dias." + CTA;
  3. `past_due`: "Pagamento pendente." + CTA;
  4. convite pendente (`GET /api/me/invites`): "Você foi convidado para a Empresa X." + Aceitar (vai para `/convite/<token>`, ou aceita inline).
- Handler central de erro: `402 subscription_inactive` → toast explicando o só leitura (sem deslogar), uma vez por sessão de tela.
- Botões de escrita principais desabilitados com tooltip em modo só leitura, onde for barato. A guarda real é no servidor (S06).

### files_allowed

- `apps/web/shared/components/layout/Sidebar.tsx`, `apps/web/shared/components/layout/UserMenu.tsx`
- `apps/web/shared/components/workspace-switcher/**` (novo)
- `apps/web/shared/components/account-banner/**` (novo)
- `apps/web/shared/stores/auth.store.ts`
- `apps/web/shared/lib/api-client.ts`, `apps/web/shared/lib/query-client.ts`
- `apps/web/shared/realtime/**`
- `apps/web/app/(app)/layout.tsx`
- testes ao lado e `apps/web/e2e/specs/workspace-switch*.spec.ts` (novos)

### files_forbidden

- `apps/web/shared/components/layout/TopBar*` (F70-S32), `apps/web/features/auth/**` (S09)

## Definition of Done

- [ ] teste: troca limpa o cache e reconecta o socket
- [ ] teste: seletor some com 1 empresa
- [ ] teste: prioridade das faixas
- [ ] teste: 402 mostra o toast e não desloga
- [ ] capturas 375/768/1440 em dark e light, axe, peso (`~/.claude/skills/canone/VERIFICACAO.md`)
- [ ] revisão `design-web` / `/hm-designer` aprovada

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
pnpm --filter @hm/web exec vitest run shared --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`.
- Conflito evitado: o TopBar é da F70-S32. Se o seletor precisar entrar no TopBar, sequenciar depois da F70-S32.
