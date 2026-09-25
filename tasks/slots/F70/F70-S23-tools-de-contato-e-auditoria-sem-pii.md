---
id: F70-S23
title: Tools de contato com allowlist de escrita, auditoria sem PII e execução com prazo
phase: F70
status: in-progress
priority: high
estimated_size: M
depends_on: [F70-S15]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S15-tools-dos-agentes-endurecidas.md
agent_id: backend-engineer
claimed_at: 2026-09-25T12:33:56Z

---
# F70-S23 — Tools de contato com allowlist de escrita, auditoria sem PII e execução com prazo

> Segunda auditoria de segurança pré-deploy (25/09): MEDIUM-1, MEDIUM-2, L-a, L-b, L-c, L-f, L-g e a nota funcional do M2.

## Objetivo

O modelo não conseguir, pelas tools de contato, nada que o operador não liberou explicitamente para aquele agente, e o `tool_logs` não guardar dado pessoal em claro.

## Contexto

- **MEDIUM-1:** `add_contact_tag` aceita qualquer etiqueta existente. O trigger `fn_contact_tags_register_conversion` (0027) registra conversão ao inserir etiqueta mapeada em `conversion_tag_triggers`, o que contorna o `allow_agent_conversions` e a habilitação de `register_conversion`.
- **MEDIUM-2:** `update_contact` grava qualquer chave de `custom_fields`. A leitura tem allowlist; a escrita não.
- **L-a:** `transfer_to_human` grava `department_id` dos args sem checar o tenant.
- **L-b:** `redactLogArgs` só mascara chaves de primeiro nível. `display_name`, os valores de `custom_fields` e os campos das tools de calendário vão crus.
- **L-c:** `authorizeToolCall` aceita execução `running` sem prazo.
- **L-f:** `display_name` gravado pelo modelo volta ao prompt em todo turno.
- **L-g:** o catálogo da 0087 declara `["string","null"]`, mas o Zod recusa `null`.
- **Nota M2:** uma conversa ligada por humano, sem origem, perde a marca quando a IA é pausada por human takeover e retomada automaticamente.

## Escopo

### files_allowed

- `apps/api/src/internal/tools/**`
- `apps/agent-runtime/**`
- `packages/db/src/seed/tools_agent*.ts`
- `packages/db/drizzle/**` *(se o catálogo precisar de migração de dados: 0089, depois verificar o journal)*
- `apps/workers/src/agents/reengagement.ts`
- `apps/workers/src/agents/*.test.ts`

## Escopo (faz)

- `add_contact_tag`: `allowed_tags` na config por agente, vazio por padrão (negação). Mesmo com `allowed_tags`, recusar etiqueta mapeada em `conversion_tag_triggers` quando o agente não tem `allow_agent_conversions`.
- `update_contact`: `custom_fields_write_keys` na config por agente, vazio por padrão.
- `display_name`: sem quebra de linha, sem colchetes, sem caracteres de controle, até 80 caracteres.
- `transfer_to_human`: `department_id` passa por `requireRefsInWorkspace`, com a mesma resposta para "não existe" e "é de outro workspace".
- `redactLogArgs`: allowlist por tool do que pode ser registrado; o resto é mascarado recursivamente.
- `authorizeToolCall`: execução precisa ter `started_at` recente (configurável, padrão de 15 minutos).
- Contrato: o catálogo e o Zod dizem a mesma coisa sobre `null`.
- Retomada automática (`reengagement.ts`): conversa que tinha marca humana válida antes da pausa por human takeover mantém a elegibilidade depois de retomar. Decidir e documentar a regra fail-closed.
- O seed da Arcada **não** libera `add_contact_tag` para etiquetas de conversão; `atendimento-humano` fica na allowlist.

## Entregue

**Config das tools lida do banco.** A barreira (`apps/api/src/internal/tools/access.ts`) passa a
devolver, junto do `tools.id` vencedor, o `handler_config` dessa linha e o `agent_tools.overrides`
do vínculo com o agente. O router entrega isso ao handler num 3º parâmetro (`ToolHandlerContext`,
`registry.ts`). O runtime e o modelo não mandam config nenhuma que o Node use.

**MEDIUM-1 — `add_contact_tag`** (`contact-handlers.ts`):
- `allowed_tags`: nomes exatos, comparados com o nome gravado da etiqueta resolvida. Sem lista,
  recusa antes de consultar o banco.
- Etiqueta mapeada em `conversion_tag_triggers` só é aplicada se o agente puder registrar
  conversões: `workspace_agent_policies.allow_agent_conversions` ligado **e** `register_conversion`
  habilitada para ele, pela mesma resolução da barreira (`isToolEnabledForAgent`).
- "Não existe" e "não liberada" respondem igual. A resposta lista as etiquetas liberadas, que são
  vocabulário do operador, e nunca repete o texto do modelo.

**MEDIUM-2 — `update_contact`:** `custom_fields_write_keys`. Uma chave fora da lista recusa a
chamada inteira, e nada é gravado, nem os campos fixos. A mensagem traz a contagem e as chaves
liberadas, nunca as recusadas: elas vão para `tool_logs.error`.

**L-f — `display_name`:** no Node, até 80 caracteres e sem `Cc`/`Cf`/`Zl`/`Zp` (quebra de linha, tab,
zero-width), `[]`, `{}`, `<>` ou `⟦⟧`. Fora disso, recusa em vez de corrigir. No runtime,
`build_prompt._prompt_contact_name` faz o mesmo com o nome que chega por outro caminho (perfil do
WhatsApp, importação): uma linha, sem delimitadores e invisíveis, cortado em 80.

**L-g — `null`:** nas propriedades de primeiro nível, o Node aceita `null` exatamente onde o
catálogo o declara. Em `update_contact`, `null` quer dizer "não informado", e o runtime nem o envia
(`_envelope`). Dentro de `custom_fields`, `null` continua sendo valor. `transfer_to_agent.reason`
passou a `nullish`. O teste confronta o `schema` do catálogo no banco com
`WORKFLOW_TOOL_ARG_SCHEMAS`, propriedade por propriedade e nos dois sentidos.

**L-a — `transfer_to_human`:** `department_id` passa por `requireRefsInWorkspace`. Tanto para "não
existe" quanto para "é de outro workspace" a resposta é a mesma (`Departamento não encontrado.`,
422), e a conversa não muda.

**L-b — `tool_logs`** (`log-redaction.ts`):
- Cada tool registrada tem uma política declarada campo a campo, para `params` e para `result`,
  com os tipos `id`, `token`, `number`, `boolean`, `datetime`, `text`, `shape`, `each` e `fields`.
- O que a política não declara é mascarado recursivamente: fica só a forma, como
  `[redacted:string]`, mantendo as chaves, também mascaradas.
- Tool sem política tem tudo mascarado. `display_name` e `custom_fields` são `shape`.
- `tool_logs.error` passa pela mesma máscara de texto, com teto de 300.
- Um teste trava que toda tool registrada no endpoint tem política.

**L-c — prazo da execução:** `started_at < clock_timestamp() - make_interval(secs => N)` resulta em
403 `execution_expired`, logado. N vem de `AGENT_TOOL_EXECUTION_MAX_AGE_SECONDS`, inteiro de 60 a
86400, com padrão de 900 s. Valor inválido cai no padrão e nunca desliga o prazo.
`createToolCallAuthorizer({ executionMaxAgeSeconds })` para injeção.

**Nota M2 — retomada** (migração **0089**, `reengagement.ts`): função
`public.conversation_ai_resume_keeps_human_mark`. O trigger `trg_conversations_ai_enable_mark`
passa a usá-la, e o UPDATE do reengajamento também (via `OR` com a trava de origem).

**Catálogo:** as descrições de `add_contact_tag`/`update_contact` falam da allowlist, e
`display_name` agora tem `maxLength` 80. Tudo foi gerado do TS na 0089 (`AGENT_TOOL_MIGRATIONS`).

**Arcada:** `tools_agent_grants.ts` (`ARCADA_AGENT_TOOL_OVERRIDES`) libera `add_contact_tag` só para
`atendimento-humano`. `ia-arcada` e `esfriou` são dos flows, e etiqueta de conversão não entra
nunca. `update_contact` não tem campo liberado. Ligar isso ao seed está nas Pendências.

## Decisões

### Onde o operador libera a escrita (sem UI ainda)

- **Por agente:** `agent_tools.overrides` do vínculo agente ↔ tool. Exemplos:
  `{"allowed_tags": ["atendimento-humano"]}` e `{"custom_fields_write_keys": ["interesse"]}`.
- **Teto do workspace (opcional):** tool custom do workspace com a mesma key (`tools.workspace_id =
  <ws>`), que já vence a global na resolução, com a lista em `handler_config`.
- **Resolução** (`resolveWriteAllowlist`):
  - vale o override do agente; sem override, a lista do `handler_config`; sem as duas, `[]`;
  - se o `handler_config` declara a lista, ela é teto e o override só escolhe dentro dela
    (interseção). O override por agente não amplia o que o operador fixou;
  - formato inválido conta como `[]` (fail-closed);
  - o catálogo global não declara as listas, e um teste trava isso: declarar ali viraria teto ou
    concessão para todo workspace.
- **SQL de exemplo** até existir UI:
  ```sql
  UPDATE agent_tools at SET overrides = at.overrides || '{"allowed_tags":["atendimento-humano"]}'
  FROM tools t WHERE t.id = at.tool_id AND t.key = 'add_contact_tag' AND at.agent_id = '<agente>';
  ```

### "O agente tem `allow_agent_conversions`"

A política é por workspace. Por isso a regra exige também `register_conversion` habilitada para o
agente, que é o que o operador escolhe por agente. A etiqueta de conversão é outro caminho para a
mesma conversão e passa pelas duas travas.

### Nota M2 — a marca humana na retomada automática (fail-closed)

A retomada **preserva** a marca humana se, no estado anterior ao UPDATE:
- `ai_mode = 'paused'` e `ai_paused_reason = 'human_takeover'`. Essa pausa só nasce de `on`
  (`planHumanReply`);
- `ai_enabled_at <= ai_paused_at`, ou seja, a marca foi gravada antes da pausa;
- `ai_auto_enabled_at` é NULL ou anterior a `ai_enabled_at`, ou seja, a marca ainda valia.

Qualquer campo NULL, pausa `manual`, IA `off` ou marca vencida faz o trigger carimbar
`ai_auto_enabled_at` como antes. Assim, **todo `on` automático a partir de `off` continua
invalidando a marca.**

A regra mora numa função só do banco, usada pelo trigger e pelo reengajamento. Com isso, os dois
não divergem, e qualquer caminho automático futuro que retome uma pausa de atendente herda a mesma
regra.

Os relógios diferem: `ai_paused_at` vem do app ou da mensagem, e `ai_enabled_at` vem do
`clock_timestamp()`. Uma distorção entre eles só pode fazer a marca **não** sobreviver.

### Migração 0089 (`when` 1781452850000)

Não é só catálogo: troca a função do trigger. Na hora do merge, a main não tinha 0089. Se a F70-S21
entrar antes com uma 0089, esta vira 0090, com `when` maior que o dela, e `AGENT_TOOL_MIGRATIONS` e o
journal acompanham. **Já está aplicada no Postgres dev compartilhado.**

## Pendências fora da fronteira

- **Seed da Arcada** (`packages/db/src/seed/agent_templates_arcada.ts`, F70-S06, fora do
  `files_allowed`). O insert de `agent_tools` precisa gravar
  `overrides: seededToolOverrides(ARCADA_AGENT_TOOL_OVERRIDES, t.key)`. Também precisa atualizar os
  vínculos que já existem, porque hoje é `onConflictDoNothing`. Enquanto isso não entrar, o agente
  da Arcada tem `add_contact_tag` e nenhuma etiqueta liberada, e `atendimento-humano` é recusada.
  No workspace real, basta o SQL da seção Decisões. Registrado em `tasks/COMMS.md`.
- UI de configuração das allowlists (etiquetas e campos por agente) no editor de tools do agente.
- `schedule_event` ainda aceita `contact_id` do modelo (outro contato do workspace). Não é
  vazamento entre tenants, mas é o mesmo padrão H1 da F70-S15.
- `.env.example`: documentar `AGENT_TOOL_EXECUTION_MAX_AGE_SECONDS` (opcional, padrão 900).

## Riscos

- **Agentes em produção com `add_contact_tag`/`update_contact`:** passam a ter a escrita recusada
  até o operador liberar. É intencional, porque a negação é o padrão. Consulta para saber quem
  é afetado:
  ```sql
  SELECT a.workspace_id, a.id, a.name, t.key FROM agent_tools at
  JOIN agents a ON a.id = at.agent_id JOIN tools t ON t.id = at.tool_id
  WHERE at.is_enabled AND t.key IN ('add_contact_tag','update_contact');
  ```
- **Execução longa:** um turno que chame uma tool mais de 15 minutos depois do `started_at` é
  recusado. O runtime tem no máximo 5 iterações e callbacks de 15 s, então isso não deve acontecer
  hoje.
- **`display_name` mais restrito:** agora vai até 80 e sem colchetes, contra 200 antes. Isso vale só
  para o que o modelo grava; nomes que já existem não mudam.

## Validação

Executado em 25/09 contra o Postgres dev (`localhost:5442`), com a 0089 aplicada e a main mesclada.

- API `src/internal/tools`: 9 arquivos, 80/80. Novos:
  - `contact-tools-allowlist.integration.test.ts` 16/16 (MEDIUM-1/2, L-a/b/c/f/g);
  - `log-redaction.test.ts` 8/8;
  - `router.test.ts` 17/17 (L-b pelo router e config que chega ao handler).
- Worker: `reengagement-human-mark.test.ts` 3/3 (nota M2, banco real), `reengagement*.test.ts`,
  `run*.test.ts`, `agents.test.ts`.
- DB: `tools_agent.test.ts` 10/10, `tools_agent_grants.test.ts` 4/4.
- Runtime: `test_build_prompt.py`, `test_tools_hardening.py` e vizinhos, 92/92. `ruff` limpo.

```bash
python scripts/slot.py check-migrations
pnpm --filter @hm/db migrate
node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit -p apps/api
node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit -p apps/workers
pnpm --filter @hm/db typecheck
pnpm --filter @hm/api exec vitest run src/internal/tools --maxWorkers=2
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/agents/reengagement-human-mark.test.ts src/agents/reengagement-origin-gate.test.ts src/agents/reengagement.test.ts src/agents/run-origin-gate.test.ts src/agents/run.test.ts src/agents/agents.test.ts --maxWorkers=2
pnpm --filter @hm/db exec vitest run src/seed/tools_agent.test.ts src/seed/tools_agent_grants.test.ts --maxWorkers=2
python -m uv --directory apps/agent-runtime run --frozen pytest tests/test_build_prompt.py tests/test_tools_hardening.py tests/test_tools_workflow.py tests/test_graph.py tests/test_tools_registry.py tests/test_load_context.py -q
python -m uv --directory apps/agent-runtime run --frozen ruff check app tests/test_build_prompt.py tests/test_tools_hardening.py
```

## Definition of Done

- [x] teste: etiqueta fora da allowlist → recusada; etiqueta de conversão sem `allow_agent_conversions` → recusada, sem conversão criada (`contact-tools-allowlist.integration.test.ts`)
- [x] teste: chave de `custom_fields` fora da allowlist de escrita → recusada, sem nada gravado
- [x] teste: `department_id` de outro workspace → mesma resposta que inexistente
- [x] teste: `tool_logs.params` sem `display_name` nem valores de `custom_fields` em claro (integração + `router.test.ts`)
- [x] teste: execução `running` antiga → 403 (`execution_expired`)
- [x] teste: marca humana sobrevive a pausa e retomada (`reengagement-human-mark.test.ts`, banco real; `on` automático a partir de `off` continua invalidando)
