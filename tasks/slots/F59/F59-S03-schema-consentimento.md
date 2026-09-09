---
id: F59-S03
title: Consentimento e supressão por canal
phase: F59
status: in-progress
priority: critical
estimated_size: M
depends_on: [F59-S02]
blocks: [F59-S04, F59-S06]
source_docs:
  - docs/features/AGENCIA_PLAN.md
  - docs/features/CANAIS_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T05:43:36Z

---
# F59-S03 — Consentimento e supressão por canal

## Objetivo

Substituir o consentimento único e global de `contacts` por consentimento **por canal e por
finalidade**, com prova auditável, e criar a lista de supressão que o portão de envio consulta.

## Contexto

`contacts` já tem `marketing_opt_in`, `opt_in_method`, `opt_in_source`, `opt_in_at`, `opt_out_at` —
a intuição estava certa, mas é um consentimento só para todos os canais. A lei americana é por canal
e por finalidade: quem aceitou WhatsApp não consentiu SMS de marketing (`AGENCIA_PLAN` §4.4).

## Escopo

### files_allowed

- `packages/db/src/schema/consent.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/repositories/consent.ts`
- `packages/db/drizzle/0070_f59_contact_consents.sql`
- `packages/db/drizzle/meta/**`
- `packages/db/src/**/consent*.test.ts`

### files_forbidden

- `apps/**`
- `packages/shared/**`

## Escopo (faz)

- `contact_consents` — `workspace_id`, `contact_id`, `channel`, `purpose` (`transactional|marketing`),
  `status` (`granted|revoked|never`), `source`, `proof` jsonb (**texto exato exibido, URL, timestamp,
  IP, user agent**), `captured_by`, `market`, `granted_at`, `revoked_at`. Único por
  `(workspace_id, contact_id, channel, purpose)`.
- `contact_suppressions` — supressão por canal **e** global (`channel` nulo = empresa inteira),
  com `reason`, `source`, `created_at`. É a tabela que o portão lê primeiro.
- RLS em ambas, por `workspace_id`, no mesmo PR (regra F0-S04).
- **Migração de dado**: cada `contacts.marketing_opt_in = true` vira uma linha `granted` de canal
  `meta_whatsapp` / `marketing`, preservando `opt_in_method`/`source`/`at` dentro de `proof`.
  Cada `opt_out_at` não nulo vira supressão global com `reason` preservado.
- `contacts.marketing_opt_in` **permanece** por ora, marcado como deprecated em comentário de coluna
  e no JSDoc — remover no mesmo PR quebraria leitores que ainda não migraram.

## Fora de escopo

- O portão que consulta isso (F59-S04).
- Detector de revogação em linguagem natural (F59-S06).
- UI de consentimento (fase de canais).

## Definition of Done

- [ ] Migration `0070` cria as duas tabelas com RLS habilitada e `force row level security`.
- [ ] Teste de integração confirma que outro workspace não lê consentimento nem supressão.
- [ ] Migração de dado é **idempotente**: rodar duas vezes não duplica linha (constraint única cobre).
- [ ] Teste com fixture: workspace com 3 contatos opt-in e 1 opt-out gera 3 `granted` + 1 supressão global.
- [ ] `proof` nunca é nulo em linha `granted` criada pela aplicação; em linha vinda da migração, carrega o que existia com `migratedFrom: 'contacts.marketing_opt_in'`.
- [ ] Escopo de revogação suporta `channel: null` (empresa inteira) desde já — a cláusula que torna isso obrigatório nos EUA entra em 31/01/2027 e migrar consentimento depois é o pior tipo de migration.
- [ ] Repositório expõe `getConsent`, `grantConsent`, `revokeConsent`, `isSuppressed` — todos sob RLS.

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/db test
pnpm --filter @hm/db lint
```

## Notas

- `proof` é o que sustenta a defesa se alguém contestar. Guardar o **texto exibido**, não um
  identificador de versão de texto: o texto pode mudar e a prova precisa valer no dia em que foi dada.
- IP em `proof` é dado pessoal — entra na política de retenção existente (`retention` worker),
  não fica para sempre.

## Decisões tomadas na execução (2026-09-09)

1. **`repos/consent.ts`, não `repositories/consent.ts`.** A spec do slot inventou o caminho; a
   convenção real do pacote é `packages/db/src/repos/`. Segui a convenção.
2. **Dois índices únicos parciais em vez de um UNIQUE com `channel`.** No Postgres `NULL` nunca é
   igual a `NULL`, então um UNIQUE comum permitiria duplicar exatamente a supressão global — a que
   mais precisa ser única. `uq_contact_suppressions_global` (WHERE channel IS NULL) e
   `uq_contact_suppressions_channel` (WHERE channel IS NOT NULL) resolvem.
3. **O opt-in migrado vira consentimento de `meta_whatsapp`, não de todos os canais.** É o canal em
   que o consentimento foi de fato obtido e o único que a prova sustenta. Espalhar para SMS e e-mail
   seria inventar consentimento que ninguém deu — exatamente o que o slot existe para impedir.
4. **Todo opt-out migrado vira supressão de EMPRESA (`channel = null`).** Quem pediu para sair não
   pediu para sair de um canal só; o escopo mais restritivo é o seguro.
5. **`revoke()` suprime e revoga na mesma chamada.** Separar deixaria uma janela em que o contato
   revogou mas ainda passa pelo portão até alguém lembrar de criar a supressão.
6. **CHECK `contact_consents_granted_at_chk`** — linha `granted` sem `granted_at` é prova incompleta
   e não deve existir.
7. **`contacts.marketing_opt_in` mantida e marcada como deprecated** via `COMMENT ON COLUMN`.
   Remover no mesmo PR quebraria leitores ainda não migrados.
