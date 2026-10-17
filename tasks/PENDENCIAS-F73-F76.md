# Pendências da construção F73–F76 (Copiloto, Loja de Integrações, Mascote)

> Arquivo de **acúmulo**. Os agentes anotam aqui o que ficou para trás ou depende do Rogério, sem parar a
> construção. No fim da construção o Rogério lê este arquivo e resolve cada ponto, um a um.
> Formato de cada item: `- [ ] <SLOT> — <o que falta> — **Precisa de:** <quem/o quê> — **Impacto:** <o que fica sem prova/sem funcionar> — **Como fechar:** <passo cirúrgico>`.

## Decisões de produto (do Rogério)

- [ ] F75-S16 — confirmar se algum flow em produção chama host interno/porta baixa/resposta > 1 MiB (passam a falhar após o deploy) — **Precisa de:** Rogério (consulta no banco de produção antes do deploy) — **Impacto:** flow legítimo pode parar — **Como fechar:** `SELECT` nos nós `http_request` dos flows publicados; se houver host interno legítimo, pôr em `HM_FLOW_HTTP_ALLOWLIST`.

## Credenciais, contas e serviços externos

- [ ] F73-S03 — `COPILOT_GRANT_SECRET` precisa existir no `.env` da VPS ANTES do próximo deploy (o compose de produção agora exige; sem ela o deploy para no `config`) — **Precisa de:** Rogério (acesso à VPS) — **Impacto:** deploy bloqueado — **Como fechar:** `openssl rand -base64 48` → `.env` da VPS (valor distinto do `AGENT_RUNTIME_TOKEN`); ver `docs/runbooks/deploy-production.md` §2.5.

## Provas que não puderam ser executadas (infra, dispositivo, custo)

- [ ] F73-S04 — prova do runtime do Copiloto com modelo real (latência até o 1º `verdict_delta` e o `final`, tool use com `tool_choice` forçado e `parallel_tool_calls=false`, argumentos de `answer` chegando em streaming, `usage.cost` no stream) com `openai/gpt-4.1-mini` — **Precisa de:** Rogério (chave OpenRouter e custo) — **Impacto:** o caminho só foi provado com provider fake — **Como fechar:** rodar um turno real pelo `/copilot/run` e registrar na nota do F73-S04.

## Dívida técnica e achados fora de fronteira (slots futuros)

- [ ] F75-S16 (para F75-S13) — guard SSRF compartilhado (`packages/shared/src/net/ssrf-guard.ts`) não bloqueia fec0::/10, 2002::/16 (6to4 com v4 interno), 64:ff9b:1::/48, 2001::/32 (Teredo), 100::/64 — **Precisa de:** slot de `@hm/shared` (F75-S13) — **Impacto:** fail-closed incompleto em IPv6 raro (pouco roteável na VPS) — **Como fechar:** acrescentar as faixas em `isBlockedIpAddress` com teste.
- [ ] F75-S16 — `FlowHttpRequest` (`packages/flow-engine/src/types.ts`) e `docs/features/FLOW_BUILDER.md` não citam o teto de 1 MiB, 5 redirects, portas permitidas e `HM_FLOW_HTTP_ALLOWLIST` — **Precisa de:** F75-S13 — **Impacto:** documentação desatualizada — **Como fechar:** atualizar comentário e doc.
- [ ] Infra dev — Postgres nativo do Windows ocupa `localhost:5432`; o container dev só é alcançável via override fora do repo em 5442 — **Precisa de:** slot de infra (parametrizar `${POSTGRES_HOST_PORT:-5432}` no compose dev) — **Impacto:** quem sobe o compose cru não roda testes de banco — **Como fechar:** uma linha no compose + runbook.

- [ ] F73-S03 — `.env.production.example` (base do `deploy.sh`) não lista `COPILOT_GRANT_SECRET` — **Precisa de:** slot de infra/deploy — **Impacto:** quem monta a VPS do zero esquece a variável — **Como fechar:** acrescentar a linha com comentário.
- [ ] F73-S03 — `args_redacted` do Copiloto guarda só a forma dos args (sem ids), porque `internal/tools/log-redaction.ts` não tem política para chaves do Copiloto — **Precisa de:** slot que possa editar o redator (F73-S14 ou próprio) — **Impacto:** auditoria de chamadas sem ids de alvo — **Como fechar:** exportar gancho de política e registrar as chaves do Copiloto.
- [ ] F73-S03 — escrita sob view-as responde `impersonation_read_only` (middleware global) e não `copilot_unavailable_impersonation` — **Precisa de:** decisão (aceitar) ou slot no middleware de impersonation — **Impacto:** só o código de erro difere; a escrita é barrada — **Como fechar:** F74 trata os dois códigos.

- [ ] F73-S05 — idempotência do desfazer e do retry guardada em `audit_logs.metadata` (sem coluna) e lease sem dono (`lease_owner`); exclusão mútua vem do lock por item — **Precisa de:** slot de schema (`undo_idempotency_key`, `undo_lease_expires_at`, `lease_owner`) — **Impacto:** robustez; hoje há retomada após 10 min — **Como fechar:** migração + trocar a leitura no `undo.ts`/`retry.ts`/sweeper.
- [ ] F73-S05 — `apps/api/src/index.ts` não trata SIGTERM: o sweeper só para em `httpServer 'close'` — **Precisa de:** slot de graceful shutdown — **Impacto:** seguro (lease retoma), mas o DoD "parado no shutdown" é nominal — **Como fechar:** `process.once('SIGTERM', () => httpServer.close())`.
- [ ] F73-S05 — `can_confirm` do DTO não considera os `requires` do executor (pode mostrar verdadeiro e o confirmar dar 403) — **Precisa de:** F73-S14 — **Impacto:** botão habilitado que falha — **Como fechar:** `viewerCanAct` usar `authorizeWrite`.

- [ ] F73-S06 — `get_pipeline_overview` p95 232 ms com 35 mil negócios abertos (meta 150 ms) — **Precisa de:** slot de schema — **Impacto:** funil lento em workspaces grandes (> ~25 mil abertos) — **Como fechar:** índice parcial `messages (conversation_id, coalesce(provider_timestamp, created_at) desc) where direction='inbound'` (medido −40%) ou coluna `deals.last_inbound_at` mantida por trigger.
- [ ] F73-S06 — cartões sem campos que o produto não tem: `deal_card.installments` sempre `null`, `kpis` sem meta de receita; `percent` é fração 0..1 — **Precisa de:** Rogério (meta de receita existe?) e F74 (formatação) — **Impacto:** cartão mais pobre que a maquete — **Como fechar:** decidir meta/parcelas no produto.

## Itens bloqueados de propósito (v1.1)

- [ ] F73-S16 — "Mover sozinho" do piloto automático — **Precisa de:** dado de aceitação (>= 70% de aceite e <= 3% de desfazer por 30 dias) — **Impacto:** o piloto só sugere e aguarda aprovação — **Como fechar:** destravar o slot depois da telemetria.
