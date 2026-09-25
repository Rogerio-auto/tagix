---
id: F70-S06
title: Agente de atendimento da Arcada
phase: F70
status: review
priority: high
estimated_size: M
depends_on: [F70-S04, F70-S05, F70-S07]
blocks: []
source_docs:
  - rogerio-os/tasks/central-operacao/CO-10-agente-de-atendimento-da-arcada.md
agent_id: backend-engineer
claimed_at: 2026-09-25T03:49:20Z
completed_at: 2026-09-25T04:07:10Z

---
# F70-S06 — Agente de atendimento da Arcada

> Espelho do **CO-10** da Central de Operação (`rogerio-os/tasks/central-operacao/`).

## Objetivo

Quem chega por anúncio, Instagram ou site ser atendido 24h e passar para o Rogério na hora certa.

## Contexto

O Leadium tem runtime de agente (LangGraph + OpenRouter, `transfer_to_human`, prompt versionado). Conversa nova nasce com `ai_mode='off'`: sem um Flow, a IA não atende.

## Escopo

### files_allowed

- `packages/db/src/seed/agent_templates*.ts` *(template novo, opcional)*
- configuração do agente e do flow pela UI ou seed

## Escopo (faz)

- Agente "Arcada" com prompt versionado: os 3 níveis (1.000 / 2.500 / 5.000), qualificação (clínica, tem site, decisor, prazo), envio de portfólio, agendamento.
- Passagem para humano: o agente trata objeções e negocia dentro dos limites aprovados e passa para o Rogério **quando o cliente está pronto para fechar**; também em pedido explícito de humano ou irritação.
- Limites aprovados em 24/09: parcelamento em 2x sem juros, até 3x se o cliente insistir (sem desconto); à vista, 10% de desconto, máximo 15%; entrega em até 5 dias úteis.
- Sem resposta: lembrete dentro das 24h, outro no 3º e no 7º dia (modelo aprovado), etiqueta `esfriou` e um toque 30 dias depois.
- Flow `new_lead` / `new_message` → `ai_action ACTIVATE` só para conversas iniciadas pelo cliente com origem comprovada (F70-S05).
- Sonnet via OpenRouter (whitelist do Leadium) e teto de custo por conversa.
- Base de conhecimento (`kb_*`) com FAQ e casos.

## Fora de escopo

- Responder prospecção iniciada pelo Rogério (IA desligada nelas, F70-S04).

## Passos do Rogério 🧑

- Aprovar o prompt e o roteiro antes de ligar.
- Fazer 10 conversas de teste como cliente.

## Entregue (código)

| Arquivo | Conteúdo |
| --- | --- |
| `packages/db/src/seed/agent_templates_arcada.content.ts` | Conteúdo puro: prompt (`buildArcadaSystemPrompt`), limites (`ARCADA_NEGOTIATION_LIMITS`), 4 gatilhos (`ARCADA_HANDOFF_TRIGGERS`), KB (`buildArcadaKbDocuments`), cadência (`ARCADA_CADENCE`), `listPendingMarkers()` |
| `packages/db/src/seed/agent_templates_arcada.ts` | `seedArcadaAttendance(tx, workspaceId)` + grafos dos 2 flows |
| `packages/db/src/seed/agent_templates_arcada.run.ts` | CLI `--workspace <slug>` (recusa banco não-local sem `ARCADA_SEED_ALLOW_REMOTE=1`) |
| `packages/db/src/seed/agent_templates_arcada.test.ts` | limites, gatilhos, anti-invenção de números, grafos publicáveis, idempotência no Postgres dev |

O seed é um arquivo novo que NÃO foi registrado em `packages/db/src/seed.ts` (fora de `files_allowed`)
nem ganhou script no `package.json`. Isso é proposital: é conteúdo de UM workspace, e roda à mão:

```text
pnpm --filter @hm/db exec tsx src/seed/agent_templates_arcada.run.ts --workspace <slug-da-arcada>
```

## Decisões

- **Template do WORKSPACE, não global.** O prompt tem preços e limites comerciais do Rogério; um
  `agent_templates` global (`workspace_id IS NULL`) é legível por todo tenant (RLS de leitura global).
- **Números derivados, nunca digitados.** Preços, valor à vista (10%/15%) e parcelas (2x/3x, com o
  último centavo na última parcela) saem das constantes. O teste varre prompt e KB: qualquer `%` fora de
  {10, 15}, `Nx` fora de {2, 3} ou `R$` fora da tabela derivada quebra o build.
- **Nada inventado.** O que só o Rogério sabe virou marcador `{{…}}` (lista abaixo). O prompt manda
  nunca mostrar marcador ao cliente e tratar como "vou confirmar com o Rogério". "Costuma ficar pronto
  antes" veio da instrução do Rogério; o compromisso escrito é "até 5 dias úteis".
- **Modelo:** `anthropic/claude-sonnet-4` (Sonnet mais novo em `llm_models_whitelist`; `defaultPlanKeys`
  = business). O seed falha se o slug não estiver ativo na whitelist e avisa se a policy do workspace
  restringir modelos sem incluí-lo. `model_params = { temperature: 0.4, max_tokens: 600 }`.
- **Teto de custo por conversa: o schema NÃO suporta.** Só existem `max_monthly_cost_usd` (por
  workspace, checado antes de cada turno em `agents-core/cost-guard.ts`), `max_tokens_per_call` e
  `max_iterations`. Mitigação aplicada: `max_tokens: 600` por turno. Recomendado (super-admin, UI de
  policies): `max_monthly_cost_usd` do workspace da Arcada. Teto por conversa exige slot próprio.
- **Versionamento.** 1ª execução: agente + v1 `live` (mesmo contrato do `POST /api/agents`). Execuções
  seguintes nunca tocam o live; se o prompt/modelo do seed mudou e não há versão igual, grava `draft`
  (publica-se pela UI). Comparação de `model_params` canônica (o jsonb reordena chaves — pego pelo teste).
- **Gatilho `new_message`, não `new_lead`.** `evaluateTrigger` (`apps/workers/src/flows-triggers/dispatcher.ts`)
  devolve `false` para `new_lead` e o dispatcher inbound só consulta `keyword`/`new_message`: um flow
  `new_lead` nunca dispararia.
- **Ativação só uma vez por contato.** `new_message` dispara a cada mensagem do cliente e os filtros
  `filter_*` do flow não são aplicados pelo dispatcher. Sem guarda, o flow religaria a IA depois de um
  `transfer_to_human` ou da pausa do eco (F70-S04). Por isso: `HAS_TAG ia-arcada` → fim; senão
  `ai_action ACTIVATE` → `HAS_VALUE ai_activation_blocked` → `true`: fim sem nenhum envio
  (sem-origem/prospecção); `false`: `add_tag ia-arcada`.
- **Cadência sem ciclo.** O publish rejeita ciclos. Cada mensagem do cliente abre uma execução nova da
  cadência; a anterior é retomada pela aresta `response` (`resumeFlowWithResponse`) e termina tirando
  `esfriou`. O relógio conta sempre da última mensagem do cliente: 20h (lembrete livre, dentro da janela
  de 24h) → 3º dia (modelo) → 7º dia (modelo + `esfriou`) → +30 dias (modelo). Antes de cada envio,
  `HAS_TAG atendimento-humano` → para. O 1º gate também exige `ia-arcada`.
  Interpretação a confirmar: o "toque 30 dias depois" conta a partir do `esfriou` (dia 7 → dia 37).
- **Nada ativado:** agente `inactive` (o worker pula `agent_inactive`), flows `draft` sem `flow_versions`
  (o dispatcher só lê `active`), KB `draft` + `visible_to_agents=false` e sem chunks.

## Marcadores a preencher (Rogério)

Prompt + KB: `nivel_1000_inclui`, `nivel_2500_inclui`, `nivel_5000_inclui`, `inicio_do_prazo` (a partir
de quando contam os 5 dias úteis), `links_do_portfolio`, `casos_autorizados` (ex.: Nácar, só o que
puder ser citado), `como_agendar`, `meios_de_pagamento`.
Só KB (FAQ): `material_necessario`, `dominio_e_hospedagem`, `alteracoes_e_manutencao`, `google_e_seo`,
`contrato_e_nota_fiscal`.
Cadência (nome exato do template aprovado na Meta): `modelo_lembrete_dia_3`, `modelo_lembrete_dia_7`,
`modelo_toque_30_dias`. Texto sugerido do lembrete de 24h (aprovar): em `ARCADA_CADENCE.reminderText`.

## Como ligar (depois da aprovação)

1. Preencher os marcadores em `agent_templates_arcada.content.ts` e rodar o seed de novo no workspace.
   Como o agente já existe, o prompt novo entra como **rascunho** (v2); a KB em rascunho é atualizada.
2. Agentes → "Arcada — atendimento" → Versões: revisar o diff e **publicar** a versão preenchida.
3. Base de conhecimento: em cada doc "Arcada — …", **Reprocessar** (indexa e promove a `active`) e
   ligar "visível para agentes".
4. Pré-requisitos técnicos (ver Pendências): tools entregues ao runtime e catálogo `tools` com
   `transfer_to_human`/`search_knowledge_base`/`add_contact_tag` — re-rodar o seed vincula as tools.
5. Agente → status **ativo**. (Ativar o agente ANTES do flow: `ACTIVATE` com agente inativo deixa a
   conversa com `ai_mode='on'` e ninguém responde.)
6. Flows → "Arcada — ligar IA (conversa iniciada pelo cliente)": opcional restringir canais; **Publicar**.
   Conversas elegíveis já em andamento sem a etiqueta `ia-arcada` recebem a IA na próxima mensagem do
   cliente; para evitar, aplicar `ia-arcada` nesses contatos antes de publicar.
7. Flows → "Arcada — cadência sem resposta": trocar os 3 `templateName` pelos modelos aprovados
   (o publish avisa `unknown_var` enquanto houver `{{…}}`), restringir ao canal WhatsApp Cloud
   (template não existe no WAHA nem no Instagram) e **Publicar**. Pode ficar desligado sem afetar o resto.
8. Desligar: despublicar o flow de ativação e pôr o agente em inativo.

## Pendências fora da fronteira

- **BLOQUEANTE para o handoff: o worker não entrega tools ao runtime.** `buildRunRequest`
  (`apps/workers/src/agents/run.ts`) não envia `tools`; o runtime (`app/routes/run.py`) usa
  `req.tools` (default `[]`) e `_tool_specs` devolve `None`. Em produção nenhum agente consegue chamar
  `transfer_to_human` nem `search_knowledge_base`. O prompt tem fallback (avisa e para de negociar), mas
  o DoD "handoff nos 4 gatilhos" depende de um slot que carregue `agent_tools` → `tools` no request.
- **Catálogo `tools` sem as tools de workflow/KB.** No Postgres dev só as de calendar são semeadas
  (`calendar_tools.ts`); `transfer_to_human`, `search_knowledge_base`, `add_contact_tag`, `query_contact`,
  `update_contact` não existem em `tools`. O seed reporta e vincula quando existirem.
- `new_lead` nunca é disparado no caminho inbound (ver Decisões).
- Teto de custo por conversa não existe no schema/runtime.
- Pausa da cadência depende da etiqueta `atendimento-humano` (aplicada pelo agente antes do
  `transfer_to_human`, quando a tool de etiqueta estiver disponível, ou à mão). Quando o Rogério assume
  sem etiqueta, a cadência pode mandar o lembrete. Ideal: `transfer_to_human` e a pausa do eco
  cancelarem as execuções da conversa (`cancelAllForConversation`) ou um operador de condição por `ai_mode`.
- Script `seed:arcada` no `package.json` do `@hm/db` (opcional).

## Validação

Executado em 25/09 contra o Postgres dev (`localhost:5442`): o seed rodou 2x no workspace `dev`, a
2ª rodada criou nada; os grafos passaram no `validateFlow` real e nos schemas Zod dos handlers da
`@hm/flow-engine` (script temporário, não commitado): ativação sem issues; cadência só com os 3 avisos
`unknown_var` dos modelos a preencher.

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/db exec vitest run src/seed/agent_templates_arcada.test.ts --maxWorkers=2
pnpm exec eslint packages/db/src/seed/agent_templates_arcada.ts packages/db/src/seed/agent_templates_arcada.content.ts packages/db/src/seed/agent_templates_arcada.run.ts packages/db/src/seed/agent_templates_arcada.test.ts
```

## Definition of Done

- [x] template + agente "Arcada — atendimento" com prompt versionado (v1), inativo
- [x] flow de ativação (`new_message` → `ai_action ACTIVATE`, ramo `ai_activation_blocked`) e cadência, em rascunho
- [x] KB com FAQ e casos (rascunho, marcadores `{{…}}`)
- [x] seed idempotente no Postgres dev + testes de limites e dos 4 gatilhos
- [ ] tools entregues ao runtime (pendência fora da fronteira; pré-requisito do handoff)
- [ ] marcadores preenchidos e prompt aprovado pelo Rogério
- [ ] 10 conversas de teste aprovadas pelo Rogério
- [ ] handoff testado nos 4 gatilhos
- [ ] custo médio por conversa medido
