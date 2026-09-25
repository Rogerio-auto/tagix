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

## Definition of Done

- [ ] teste: etiqueta fora da allowlist → recusada; etiqueta de conversão sem `allow_agent_conversions` → recusada, sem conversão criada
- [ ] teste: chave de `custom_fields` fora da allowlist de escrita → recusada, sem nada gravado
- [ ] teste: `department_id` de outro workspace → mesma resposta que inexistente
- [ ] teste: `tool_logs.params` sem `display_name` nem valores de `custom_fields` em claro
- [ ] teste: execução `running` antiga → 403
- [ ] teste: marca humana sobrevive a pausa e retomada
