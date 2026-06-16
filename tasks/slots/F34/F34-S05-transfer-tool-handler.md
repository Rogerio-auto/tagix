---
id: F34-S05
title: Tool transfer_to_agent — handler Node + authz de alvo + re-engaje
phase: F34
status: review
priority: medium
estimated_size: M
depends_on:
  - F34-S01
blocks:
  - F34-S06
  - F34-S07
source_docs:
  - docs/features/AGENT_DEPARTMENT_ROUTING_PLAN.md
  - docs/AGENTS_LANGGRAPH.md
agent_id: backend-engineer
claimed_at: 2026-06-16T04:20:04Z
completed_at: 2026-06-16T04:24:25Z

---
# F34-S05 — Handler transfer_to_agent

## Objetivo

Implementar o lado Node da tool `transfer_to_agent`: ao ser chamada pelo runtime, validar o alvo permitido, gravar `conversations.agent_id` no agente destino, registrar o handoff e re-engajar a IA — fechando o caminho da transferência autônoma IA→IA.

## Contexto

As tools de negócio têm um registry de dispatch em `apps/api/src/internal/tools/` (`registry.ts`, `router.ts`, `workflow-handlers.ts`), com `ToolHandler(envelope, tx)` rodando dentro de `withWorkspace` (RLS). Análogo direto: `transfer_to_human` (F2-S20). A authz de alvo usa `areAgentsInSameDepartment` (repo S01). Decisão D3: transferir para pares do mesmo departamento e **escalar para outro dept quando configurado**.

## Escopo (faz)

- **`apps/api/src/internal/tools/workflow-handlers.ts`** (ou novo `agent-transfer-handlers.ts` em internal/tools) — handler `transfer_to_agent`:
  - Args: `{ targetAgentId: string, reason?: string }` (validados via Zod no boundary).
  - Authz de alvo: o agente atual (`envelope.agentId`) e o `targetAgentId` devem compartilhar ≥1 departamento (`areAgentsInSameDepartment`) **ou** o alvo atende um departamento marcado como destino de escalonamento (D3 — ler config de escalonamento; se ainda não houver flag, restringir a same-dept e deixar TODO honesto para cross-dept).
  - Efeito: grava `conversations.agent_id = targetAgentId` (sticky), registra handoff (log/evento), re-engaja enfileirando `flow.run.requested` em `hm.q.flows`.
  - Retorno `ToolHandlerResult { ok, content, action:'workflow', tableName:'conversations' }` — content é a confirmação devolvida ao modelo.
  - Registrar o handler no registry (`createDefaultRegistry`/wiring de internal/tools).
- **`apps/api/src/internal/tools/router.test.ts`** (ou test co-located) — cobrir: alvo válido same-dept → grava agent_id + enqueue; alvo de outro dept sem escalonamento → `{ ok:false }`; args inválidos → erro estável.

## Fora de escopo

- Definição da tool no runtime Python + diretriz de prompt + contexto IA→IA (S06).
- Troca manual via cockpit (S04).
- Schema/repo (S01).

## Arquivos permitidos

- `apps/api/src/internal/tools/**`

## Arquivos proibidos

- `apps/api/src/routes/**`
- `apps/agent-runtime/**`
- `packages/db/**`
- `apps/web/**`

## Contratos de entrada/saída

- Tool key: `transfer_to_agent`. Args: `{ targetAgentId, reason? }`.
- Efeito: `conversations.agent_id` ← alvo; envelope `flow.run.requested` em `hm.q.flows`.
- Consome `areAgentsInSameDepartment` (S01). **Contrato de args é a fonte da verdade para S06** (a tool Python deve casar exatamente).

## Definition of Done

- [ ] `transfer_to_agent` registrado no registry e roteável pelo router de tools.
- [ ] Alvo same-dept → grava `agent_id` + re-engaja; alvo inválido/não-elegível → `{ ok:false }` sem efeito.
- [ ] Idempotente: transferir para o agente já atual é no-op gracioso.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Permission scope

- A tool roda em nome do agente (server-to-server, token interno de runtime — `apps/api/src/internal/tools/auth.ts`), não de um membro humano. A salvaguarda é a **authz de alvo** (elegibilidade por departamento), não a matriz de roles. Não confundir com `conversation.assign_agent` (essa é da troca humana, S04).

## Notas

Modelar pelo `transfer_to_human` (F2-S20) para o shape do handler + logging. O re-engaje usa o mesmo envelope `flow.run.requested` da S04 — extrair um helper de publish se ambos precisarem (mas S04 e S05 têm files_allowed disjuntos; se um util compartilhado for necessário, ele já existe no boundary de mq — importar, não recriar). Guard anti-pingue-pongue: registrar no log o par origem→destino; o limite de iterações do agente (policy `max_iterations`) já contém loops dentro de um turno.
