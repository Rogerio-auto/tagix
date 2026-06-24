---
id: F47-S06
title: <ContactPanel> reutilizável + Cockpit seção Cliente (ViaCEP)
phase: F47
status: review
priority: high
estimated_size: M
depends_on: [F47-S04]
blocks: [F47-S07, F47-S09, F47-S11]
agent_id: frontend-engineer
source_docs:
  - docs/features/COCKPIT_CLIENT_ENRICHMENT.md
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica 2.1 — editar é ação no corpo da seção (não engrenagem)."
  - "Aplica 2.7 — save com loading + toast; skeleton enquanto carrega o contato."
  - "Aplica 2.11 — erro em 3 partes (ex.: CEP não encontrado → o que fazer)."
  - "Aplica 8 (mobile) — painel embutido no Sheet no mobile, inputs ≥16px, alvos ≥44px."
claimed_at: 2026-06-24T00:43:11Z
completed_at: 2026-06-24T00:43:12Z

---
# F47-S06 — Componente <ContactPanel> + seção Cliente no Cockpit

## Objetivo

Criar o componente reutilizável `<ContactPanel>` (dados + endereço com ViaCEP + documento +
custom_fields + resumo financeiro) em modo editável/read-only, e plugá-lo como a nova seção
**Cliente** do Cockpit do LiveChat.

## Contexto

S04 estendeu o contato (address/document) e o detalhe da conversa traz o cadastro. Este é o
componente que S09 reusa na Pipeline e em Contatos — por isso nasce genérico aqui.

## Escopo (faz)

- `apps/web/features/contacts/components/ContactPanel.tsx` (novo): props
  `{ contactId, editable }`. Renderiza nome/telefone/e-mail/documento/endereço/custom_fields +
  resumo financeiro (total convertido / nº deals / ticket médio — derivável do detalhe do contato).
- `apps/web/features/contacts/components/AddressForm.tsx` (novo): edição de endereço com
  **autopreenchimento ViaCEP** (CEP → preenche rua/bairro/cidade/UF). Util `viacep.ts`.
- `apps/web/shared/lib/viacep.ts` (novo): fetch ViaCEP com tratamento de erro/timeout (sem `any`).
- Edição salva via `PATCH /api/contacts/:id` (address/document/dados) — hooks em `contacts/queries.ts`.
- Plugar `<ContactPanel editable>` como seção **Cliente** no `ContactInfoPanel.tsx` (Cockpit),
  usando o `contactId` do detalhe da conversa; gate de edição por `contact.edit`.
- 3 estados; endereço vazio com CTA "Adicionar endereço".

## Fora de escopo

- Seção Card/Itens (S07) e Conversão (S08) no cockpit. Uso na Pipeline/Contatos (S09).

## Arquivos permitidos

- `apps/web/features/contacts/components/ContactPanel.tsx` (novo)
- `apps/web/features/contacts/components/AddressForm.tsx` (novo)
- `apps/web/features/contacts/queries.ts` (estender: hook de PATCH address/document)
- `apps/web/features/contacts/types.ts` (campos address/document)
- `apps/web/shared/lib/viacep.ts` (novo)
- `apps/web/features/conversations/components/ContactInfoPanel.tsx` (montar a seção Cliente)
- `apps/web/features/conversations/types.ts` (incluir contact/address no ConversationDetail)

## Arquivos proibidos

- `apps/web/features/contacts/ContactDetailDrawer.tsx` (S09 é dono), `features/pipeline/**` (S09),
  `features/products/**`, `shared/components/layout/**` (S10), `features/conversions/**` (S08).

## Definition of Done

- [ ] `<ContactPanel>` funciona em modo editável (cockpit) e read-only (prop) sem duplicar lógica.
- [ ] ViaCEP preenche endereço a partir do CEP; falha trata com erro em 3 partes; salva via PATCH.
- [ ] Cockpit ganha a seção Cliente com loading/empty/error; mobile no Sheet; DS v2 sem hex.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Permission scope

- Ver cadastro = `contact.view`. Editar = `contact.edit` (esconde os controles de edição).

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- `ContactInfoPanel.tsx` é a espinha do cockpit, compartilhada por S07/S08 — por isso esta cadeia é
  sequencial. Deixe pontos de montagem claros (seções como componentes) p/ S07/S08 inserirem as suas.
- Resumo financeiro: reusar os dados já agregados em `GET /api/contacts/:id` (deals/conversions).
