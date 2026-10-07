---
id: F70-S36
title: Nome do perfil do canal salvo à parte e devolvido na lista de conversas
phase: F70
status: in-progress
priority: high
estimated_size: M
depends_on: []
blocks: [F70-S37]
source_docs:
  - apps/workers/src/inbound/db-ports.ts
  - docs/DATA_MODEL.md
agent_id: backend-engineer
claimed_at: 2026-10-07T17:27:13Z

---
# F70-S36 — Nome do perfil do canal salvo à parte e devolvido na lista de conversas

## Objetivo

O contato guarda, num campo próprio, o nome que a pessoa usa no WhatsApp/Instagram (pushname), sempre atualizado e sem nunca sobrescrever o nome salvo no sistema. A lista e o detalhe de conversas passam a devolver os dois nomes, para a interface aplicar a hierarquia **nome no sistema → nome do perfil → telefone**.

## Contexto (relato do Rogério, 07/10)

- A lista de conversas mostra só o número, embora o pushname esteja salvo nas informações do contato.
- Causa: `ChatListItem` renderiza `conversation.remoteId` e o `GET /api/conversations` não devolve nada do contato. O cabeçalho da conversa faz o mesmo (`detail.remoteId`).
- Hoje o pushname vai para `contacts.display_name` só quando ele está vazio (`fillContactName`, F61-S12). Não há como distinguir o nome do sistema do pushname, e a pessoa que troca o nome no WhatsApp nunca é atualizada.

## Escopo (faz)

- Migração `0095_f70_contact_profile_name.sql`:
  - `contacts.profile_name text null`;
  - `contacts.profile_name_updated_at timestamptz null`;
  - backfill best-effort: se mensagens/eventos guardados tiverem o nome do perfil (conferir onde o `contactName` do parser fica persistido, ex.: metadata da mensagem ou do evento WAHA), preencher `profile_name` com o mais recente. Se não houver fonte confiável, não inventar: registrar no slot.
- Worker de inbound (`fillContactName`):
  - grava `profile_name` com o nome do perfil da mensagem mais recente, **sempre que mudar** (update condicional `profile_name is distinct from $nome`), mais o `profile_name_updated_at`;
  - mantém o comportamento atual de preencher `display_name` só quando vazio. Não remover: agente, campanhas, API v1 e flows leem `display_name`;
  - vale para Meta WhatsApp, WAHA e Instagram, se o parser trouxer o nome. Coexistência (eco do app) não grava nome do perfil do contato.
- API:
  - `GET /api/conversations` (lista) passa a devolver `contactDisplayName` e `contactProfileName` via join em `contacts`. Sem N+1: um join na query existente, conferindo o plano (`EXPLAIN`) e os índices;
  - `GET /api/conversations/:id` devolve `profileName` no objeto `contact`;
  - a busca da lista, se existir, passa a casar também por `display_name`/`profile_name` (`ILIKE`, com índice se a query já usa um).
- Testes: o worker atualiza o `profile_name` quando o nome muda e não toca no `display_name` preenchido; a lista devolve os campos; isolamento por workspace (RLS) mantido.

## Fora de escopo

- Interface (F70-S37).
- Trocar `display_name` por um resolvedor no agente, nas campanhas e na API v1 (follow-up, se o Rogério quiser).

### files_allowed

- `packages/db/src/schema/contacts.ts`
- `packages/db/drizzle/**`
- `packages/db/src/**/*.test.ts`
- `apps/workers/src/inbound/**`
- `apps/workers/src/coexistence/**` (só se precisar ignorar o nome no eco)
- `packages/channels/src/**/webhook.parser.ts` + testes (só se o Instagram precisar expor o nome)
- `apps/api/src/routes/conversations/**`
- `docs/DATA_MODEL.md`

### files_forbidden

- `apps/web/**` (F70-S37)

## Definition of Done

- [ ] migração aplicada no dev, idempotente; `check-migrations` OK
- [ ] teste: o nome do perfil muda → `profile_name` atualiza; o `display_name` preenchido pelo humano fica intacto
- [ ] teste: contato novo sem nome → `display_name` e `profile_name` preenchidos (compatibilidade)
- [ ] teste: lista e detalhe devolvem os campos novos; sem query por linha
- [ ] RLS/isolamento entre workspaces mantido (teste existente verde)
- [ ] DATA_MODEL atualizado

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/api typecheck
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/inbound --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/routes/conversations --maxWorkers=1
```

## Notas

- Agente: `db-engineer` para a migração + `backend-engineer` para worker/API (ou um só, em sequência).
- Em produção, contatos antigos só ganham `profile_name` na próxima mensagem, a menos que o backfill ache fonte. A UI cai no `display_name`, que já tem o pushname de muitos.
