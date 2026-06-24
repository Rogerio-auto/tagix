---
id: F47-S09
title: Cross-surface — <ContactPanel> na Pipeline + Contatos
phase: F47
status: done
priority: medium
estimated_size: S
depends_on: [F47-S04, F47-S06]
blocks: [F47-S11]
agent_id: frontend-engineer
source_docs:
  - docs/features/COCKPIT_CLIENT_ENRICHMENT.md
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica 2.3 — detalhe do card é drawer; cadastro entra no drawer, não em modal."
  - "Aplica 8 (mobile) — MobileDealSheet recebe o painel read-only; alvos ≥44px."
  - "Aplica 3.1 — read-only por padrão fora do cockpit (evita edição acidental)."
claimed_at: 2026-06-24T00:54:17Z
completed_at: 2026-06-24T00:54:19Z

---
# F47-S09 — Cadastro do cliente visível na Pipeline e em Contatos

## Objetivo

Plugar o `<ContactPanel>` (read-through, read-only) no detalhe do card da Pipeline
(`DealDetailDrawer` + `MobileDealSheet`) e reaproveitá-lo na página de Contatos — para "ver mais
informações do cliente" fora do LiveChat.

## Contexto

S06 criou o `<ContactPanel>`; S04 fez o detalhe do deal trazer o cadastro do contato. Aqui só
consumimos — o card reflete o cadastro vivo (read-through), sem cópia.

## Escopo (faz)

- `DealDetailDrawer.tsx`: nova seção/aba "Cliente" renderizando `<ContactPanel contactId readOnly>`
  (cadastro vivo + endereço + documento + custom_fields).
- `MobileDealSheet.tsx`: mesma informação no sheet mobile.
- Página de Contatos (`ContactDetailDrawer.tsx`): substituir/compor a aba "Dados" para reusar
  `<ContactPanel>` (read-only ou editável conforme `contact.edit`), evitando duplicar a renderização
  de cadastro/endereço.

## Fora de escopo

- Criar/editar o componente (S06 é dono). Cockpit (S06/S07/S08). API (S04).

## Arquivos permitidos

- `apps/web/features/pipeline/deal/DealDetailDrawer.tsx`
- `apps/web/features/pipeline/board/MobileDealSheet.tsx`
- `apps/web/features/contacts/ContactDetailDrawer.tsx`
- `apps/web/features/pipeline/queries.ts` (se o detalhe do deal precisar do cadastro — apenas leitura)

## Arquivos proibidos

- `apps/web/features/contacts/components/ContactPanel.tsx` (S06 é dono — só importar),
  `features/conversations/**`, `features/products/**`, `shared/components/layout/**`, `apps/api/**`.

## Definition of Done

- [ ] Card na pipeline (desktop + mobile) mostra o cadastro vivo do cliente via `<ContactPanel>`.
- [ ] Página de Contatos reusa o mesmo componente (sem duplicar endereço/cadastro).
- [ ] Read-only por padrão fora do cockpit; DS v2 sem hex; build verde.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Permission scope

- Ver cadastro = `contact.view`. Edição (se exposta em Contatos) = `contact.edit`.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Paralelo a S07 (arquivos distintos). Só depende do `<ContactPanel>` (S06) e do detalhe com cadastro
  (S04). Manter o `<ContactPanel>` agnóstico de surface (já nasce assim em S06).
