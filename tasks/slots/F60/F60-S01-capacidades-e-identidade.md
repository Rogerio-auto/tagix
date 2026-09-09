---
id: F60-S01
title: Capacidades negociadas do adapter e identidade do contato
phase: F60
status: in-progress
priority: critical
estimated_size: M
depends_on: []
blocks: [F60-S02, F60-S03, F60-S06]
source_docs:
  - docs/features/CANAIS_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T14:09:12Z

---
# F60-S01 — Capacidades negociadas do adapter e identidade do contato

## Objetivo

Preparar as duas abstrações que quebram quando e-mail e SMS entram: `AdapterCapabilities`, hoje uma
lista fixa com forma de WhatsApp, e a identidade do contato, hoje ancorada em telefone.

## Contexto

`CANAIS_PLAN` §3.1 e §3.2. Sem isto, cada canal novo acrescenta booleanos irrelevantes ao contrato e
cria contato duplicado — o lead que chegou por e-mail e depois mandou WhatsApp vira duas pessoas, e
o agente responde como se nunca tivesse falado com ele.

## Escopo

### files_allowed

- `packages/channels/src/types.ts`
- `packages/channels/src/capabilities.ts`
- `packages/channels/src/*.test.ts`
- `packages/db/src/schema/contact_identities.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/repos/contact-identities.ts`
- `packages/db/drizzle/0072_f60_contact_identities.sql`
- `packages/db/drizzle/meta/**`
- `packages/db/src/index.ts`
- `packages/db/src/contact-identities.test.ts`

### files_forbidden

- `apps/**`
- `packages/channels/src/meta/**`
- `packages/channels/src/waha/**`

## Escopo (faz)

- **Capacidades declaradas**: manter os booleanos atuais (não quebrar os três adapters) e adicionar
  um conjunto **aditivo e negociável** — `supports(capability)` — cobrindo o que e-mail e SMS
  precisam: `subject`, `htmlBody`, `attachments`, `threading`, `characterLimit`, `segments`, `bcc`.
- `contact_identities`: `workspace_id`, `contact_id`, `kind` (`phone|email|ig_user|fb_user|web_visitor`),
  `value` normalizado, `verified_at`. Único por `(workspace_id, kind, value)`. RLS no mesmo PR.
- Resolução na entrada: `resolveContactByIdentity` — dado (kind, value), acha o contato.
- Backfill: `contacts.phone` e `contacts.email` existentes viram linhas de identidade.

## Fora de escopo

- **Fusão de contatos** — é o passo perigoso e merece slot próprio com confirmação humana
  (`CANAIS_PLAN` §3.2). Aqui só resolve e sugere; não funde.
- Adapters novos (F60-C em diante).

## Definition of Done

- [ ] Os três adapters existentes continuam compilando **sem alteração** — a extensão é aditiva.
- [ ] `contact_identities` com RLS testada e único por `(workspace, kind, value)`.
- [ ] Normalização por tipo: e-mail minúsculo e sem espaço; telefone só dígitos com E.164 quando houver país.
- [ ] Backfill idempotente de `contacts.phone`/`contacts.email` — rodar duas vezes não duplica.
- [ ] `resolveContactByIdentity` devolve no máximo um contato; colisão é erro explícito, não escolha silenciosa.
- [ ] Teste: lead por e-mail + mensagem de WhatsApp depois **sugere** fusão e não funde sozinho.

## Validação

```bash
pnpm --filter @hm/channels typecheck
pnpm --filter @hm/channels test
pnpm --filter @hm/db typecheck
pnpm --filter @hm/db test
pnpm lint
```

## Notas

- Fundir contato errado mistura o histórico de duas pessoas e é irreversível na prática. Por isso
  este slot **não funde** — só cria a base para sugerir.
- O índice único por `(workspace, kind, value)` é o que impede dois contatos com o mesmo e-mail.
