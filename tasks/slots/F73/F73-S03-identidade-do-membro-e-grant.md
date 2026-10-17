---
id: F73-S03
title: Identidade do membro, grant assinado, callback interno do Copiloto e API de me/configurações
phase: F73
status: review
priority: critical
estimated_size: L
model: opus
ui: false
depends_on: [F73-S01, F73-S02]
blocks: [F73-S05, F73-S06, F73-S07, F73-S10, F73-S11, F73-S12, F73-S13, F73-S15]
source_docs:
  - docs/decisions/ADR-003-identidade-do-membro-nas-acoes-de-ia.md
  - docs/features/COPILOTO.md
  - docs/features/PERMISSIONS.md
agent_id: backend-engineer
claimed_at: 2026-10-17T04:32:04Z
completed_at: 2026-10-17T05:20:44Z

---
# F73-S03 — Identidade do membro e grant

## Objetivo

Implementar o ADR-003 inteiro. Cada turno do Copiloto vira uma credencial curta e assinada, amarrada a um membro. Cada chamada de ferramenta reautoriza do zero (papel atual, matriz, assinatura e orçamento). O Copiloto respeita o modo só leitura e fica indisponível em view-as. As rotas `/api/copilot/me`, `/me/prefs` e `/settings` passam a existir, e as sub-rotas e registros de ferramenta ficam com o lugar reservado para os slots seguintes.

## Contexto

Todo slot de ferramenta (S06–S09, S11) e a API de sessão (S10) se apoiam aqui. O caminho de agente (`apps/api/src/internal/tools/**`) **não muda**. Leia `access.ts` e `router.ts` de lá como referência de estilo: barreira antes do handler, motivos de recusa estáveis, log da recusa e nenhum corpo de erro cru ao chamador.

## Escopo (faz)

- `apps/api/src/services/copilot/identity/**`:
  - `grant.ts`: `mintGrant({ turnId, workspaceId, memberId, nonce, ttlSeconds = 120 })` e `verifyGrant(token)`, com HMAC-SHA256 (`node:crypto`), base64url, `timingSafeEqual` e `v: 1`. Recusa token malformado, `exp` vencido, versão desconhecida ou assinatura inválida, com motivos estáveis: `grant_malformed`, `grant_expired`, `grant_bad_signature`, `grant_unsupported_version`;
  - `principal.ts`: `resolveCopilotPrincipal(tx, { workspaceId, memberId })` → `{ workspaceId, memberId, role, memberStatus, subscription: { effectiveStatus, inactive }, settings, effectiveCapabilities }`, recarregando membro, workspace e `copilot_settings` a cada chamada (sem cache);
  - `scope.ts`: os predicados de escopo **únicos** do Copiloto (ADR-003 §4), importados por todas as ferramentas e pela sessão:
    - `conversationScope(principal)`: `buildVisibilityPredicate` de `@hm/db` + peer-privacy; `null` para OWNER/ADMIN;
    - `dealScope(principal)`: AGENT vê `owner_id = membro` **ou** negócio com conversa vinculada visível; demais papéis com `pipeline.view` veem todos;
    - `contactScope(principal)`: `contact.view`;
    - `resolveVisible(tx, principal, { type, id })` → entidade mínima (`{ type, id, label }`) ou `null`, para o contexto de página e para validar ids vindos de `args`.
    Teste de escopo por papel (os 5) e por time `private`.
  - `authorize.ts`: `authorizeCapability(principal, capability, { targetCount, isWrite, budget })` → `{ allowed: true } | { allowed: false, reason: 'role'|'capability_disabled'|'subscription_inactive'|'budget'|'copilot_disabled' }`, na ordem do ADR-003 §3.
- Configuração: `COPILOT_GRANT_SECRET` em `apps/api/src/config.ts` (Zod, ≥ 32 bytes, obrigatório quando `NODE_ENV=production`; em dev, gerado por processo com aviso no log) e `.env.example`.
- Callback interno `apps/api/src/internal/copilot/core/**`:
  - `router.ts`: `POST /internal/copilot/tools/:key`. Valida o bearer de serviço igual ao caminho de agente (reusar `internal/tools/auth.ts` **por import**, sem editar), verifica o grant, abre `withWorkspace(payload.ws)` e chama `copilotTurnsRepo.claimToolCall` (falha → 403 `turn_not_active`, sem executar). Resolve o principal, encontra a ferramenta no registro (inexistente → 404 `tool_not_found`), valida `args` com o Zod `.strict()` da ferramenta (falha → `decision: 'invalid_args'` com mensagem segura para o modelo) e autoriza a capacidade. Só então chama o handler. Grava `copilot_tool_calls` em todos os caminhos, com `args_redacted` pelo redator de `internal/tools/log-redaction.ts` (por import);
  - `registry.ts`: `CopilotToolDefinition<Args>` = `{ key, capability, label (do catálogo), description (para o modelo), args: ZodType, taintsTurn: boolean, handler(ctx, args) → CopilotToolEnvelope }`. `CopilotToolContext` = `{ tx, principal, turn, callId, emitResult(card) }`. Também `listToolDescriptorsFor(principal)`, que gera o JSON Schema por `z.toJSONSchema` e filtra pelas capacidades efetivas: o modelo **não vê** ferramenta que o membro não pode usar;
  - `taint.ts`: quando a ferramenta tem `taintsTurn`, chama `copilotTurnsRepo.markTainted` **antes** de devolver o resultado;
  - composição em `apps/api/src/internal/copilot/index.ts`, importando os registros de cada área.
- Stubs de registro, cada um exportando `export const tools: readonly CopilotToolDefinition[] = []` e um comentário com o slot dono:
  - `apps/api/src/internal/copilot/read-crm/index.ts` (S06);
  - `apps/api/src/internal/copilot/read-ops/index.ts` (S07);
  - `apps/api/src/internal/copilot/act-crm/index.ts` (S08);
  - `apps/api/src/internal/copilot/act-external/index.ts` (S09);
  - `apps/api/src/internal/copilot/memory-tools/index.ts` (S11).
  `act-crm` e `act-external` também exportam `executors: readonly CapabilityExecutor[] = []`. O tipo vem de um `type`-only placeholder em `core/executor-types.ts`, que o S05 completa.
- Rotas públicas `apps/api/src/routes/copilot/**` (este slot é dono só do `index.ts` e de `me/` e `settings/`):
  - `index.ts`: `createCopilotRouter()` monta `me`, `settings` e os stubs `sessions`, `proposals`, `activity`, `memory`, `briefing`, `autopilot` e `usage`;
  - cada stub é um `Router()` vazio em `routes/copilot/<área>/index.ts`, com comentário do slot dono;
  - middleware `copilotAvailable`, comum a todas: `req.impersonation` → 403 `copilot_unavailable_impersonation`; `copilot_settings.enabled = false` → 403 `copilot_disabled`; `requireRole('copilot.use')`;
  - `GET /api/copilot/me` → `CopilotMeSchema` (capacidades efetivas, preferências resolvidas, `available`, `budget: { state: 'ok'|'alert'|'queries_only'|'paused', resets_on }`; `spent_usd` e `cap_usd` só com `copilot.view_costs`);
  - `PATCH /api/copilot/me/prefs` (`CopilotPrefsUpdateSchema`: `auto_open`, `surface`, `first_use_hint_seen`). Animação e atenção **não** entram aqui: são da F76 (`members.notification_prefs.copilot`, ADR-006);
  - `GET /api/copilot/settings` e `PUT /api/copilot/settings` (`copilot.manage`), com `audit_logs` (`action: 'copilot.settings.updated'`, diff sem valores sensíveis).
- Montagem: `app.use(createCopilotRouter())` e `app.use(createCopilotInternalRouter())` em `apps/api/src/app.ts`, no mesmo bloco das rotas de workspace e das internas.
- `apps/api/src/middlewares/subscription-guard.ts`: exceções **exatas** (método + regex ancorada) para `POST /api/copilot/sessions` e `POST /api/copilot/sessions/:uuid/messages`, com comentário citando o ADR-003 §5 e testes que provam que `POST /api/copilot/proposals/:id/confirm` continua 402.

## Fora de escopo

- Ferramentas concretas (S06–S09, S11), motor de propostas (S05), sessão e SSE (S10).
- Uso e custo detalhado (S15). Aqui só o `state` do orçamento, calculado com `monthToDateSpendUsd` filtrando `surface='copilot'`; a função ganha esse filtro no S10. Até lá, este slot faz a soma com uma query local em `identity/budget.ts`, que o S10 substitui.

### files_allowed

- `apps/api/src/services/copilot/identity/**`
- `apps/api/src/internal/copilot/core/**`
- `apps/api/src/internal/copilot/index.ts`
- `apps/api/src/internal/copilot/read-crm/index.ts`
- `apps/api/src/internal/copilot/read-ops/index.ts`
- `apps/api/src/internal/copilot/act-crm/index.ts`
- `apps/api/src/internal/copilot/act-external/index.ts`
- `apps/api/src/internal/copilot/memory-tools/index.ts`
- `apps/api/src/routes/copilot/index.ts`
- `apps/api/src/routes/copilot/me/**`
- `apps/api/src/routes/copilot/settings/**`
- `apps/api/src/routes/copilot/sessions/index.ts`
- `apps/api/src/routes/copilot/proposals/index.ts`
- `apps/api/src/routes/copilot/activity/index.ts`
- `apps/api/src/routes/copilot/memory/index.ts`
- `apps/api/src/routes/copilot/briefing/index.ts`
- `apps/api/src/routes/copilot/autopilot/index.ts`
- `apps/api/src/routes/copilot/usage/index.ts`
- `apps/api/src/app.ts`
- `apps/api/src/config.ts`
- `apps/api/src/middlewares/subscription-guard.ts`
- `apps/api/src/middlewares/subscription-guard.test.ts`
- `.env.example`
- `packages/shared/src/copilot/statuses.test.ts`

### files_forbidden

- `apps/api/src/internal/tools/**` (caminho de agente: só importar)
- `packages/db/**`

## Contratos

- `CopilotToolEnvelope` e `CopilotToolCallBody`: `packages/shared/src/copilot/internal.ts` (S02).
- Motivos de recusa do callback (estáveis, logados, nunca com dado de negócio): `service_unauthorized`, `grant_*`, `turn_not_active`, `tool_not_found`, `invalid_args`, `capability_denied:<reason>`.

## Definition of Done

- [ ] Testes de `grant.ts`: ida e volta; token adulterado em cada segmento; `exp` vencido; versão desconhecida; segredo diferente
- [ ] Teste de integração do callback (banco de dev), recusando sem executar: sem bearer; grant de outro workspace; turno `completed`; turno de outro membro; `tool_calls` esgotado; membro rebaixado entre duas chamadas (a 2ª recusa por `role`); assinatura expirada com ferramenta de escrita (recusa) e de consulta (passa); args com campo extra (`invalid_args`)
- [ ] `listToolDescriptorsFor` não lista ferramenta de capacidade negada (teste com AGENT e READONLY)
- [ ] `copilot_tool_calls` gravado em todos os caminhos, sem PII (teste com telefone e e-mail em `args`)
- [ ] View-as → 403 em todas as rotas `/api/copilot/*`; só leitura → `POST /sessions` passa no guard e `POST /proposals/:id/confirm` dá 402
- [ ] `GET /me` não devolve valores em US$ sem `copilot.view_costs` (teste com AGENT, SUPERVISOR e OWNER)
- [ ] O teste de igualdade de enums (`statuses.test.ts`) ligado e verde
- [ ] `COPILOT_GRANT_SECRET` documentado em `.env.example`; o boot de produção falha sem ele (teste de `config`)

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/services/copilot/identity src/internal/copilot src/routes/copilot src/middlewares/subscription-guard.test.ts --maxWorkers=1
node packages/shared/node_modules/vitest/vitest.mjs run --root packages/shared src/copilot/statuses.test.ts --maxWorkers=1
```

## Notas

- Agente: `backend-engineer` (opus). Depois do merge, `/hm-security` focado no callback (fica registrado no F73-S14).
- O orçamento só bloqueia escrita em `queries_only`. Consulta passa até o teto duro de 120% do teto (spec §6 e ADR-003 §3.6). Em `pause`, nada passa. O número 120% é provisório e depende da decisão de preço do Rogério: deixe-o numa constante nomeada.
- `GET /me` é o primeiro request do cliente (F74-S01). Mire p95 ≤ 60 ms com 3 queries indexadas.
