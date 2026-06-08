# Highermind v2 — Documentação de Reescrita

> **Status:** Especificação para `/hm-init` · 2026-06-06
> **Autoria:** Síntese de 6 explorações profundas do monorepo legado `livechat-monorepo`
> **Alvo:** Reescrita do zero, world-class, com foco em qualidade de código, arquitetura limpa e novo Design System v2

---

## Sumário executivo (1 página)

O projeto legado (`livechat-monorepo`) é um sistema multi-tenant de atendimento ao cliente com WhatsApp (Meta Cloud API + WAHA), agentes IA, Flow Builder visual, campanhas, agenda e pipeline. Foi construído com vibe-coding e acumulou dívida estrutural significativa: 47+ migrations SQL + 30+ ad-hoc sem disciplina, dois sistemas de tema coexistindo no frontend, ToastContainer duplicado, dupla estrutura de kanban (`kanban_columns` legacy vs `project_stages` novo), framework "tipo LangChain feito à mão" para agentes IA, cache matrix de 16+ keys por chat, `interactive_content: Record<string, any>`, e muito mais.

**O v2 herda os conceitos que funcionam, abandona a implementação.** É um rebuild com:
- Postgres self-hosted + Drizzle ORM (sai do Supabase como DAL primária)
- LangGraph.js para agentes IA (substitui o runtime custom)
- **OpenRouter como roteador de LLM** (provider único de chat completion; embeddings continuam OpenAI direto). Gerenciado por super-admin (whitelist de modelos, caps por plano/workspace).
- **Canais Meta de primeira classe (WhatsApp + Instagram)**, com Highermind atuando como **Tech Provider único** sob um mesmo Meta App. WhatsApp implementado no MVP; Instagram com fundamentos prontos (schema, adapter interface, webhook unificado) desde o MVP e implementação completa logo após (fase F1.5: DMs, story mentions/replies, comments com private reply).
- Cloudflare R2 (ou compatível S3) para storage de mídia (driver abstrato)
- Design System v2 nativo desde o primeiro commit (verde-neon `#1FFF13`, Rajdhani/Chakra Petch/Orbitron/Manrope, dark-first)
- Feature-folders no frontend
- Workflow engine custom (mantido) — não é função do LangGraph
- Multi-tenant com RLS desde o início
- Billing via feature flag (off no MVP)

Este pacote é **input para `/hm-init`**, não para implementação imediata. Rogério revisa, ajusta, e usa para bootstrappar o projeto novo num diretório separado.

---

## Decisões de arquitetura travadas (não pedir confirmação)

| Categoria | Decisão | Por quê |
|---|---|---|
| **Linguagem** | TypeScript strict mode end-to-end | Padrão do CLAUDE.md global; consistência com agentes IA via LangGraph.js |
| **Runtime** | Node.js 22 LTS | Estabilidade, performance (V8 atualizado) |
| **Package manager** | pnpm | Workspace nativo + melhor que npm para monorepo |
| **DB** | Postgres self-hosted na VPS + Drizzle ORM | Decisão explícita do Rogério; Drizzle é o melhor ORM TS atual (type-safety end-to-end, migrations versionadas, schema-first) |
| **DB abstração** | Repository pattern com Drizzle queries; nenhuma chamada Supabase JS no backend | Modular para migrar para Supabase no futuro sem refazer DAL |
| **Storage** | Cloudflare R2 (S3-compatible) + driver abstrato `IStorageDriver` | Não acumula mídia na VPS; R2 é o melhor S3-compatível barato (sem egress) |
| **Cache + Locks** | Redis (ioredis) — mesmo padrão do v1 | Funciona, manter |
| **Message Queue** | RabbitMQ (amqplib) — mesmo padrão do v1 | Topologia atual é boa, replicar com nomes consistentes |
| **HTTP framework** | Express 5 | Estável, ecossistema; Fastify avaliado mas Express é incumbente sólido |
| **Real-time** | Socket.io + Redis adapter | Padrão consolidado |
| **Auth** | Supabase Auth como provider, atrás de interface abstrata `IAuthProvider` | Permite trocar por Better-auth/Lucia depois; MVP usa Supabase Auth porque é grátis e estável |
| **Validação** | Zod v4 + schemas em `packages/shared/` | Padrão TS, validation in/out, usado no Drizzle e em rotas |
| **Agentes IA** | LangGraph.js com PostgresCheckpointer | Substitui runtime custom; nativo para state graph, streaming, interrupt, human-in-the-loop |
| **LLM provider** | **OpenRouter** como roteador único de chat completion (multi-model: OpenAI, Anthropic, Google, etc.) atrás de `ILLMProvider`. Gerenciado por super-admin (api key da plataforma, whitelist de modelos, caps de custo por plano/workspace) | Decisão explícita do Rogério; um único contrato/billing/observability cobre todos os modelos; troca de modelo sem mudança de código; OpenAI direto fica reservado para embeddings/transcription/vision (OpenRouter não roteia esses) |
| **Embeddings/RAG** | pgvector + OpenAI `text-embedding-3-small` direto (OpenRouter não cobre embeddings) | v1 não tem embeddings, só FTS; v2 começa com vetores |
| **Flow Builder engine** | Custom (mantido como conceito, reescrito limpo) | Não é workflow agentic; LangGraph seria overkill. Engine fica em `src/flow-engine/` |
| **Frontend** | **Next.js 15+ (App Router) + React 19 + Tailwind 4 + TanStack Query 5** — rodando em container Docker (`output: 'standalone'`) na **VPS unificada**, atrás do Nginx. Server Components por default; `'use client'` apenas onde há estado, socket, drag-and-drop ou animação | Decisão explícita do Rogério. App Router + Server Components reduz bundle inicial, permite streaming HTML, e o file-based routing substitui React Router. Deploy junto com o resto na VPS (sem Vercel) mantém um lugar só pra monitorar/escalar |
| **State global** | Zustand para auth/theme/subscription + TanStack Query para remote | Reduz 6 contextos aninhados |
| **Forms** | React Hook Form + Zod (`@hookform/resolvers/zod`) | Substitui `useFormValidation` manual do v1 |
| **Design System** | DS v2 (Rajdhani/Chakra Petch/Orbitron/Manrope + tokens semânticos + verde-neon escasso no produto) | Já especificado em `docs/design-system/` do v1; v2 nasce com ele |
| **Tema** | `data-theme="dark|light"` (default dark) — NUNCA classe `.dark` | Limpa, sem coexistência com legado |
| **Animação** | Motion One (substitui Framer Motion) | Lighter (<5kb), API moderna, suficiente |
| **Storybook** | Ladle (não Storybook) | 10× mais rápido, basta para documentar primitives |
| **Estrutura frontend** | Feature-folders (`features/<domain>/{pages,components,hooks,services,types,queries}.ts`) | Substitui a estrutura `pages/components/hooks` por domínio |
| **Multi-tenancy** | Postgres RLS sobre `company_id` desde o primeiro migration + filtering explícito como cinto-e-suspensório | Crítico para um SaaS world-class |
| **Encryption at rest** | AES-256-GCM (mantido como conceito do v1) | Sound; replicar `lib/crypto.ts` com versionamento de key |
| **Billing** | Stripe atrás de feature flag (`BILLING_ENABLED=false` no MVP) | MVP funciona sem; ativa quando o produto for vender |
| **Workers** | 5 workers especializados (inbound, outbound, media, campaigns, flows) + scheduler in-process | Reflete v1, decompõe bem por carga |
| **Deploy MVP** | Docker Compose na VPS atual + nginx via aaPanel | Já funciona; trocar pra K8s só quando crescer |
| **Logging** | Pino (estruturado) com PII masking | Substitui logger custom do v1 |
| **Observability** | OpenTelemetry pronto desde dia 1, com Sentry opcional | World-class. Mesmo sem servidor APM imediato, instrumentação fica |
| **Testes** | Vitest (unit) + Vitest com supertest (integration) + Playwright (e2e) | Stack já provada |
| **CI** | GitHub Actions (mantém) | Push a `main` bloqueado via branch protection + git hook local |

---

## Mapa do pacote

Cada arquivo abaixo é denso e independente. Ler na ordem recomendada para `/hm-init`.

### Núcleo (ler primeiro)

| # | Arquivo | Propósito |
|---|---|---|
| 1 | [`PRD.md`](./PRD.md) | Produto, visão, personas, escopo do v2, métricas de sucesso |
| 2 | [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Arquitetura técnica completa do v2 (diagramas, decisões, trade-offs) |
| 3 | [`DATA_MODEL.md`](./DATA_MODEL.md) | Schema Postgres + Drizzle do v2 (todas as tabelas, índices, RLS) |
| 4 | [`AGENTS_LANGGRAPH.md`](./AGENTS_LANGGRAPH.md) | Design do sistema de agentes IA em LangGraph.js |
| 5 | [`INFRASTRUCTURE.md`](./INFRASTRUCTURE.md) | RabbitMQ, Redis, R2, workers, scheduler, deploy, observability |
| 6 | [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) | DS v2, tokens, fontes, componentes, estrutura frontend |
| 6a | [`UX_PRINCIPLES.md`](./UX_PRINCIPLES.md) | Princípios UX inegociáveis. Anti-padrões nomeados do v1 (gear-only, drag-text-overlap, full-screen modal). Aplicado por `/hm-tasks` e `/hm-designer` |

### Features (1 arquivo por domínio)

| # | Arquivo | Domínio |
|---|---|---|
| 7 | [`features/LIVECHAT.md`](./features/LIVECHAT.md) | Inbox, sessions, mensagens, providers Meta WhatsApp + Meta Instagram + WAHA, real-time |
| 8 | [`features/INSTAGRAM.md`](./features/INSTAGRAM.md) | Instagram Messaging (DMs, story mentions/replies, comments) via Meta Tech Provider |
| 9 | [`features/FLOW_BUILDER.md`](./features/FLOW_BUILDER.md) | Engine de execução, 14 handlers, ReactFlow editor |
| 10 | [`features/CAMPAIGNS.md`](./features/CAMPAIGNS.md) | Broadcast/drip/triggered, send windows, opt-in LGPD, safety |
| 11 | [`features/CALENDAR.md`](./features/CALENDAR.md) | Agenda, slots, tools para agente, integrações externas |
| 12 | [`features/PIPELINE.md`](./features/PIPELINE.md) | Funil unificado, stage automation, event sourcing |
| 13 | [`features/DASHBOARD.md`](./features/DASHBOARD.md) | Dashboard role-aware (5 dashboards) + sistema de conversões (lacuna do v1) |
| 14 | [`features/PERMISSIONS.md`](./features/PERMISSIONS.md) | Roles, matriz de permissões, 3 níveis de configuração (pessoal/workspace/plataforma) |

### Migração / decisões

| # | Arquivo | Propósito |
|---|---|---|
| 13 | [`FEATURES.md`](./FEATURES.md) | Inventário completo: o que reusar / reescrever / descartar |
| 14 | [`reuse-map/REUSE_MAP.md`](./reuse-map/REUSE_MAP.md) | Mapa arquivo-por-arquivo do v1 → destino no v2 |
| 15 | [`MIGRATION_NOTES.md`](./MIGRATION_NOTES.md) | Armadilhas do v1 a NÃO repetir (catalogadas) |
| 16 | [`ROADMAP.md`](./ROADMAP.md) | Fases de execução sugeridas (F0 → F10) |

---

## Princípios inegociáveis do v2

1. **Padrão world-class em todas as camadas.** Toda escolha técnica é a melhor disponível, não a popular. Se alguém auditar o código pra comprar, não deve achar nada pra ter vergonha.
2. **Segurança desde o primeiro commit.** RLS, encryption at rest, secrets em vault, validação Zod em toda input externa, rate limit em webhook público.
3. **TypeScript strict, zero `any`.** Quando o tipo for genuinamente desconhecido, `unknown` + parse Zod. Nunca `any`, nunca `as` para suprimir tipo.
4. **Sem dívida técnica desde o início.** Quando achar que está "deixando pra depois", parar e tratar agora. O legado nasceu disso.
5. **Performance é restrição de design, não fase de otimização.** Índices PG planejados desde o schema, caching seletivo (não amplo), workers desacoplados.
6. **DS v2 nativo.** Nenhuma tela vai pro repo sem usar tokens semânticos. Nenhum hex hardcoded em JSX.
7. **Testes acompanham o código.** Unit em service/lib, integration em rota, e2e em fluxo crítico. Não shipar feature sem teste de feliz path.
8. **Documentação viva.** PRD, ADRs em `docs/decisions/`, runbooks operacionais, API spec em OpenAPI.

---

## O que **NÃO** está no escopo do v2 (MVP)

Para evitar reaprender as lições erradas:

- **Cadastro e Landing** ficam para fase 2 (após core estabilizado). MVP é o produto autenticado (LiveChat + admin + features adjacentes).
- **Stripe billing ativo** — fica atrás de flag. MVP não cobra.
- **Mobile app nativo (PWA pode entrar)** — depois.
- **Multi-region deploy** — depois (single-VPS Brasil é suficiente).
- **Google Calendar / Outlook sync** — depois (calendar interno é v2.0; sync é v2.1).
- **Document templates / Orçamento / Proposta** — provavelmente fora do MVP. Confirmar com Rogério na revisão deste pacote (ver `FEATURES.md` §3).
- **Páginas órfãs do v1** (admin.tsx vazio, AutomationRulesPage duplicada, etc.) — não migrar.

---

## Termos a evitar no v2

- "Contact" vs "Customer" — escolher **`contact`** uniformemente (é mais correto: a entidade é o ser humano sendo contatado).
- "Lead" vs "Customer" — `contact` é a pessoa; `lead` é um estágio do funil sobre essa pessoa. Sem dupla representação.
- "Inbox" vs "Channel" — usar **`channel`** (mais geral, cobre WhatsApp, Instagram e canais futuros).
- "kanban_colum_id" — bug histórico de typo. No v2: `pipeline_stage_id`.
- "AI" como status de chat — substituir por `ai_mode: 'on' | 'off'` boolean ortogonal ao status.
- "Meta Cloud API" — termo legado; canais Meta agora têm provider explícito (`meta_whatsapp`, `meta_instagram`). Em prosa, dizer "WhatsApp Cloud API" e "Instagram Messaging API" para desambiguar.
- "OpenAI" como sinônimo de LLM — o provider de chat completion é **OpenRouter** (roteador); modelos OpenAI são uma opção entre várias.

---

## Glossário do produto v2

| Termo | Definição |
|---|---|
| **Workspace** | Tenant (substitui "company" para evitar confusão com customer business) |
| **Member** | Usuário interno de um workspace (substitui "user" no contexto de funcionário) |
| **Channel** | Inbox de mensageria (WhatsApp Cloud via Meta, Instagram Messaging via Meta, WAHA, etc.) |
| **Provider** | Identidade técnica do canal: `meta_whatsapp`, `meta_instagram`, `waha` |
| **Tech Provider** | Postura do Highermind no Meta App Dashboard: app autorizado a conectar contas de terceiros para WhatsApp e Instagram |
| **LLM router** | OpenRouter — serviço único de roteamento de chat completion para múltiplos modelos (OpenAI/Anthropic/Google/etc.) |
| **Contact** | Pessoa sendo atendida (substitui "customer" e "lead") |
| **Conversation** | Thread de mensagens entre Contact e Workspace (substitui "chat") |
| **Pipeline** | Funil de vendas/atendimento (substitui "kanban_board") |
| **Stage** | Coluna do pipeline (substitui "kanban_column") |
| **Deal** | Card no pipeline com valor financeiro (novo conceito, antes era "card" genérico) |
| **Flow** | Automação visual disparada por evento |
| **Agent** | Bot de IA configurável (mantém termo) |
| **Tool** | Função invocável por Agent (mantém termo) |
| **Campaign** | Disparo massivo ou cadência automatizada |
| **Event** | Compromisso na agenda (calendar) |

---

## Próximos passos após revisão deste pacote

1. Rogério revisa todos os 15 arquivos. Anota o que falta, o que está errado.
2. Iteração: ajustes nos docs conforme feedback.
3. Quando aprovado, zipa a pasta `highermind-v2/docs/` e usa como input no `/hm-init` num diretório separado.
4. `/hm-init` materializa a estrutura, instala dependências, configura CI/CD.
5. Trabalho começa pela fase F0 do `ROADMAP.md` (fundação).

---

> **Lembrete:** Este pacote é **especificação de design**, não código pronto. Decisões aqui são para guiar a implementação, não para serem importadas como bibliotecas.
