# Flow Builder — Avaliação de Prontidão para Produção + Plano de Correção

> **Data:** 2026-06-15
> **Escopo:** auditoria de código do Flow Builder v2 (F4 + F31) ponta a ponta — engine, worker, triggers, bridge de envio, API e dependências externas da Meta.
> **Método:** leitura direta do código atual (não da memória de fases). Cada afirmação abaixo foi verificada em arquivo.

---

## 0. TL;DR

O **núcleo determinístico do Flow Builder está pronto para produção**: engine, scheduler, versionamento, CRUD/API, e o caminho de envio de **mensagem de texto e mídia** funcionam ponta a ponta. A UI v2 (22 node types, inspectors ricos) foi entregue na F31.

Mas há **6 lacunas de CÓDIGO** que tornam node types e triggers específicos **no-op silencioso em produção** — eles existem na UI, salvam, publicam, executam, logam `SUCCESS`, mas **não produzem efeito externo**. Isso é pior que um erro: parece que funciona.

Separadamente, há **dependências de infraestrutura da Meta** (canal WABA conectado, templates HSM aprovados, WhatsApp Flow publicado, App Review) que são pré-requisito para *verificar* envio real — mas isso é externo ao código e não bloqueia as correções de código.

---

## 1. Categoria A — Pronto para produção (funciona hoje, dado um canal conectado)

| Área | Estado | Evidência |
|---|---|---|
| Engine — `triggerFlow`/`processFlowStep`/`resume`/`cancel` | ✅ | `packages/flow-engine/src/dispatcher.ts` |
| Scheduler de wakeup (`wait`/timeout biestável) com lock Redis | ✅ | `apps/workers/src/flows/scheduler.ts` |
| Worker consumer `hm.q.flow.execution` + re-enqueue | ✅ | `apps/workers/src/flows/worker.ts` |
| Bootstrap liga worker + scheduler + trigger dispatch | ✅ | `apps/workers/src/bootstrap/index.ts:183,199` |
| Versionamento (publish snapshot → `flow_versions`; execução referencia version) | ✅ | spec §7 + crud |
| API CRUD + publish/unpublish/archive + executions + cancel | ✅ | `apps/api/src/routes/flows/*` |
| **Trigger: manual** | ✅ | endpoint `/flows/:id/trigger` |
| **Trigger: keyword** | ✅ | `flows-triggers/dispatcher.ts` ligado em `inbound/worker.ts:97` |
| **Trigger: new_message** | ✅ | idem |
| **Trigger: flow_submission** (resposta de WhatsApp Flow) | ✅ | webhook `webhooks/meta.ts:171` → `processMetaFlowSubmission` |
| **Output: message (texto)** | ✅ | `outbound-publisher.ts` → job `text` → `dispatch.ts` → serializer |
| **Output: message (mídia: imagem/vídeo/áudio/voz/doc)** | ✅ | signed URL + job `media` |
| Nodes lógica/timing: condition, switch, ab_split, wait, wait_for_response, input | ✅ | handlers + dispatcher |
| Nodes sistema: set_variable, ai_action, change_status, assign, add_tag, remove_tag, move_stage, register_conversion | ✅ | handlers (efeito é no DB próprio) |
| Node external: http_request | ✅ | `http_request.handler.ts` + http port |
| Node external_notify (envio **texto** p/ outra conversa) | ✅ | usa caminho de texto |
| Interpolação `{{vars.*}}`/`{{input.*}}`/`{{contact.*}}` | ✅ | `utils/interpolate.ts` |

> O worker outbound (`apps/workers/src/outbound/job.ts` + `dispatch.ts`) **já suporta** os kinds `interactive` e `template` e os roteia ao adapter Meta. O serializer WhatsApp serializa `buttons`/`list`/`template`. Ou seja: o "downstream" está pronto — o que falta é a **ponte do flow até esse downstream** (Categoria B).

---

## 2. Categoria B — Lacunas de CÓDIGO (corrigíveis sem Meta; bloqueiam node types/triggers)

### B1. Bridge de envio `interactive` é no-op 🔴 ALTO
- **Sintoma:** node `interactive` (botões/listas) executa, loga SUCCESS, mas **nunca chega ao provider**.
- **Causa:** `createOutboundPublisher.publishMessage` (`apps/workers/src/flows/outbound-publisher.ts:251`) faz `if (message.interactivePayload) { warn; return; }` — degradação conservadora deixada como follow-up da F31-S01.
- **Fix:** mapear o `interactivePayload` do handler (`kind:'buttons'|'list'`) para um `OutboundJob` `kind:'interactive'` com `payload` no shape do `InteractivePayloadSchema`. **Atenção à divergência de campos:** o handler usa `kind` + botão `{id,title}` + lista `buttonLabel`; o `InteractivePayloadSchema` usa `type` + botão `{id,text}` + lista `button`. Precisa tradução + testes.
- **Arquivos:** `apps/workers/src/flows/outbound-publisher.ts`, `packages/shared/src/types/interactive.ts` (ref), `packages/flow-engine/src/handlers/interactive.handler.ts` (ref).

### B2. Bridge de envio `template` (HSM) é no-op 🔴 ALTO
- **Sintoma:** node `template` executa, monta payload Cloud API, mas o publisher o trata como `interactivePayload` → no-op.
- **Causa:** mesmo `return` da B1. O handler `template.handler.ts` emite `{kind:'template', template:{name,language,components}}` via `interactivePayload`.
- **Fix:** detectar `interactivePayload.kind === 'template'` e emitir `OutboundJob` `kind:'template'` (`templateName`, `languageCode`, `components`) — kind já existe e roteia para `adapter.sendTemplate`.
- **Dependência externa:** envio real exige template **aprovado** na Meta (Categoria C2).

### B3. `go_to_flow` não executa o flow alvo 🟠 MÉDIO
- **Sintoma:** node `go_to_flow` cria a `flow_execution` do flow alvo, grava `_goto_flow_execution_id`, mas o flow alvo **nunca roda** (fica `running` parado).
- **Causa:** o dispatcher (`packages/flow-engine/src/dispatcher.ts` `runStep`) não lê `_goto_flow_execution_id` para enfileirar. Seam documentado em `go_to_flow.handler.ts:16`.
- **Fix:** após `advance`/persist do step, se `mergedVars['_goto_flow_execution_id']` é string, `deps.queue.enqueueStep({...})`. ~3 linhas + teste.

### B4. Triggers `stage_change` e `tag_added` nunca disparam 🔴 ALTO
- **Sintoma:** um flow com trigger `stage_change` ou `tag_added` está ativo, casa a regra, mas **não é disparado** quando o deal muda de stage / tag é aplicada.
- **Causa:** `dispatchTriggersForStageChange`/`dispatchTriggersForTagAdded` existem, têm teste e são exportados — mas **não têm chamador em runtime** (só `dispatcher.test.ts` e o re-export em `index.ts`). O hook `onStageChanged` (`apps/api/src/services/deal-hooks.ts`) só liga socket + automations (F5-S06), **não** o flow trigger.
- **Fix:** ligar o dispatch de flow trigger no seam de stage change (deal-move) e na aplicação de tag. Cuidado: `deal-hooks` está em `apps/api` e o dispatcher em `apps/workers` — provavelmente publicar um evento/enfileirar em vez de import cross-app (seguir padrão `pending_automations` ou um job MQ dedicado).
- **Nota:** a memória [[tagix-f5-decomposition]] dizia que F5-S16 "fechou os stubs"; o handler/efeito foi feito, mas a **emissão do trigger** ficou desconectada.

### B5. Triggers `new_lead` e `system_event` não têm emissor 🟡 BAIXO
- **Sintoma:** disponíveis na UI (`flow-builder/nodes/trigger/config.ts`), mas `evaluateTrigger` retorna `false` no caminho de mensagem e não há emissor de "contato criado"/"evento interno".
- **Fix (escolher):** (a) ligar emissores reais (contato criado → new_lead; eventos internos → system_event), ou (b) ocultar da UI até existir emissor, evitando trigger morto. Recomendo (a) p/ new_lead (alto valor), (b) ou backlog p/ system_event.

### B6. `meta_flow` (WhatsApp Flows) não tem caminho de envio 🟠 MÉDIO (mais profundo)
- **Sintoma:** node `meta_flow` executa e monta payload, mas **nenhuma camada** abaixo sabe enviar: não há `OutboundJob` kind `meta_flow`, o `InteractivePayloadSchema` não tem variante `flow`, e o serializer WhatsApp (`serializeInteractive`) só trata `buttons`/`list`.
- **Fix (3 camadas):** (1) novo `OutboundJob` kind (`meta_flow` ou `interactive type=flow`); (2) serializer `interactive` Cloud API `type:'flow'` (`action.name='flow'`, `flow_token`, `flow_id`, `flow_cta`, `flow_action_payload`); (3) método no adapter + bridge no publisher.
- **Dependência externa:** exige WhatsApp Flow **publicado** na Meta + Flow ID (Categoria C3).

---

## 3. Categoria C — Dependências de infra/app da Meta (externas ao código)

Estas **não são bugs** — são pré-requisitos para *executar e verificar* envio real. Mesmo com B1–B6 corrigidos, o E2E só fecha com:

- **C1. Canal WABA conectado:** Business verificado, número de telefone, system user token, assinatura de webhook ativa. Sem isso, nenhum envio real ocorre (vale para texto/mídia também — hoje "pronto" = pronto *dado um canal*).
- **C2. Templates HSM aprovados** no Meta Business Manager (pré-req do node `template`/B2). Nome + idioma + componentes precisam existir e estar `APPROVED`.
- **C3. WhatsApp Flow publicado** na Meta + Flow ID e asset de tela (pré-req do node `meta_flow`/B6).
- **C4. Permissões / App Review:** `whatsapp_business_messaging`, etc. (e permissões IG, se usar canal Instagram).
- **C5. Janela 24h / opt-in:** envio fora da janela exige template (regra Meta) — já tratada para IG no `dispatch.ts`; para WA o `template` é a saída (depende de B2+C2).

**Recomendação:** montar um workspace de staging com 1 canal WABA real (sandbox ou número de teste) + 1 template `APPROVED` + 1 Flow publicado, para validar B1/B2/B6 de verdade. Sem isso, as correções só são testáveis até a borda (job enfileirado correto), não no recebimento no celular.

---

## 4. Itens de hardening a confirmar (verificar antes de fechar)

- **V1. Validação pré-publish** (`validateFlow`): a spec §9.3 promete detecção de ciclos, nodes inalcançáveis e variáveis desconhecidas. Confirmar que `packages/flow-engine/src/validation.ts` implementa os três (há `validation.test.ts`).
- **V2. DLQ de `hm.q.flow.execution`** (spec §6.3): confirmar que falhas 3× vão para DLQ e que há visibilidade/reprocesso (worker faz nack→DLX; falta painel/reprocesso?).
- **V3. external_notify com payload interactive:** se o usuário configurar external_notify com conteúdo interativo, cai no mesmo no-op da B1. Confirmar escopo (hoje texto funciona).
- **V4. Retry policy por node** (spec §6.1): o `http_request`/`external_notify` declaram retry policy na UI — confirmar que o dispatcher honra `retryPolicy` (hoje vejo `fallbackEdgeHandle`, mas não retry com backoff).
- **V5. UI v2:** F31 reporta e2e Playwright verde; recomendo um passe de verificação manual dos inspectors de interactive/template/meta_flow após B1/B2/B6 (pra UI refletir o que de fato envia).

---

## 5. Plano de correção (decomponível em slots)

Proposta de fase **F32 — Flow Builder Production Hardening**. Ordenada por valor/risco e com dependências explícitas. Cada item ~1 slot.

### Onda 1 — desbloqueio de envio (paralela; sem dependência entre si)
- **S01 — Bridge `interactive`** (B1). Mapear `kind`→`type` + campos, emitir job `interactive`. Testes de tradução + e2e até borda.
- **S02 — Bridge `template`/HSM** (B2). Detectar `kind:'template'`, emitir job `template`. Testes.
- **S03 — Wire `go_to_flow`** (B3). Dispatcher enfileira `_goto_flow_execution_id`. Teste de encadeamento + guard MAX_DEPTH.

### Onda 2 — triggers que faltam (depende de definir o seam de evento)
- **S04 — Wire trigger `stage_change`** (B4, parte 1). Ligar `dispatchTriggersForStageChange` no seam de deal-move (via MQ/evento, sem import cross-app). Teste de disparo.
- **S05 — Wire trigger `tag_added`** (B4, parte 2). Idem na aplicação de tag.
- **S06 — Trigger `new_lead`** (B5). Emissor em criação de contato → dispatch. (`system_event`: decidir wire vs ocultar — pode ser sub-tarefa ou backlog.)

### Onda 3 — meta_flow (3 camadas; maior, isolável)
- **S07 — Send path `meta_flow`** (B6). Novo kind + serializer `interactive type=flow` + adapter + bridge no publisher. Depende de C3 só para E2E real.

### Onda 4 — hardening / verificação
- **S08 — Validação pré-publish completa** (V1) — fechar ciclos/inalcançáveis/vars.
- **S09 — Retry policy por node + DLQ visível** (V2, V4).
- **S10 — Passe de QA/UX dos inspectors interactive/template/meta_flow** (V3, V5) + e2e com canal de staging.

### Trilha paralela (infra, não-código) — pré-req de verificação E2E
- **C-infra — Provisionar staging Meta:** canal WABA de teste (C1) + template `APPROVED` (C2) + WhatsApp Flow publicado (C3) + permissões (C4). Não é slot de código; é setup de ambiente, mas **bloqueia a verificação real** de S01/S02/S07.

---

## 6. Mapa rápido "node type → estado real em produção"

| Node | UI | Executa | Efeito externo real | Bloqueio |
|---|---|---|---|---|
| trigger | ✅ | ✅ | n/a | — |
| message (texto/mídia) | ✅ | ✅ | ✅ | C1 (canal) |
| interactive | ✅ | ✅ | ❌ no-op | **B1** (+C1) |
| template | ✅ | ✅ | ❌ no-op | **B2** (+C2) |
| meta_flow | ✅ | ✅ | ❌ sem caminho | **B6** (+C3) |
| wait / wait_for_response / input | ✅ | ✅ | ✅ | — |
| condition / switch / ab_split | ✅ | ✅ | ✅ | — |
| go_to_flow | ✅ | ✅ (cria) | ⚠️ alvo não roda | **B3** |
| ai_action / change_status / assign | ✅ | ✅ | ✅ | — |
| add_tag / remove_tag / move_stage | ✅ | ✅ | ✅ | — |
| set_variable / register_conversion | ✅ | ✅ | ✅ | — |
| http_request | ✅ | ✅ | ✅ | — |
| external_notify (texto) | ✅ | ✅ | ✅ | — (interactive → B1) |

| Trigger | Estado real |
|---|---|
| manual | ✅ |
| keyword / new_message | ✅ |
| flow_submission | ✅ |
| stage_change / tag_added | ❌ não disparam — **B4** |
| new_lead / system_event | ❌ sem emissor — **B5** |
