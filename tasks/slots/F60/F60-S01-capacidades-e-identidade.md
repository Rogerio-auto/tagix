---
id: F60-S01
title: Capacidades negociadas do adapter e identidade do contato
phase: F60
status: review
priority: critical
estimated_size: M
depends_on: []
blocks: [F60-S02, F60-S03, F60-S06]
source_docs:
  - docs/features/CANAIS_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T14:09:12Z
completed_at: 2026-09-09T14:22:03Z

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

## Decisoes tomadas na execucao (2026-09-09)

1. **Capacidades em modulo novo (`capabilities.ts`), nao dentro de `types.ts`.** `AdapterCapabilities`
   fica intacta e os tres adapters existentes nao mudam **uma linha** — que era o requisito. O
   conjunto novo vive ao lado e e consultado por quem monta mensagem.
2. **`capabilitiesFromLegacy` como ponte, nao como destino.** Enquanto os adapters nao declararem por
   conta propria, o conjunto e derivado dos booleanos que ja existem. Assim o composer e o wizard de
   campanha ja funcionam com WhatsApp, Instagram e WAHA hoje. O JSDoc diz explicitamente que e ponte.
3. **Nomes por habilidade de composicao, nao por provider.** `approved_template_required` em vez de
   `templatesHSM`; `threading` em vez de `emailThread`. Ha um teste que reprova qualquer capacidade
   cujo nome contenha `meta|whatsapp|instagram|waha|hsm|story` — e a guarda contra o vicio que este
   modulo existe para evitar.
4. **`ChannelLimits` separado das capacidades.** "Tem segmentacao" e booleano; "160 caracteres por
   segmento" e numero. Misturar os dois num objeto so foi como a lista antiga cresceu.
5. **`resolve` LANCA quando acha mais de um contato.** O indice unico garante que nao acontece; se
   acontecer e corrupcao de dado, e escolher o primeiro em silencio esconderia o problema exatamente
   no caminho que decide para quem a mensagem vai.
6. **Este slot nao funde contatos** — so resolve e sugere. `suggestMerge` devolve os ids distintos e
   ha teste garantindo que nada e apagado. Fusao errada mistura historico de duas pessoas e nao tem
   desfazer real; e slot proprio, com confirmacao humana.
7. **Telefone normalizado so com digitos.** Guardar com e sem `+` criaria duas identidades para o
   mesmo numero. O `+` do E.164 e reconstruido na exibicao.
8. **O unico e por workspace**, entao duas empresas clientes podem ter o mesmo consumidor — que e o
   caso real e esta testado.

## Resultado

`@hm/channels` 119 verdes (10 novos) · `@hm/db` 135 verdes (15 novos) · migration 0072 com RLS e
backfill idempotente de `contacts.phone`/`contacts.email`.
