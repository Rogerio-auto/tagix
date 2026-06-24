---
id: F47-S04
title: API Card-da-conversa + cadastro read-through + snapshot
phase: F47
status: review
priority: high
estimated_size: M
depends_on: [F47-S01]
blocks: [F47-S06, F47-S07, F47-S09, F47-S11]
agent_id: backend-engineer
source_docs:
  - docs/features/COCKPIT_CLIENT_ENRICHMENT.md
  - docs/features/LIVECHAT_OPS.md
claimed_at: 2026-06-24T00:36:04Z
completed_at: 2026-06-24T00:36:05Z

---
# F47-S04 — Card a partir da conversa + cadastro do contato (read-through + snapshot)

## Objetivo

Permitir criar (e auto-criar) o card da pipeline a partir de uma conversa, estender o cadastro do
contato (endereço/documento) e expor o cadastro vivo do contato no detalhe do deal e da conversa
(read-through), com snapshot no fechamento.

## Contexto

`deals.conversation_id` já liga deal↔conversa. Falta a rota de criação a partir da conversa, a
auto-criação no 1º enriquecimento, e o cadastro estruturado vindo no detalhe (Cockpit S06/S07 e
Pipeline S09 consomem).

## Escopo (faz)

- **`POST /api/conversations/:id/deal`** — cria deal ligado à conversa (estágio default do pipeline
  default; título = nome do contato; `contact_id` da conversa). Idempotente: se a conversa já tem
  deal, retorna o existente. Gate `deal.edit`.
- **Auto-create:** helper reutilizável `ensureDealForConversation(tx, conversationId)` chamado quando
  o 1º item/valor é lançado (S03/S07 chamam via a rota de itens quando `dealId` ausente). Documentar
  o ponto de integração. (A criação em si mora aqui; S03 só a invoca.)
- **PATCH contato:** estender `apps/api/src/routes/contacts/contacts.ts` (`updateSchema`) com
  `address` (objeto Zod tipado: cep/street/number/complement/district/city/state, todos opcionais,
  com validação de UF e CEP) e `document` (CPF/CNPJ — valida formato, não obriga). Gate `contact.edit`.
- **Read-through:** `GET /api/conversations/:id` passa a incluir `deal` (id, stage, value_cents) e o
  cadastro do contato (`address`, `document`); `GET /api/deals/:id` inclui o cadastro do contato
  (read-through via `contact_id`). Sem cópia — leitura viva.
- **Snapshot no fechamento:** ao fechar deal (won/lost) grava `deal.custom_fields.contact_snapshot`
  com o cadastro vigente. Integrar no fluxo de close existente.
- Testes: criação idempotente; auto-create; PATCH address/document valida e persiste; detalhe traz
  cadastro; snapshot no close.

## Fora de escopo

- Itens/recompute (S03). Catálogo (S02). Toda UI (S06/S07/S09).

## Arquivos permitidos

- `apps/api/src/routes/conversations/**` (rota `:id/deal`, enriquecer detalhe)
- `apps/api/src/routes/contacts/contacts.ts` (estender updateSchema + GET detalhe)
- `apps/api/src/routes/pipeline/**` (helper `ensureDealForConversation`, snapshot no close)
- `apps/api/src/routes/**/*.test.ts` (testes correspondentes)

## Arquivos proibidos

- `apps/api/src/routes/pipeline/items.ts` (S03 é dono), `apps/api/src/routes/products/**` (S02),
  `packages/db/**`, `apps/web/**`.

## Contratos de entrada/saída

- `POST /api/conversations/:id/deal` → `{ deal: { id, stageId, valueCents, ... } }` (idempotente).
- `PATCH /api/contacts/:id` aceita `{ address?: {...}, document? }` (além do já existente).
- `GET /api/conversations/:id` → `{ conversation: { ..., deal?: {...}, contact: { ..., address, document } } }`.
- `GET /api/deals/:id` → inclui `contact: { displayName, phone, email, address, document, customFields }`.

## Definition of Done

- [ ] Criar deal da conversa é idempotente (2 chamadas = 1 deal); auto-create cobre o 1º enriquecimento.
- [ ] PATCH valida address (UF/CEP) e document; persiste; cross-workspace 404.
- [ ] Detalhe de conversa e de deal trazem o cadastro vivo (read-through); fechamento grava snapshot.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## Permission scope

- Criar deal = `deal.edit` (STAFF). Editar cadastro = `contact.edit` (STAFF). Ler detalhe = view.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Read-through (sem cópia) = "card sempre alimentado" sem drift. Snapshot só no fechamento preserva o
  histórico (ex.: endereço de entrega na hora da venda). Decisão do founder.
- Coordenação: `ContactDetail`/`ConversationDetail` types do web mudam — sinalizar p/ S06/S07/S09
  (contrato acima é a fonte). Reusar `assertConversationVisible` (F30) na rota `:id/deal`.
