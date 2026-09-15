---
id: F25-S11
title: Limite de tentativas na camada de plataforma — negação repetida não pode encher a auditoria nem o banco
phase: F25
status: available
priority: medium
estimated_size: S
depends_on: [F25-S10]
blocks: []
source_docs:
  - docs/INDEX.md
agent_id: security-auditor

---
# F25-S11 — Limite de tentativas na camada de plataforma

## Objetivo

Um usuário autenticado sem privilégio de plataforma não consegue, repetindo pedidos, crescer
`audit_logs` sem limite nem ocupar conexões do banco — e cada pessoa bloqueada continua deixando
rastro suficiente para investigar.

## Contexto

Apontado na revisão de segurança da F25-S10 (2026-09-15), severidade média, **anterior** àquela
mudança. Nenhuma rota `/api/platform/*` tem limite de taxa: os 11 routers de plataforma são montados
em `apps/api/src/app.ts` (linhas 263–278) sem `rateLimit`. Cada tentativa negada custa uma busca de
sessão e uma escrita em `audit_logs` — antes da F25-S10 a mesma escrita acontecia, só que sem esperar.

O `rateLimit` existente (`apps/api/src/middlewares/rate-limit.ts`) chaveia por IP e, opcionalmente,
por e-mail do corpo. Para esta camada a chave certa é o **membro autenticado**: IP muda, e o risco é
de quem já tem sessão.

## Escopo

### files_allowed

- `apps/api/src/middlewares/rate-limit.ts`
- `apps/api/src/middlewares/rate-limit.test.ts`
- `apps/api/src/middlewares/platform-admin.ts`
- `apps/api/src/middlewares/platform-admin.test.ts`

### files_forbidden

- `apps/api/src/routes/platform/**`

## Escopo (faz)

- Limite por membro na negação da camada de plataforma (proposta: 30 por minuto), aplicado dentro do
  guard, sem mexer nos 43 handlers.
- Acima do limite: 429, sem nova linha em `audit_logs` por pedido — uma linha resumo por membro por
  janela com a contagem, para a trilha continuar dizendo quem tentou e quanto.
- Administrador de plataforma não é limitado por este mecanismo.

## Definition of Done

- [ ] 31ª tentativa negada do mesmo membro em 1 minuto recebe 429.
- [ ] `audit_logs` cresce no máximo uma linha por tentativa até o limite, e uma linha resumo depois.
- [ ] Administrador de plataforma não é afetado.
- [ ] Redis fora não bloqueia a negação (falha aberta para o limite, fechada para o acesso).

## Validação

```bash
pnpm --filter @hm/api test
pnpm typecheck
pnpm lint
```
