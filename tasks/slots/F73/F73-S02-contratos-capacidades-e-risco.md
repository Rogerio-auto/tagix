---
id: F73-S02
title: Contratos do Copiloto em @hm/shared (permissões copilot.*, catálogo de capacidades, classificador de risco, Zod de API e SSE)
phase: F73
status: available
priority: critical
estimated_size: M
model: opus
ui: false
depends_on: []
blocks: [F73-S03, F73-S05, F73-S06, F73-S07, F73-S08, F73-S09, F73-S10, F73-S11, F73-S12, F73-S13, F74-S01, F75-S04, F75-S06, F75-S07, F75-S08, F76-S04]
source_docs:
  - docs/features/COPILOTO.md
  - docs/decisions/ADR-003-identidade-do-membro-nas-acoes-de-ia.md
  - docs/decisions/ADR-004-motor-de-acoes-com-confirmacao-humana.md
  - docs/features/PERMISSIONS.md
  - docs/design/copilot-integracoes-ux.md
agent_id: backend-engineer
---
# F73-S02 — Contratos, capacidades e risco

## Objetivo

Um único lugar (`@hm/shared/copilot`) define o que o Copiloto pode fazer, quanto cada coisa arrisca e o formato de tudo o que cruza a rede. Backend, runtime (por espelho) e interface usam esse contrato. É o que deixa a F74 começar com cliente mock sem esperar o backend.

## Contexto

O nível de risco é do sistema e não do modelo (ADR-004 §1), então o classificador precisa ser uma função pura, testável por tabela e importável por API e web. Os eventos SSE e os DTOs são usados em 15 slots: se não forem únicos, divergem.

## Escopo (faz)

- `packages/shared/src/permissions.ts`: permissões novas, sem mexer nas existentes.
  - `copilot.use` → ALL
  - `copilot.manage` → ADMINS
  - `copilot.view_costs` → OWNER e ADMIN
  - `copilot.memory.edit` → MANAGERS
  - `copilot.activity.view_all` → MANAGERS
  - `copilot.autopilot.manage` → ADMINS
- `packages/shared/src/copilot/capabilities.ts`: `CAPABILITIES` como `as const satisfies Record<CapabilityKey, CapabilityDef>`, exatamente o catálogo da spec §6.2.
  - `CapabilityDef` = `{ key, label, description, kind: 'query'|'write', baseRisk: 1|2|4, permission: Permission | ((targetCount: number) => Permission), external, irreversible, undoable, scopeNote? }`.
  - `effectiveCapabilities(role, matrix)` → `Record<CapabilityKey, { allowed: boolean, reason?: 'role'|'disabled_by_owner' }>`. A matriz só restringe.
  - `CAPABILITY_LABELS_PT` (para a tela de configurações e para os rótulos de `status`, ex.: "Lendo o pipeline…").
- `packages/shared/src/copilot/risk.ts`: `classifyRisk(input) → { level: 1|2|3|4, reasons: RiskReason[] } | { refused: 'batch_too_large' }`, a regra exata da spec §6.1, com `BATCH_LIMIT = 200`.
- `packages/shared/src/copilot/contracts.ts` (Zod v4; todo objeto `.strict()` na entrada e tolerante na saída só onde o comentário justificar):
  - `CopilotPageContextSchema` (spec §5.1);
  - `CopilotStreamEventSchema`, união discriminada dos eventos públicos (spec §5.3) com `v: 1`;
  - `CopilotAnswerBlocksSchema`, `ToolResultCardSchema` (um schema de `data` por `kind`: `deal_list`, `contact_card`, `deal_card`, `kpis`, `series`, `funnel`, `event_list`, `conversation_list`, `campaign_card`, `table`);
  - `ProposalDTOSchema`: `id`, `capability`, `risk_level`, `status`, `summary`, `preview`, `policy_checks`, `items` (paginado ≤ 200), `expires_at`, `undo_deadline`, `version`, `can_confirm`, `can_undo`, `blocked_reason`, `approver`;
  - `ProposalPreviewSchema`: `before_after[]`, `impact` (`{ forecast_delta_brl?, notified_members[], affected_count, criterion }`);
  - `PolicyCheckSchema` (`key`, `status: ok|warn|block`, `label`, `detail`);
  - `ActivityEntrySchema`, `BriefingSchema` / `BriefingItemSchema` (`kind`, `title`, `value_at_risk`, `why[]`, `as_of`, `action`), `MemoryProfileSchema`, `MemoryFactSchema`, `CopilotSettingsSchema` / `CopilotSettingsUpdateSchema`, `CopilotMeSchema`, `CopilotPrefsUpdateSchema`, `SuggestionSchema`, `AutopilotRuleSchema`, `CopilotUsageSchema`;
  - bodies de request: `ConfirmProposalBody`, `AdjustProposalBody`, `RequestApprovalBody`, `DecideSuggestionsBody`, `AskBody` (`{ text ≤ 2000, page_context?, client_request_id: uuid, origin }`).
- `packages/shared/src/copilot/internal.ts`: contrato interno API ↔ runtime da spec §5.4 (`CopilotRunRequestSchema`, `CopilotRuntimeEventSchema`, `CopilotToolCallBodySchema`, `CopilotToolEnvelopeSchema`). É a fonte que o Python espelha (F73-S04) e que o cliente Node valida (F73-S10).
- `packages/shared/src/copilot/statuses.ts`: enums de status iguais aos do banco (F73-S01). Um teste confere a igualdade quando o `@hm/db` estiver disponível; até lá, o teste fica `skip` com `TODO(F73-S01)`, e a S03 o liga.
- `packages/shared/src/copilot/index.ts` e reexportação em `packages/shared/src/index.ts`.
- `packages/shared/src/socket-events.ts`: `copilot:proposal_updated`, `copilot:briefing_ready`, `copilot:suggestions_changed` (spec §5.5), com payloads tipados e incluídos em `SERVER_TO_CLIENT_EVENTS`.
- `packages/shared/src/notifications.ts`: eventos `copilot_briefing` e `copilot_aprovacao`. `copilot_briefing` é **só push** (nunca degrada para WhatsApp ou e-mail: briefing não é urgente e não pode virar spam); `copilot_aprovacao` segue a cascata normal. A regra fica na função pura de decisão, com teste. Ajustar os `Record<NotificationEvent, …>` que deixam de compilar:
  - títulos em `apps/api/src/services/notifications/**`;
  - rótulos em `apps/web/features/notifications/labels.ts`.
  Só texto: a entrega usa a cascata existente.
- Fixtures canônicas em `packages/shared/src/copilot/fixtures.ts`: Arcada Odontologia, dados fictícios da maquete (Maria Souza, 7 negócios parados, R$ 38.500, briefing de 3 itens, lembrete a 12 pacientes, campanha "Clareamento de Outubro"). Todas validadas pelos schemas num teste. São o insumo do cliente mock da F74-S01 e dos testes de API.
- `docs/features/PERMISSIONS.md`: linhas das permissões novas na matriz e uma seção curta "Copiloto: age com as permissões de quem pede" apontando para o ADR-003.

## Fora de escopo

- Qualquer I/O (rotas, banco, runtime).
- O espelho Python do contrato interno (F73-S04).

### files_allowed

- `packages/shared/src/copilot/**`
- `packages/shared/src/permissions.ts`
- `packages/shared/src/index.ts`
- `packages/shared/src/socket-events.ts`
- `packages/shared/src/socket-events.test.ts`
- `packages/shared/src/notifications.ts`
- `packages/shared/src/notifications.test.ts`
- `apps/api/src/services/notifications/**`
- `apps/web/features/notifications/labels.ts`
- `docs/features/PERMISSIONS.md`

### files_forbidden

- `packages/db/**`
- `apps/agent-runtime/**`

## Contratos

O que esta slot publica **é** o contrato. Toda mudança posterior em `packages/shared/src/copilot/**` exige nota no slot que mudou e aviso em `tasks/COMMS.md`.

## Definition of Done

- [ ] `classifyRisk` com teste por tabela, cobrindo todas as combinações de `external`, `irreversible`, `notifies_members`, `turn_tainted` e `target_count` ∈ {1, 2, 200, 201}, por capacidade
- [ ] `effectiveCapabilities` testado para os 5 papéis × catálogo: nunca concede o que `can()` nega, e a matriz só restringe
- [ ] Todas as fixtures parseiam nos schemas, e um teste de ida e volta (`parse(JSON.parse(JSON.stringify(x)))`) garante que nada depende de `Date` ou de `undefined`
- [ ] Nenhum `any`; `z.infer` exportado para cada schema
- [ ] Typecheck verde em `@hm/shared`, `@hm/api`, `@hm/web` e `@hm/workers`
- [ ] `PERMISSIONS.md` atualizado

## Validação

```bash
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/web typecheck
pnpm --filter @hm/workers typecheck
node packages/shared/node_modules/vitest/vitest.mjs run --root packages/shared src/copilot src/socket-events.test.ts src/notifications.test.ts --maxWorkers=1
pnpm exec eslint packages/shared/src/copilot --max-warnings=0
```

## Notas

- Agente: `backend-engineer`, com modelo `opus`: é contrato de produto e de segurança.
- Rótulos de `status` vêm do catálogo e nunca do modelo, para evitar injeção visual ("Lendo dados do Banco Central…").
- `message.send` tem permissão dependente do volume (1 alvo: `conversation.assign`; 2 ou mais: `campaign.edit`). Por isso `permission` aceita função.
- Paralelo ao F73-S01 e ao F73-S04.
