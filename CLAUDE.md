# CLAUDE.md — tagix (Highermind v2)

Plataforma multi-tenant de atendimento, vendas conversacionais e automação.
Canais Meta (WhatsApp + Instagram) + WAHA, agentes IA (LangGraph Python + OpenRouter),
Flow Builder, conversões, dashboard role-aware. **Padrão world-class, inegociável.**

## Ambiente

- Dev **nativo no Windows** — terminal é **PowerShell** (`$env:VAR`, `Get-ChildItem`, `.ps1`). Nunca bash para a máquina local.
- Toolchain: Node 22+ (via `fnm`), pnpm (global via npm), Python 3.13 (via `uv`), Docker Desktop.
- Setup completo: `docs/runbooks/dev-environment-windows.md`.
- **Produção é Linux** (VPS Ubuntu) — comando que roda no servidor é bash; só esse contexto.

## Monorepo (pnpm workspaces)

```
apps/
  api/            @hm/api      — Express 5 + Socket.io (Node)
  web/            @hm/web      — Next.js 15 App Router + React 19 (scaffold real em F0-S10)
  workers/        @hm/workers  — 5 workers + scheduler (Node)
  agent-runtime/  Python       — FastAPI + LangGraph + OpenRouter (roda com uv; F2)
packages/
  shared/ db/ logger/ storage/ channels/ flow-engine/ agents-client/ ui/ design-tokens/
infra/docker/     — docker-compose.dev.yml (Postgres pgvector + Redis + RabbitMQ + WAHA)
docs/             — especificação completa (PRD, ARCHITECTURE, DATA_MODEL, features, ROADMAP)
```

## Comandos

```powershell
pnpm install
pnpm typecheck          # tsc --noEmit em todos os projetos TS
pnpm lint               # eslint flat, zero `any`
pnpm format             # prettier --write
docker compose -f infra/docker/docker-compose.dev.yml up -d   # infra (requer Docker Desktop)
```

## Decisões travadas

Os ADRs estão em `docs/INDEX.md` (não re-perguntar): TS strict end-to-end, Drizzle ORM,
Postgres self-hosted + RLS multi-tenant, OpenRouter como roteador LLM único, LangGraph
(agentes) vs flow-engine custom (flows determinísticos), Supabase Auth atrás de
`IAuthProvider`, DS v2 dark-first. Termos do produto e antipadrões: `docs/INDEX.md`.

## Padrão

- TypeScript strict, **zero `any`** (use `unknown` + Zod). Sem dívida desde o init.
- Segurança é fundação: RLS desde o schema, validação Zod em toda input externa, secrets só em `.env` (nunca commitado).
- Performance é restrição de design (índices PG planejados, caching seletivo).
- DS v2 nativo: nenhum hex hardcoded em JSX; tokens semânticos de `@hm/design-tokens`.
- Testes acompanham o código (Vitest unit/integration, Playwright e2e).

## Sistema de tasks

- `tasks/PROTOCOL.md` é lei. `tasks/STATUS.md` é o board (view derivada — NUNCA edite à mão).
- Slots em `tasks/slots/F<n>/`. Use `python scripts/slot.py` para tudo (claim/validate/finish/sync).
- NUNCA `git checkout -b` manual — `slot.py claim` cria a branch canônica `feat/<slot-id>`.
- `files_allowed` do slot é fronteira sagrada. Decompor specs em slots: skill `/hm-tasks`.
- Roadmap de fases (F0→F10): `docs/ROADMAP.md`. F0-S01 (fundação) = done.
