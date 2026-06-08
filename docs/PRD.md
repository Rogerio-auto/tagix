# PRD — Highermind v2

> **Documento:** Product Requirements Document
> **Versão:** 0.1 (draft inicial para revisão)
> **Data:** 2026-06-06

---

## 1. Visão de produto

**Highermind v2** é uma plataforma multi-tenant de atendimento ao cliente, vendas conversacionais e automação de relacionamento. **WhatsApp (Meta Cloud API)** e **Instagram (Meta Messaging API)** são canais oficiais nativos, com Highermind atuando como **Tech Provider único da Meta** (um Meta App para ambos os produtos, Embedded Signup unificado). **WAHA** está disponível como canal não-oficial para casos específicos. Agentes IA usam **LangGraph.js** com **OpenRouter** como roteador único de modelos (multi-LLM atrás de uma interface; OpenAI/Anthropic/Google/etc.), e Flow Builder visual automatiza conversas determinísticas.

O produto serve **PMEs e equipes de vendas/atendimento** que precisam:
- Centralizar conversas de múltiplos canais (WhatsApp + Instagram DM + WAHA) e múltiplos atendentes
- Automatizar respostas e qualificação de leads com IA (modelos via OpenRouter, escolha por workspace dentro da whitelist do super-admin)
- Disparar campanhas de WhatsApp em conformidade com Meta + LGPD
- Receber e atender comentários e menções em stories do Instagram como parte da inbox (após F1.5)
- Acompanhar um pipeline de vendas/atendimento integrado às conversas
- Agendar reuniões via agente IA sem fricção

A diferença em relação ao v1 não é o que ele faz, é **como ele faz**: arquitetura limpa, segurança desde o primeiro commit, performance como restrição de design, UI inspirada em Apple/Airbnb/Linear/Stripe/Vercel, e identidade visual diferenciada (verde-neon `#1FFF13`, tipografia editorial, dark-first).

---

## 2. Por que reescrever do zero

O legado (`livechat-monorepo`) acumulou dívida significativa que torna a evolução lenta:

| Sintoma | Causa raiz |
|---|---|
| 47 migrations SQL + 30 ad-hoc + scripts `check_*.ts` em `src/` | Sem disciplina de migração; cada bug virou novo SQL |
| Cache matrix de 16+ keys por chat, com invalidação manual | Concept correto mas implementação espalhada em `store.service.ts` (1000+ linhas) |
| Framework agentes "tipo LangChain" feito à mão (702 linhas em `agents-runtime.service.ts`) | Reinventou state graph manual; sem checkpoint, sem streaming, sem human-in-the-loop |
| Dois sistemas de tema em paralelo (`livechat-theme` legacy + DS v2) | DS v2 só existe em HTML showcase, nunca foi integrado ao código |
| Dupla estrutura de pipeline (`kanban_columns` vs `project_stages`) | Tentativa de upgrade sem migrar a velha |
| `interactive_content: Record<string, any>` em `chat_messages` | TODO documentado em `FX-023d`, nunca tipado |
| Bug histórico `kanban_colum_id` (typo) que virou nullable em vez de ser renomeado | Patches por cima de patches |
| Cadastro/Landing como apps Vite separados sem necessidade | Decomposição prematura |
| 6 contextos React aninhados, 6 hooks de socket diferentes | Crescimento orgânico sem refator |
| `useFormValidation` manual em vez de React Hook Form | Não adotou ferramentas padrão |
| Supabase como DAL primária + Postgres direto via `pg.Pool` ao lado | Dois caminhos para o mesmo dado |
| ToastContainer duplicado em 2 lugares | Refactor parado no meio |

Refatorar tudo isso custa mais do que reescrever com o aprendizado em mãos. O v2 não é uma rebrand — é o produto certo, feito da forma certa, com a identidade visual nova.

---

## 3. Escopo do MVP

### 3.1 In scope (essencial para shippar v2.0)

**Autenticação & multi-tenancy**
- Login por email/senha (Supabase Auth)
- Recuperação de senha
- Convite de membro para workspace
- Roles: `OWNER`, `ADMIN`, `AGENT`, `SUPERVISOR`, `READONLY` (5 roles, simplifica os 6 do v1)
- RLS por `workspace_id` em todas as tabelas

**LiveChat (núcleo)**
- Conexão de canais via Embedded Signup unificado:
  - **WhatsApp Cloud (Meta)** — produção, completo no MVP
  - **Instagram Messaging (Meta)** — schema, naming, adapter interface e webhook unificado prontos no MVP (provider = `meta_instagram`); implementação completa do adapter em fase F1.5 (DMs, story mentions/replies, comments com private reply)
  - **WAHA** — canal não-oficial mantido para casos legados
- Inbox unificada por canal + filtros (status, atribuído, departamento, **provider**)
- Conversa em tempo real (texto, mídia, áudio, vídeo, documento, sticker, interactive buttons/list, templates Meta WA)
- Janela 24h Meta com lock de composer + CTA template (mantém FX-011 do v1). Em Instagram a janela tem regra própria — composer permite `HUMAN_AGENT` tag dentro de 7 dias da última inbound, e bloqueia totalmente após
- Mentions (`@membro`) em notas internas
- Atribuição manual e auto-assign por departamento/time
- Read receipts, typing/recording presence
- Transferência entre departamentos com audit trail

**Agentes IA (LangGraph Python + OpenRouter)**
- **Runtime de agentes em Python** como microsserviço dedicado (container `agent-runtime`: FastAPI + LangGraph Python + LangServe). Decisão consciente: o ecossistema Python para agentes (LangGraph, LangSmith, ferramentas de avaliação, tracing nativo, integrações nativas com mais providers) está significativamente mais maduro que o JS. Node continua dono de API/workers/UI; agent runtime é chamado via HTTP interno (token compartilhado).
- LLM via **OpenRouter** como roteador único de chat completion (single contract para OpenAI/Anthropic/Google/etc.). Embeddings, transcription e vision continuam com OpenAI direto (OpenRouter não cobre).
- Templates pré-existentes (5 do v1: sales, reception, support, first_touch, follow_up) + facilidade de criar custom
- Configuração por agente: **modelo via slug OpenRouter** (`openai/gpt-4o-mini`, `anthropic/claude-3.5-sonnet`, `google/gemini-2.5-pro`, etc.), system prompt, tools habilitadas, knowledge base, params
- Tool calling com 4 categorias: `DATABASE`, `HTTP`, `WORKFLOW`, `CALENDAR` (+ `KNOWLEDGE` para RAG). Tools "leves" rodam em Python (acesso a DB com workspace context); tools "pesadas de negócio" (trigger_flow, schedule_event, transfer_to_human) são callbacks HTTP para o API Node, que continua sendo o source-of-truth.
- Column-level access control em tools que tocam DB (do v1, mantido)
- Auto follow-up por inatividade (`reply_if_idle_sec`)
- Playground isolado para testar agente (com troca de modelo on-the-fly dentro da whitelist do plano)
- **Cost tracking detalhado por modelo + por provider real consumido (via `openrouter_generation_id`)**. Roll-up em `llm_usage_logs` e `agent_metrics`.
- Knowledge base com RAG (pgvector + chunking + reranker simples; embeddings via OpenAI direto)

**Super-admin de IA (controle granular por workspace)**

O painel de plataforma (super-admin) gerencia, por workspace:
- **Whitelist de modelos OpenRouter** permitidos (default herda do `plan.features`)
- **Funcionalidades LangGraph habilitadas:** streaming, interrupts (human-in-the-loop), parallel tool execution, vision (gpt-4o-vision e equivalentes), transcription (Whisper), checkpoints persistentes
- **Limites operacionais:** `max_iterations` (loop de tool calls), `max_tools_per_agent`, `max_tokens_per_call`, `max_monthly_cost_usd`
- **Whitelist de categorias de tools** (ex: bloquear `http` para workspace que não deve fazer webhook saintes)
- **API key OpenRouter da plataforma** (cifrada em `platform_secrets`, rotacionável)
- **Auditoria:** todos os usos de modelos e gastos são visíveis no painel super-admin com filtro por workspace, modelo, período

**Flow Builder**
- Editor visual (ReactFlow / `@xyflow/react`)
- 14 node types do v1 (trigger, message, interactive, wait, wait_for_response, condition, switch, ai_action, add_tag, move_stage, change_status, http_request, external_notify, meta_flow)
- Triggers: STAGE_CHANGE, TAG_ADDED, KEYWORD, NEW_LEAD, NEW_MESSAGE, SYSTEM_EVENT, FLOW_SUBMISSION, MANUAL
- Estados de execução: RUNNING, WAITING, COMPLETED, FAILED, CANCELLED
- Versionamento de flow (snapshot ao publicar)
- Manual flows disparáveis pelo chat (quickbar)
- Indicador de execução ativa na ChatList + ChatHeader (do FX-031c/d)

**Pipeline (Funil unificado)**
- Estrutura única `pipelines` + `stages` + `deals` (resolve dupla estrutura do v1)
- Stage tem `automation_rules` (JSONB) que dispara Flow Builder ao entrar/sair
- Transition rules: required_fields + required_role + requires_approval
- Cards (deals) com valor financeiro, owner, source, tags
- Mídia em deals com EXIF/GPS (do v1, melhorado)
- Relacionamento `deal ↔ contact ↔ conversation` com history audit
- Drag-and-drop com optimistic update + sync server

**Campanhas**
- Broadcast, drip, triggered
- Send windows com timezone + horário comercial
- Opt-in LGPD obrigatório para templates MARKETING (com bulk opt-in via fonte)
- Opt-out automático por keyword (STOP, PARAR, SAIR, CANCELAR)
- Validação pré-ativação (Meta tier, quality rating, template approved, opt-in completo)
- Rate limit conservador adaptativo (reduz com quality YELLOW, pausa em RED)
- Métricas em tempo real (delivery rate, read rate, response rate, block rate)
- Follow-up automático com cadência configurável

**Agendamentos (Calendar)**
- Calendários: pessoais e de workspace
- Regras de disponibilidade (por dia da semana, com exceções)
- Cálculo de slots disponíveis (replica `compute_available_slots` PL/pgSQL do v1)
- Eventos com participantes
- Tools para agente IA: `list_calendars`, `get_available_slots`, `schedule_event`
- Notificações de lembrete

**Knowledge Base**
- Upload de markdown/texto (limite generoso, ex: 5MB/doc)
- Chunking automático (semantic, ~500 tokens com overlap 50)
- Embedding via OpenAI `text-embedding-3-small`
- Vector search via pgvector + ranking por priority/usage_count
- Tool `search_knowledge_base` para agentes
- Feedback útil/não útil para retreino futuro

**Workspace admin**
- Gerenciamento de membros
- Departamentos, times
- Canais (channels) conectados
- Configuração de agentes IA
- Configuração de horário comercial
- Configuração de auto-assign
- Logs de tools executadas
- Logs de mensagens enviadas (campaign deliveries)

**Adaptação por nicho (vertical-aware seeds)**

- `workspaces.industry` com valores canônicos sugeridos: `digital_marketing`, `office_services`, `real_estate`, `clinic`, `law_firm`.
- Catálogo global (super-admin) de **agent templates por nicho**: variantes de prompts otimizadas para cada vertical (ex: `sales` genérico + `sales_real_estate` que sabe sobre proposta, visita, escritura).
- Catálogo global de **pipeline templates por nicho** (`pipelines` + `stages` seed):
  - Imobiliária: lead → visita → proposta → contrato → escritura
  - Advocacia: lead → diagnóstico → contrato → processo em andamento → encerramento
  - Clínica: lead → agendamento → consulta → tratamento → alta/retorno
  - Mercado digital (agência): lead → diagnóstico → proposta → onboarding → execução → retainer
  - Escritório (contabilidade/consultoria): lead → diagnóstico → proposta → contrato → execução recorrente
- Onboarding sugere pipeline + agentes ao escolher o nicho. Workspace pode editar ou criar do zero.
- MVP entrega 1–2 nichos com templates polidos (ordem provável: imobiliária + clínica). Demais entram em expansão pós-MVP sem mudança de schema.

**Plataforma admin** (super-admin)
- Lista de workspaces + métricas
- Dashboard de infraestrutura (Redis, RabbitMQ, Postgres, Workers, **agent-runtime Python**)
- Templates de agente globais
- Templates de pipeline globais (por indústria)
- Audit logs
- **Gestão de IA (OpenRouter + LangGraph) por workspace** — whitelist de modelos, features LangGraph habilitadas, caps de custo/iteration/tokens, categorias de tools permitidas
- **Secrets da plataforma** — API key OpenRouter, Meta App ID/Secret (compartilhados WA+IG), rotação de chaves de criptografia
- **Whitelist global de modelos OpenRouter** disponíveis para escolha (sincronizada periodicamente com a API `/api/v1/models` da OpenRouter; super-admin marca quais entram no catálogo da plataforma)

**API pública**
- `/api/v1/*` com auth via API key
- Endpoints: send_message, send_template, upsert_contact, trigger_flow, list_conversations, get_conversation, webhook_subscriptions
- Rate limit por API key + por workspace
- Webhook outbound para eventos (message.received, message.sent, contact.created, deal.stage_changed)
- HMAC signature em webhooks outbound

### 3.2 Out of scope no MVP (fica pra fase 2+)

- **Landing page institucional** — fora. Quando precisar, sobe como rotas em `app/(public)/` no mesmo Next.js (mesmo deploy) ou app separado, conforme custo de manter.
- **Cadastro/Onboarding multi-step wizard** — fora. MVP usa Supabase Auth direto + setup mínimo inline.
- **Stripe billing** — schema preparado, feature flag `BILLING_ENABLED=false` no MVP.
- **Documentos / Orçamentos / Propostas / Templates DOCX** — fora do MVP. Era um upsell vertical (energia solar) no v1.
- **Produtos / Galeria / Catalog** — fora. Pipeline cobre a necessidade primária.
- **Tarefas (Tasks)** — ❌ fora do MVP por completo (vide §3.3 #1). Não vira módulo nem `deal_tasks`.
- **Mobile PWA** — fase 2 (após desktop web estabilizar).
- **Integração Google Calendar / Outlook** — fase 2.
- **Implementação completa do adapter Instagram** — fundamentos (schema, naming, webhook unificado, interface IChannelAdapter, UI placeholders) prontos no MVP. Implementação real (parser, sender, comments, stories, App Review Meta) na fase **F1.5**, logo após o MVP, antes do disparo comercial pleno. Telegram e Email continuam fase 2.
- **Multi-region deploy** — fase 3 (single-VPS Brasil é suficiente para MVP).
- **Human-in-the-loop interrupts em agentes** — runtime Python suporta nativamente, mas o controle via super-admin entra como flag desligada por default no MVP; UI completa de aprovação fica para fase 2.

### 3.3 Decisões fechadas (revisão Rogério)

Itens que estavam ambíguos no v2 foram resolvidos:

1. **Sistema de Tarefas** — ❌ **Descartado por completo no MVP** (nem módulo independente, nem sub-recurso de deal). Tabela `deal_tasks` removida do schema. Se voltar à pauta, reabre como novo módulo, não como remendo.
2. **Sistema de Projects (`046_create_projects_system.sql` do v1)** — ❌ **Descartado**. Conceito de templates por indústria sobrevive, mas via `agent_templates.industry` e `pipelines.industry` (já existem no schema), não via Projects.
3. **Document Templates DOCX (`041_COMPLETE_document_templates_system.sql`)** — ❌ **Descartado no v2 como estava**. Geração de documento será reabordada em fase futura com estratégia diferente (provavelmente LLM-driven, não DOCX templating).
4. **Adaptação por nicho de empresa** — ✅ **Sim, é objetivo de produto**. Nichos-alvo do Highermind v2: **mercado digital** (agências, SaaS, infoprodutores), **escritórios** (contabilidade, consultoria), **imobiliárias**, **clínicas** (médica, odontológica, estética) e **advocacias**. Isso substitui o foco vertical "solar/construção" do v1. Implicações:
   - `workspaces.industry` ganha valores canônicos sugeridos: `digital_marketing`, `office_services`, `real_estate`, `clinic`, `law_firm` (free text aceito mas UI sugere os cinco).
   - Catálogo global de `agent_templates` ganha variantes por nicho (ex: `sales` genérico + `sales_real_estate`, `sales_law_firm`, `support_clinic`).
   - Catálogo global de `pipelines` + `stages` ganha templates por nicho (ex: imobiliária = lead/visita/proposta/contrato/escritura; advocacia = lead/diagnóstico/contrato/processo/encerramento; clínica = lead/agendamento/consulta/tratamento/alta).
   - Seed inicial entrega 1–2 nichos no MVP; demais entram em fase de expansão (sem mudança de schema).
5. **Mentions em mensagens normais (não só em notas)** — ❌ Não entra. **Sim mantém mentions em notas internas** (`conversation_notes.mentions[]`, como já planejado). Sem mentions em mensagens enviadas a contact.
6. **Galeria de produtos** — ❌ **Descartada do MVP** (e provavelmente sempre — não está alinhada com os nichos-alvo, que são de serviço, não de produto físico).
7. **Notification preferences granulares** — ❌ **Não no MVP**. Só padrão global de notificações. Granularidade entra em fase posterior se demanda real aparecer.

---

## 4. Personas

### 4.1 Rogério (Founder/CTO) — usuário primário do produto e do código

- Constrói. Vê em décadas. Não escreve código, mas o padrão dele é o padrão do projeto.
- Quer o produto **inegociavelmente bom** em todas as camadas.
- Vai usar Highermind para os próprios projetos (pessoais) e para clientes (entrega no ambiente do cliente).
- Tem stack default: TypeScript, Node, Drizzle, Postgres, n8n para automações.

### 4.2 Operador do workspace (admin/owner)

- Dono ou gestor de PME (5–50 funcionários) num dos cinco nichos-alvo: **mercado digital, escritórios, imobiliárias, clínicas, advocacias**.
- Configura canais, contrata agentes IA, define automações, vê resultados.
- Não é técnico. Precisa de UI que conduz, não que apresenta opções.
- Métrica de sucesso: tempo até primeira conversa atendida via IA (< 30 min do signup) — **fortemente acelerada pelos templates de nicho**.

### 4.3 Atendente (agent)

- Faz atendimento humano, recebe transferências do agente IA, vê pipeline.
- Trabalha com Highermind o dia inteiro. Latência conta.
- Métrica de sucesso: tempo médio de resposta ao cliente (< 60s após inbound).

### 4.4 Supervisor

- Monitora múltiplos atendentes e agentes IA.
- Vê dashboards de SLA, qualidade de IA, conversões.
- Aciona campanhas, configura departamentos.

### 4.5 Cliente final do workspace (contact)

- Recebe mensagens via WhatsApp. **Não interage com Highermind diretamente.**
- Experiência: agente IA responde rapidamente, qualifica, escala para humano quando necessário, agenda reunião sem fricção.

---

## 5. Princípios de produto

1. **A interface ensina o uso.** Onboarding sem tutorial; cada tela tem um próximo passo claro. Empty states convidam a agir.
2. **A IA é assistente, não autônoma.** Toda ação de IA tem audit trail. Toda decisão crítica (transferir, agendar, marcar pago) tem tool log inspecionável.
3. **Performance é UX.** Inbox abre em <500ms. Mensagem aparece em <1s após inbound. Drag-and-drop é instantâneo (optimistic). Página carrega em <2s.
4. **Dark-first, light disponível.** Maioria do trabalho é em dark. Light existe e é igual de polido.
5. **Verde-neon é precioso.** Um por tela. Um botão de ação principal. Status e marca. Nunca decorativo.
6. **Documentação de ajuda integrada.** Cada feature tem `(?)` que abre painel lateral com explicação curta + link pro doc completo. Não é tooltip, é um painel.
7. **Acessibilidade não é opcional.** Focus ring sempre. ARIA em modal/form/livechat. Contraste AAA em texto principal.

---

## 6. Métricas de sucesso do v2

### 6.1 Qualidade de código (auditáveis no repo)

- **0 `any`** em código de produção (eslint regra error)
- **Cobertura de testes** ≥ 70% em backend services + libs, ≥ 50% em frontend components
- **Lint zerado** na main em todo momento (CI bloqueia)
- **Time to first build em VPS** < 5min
- **Time to first deploy de nova feature** < 1 dia (do PR mergeado ao produção)

### 6.2 Performance

- **Inbound webhook → mensagem renderizada no cliente:** P95 < 1s
- **Inbox /list query:** P95 < 200ms (com cache)
- **Agent first token (streaming):** P95 < 2s
- **Página completa carregada (FCP):** P95 < 2s
- **Bundle inicial frontend (Next.js 15 App Router):**
  - HTML SSR (server payload + crítico inline): < 60KB gzipped
  - JS de hydration da rota inicial (React 19 + framework chunks): < 350KB gzipped
  - **Total inicial (HTML + JS first-paint):** < 400KB gzipped
  - Componentes pesados (`@xyflow/react`, `@fullcalendar/*`, `recharts`) ficam fora do bundle inicial via `next/dynamic({ ssr: false })`

### 6.3 Adoção (após launch)

- **Time to first message handled by AI** após signup < 30min
- **NPS interno** (eu uso e amo): subjetivo, mas mensurável
- **Churn por bug crítico em 30 dias:** zero

---

## 7. Restrições e premissas

### 7.1 Restrições técnicas

- VPS atual (Hetzner, Ubuntu 24.04) é o destino do deploy MVP. Single-instance, 14 containers Docker Compose, nginx via aaPanel.
- Postgres roda na VPS (não Supabase). Pode subir para 16 cores e 64GB se necessário.
- Mídia vai pra Cloudflare R2 (zero egress, ~$0.015/GB armazenado).
- Domínio: a definir (placeholder `<domínio>` na documentação técnica). Quando contratar VPS nova + registrar domínio, fazer search-and-replace.
- Builds rodam em GitHub Actions; deploy via `deploy.sh update` na VPS (pull + rebuild + restart).

### 7.2 Restrições legais

- **LGPD compliance é mandatório.** Opt-in registrado com fonte e timestamp. Opt-out automático. Direito ao esquecimento implementado (delete contact + mensagens).
- **Meta Business Policy** — templates MARKETING precisam opt-in registrado. Violação = banimento WABA.
- **Meta Platform Terms (Instagram)** — outbound proativo proibido para usuários sem interação prévia; uso de `MESSAGE_TAG` rigorosamente justificado (logs em `audit_logs`). Violação = perda do permission `instagram_manage_messages`.
- **Tech Provider obligations** — Highermind responde solidariamente perante Meta pelos uses dos seus clientes. Auditoria interna de uso é obrigatória.
- **Encriptação em trânsito (TLS 1.3)** e em repouso (mídia + secrets) obrigatória.

### 7.3 Premissas

- Rogério aprova decisões técnicas; agentes de código (Claude, etc.) executam.
- Equipe atual: 1 dev (Rogério) + agentes IA. Escalabilidade técnica importa pra produto, não para time de dev (por enquanto).
- Volume esperado no primeiro ano: < 1.000 workspaces, < 100M de mensagens. Otimizar para esse range; não overengineer para escala maior.

---

## 8. Identidade visual (sumário; detalhe em `DESIGN_SYSTEM.md`)

- **Tom geral:** Apple Watch + Linear + cyberpunk respeitoso. Dark-first.
- **Cor de marca:** verde-neon `#1FFF13`. Escasso no produto (um por tela), abundante na landing.
- **Tipografia editorial:** Rajdhani (heads), Manrope (corpo), Chakra Petch (preços/números), Orbitron (logo/selos).
- **Sem nome de produto definido ainda** — não inventar marca. Wordmark: `◢` ou `◢ Highermind` quando precisar.
- **Sem template look.** Se a tela poderia ser de qualquer SaaS genérico, reprova.

---

## 9. Não-objetivos explícitos

Para fixar:

- **Não é um Intercom replacement.** Não é um CRM Salesforce-like. É focado em PME + canais Meta (WhatsApp + Instagram) + IA.
- **OpenRouter é o roteador de LLM, não OpenAI direto.** Multi-model não é "abstração futura" — é o default desde o MVP. O super-admin controla quais modelos cada workspace pode usar.
- **Não é low-code total.** Flow Builder cobre 80% dos casos; o resto exige integração via webhook ou API.
- **Canais Meta primeiro.** WhatsApp completo no MVP; Instagram em F1.5 (com fundamentos prontos desde o MVP). Telegram/Email seguem fase 2+.

---

## 10. Glossário (ver INDEX.md §"Glossário do produto v2")

Termos canônicos do v2: workspace, member, channel, provider, contact, conversation, pipeline, stage, deal, flow, agent, tool, campaign, event, **comment_thread, story_thread** (canais Instagram), **LLM router** (OpenRouter), **agent-runtime** (microsserviço Python).

Termos legados do v1 a evitar: company (use workspace), user (use member, exceto auth), inbox (use channel), customer/lead (use contact), chat (use conversation), kanban_board (use pipeline), kanban_column (use stage), "Meta Cloud" genérico (use `meta_whatsapp` / `meta_instagram`), "OpenAI" como sinônimo de LLM (use OpenRouter como provider; OpenAI é só um dos modelos disponíveis).

---

## 11. Documentos relacionados

- [ARCHITECTURE.md](./ARCHITECTURE.md) — arquitetura técnica
- [DATA_MODEL.md](./DATA_MODEL.md) — schema do banco
- [FEATURES.md](./FEATURES.md) — inventário detalhado
- [ROADMAP.md](./ROADMAP.md) — fases de execução

---

> **Próxima revisão deste PRD:** após Rogério ler e comentar. Versão 1.0 fica quando todos os items de §3.3 forem resolvidos.
