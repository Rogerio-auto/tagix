# Highermind v2 — `tagix`

> Plataforma multi-tenant de atendimento ao cliente, vendas conversacionais e automação de relacionamento.
> Canais Meta nativos (WhatsApp + Instagram), agentes IA (LangGraph Python + OpenRouter), Flow Builder visual, sistema de conversões, dashboard role-aware.

---

## Status atual

**Apenas documentação.** Este commit inicial sobe a especificação completa do produto, arquitetura, schema, fases de implementação e padrões UX. O código (`apps/`, `packages/`, `infra/`) será materializado pelo `/hm-init` na fase seguinte.

```
.
├── docs/                       # ← especificação completa do v2 (este commit)
│   ├── INDEX.md                # mapa de leitura
│   ├── PRD.md                  # produto, escopo, personas
│   ├── ARCHITECTURE.md         # arquitetura técnica + ADRs
│   ├── DATA_MODEL.md           # schema Postgres + Drizzle
│   ├── AGENTS_LANGGRAPH.md     # agentes IA Python + OpenRouter
│   ├── INFRASTRUCTURE.md       # VPS + Docker + observability
│   ├── DESIGN_SYSTEM.md        # DS v2 (tokens, fontes, componentes)
│   ├── UX_PRINCIPLES.md        # princípios UX duros (anti-padrões nomeados)
│   ├── FEATURES.md             # inventário v1 → v2
│   ├── MIGRATION_NOTES.md      # armadilhas do v1
│   ├── ROADMAP.md              # F0 → F10
│   ├── features/               # 1 doc por domínio
│   │   ├── LIVECHAT.md
│   │   ├── INSTAGRAM.md
│   │   ├── FLOW_BUILDER.md
│   │   ├── CAMPAIGNS.md
│   │   ├── CALENDAR.md
│   │   ├── PIPELINE.md
│   │   ├── DASHBOARD.md        # role-aware + sistema de conversões
│   │   └── PERMISSIONS.md      # roles + 3 níveis de settings
│   ├── reuse-map/REUSE_MAP.md  # mapa v1 → v2 arquivo-por-arquivo
│   └── runbooks/               # operação
│       ├── dev-environment-wsl2.md
│       ├── claude-code-sync.md
│       ├── multi-agent-dev.md
│       └── claude-config-template/
└── (em breve)
    ├── apps/
    │   ├── api/                # Express 5 + Socket.io
    │   ├── web/                # Next.js 15 (App Router)
    │   ├── workers/            # 5 workers Node
    │   └── agent-runtime/      # Python (FastAPI + LangGraph)
    ├── packages/
    │   ├── shared/             # Zod schemas, types, permissions matrix
    │   ├── db/                 # Drizzle schema + repos
    │   ├── agents-client/      # cliente HTTP tipado
    │   ├── flow-engine/        # workflow engine custom
    │   ├── channels/           # adapters Meta WA/IG + WAHA
    │   ├── storage/            # IStorageDriver
    │   ├── ui/                 # DS v2
    │   ├── design-tokens/
    │   └── logger/
    └── infra/
        ├── docker/
        ├── nginx/
        ├── scripts/
        └── github-actions/
```

---

## Stack (resumo)

| Camada | Tecnologia |
|---|---|
| **Frontend** | Next.js 15 (App Router) + React 19 + Tailwind 4 + TanStack Query 5 + Zustand |
| **API** | Node 22 + Express 5 + Socket.io + Drizzle ORM |
| **Agent runtime** | Python 3.13 + FastAPI + LangGraph + LangServe |
| **LLM** | OpenRouter (multi-provider chat) + OpenAI (embeddings/vision/transcription) |
| **DB** | Postgres 16 + pgvector + RLS multi-tenant |
| **Cache / Lock** | Redis 7 |
| **Queue** | RabbitMQ 3.13 |
| **Storage** | Cloudflare R2 (S3-compatível) |
| **Canais** | Meta Cloud API (WhatsApp + Instagram, Tech Provider único) + WAHA |
| **Auth** | Supabase Auth atrás de `IAuthProvider` |
| **Deploy** | Docker Compose na VPS, Nginx via aaPanel |

---

## Próximos passos

1. Provisionar VPS nova (Ubuntu 24.04).
2. Registrar domínio + apontar DNS pros subdomínios.
3. Setup ambiente dev local (vide [`docs/runbooks/dev-environment-wsl2.md`](docs/runbooks/dev-environment-wsl2.md)).
4. Sincronizar config do Claude Code (vide [`docs/runbooks/claude-code-sync.md`](docs/runbooks/claude-code-sync.md)).
5. Rodar `/hm-init` com `docs/` como input → materializa estrutura `apps/` + `packages/` + `infra/` + CI.
6. Executar fase F0 do [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Padrão

World-class. Em todas as camadas. Inegociável.

Vide [`docs/PRD.md`](docs/PRD.md) §5 — Princípios de produto.

---

> Privado. Documentação interna do projeto Highermind v2 (`tagix`).
