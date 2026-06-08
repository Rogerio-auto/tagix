# MIGRATION_NOTES — Armadilhas a evitar

> **Documento:** Lições aprendidas do v1. Cada item é um anti-pattern documentado para não repetir.
> **Versão:** 0.1 — 2026-06-06

---

## 1. Disciplina de migrations SQL

### O que aconteceu no v1

47 migrations numeradas + 30+ ad-hoc + `check_view.ts`/`fix_schema.ts`/`check_constraints.ts` em `backend/src/`. Bug `kanban_colum_id` (typo) virou nullable em vez de renomear. Tabela `chat_attachments` legada coexistindo com `messages.media_*`. Dupla estrutura `kanban_columns` + `project_stages`.

### Regra v2

- **Toda mudança de schema é uma migration Drizzle versionada.** `pnpm db:generate` gera SQL; revisão obrigatória no PR.
- **Sem scripts ad-hoc em `apps/api/src/`.** Scripts pertencem a `infra/scripts/` ou `packages/db/scripts/`.
- **Refator de schema é uma sequência de migrations forward-compatible:** add column → backfill → switch reads → switch writes → drop old. Não "alterar tipo e rezar".
- **Migration tem testes de up + down (rollback) quando destrutiva.** Default é forward-only mas explicito.
- **Naming:** typo na coluna ao subir = rename na próxima migration. Nunca "deixar pra depois".

---

## 2. Cache invalidation

### O que aconteceu no v1

`invalidateChatCaches(chatId, context)` em `store.service.ts:91-187` gera 16+ cache key variations (status × kind × dept combos). Manual. Fácil esquecer uma. Não documentado. Bugs `CHATLIST_CACHE_FIX.md`, `META_INBOX_SOCKET_FIX.md`, etc. são variantes do mesmo problema.

### Regra v2

- **Cache key versioning** (workspace-level ou resource-level), não invalidate-N-keys.
- **Key builders centralizados** em `packages/db/src/cache/keys.ts` — função tipada por categoria.
- **Cada `set` documenta TTL e invalidation strategy em comment 1 linha.**
- **Cache miss after invalidate** = single-flight via Redlock para evitar thundering herd.
- **Aceitar staleness curta (< 5min) em listas** — não invalidate a cada mensagem. Lista bumpa por last_message_at desc, então é ok.

---

## 3. Discriminated unions, não `Record<string, any>`

### O que aconteceu no v1

`messages.interactive_content?: Record<string, any>` (TODO FX-023d). Frontend renderiza polimorficamente sem tipagem. Backend não valida shape. Adicionar nova interactive = trabalho desconhecido.

### Regra v2

- **Toda JSONB column com shapes variantes tem discriminated union em TypeScript.**
- **Zod schema na fronteira de I/O** (insert/select) garante validação runtime.
- **Frontend usa switch tipado** sobre o `type` discriminator, com exhaustiveness check (`assertNever`).
- **Quando adicionar nova variante:** atualizar union + handler em todos os pontos. TypeScript falha se esquecer.

---

## 4. Nomes consistentes

### O que aconteceu no v1

- Tabela `customers`, type `Contact`, field `customer_id`, conceito "lead" em paralelo. Confusão semântica em 100% do codebase.
- `chats.kanban_colum_id` typo histórico.
- `inboxes` (canal de entrada) vs verdade: agora pode enviar (não só "inbox"). Mais correto: `channels`.
- `users` ambíguo: auth.users (Supabase) vs members do workspace.

### Regra v2

- **Glossário canônico aprovado:** workspace, member, channel, contact, conversation, pipeline, stage, deal, flow, agent, tool, campaign, event.
- **Refactor de nome é refactor de schema.** Encontrou typo → migration de rename. Não conviver com a versão errada.
- **`apps/api/src/lib/term-checker.ts` (futuro)** roda em PR e detecta uso de termos legacy em código novo.

---

## 5. Worker monolítico

### O que aconteceu no v1

`backend/src/worker.ts` tem 3500+ linhas. Mistura inbound + outbound + media + provider switching + persistence. Quase impossível navegar.

### Regra v2

- **1 processo = 1 entry file pequeno (< 100 linhas) + handler files modulares.**
- **Worker outbound do v1 já fez certo:** `src/worker/outbound/` com 14 módulos. Replicar para os outros.
- **Lock por chat (FX-007) é uma feature do compositor, não vazada para handler.** Wrapper `withChatLock(fn)` em `apps/workers/src/outbound/middleware.ts`.

---

## 6. Mocks em integration tests

### O que aconteceu no v1

(Inferido: mocks de DB em tests que passavam quando schema real divergia, causando bugs em produção.)

### Regra v2

- **Integration test = Postgres real (testcontainers) + RabbitMQ real + Redis real.** Sem mock de infra crítica.
- **Mock apenas APIs externas** (Meta, OpenAI, WAHA). Use msw ou fixtures.
- **Test fixture de tenant** com seed mínimo (1 workspace, 1 member, 1 channel) compartilhado entre tests.
- **CI roda integration suite em containers** — não em SQLite, não em mock.

---

## 7. `console.log` em produção

### O que aconteceu no v1

FX-013, FX-021, FX-021b, FX-020b, FX-021b — múltiplas tasks só para limpar console.log esquecidos.

### Regra v2

- **ESLint regra `no-console` com `error` (não `warn`).** Permite só `console.warn`/`error` em código de bootstrap.
- **Pino logger é o caminho.** Todo log estruturado, sem string solta.
- **PII masking automático** no logger config (paths sensíveis redactados).
- **No PR review:** se vir `console.log`, bloqueia merge.

---

## 8. Migration de SQL aliases mascarando schema real

### Memória do Rogério (`feedback_verify_schema_before_renaming.md`)

Aliases em queries são enganosos; sempre checar `backend/sql/` antes de diagnosticar PG 42703.

### Regra v2

- **Drizzle schema é a fonte de verdade.** Query inferred dele.
- **Quando bater erro 42703 (column does not exist):** primeiro `pnpm db:introspect` para conferir DB real vs schema TS.
- **Migration que renomeia coluna** atualiza schema TS no mesmo PR.

---

## 9. Push direto em `main`

### Memória do Rogério (`feedback_orchestrator_push_after_merge.md`)

Merge local sem push → VPS deploya código velho.

### Regra v2

- **Git hook `scripts/git-hooks/pre-push` bloqueia push em main.**
- **GitHub branch protection** quando upgrade plan (ou via custom Action).
- **CI/CD deploy é gatilhado por push em main remoto** (não local).
- **`git log origin/main -1` ANTES de declarar deploy.** Confirma que o que está em produção é o que esperamos.

---

## 10. RLS desde o início

### O que aconteceu no v1

Sem RLS. Isolation por `WHERE company_id = ?` em todas as queries. Fácil esquecer em uma rota e leak inter-tenant.

### Regra v2

- **RLS habilitada em toda tabela com `workspace_id` na primeira migration.**
- **Policies padrão:** SELECT/INSERT/UPDATE/DELETE só onde `workspace_id = current_setting('app.workspace_id')`.
- **Middleware Express seta `app.workspace_id`** no início de cada request (BEGIN transaction).
- **Schema migration valida que toda tabela "tenant" tem RLS habilitada.** Script de check no CI.

---

## 11. Bulk lint-disable proibido

### Memória do Rogério (`feedback_no_bulk_eslint_disable.md`)

FX-027 primeira tentativa silenciou 2086 `any` com `eslint-disable-next-line`. Rejeitado.

### Regra v2

- **`@typescript-eslint/no-explicit-any: error`** desde o primeiro commit.
- **PR que adiciona `eslint-disable` precisa justificativa** (single-line, single-rule, comment com motivo).
- **`as unknown as Foo` proibido** salvo casos genuinamente excepcionais (testes com mock complexo, etc.) — comment justificando.
- **Slot de lint-cleanup tem cap numérico explícito** (ex: "reduzir N erros") em vez de "zerar com disable".

---

## 12. Build local antes de PR

### Memória do Rogério (`feedback_frontend_build_check.md`)

Vitest é esbuild transpile-only e perde TS strict errors que quebram o Docker build em deploy.

### Regra v2

- **CI roda:** `pnpm typecheck` (tsc --noEmit) + `pnpm lint` + `pnpm build` + `pnpm test`.
- **Local pre-commit:** typecheck + lint via git hook.
- **Local pre-PR:** `pnpm validate` (= typecheck + lint + build + test).
- **Branch não merge** se algum desses falha.

---

## 13. Auth cache TTL e revogação

### O que aconteceu no v1

Auth cache 300s. OK para 99% dos casos. Mas member desativado continua autenticado por até 5min após operador desativar.

### Regra v2

- **Mesma TTL 300s para auth cache.**
- **Invalidate explícito em:** logout, password reset, member.deactivate, member.delete.
- **Soft block:** `members.status = 'blocked'` é checado em cada request via cache. Pode coexistir com auth token válido (logout não é instantâneo).

---

## 14. Webhook sem rate limit

### Achado v1

`POST /integrations/meta/webhook` sem rate limit (ver LiveChat explorer §12.3). Vetor de DDoS: spam de webhooks falsos sobrecarregaria worker.

### Regra v2

- **Webhook tem rate limit por IP** (express-rate-limit + Redis store).
- **Webhook valida signature** SEMPRE antes de processar. Sem signature válida = 401 + cancel processing.
- **Webhook dedup via `webhook_events`** com `UNIQUE(channel_id, event_uid)`.

---

## 15. Encryption key fallback chain

### Achado v1

`lib/crypto.ts:10-35` tinha 4 fallback methods para parsing key. Se todos falharem, throw generic. App startup pode silenciar erro de env missing.

### Regra v2

- **Env validation com Zod no startup** — fail fast se `ENCRYPTION_KEY_V1` ausente ou inválida.
- **Versionamento de key:** `ENCRYPTION_KEY_V1`, `ENCRYPTION_KEY_V2`, ... + flag `CURRENT_ENCRYPTION_KEY_VERSION`.
- **Rotação:** cron `rotate_secrets` recifra colunas `_enc` para nova version.

---

## 16. Tipos vazios e prop drilling

### Achado v1

`UserProfile` em AuthContext é mínimo (`{ id, email, phone, role }`). Página precisa mais → fetch separado → cache disperso.

### Regra v2

- **Auth payload é completo o suficiente para 95% dos uses.** Inclui `workspace`, `member`, `subscription`, `featureFlags`.
- **Endpoint `/api/me` retorna tudo necessário pra hidratar o app.**
- **Zustand store guarda esse payload.** Sem prop drilling.
- **Updates parciais via TanStack Query** invalidate `['me']`.

---

## 17. State management proliferation

### Achado v1

6 contextos React aninhados (`Auth`, `Theme`, `Subscription`, `Cadastro`, `Socket`, `QueryClient`). Cada um com lógica de fetch + cache + persist.

### Regra v2

- **3 contextos** (`ThemeProvider`, `SocketProvider`, `QueryClientProvider`).
- **Auth/Subscription/Theme/UI state** em Zustand stores.
- **Socket events** distribuídos via `useSocketEvent(eventName, handler)` hook — não Context.
- **Página/feature state** local com `useState`/`useReducer`.

---

## 18. Form validation manual

### Achado v1

`form-utils.ts` com `useFormValidation` manual. Sem integração Zod (instalado mas não usado em forms).

### Regra v2

- **React Hook Form + Zod** em TODO form.
- **Schemas em `packages/shared/src/schemas/`** reutilizáveis backend ↔ frontend.
- **Sem validação manual.** Se precisar regra customizada, é um `.refine` no Zod.

---

## 19. Cron jobs com setTimeout

### Achado v1

Campaign follow-ups usavam `setTimeout(async () => publish(...), delay * 60000)`. Se worker reinicia, follow-up perdido. Sem idempotency.

### Regra v2

- **Toda scheduled action é persistida** em tabela (ex: `pending_automations`, `scheduled_followups`).
- **Cron scheduler pega items `scheduled_at <= now`** e dispatcha.
- **Idempotency key (sha256 de identidade)** previne duplicatas.
- **`setTimeout` proibido para qualquer trabalho > 30s.**

---

## 20. Mixed Supabase JS + raw pg

### Achado v1

Backend usa `supabaseAdmin` (Supabase JS) E `pg.Pool` (raw SQL) lado a lado. Dois caminhos para o mesmo dado.

### Regra v2

- **Único caminho:** Drizzle ORM.
- **Supabase JS no backend** = ❌ proibido (a menos que isolated em `apps/api/src/auth/supabase-adapter.ts`).
- **Frontend** não usa Supabase JS direto; consome API.

---

## 21. Dupla apresentação de mídia

### Achado v1

`chat_attachments` table (legacy) + `chat_messages.media_*` columns (novo). Código tinha priority logic em `lib/mediaProxy.ts:35-87` para escolher entre 3 fontes.

### Regra v2

- **Uma representação:** `messages.media_url` (R2 key), `media_mime`, `media_size_bytes`, `media_sha256`, `media_caption`.
- **Migration apaga `chat_attachments`** após backfill.
- **Sem fallback chains.**

---

## 22. Páginas órfãs e duplicação

### Achado v1

`pages/admin.tsx` (placeholder vazio), `pages/AutomationRulesPage.tsx` (duplica `pages/automation-rules/index.tsx`), `pages/calendar.tsx` (rota legada).

### Regra v2

- **Routes centralizadas** em `apps/web/src/routes/routes.tsx`. Qualquer page que não está aqui = morta.
- **`pnpm lint:dead-files`** (custom script) detecta arquivos não importados.
- **CI bloqueia merge** com dead files.

---

## 23. ToastContainer duplicado

### Achado v1

`components/ToastContainer.tsx` + `components/common/ToastContainer.tsx`. Estilos diferentes, incompatíveis.

### Regra v2

- **Toast é único, em `packages/ui/Toast/`.**
- **Hook `useToast`** dispara via Zustand store global.
- **Provider `ToastProvider`** em `App.tsx`.

---

## 24. Refator parado em exemplo

### Achado v1

`EmpresaPanel.refactored.example.tsx` — refator começado e congelado.

### Regra v2

- **Refator é um slot/PR/feature.** Não há `.example.tsx` no repo.
- **Se exemplificar:** Storybook/Ladle stories cumprem o papel.

---

## 25. Solar / industry vertical-specific

### Achado v1

`industry-config.ts`, `catalog-config.ts`, `solarDataExtractor.ts`, `041_COMPLETE_document_templates_system.sql`, `dashboard-orca.tsx` — features de uma vertical (energia solar) acopladas no core.

### Regra v2

- **Core é genérico.** Verticais entram como plugins (futuro) ou apps separados.
- **MVP descarta tudo vertical-specific.**

---

## 26. Sem versionamento de flow

### Achado v1

Flow podia ser editado enquanto execução em curso usava ele. Mudança na config → execução quebrada silenciosamente.

### Regra v2

- **`flow_versions` snapshot ao publicar.** Execuções referenciam version, não flow direto.
- **Edit em flow não afeta executions em andamento.**

---

## 27. Performance: cache invalidation thundering herd

### Achado v1 (inferido)

Bump version em workspace → todas as queries de lista re-fazem ao mesmo tempo → DB overload.

### Regra v2

- **Single-flight via Redlock** em `cacheWrap(key, ttl, loader)`. Apenas 1 query DB se N requests fazem hit simultâneo após miss.
- **Stagger refetch no frontend** com jitter em TanStack Query.

---

## 28. Workers single-instance lock fragility

### Achado v1

`ensureSingleWorkerInstance` com TTL 60s + heartbeat 15s. Se lag de heartbeat acontece, dois workers concorrem.

### Regra v2

- **Mesma lógica, mas com auto-healing claro:** se outro instance pegou o lock (token diferente), worker faz exit(1) imediato (não tenta continuar).
- **Logs estruturados** em transição de lock para detectar fragilidade em produção.
- **Métricas em Grafana** mostram heartbeat health por worker type.

---

## 29. Aggregation window (buffer) por agente

### Achado v1

`aggregation_window_sec` (default 20s) buffera mensagens antes de invocar agente. Lógica boa, mas mistura com handler.

### Regra v2

- **Buffer é separado:** worker-inbound persiste mensagem + enfileira "aggregation tick" para `conversation_id` com delay = aggregation_window.
- **Tick consumer:** se chegou tick e `last_message_at` + window passou, invoca agente. Se não, descarta.
- **Sem in-memory buffer no worker** (perde com crash).

---

## 30. Não shipar feature sem `(?)` de ajuda

### Princípio do PRD

"Documentação de ajuda integrada".

### Regra v2

- **Toda feature mergeable tem painel de ajuda** acessível via `(?)` no PageHeader.
- **Sem doc inline = PR rejeitado.**
- **Doc fica perto do código** em `apps/web/src/features/<feat>/help.tsx`.

---

## 31. Slot legacy: não mexer parcialmente

### Memória do Rogério (DS migration §4.3)

"Slot novo / página nova → sistema NOVO." "Mudança pequena em legacy → manter legacy, não migrar parcial."

### Aplicável ao v2: NÃO tem legacy — tudo nasce DS v2.

Mas vale a regra geral: **scope creep é proibido.** Tarefa diz X, faz X. Refactor adjacente é outro PR.

---

## 32. Aliases obsoletos no DS

### Achado v1

`--color-bg` (legado) + `--bg` (novo) coexistem em `style.css`. Pior: `[data-theme="dark"]` aplica cor diferente de `.dark`. Conflito visível.

### Regra v2

- **Apenas tokens v2.** Sem `--color-*`.
- **Apenas `data-theme`.** Sem classe `.dark`.
- **Sem aliases de compat.**

---

## 33. Mídia em VPS = não escala

### Decisão Rogério

Mídia em R2, não VPS.

### Regra v2

- **Driver R2 com signed URLs** desde o primeiro commit.
- **`LocalDriver` apenas para dev local.**
- **Sem `mediaProxy` backend** (signed URLs cuidam).

---

## 34. Estrutura de teste antes de implementar

### Princípio

"Nunca deixe testes pra depois" (CLAUDE.md global).

### Regra v2

- **Toda função em service/lib tem teste unitário em commit-junto.**
- **Toda rota tem integration test.**
- **Toda feature crítica (login, send_message, schedule_event) tem e2e Playwright.**
- **Coverage não é métrica primária, mas baixo coverage em service crítico = sinal.**

---

## 35. Documentação como código

### Princípio

Decisões arquiteturais ficam documentadas, não na cabeça.

### Regra v2

- **ADR (Architecture Decision Record)** em `docs/decisions/ADR-XXX-titulo.md` para toda decisão estrutural.
- **Runbook** em `docs/runbooks/` para operações (backup, restore, incident, rotation).
- **API spec OpenAPI** em `docs/api/openapi.yaml` gerado de Zod schemas.
- **CHANGELOG.md** atualizado a cada release.

---

## 36. Não shipar mediano

### Princípio CLAUDE.md global

"Nunca shippe trabalho mediano."

### Regra v2 (mental, não rule)

- **Antes de mergear:** "Eu mostraria isso pro melhor engenheiro do mundo com orgulho?" Se hesitar, refactora.
- **Em pull request:** título do PR explica o **porquê** da decisão, não apenas o **o quê**.
- **Em design:** se a tela poderia ser de qualquer SaaS, é mediana. Reprova.

---

> Estas anotações são para humano + IA implementando. Releia antes de tocar em código que toca essas áreas.
