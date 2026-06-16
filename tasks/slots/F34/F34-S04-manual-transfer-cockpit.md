---
id: F34-S04
title: Troca manual de agente no cockpit (endpoint + UI + socket + permissão)
phase: F34
status: review
priority: high
estimated_size: L
depends_on:
  - F34-S01
blocks:
  - F34-S07
source_docs:
  - docs/features/AGENT_DEPARTMENT_ROUTING_PLAN.md
  - docs/features/LIVECHAT_OPS.md
agent_id: frontend-engineer
claimed_at: 2026-06-16T04:05:18Z
completed_at: 2026-06-16T04:19:10Z

---
# F34-S04 — Troca manual no cockpit

## Objetivo

Permitir que um operador veja **qual agente de IA atende** a conversa e **troque** para outro agente elegível direto no cockpit, com endpoint dedicado, permissão própria (`conversation.assign_agent`, D4), evento de socket e re-engajamento da IA.

## Contexto

O `ConversationHeader` (`apps/web/features/conversations/components/ConversationHeader/ConversationHeader.tsx`) hoje só liga/desliga a IA (`/ai-mode`) e nem mostra o agente. O endpoint de estado fica em `apps/api/src/routes/conversations/state.ts` (referência de padrão: guard de visibilidade `assertConversationVisible`, escopo AGENT-só-nas-suas, relay de socket). Consome `agent_departments` (S01) para listar os agentes elegíveis ao(s) departamento(s) da conversa.

## Escopo (faz)

- **API (`apps/api/src/routes/conversations/agent.ts`, novo)** — `POST /api/conversations/:id/agent` `{ agentId }`:
  - Gated por nova permissão `conversation.assign_agent` (AGENT só nas suas; guard `assertConversationVisible` → 404 antes de 403, padrão S07.1).
  - Valida que o `agentId` é elegível (agente atende algum departamento da conversa) — usar repo S01.
  - Grava `conversations.agent_id`, garante `ai_mode='on'`, re-engaja (enfileira gatilho `flow.run.requested` em `hm.q.flows`, mesmo contrato do inbound).
  - Emite `conversation:agent_changed` via relay (best-effort).
  - Monta o router; **`apps/api/src/app.ts`** monta `createConversationAgentRouter()`.
- **Contratos compartilhados:**
  - `packages/shared/src/permissions.ts` — adicionar `conversation.assign_agent` à matriz de roles (OWNER/ADMIN/SUPERVISOR; AGENT nas suas).
  - `packages/shared/src/socket-events.ts` — adicionar `conversation:agent_changed` + payload `{ conversationId, agentId, agentName }`.
- **UI (`apps/web/features/conversations/**`)** — no header/cockpit: exibir o **agente atual** (nome) e um seletor (dropdown) dos agentes elegíveis ao departamento da conversa → on change chama o endpoint. Assinar `conversation:agent_changed` para refletir troca em tempo real. Gate por `can(role, 'conversation.assign_agent')`.

## Fora de escopo

- Transferência **autônoma** (S05/S06).
- Resolução automática inicial (S03).
- Config agente↔dept (S02).

## Arquivos permitidos

- `apps/api/src/routes/conversations/agent.ts`
- `apps/api/src/app.ts`
- `packages/shared/src/permissions.ts`
- `packages/shared/src/socket-events.ts`
- `apps/web/features/conversations/**`

## Arquivos proibidos

- `apps/api/src/routes/conversations/state.ts`
- `apps/api/src/routes/conversations/messages.ts`
- `apps/api/src/routes/conversations/routing.ts`
- `apps/web/features/agents/**`
- `packages/db/**`

## Contratos de entrada/saída

- `POST /api/conversations/:id/agent { agentId }` → `{ conversationId, agentId }`.
- Evento `conversation:agent_changed { conversationId, agentId, agentName }`.
- Permissão `conversation.assign_agent`.

## Definition of Done

- [ ] Endpoint grava `agent_id`, garante `ai_mode='on'`, re-engaja e emite `conversation:agent_changed`.
- [ ] `agentId` não-elegível ao departamento da conversa → 400/422; conversa fora da visibilidade → 404.
- [ ] Cockpit mostra o agente atual e permite trocar; troca reflete via socket sem reload.
- [ ] AGENT só troca nas conversas atribuídas a ele; READONLY não vê a ação.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes; `pnpm --filter @hm/web build` verde.

## UX considerations

- UX_PRINCIPLES §2.3: a ação de trocar agente aparece no cockpit/painel sem duplicar com o header (espelho condicional já existente).
- UX_PRINCIPLES §2.7: dropdown/botão em loading durante a mutation.
- UX_PRINCIPLES §2: agente atual nomeado e visível (não só "IA on/off").
- DS v2: zero hex; tokens semânticos; componentes `@hm/ui`.

## Permission scope

- Nova permissão `conversation.assign_agent` (D4): OWNER/ADMIN/SUPERVISOR em qualquer conversa visível; AGENT só nas atribuídas a ele; READONLY nunca. Registrar em `docs/features/PERMISSIONS.md §2` (o slot pode deixar TODO de doc para a S07 consolidar).

## Notas

Espelhar o padrão de `state.ts`: relay best-effort via `hm.q.socket.relay` após a persistência commitada; `paramId` helper; `agentScopeOk` para o escopo do AGENT. O re-engajamento reusa o envelope `flow.run.requested` (tipo `INBOUND_FLOW_TYPE`) publicado em `hm.q.flows` — o worker de agentes (run.ts) resolve o `agent_id` já fixado na conversa.
