---
id: F70-S32
title: Wizard do WhatsApp preserva o signup ao voltar e painéis fechados saem da acessibilidade
phase: F70
status: available
priority: medium
estimated_size: S
depends_on: [F70-S29]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S29-e2e-do-ci-verde.md
---
# F70-S32 — Wizard do WhatsApp preserva o signup ao voltar e painéis fechados saem da acessibilidade

## Contexto

Achados da F70-S29:
- `ConnectWizard.tsx`: o `WaSignupStep` guarda os campos em estado local e perde o que foi digitado ao voltar do passo final (UX §2.8). O e2e `whatsapp-coexistence` marca o caso com `test.fail`.
- Painéis fechados continuam na árvore de acessibilidade, o mesmo bug corrigido no `Sheet` pela S29: o painel de ajuda (`shared/components/help/Sheet.tsx`), o `HelpHint` do `@hm/ui`, o drawer "Novo produto" do catálogo e o `NotificationCenter`.
- O TopBar e a página renderizam dois `<h1>` "Dashboard".

## Escopo

### files_allowed

- `apps/web/features/channels/components/ConnectWizard.tsx`
- `apps/web/shared/components/help/**`
- `packages/ui/src/**/HelpHint*`
- `apps/web/features/catalog/**`
- `apps/web/features/notifications/**`
- `apps/web/shared/components/TopBar*`
- testes ao lado e `apps/web/e2e/**`

## Definition of Done

- [ ] estado do signup sobe para o wizard; o `test.fail` do e2e vira teste normal e passa
- [ ] cada painel fechado fica `inert` e `aria-hidden`, com teste
- [ ] um único `<h1>` por tela
