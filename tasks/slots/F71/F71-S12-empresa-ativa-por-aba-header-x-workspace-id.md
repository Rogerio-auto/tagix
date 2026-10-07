---
id: F71-S12
title: Empresa ativa por aba com X-Workspace-Id e 409 workspace_mismatch
phase: F71
status: available
priority: medium
estimated_size: L
depends_on: [F71-S10]
blocks: [F71-S18]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/ARCHITECTURE.md
---
# F71-S12 — Empresa ativa por aba

## Objetivo

Trocar de empresa numa aba nunca redireciona, em silêncio, escritas feitas em outra aba para a empresa nova.

## Contexto

Achado F-04 da auditoria da F71: a empresa ativa vem do cookie `hm_workspace`, global por navegador. Com duas abas abertas em empresas diferentes, a troca em uma muda a resolução da outra, e um POST da aba antiga cai na empresa errada.

## Escopo (faz) — 2 fases no mesmo slot, nesta ordem

1. **API (backend-engineer):** `apps/api/src/middlewares/auth.ts` aceita `X-Workspace-Id` (UUID validado). Se presente e diferente da empresa resolvida pelo cookie/padrão: `409 { error: 'workspace_mismatch', activeWorkspaceId }` (a aba decide o que fazer); sem membership `active` na empresa pedida → `403`. Rotas que definem a empresa (`POST /api/me/workspace`) ignoram o header. O handshake do Socket.io lê a empresa do auth payload com a mesma regra. Auditoria `workspace.switched` inalterada. **Decisão a registrar:** `409` (cliente recarrega) em vez de o header sobrescrever o cookie, para a API nunca operar em empresa diferente da que a sessão resolveu sem o cliente saber.
2. **Web (frontend-engineer), só após a fase 1 verde:** `api-client.ts` envia `X-Workspace-Id` (empresa ativa da aba, em `auth.store`) em todo request; em `409 workspace_mismatch` limpa o cache e recarrega a aba; `BroadcastChannel('hm-workspace')` avisa as outras abas da troca (mostram "a empresa mudou" e recarregam); o socket reconecta com a empresa da aba.

## Fora de escopo

- Remover o cookie `hm_workspace` (continua como padrão de nova aba). Faixa de conta (S08).

### files_allowed

- `apps/api/src/middlewares/auth.ts`, `apps/api/src/middlewares/workspace-header.ts` (novo) e testes
- `apps/api/src/socket/index.ts` (só handshake) e teste do handshake
- `apps/web/shared/lib/api-client.ts`, `apps/web/shared/lib/query-client.ts`
- `apps/web/shared/stores/**`, `apps/web/shared/realtime/**`
- `apps/web/shared/components/workspace-switcher/**`
- testes ao lado, `apps/web/e2e/specs/workspace-switch.spec.ts`, `apps/web/e2e/fixtures/api-mock.ts`

### files_forbidden

- `packages/db/**`, `apps/web/next.config.mjs` e `instrumentation*` (S11), `apps/api/src/auth/**`

## Definition of Done

- [ ] teste API: header igual à resolvida → 200; divergente → 409 `workspace_mismatch`; sem membership → 403; ausente → comportamento atual
- [ ] teste API: handshake do socket respeita a empresa enviada pela aba
- [ ] e2e com duas abas: troca na aba A, escrita na aba B falha com recarregamento (não grava em A)
- [ ] `BroadcastChannel` sincroniza abas; teste unitário com canal simulado
- [ ] nenhum dado da empresa anterior sobra no cache após o 409

## Validação

```bash
pnpm --filter @hm/api typecheck
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/middlewares src/socket --maxWorkers=1
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
node --env-file=.env apps/web/node_modules/vitest/vitest.mjs run --root apps/web --maxWorkers=1
```

## Notas

- Agentes: `backend-engineer` (fase 1), depois `frontend-engineer` (fase 2). O orchestrator pode dividir em S12a/S12b no despacho.
- `middlewares/auth.ts` também é tocado pela S18 (declarada depois desta).
