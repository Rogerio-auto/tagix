---
id: F56-S08
title: RLS como backstop real — FORCE RLS + role não-superuser + agent_templates
phase: F56
status: available
priority: high
estimated_size: M
depends_on: []
blocks: []
agent_id: db-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S08 — RLS defense-in-depth (SEC-03/SEC-04/DB-08)

> **Origem:** AUDITORIA_TECNICA.md §3.1/§3.8. O role de app em prod é superuser+BYPASSRLS e não há `FORCE ROW LEVEL SECURITY` — caminhos `getDb()` direto bypassam RLS. `agent_templates` tem `workspace_id` mas RLS nunca foi habilitada.

## Objetivo

Restaurar a RLS como rede de segurança real (não só convenção), habilitando FORCE RLS nas tabelas tenant, criando policy de `agent_templates` e provendo um role de app não-privilegiado.

## Contexto / causa raiz (verificada)

- `packages/db/src/rls.ts:11-20` — RLS só vale sob `SET LOCAL ROLE hm_app` dentro de `withWorkspace`; caminhos owner-level (billing/plataforma/webhooks) rodam sem RLS.
- Grep `FORCE ROW LEVEL SECURITY` = vazio.
- `agent_templates`: `0015_agents_rls.sql` faz GRANT mas não `ENABLE ROW LEVEL SECURITY` nem policy.

## Escopo (faz)

- Migration `0062_f56_force_rls.sql`: `ALTER TABLE … FORCE ROW LEVEL SECURITY` nas tabelas tenant; `ENABLE RLS` + policy de isolamento em `agent_templates` (tratando `workspace_id IS NULL` = global read-only).
- Definir/documentar um role de conexão de app **sem** superuser/BYPASSRLS para API/workers (superuser só para migrations/schedulers cross-tenant).
- Estender `rls.test.ts`/novo teste cobrindo `agent_templates` e o comportamento sob FORCE.

## Escopo (não faz)

- Índices/partição (F56-S24/DB-01). Auditoria de cada `getDb()` (follow-up de código, fora de db).

## Arquivos permitidos

- `packages/db/src/rls.ts`
- `packages/db/drizzle/0062_f56_force_rls.sql`
- `packages/db/src/rls.test.ts`
- `packages/db/src/schema/agent_templates.ts`

## Arquivos proibidos

- `packages/db/drizzle/meta/**` (regenerado no integração)
- `packages/db/src/schema/{campaigns,flows,conversations,messages,agent_executions,calendar,webhook_events}.ts` (outros slots de DB)

## Definition of Done

- [ ] Tabelas tenant com `FORCE ROW LEVEL SECURITY`.
- [ ] `agent_templates` com RLS + policy; teste de isolamento cross-tenant nega leitura de outro workspace.
- [ ] Documentado o role de app não-superuser (runbook ou nota de migração).
- [ ] `pnpm --filter @hm/db test` (rls) verde.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

- Trocar o role de conexão de prod exige janela (ver pergunta aberta #2 da auditoria). Este slot entrega a policy + FORCE + role documentado; a troca operacional do role em prod é executada no deploy.
- `meta/_journal.json` regenerado pelo integrador — não commitar (evita colisão entre slots de migration).
