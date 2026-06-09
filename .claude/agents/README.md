# Agentes do projeto (`.claude/agents/`)

Time de subagentes especializados do `tagix`, para desenvolvimento multi-agente
(vide `docs/runbooks/multi-agent-dev.md` e o sistema de slots em `tasks/`).

| Agente | Papel |
|---|---|
| **orchestrator** | Decompõe features em slots, despacha workers para slots paralelizáveis, monitora o board, revisa e integra. NÃO escreve código. |
| **db-engineer** | Schema Drizzle, migrations, RLS, repos, seed (`@hm/db`). |
| **backend-engineer** | Express/auth/Socket.io/workers/adapters (`apps/api`, `apps/workers`, `packages/{shared,channels,storage,logger}`). |
| **frontend-engineer** | Next.js 15 + DS v2 + UX (`apps/web`, `packages/{ui,design-tokens}`). |
| **python-engineer** | agent-runtime FastAPI + LangGraph (`apps/agent-runtime`, fase F2). |
| **qa-engineer** | Testa (unit/integration/e2e), caça edge cases. |
| **security-auditor** | Auditoria de segurança (RLS, secrets, authz, webhooks, crypto). |

## Como funciona

Cada arquivo é uma definição de subagente do Claude Code (frontmatter `name`/`description`/`tools` + system prompt com as convenções e gotchas do projeto). Ficam disponíveis como `subagent_type` em **sessões novas** (carregam no startup).

Fluxo típico: o **orchestrator** lê uma feature, decompõe em slots (`/hm-tasks`), escolhe um lote sem overlap de `files_allowed` (`slot.py plan-batch`), despacha um engineer por slot, e integra (validar → merge → `slot.py done`). Paralelizável = pacotes/paths diferentes; schema (`@hm/db`) é sequencial entre si.

> Os labels de especialista no `tasks/slot.config.json` (`specialists.patterns`) batem com estes nomes — `slot.py brief <id>` sugere o agente certo por path.
