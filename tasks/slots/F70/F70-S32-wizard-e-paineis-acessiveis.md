---
id: F70-S32
title: Wizard do WhatsApp preserva o signup ao voltar e painéis fechados saem da acessibilidade
phase: F70
status: review
priority: medium
estimated_size: S
depends_on: [F70-S29]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S29-e2e-do-ci-verde.md
agent_id: backend-engineer
claimed_at: 2026-10-07T13:22:38Z
completed_at: 2026-10-07T13:28:41Z

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
- `apps/web/features/catalog/**` *(correção de fronteira: o drawer "Novo produto" mora em `apps/web/features/products/ResponsivePanel.tsx`; `features/catalog/` não existe)*
- `apps/web/features/products/ResponsivePanel.tsx`
- `apps/web/features/notifications/**`
- `apps/web/shared/components/TopBar*`
- testes ao lado e `apps/web/e2e/**`

## Definition of Done

- [x] estado do signup sobe para o wizard; o `test.fail` do e2e vira teste normal e passa — o rascunho do "Inserir manualmente" (`WaManualDraft`) e o "manual aberto" vivem no `MetaWhatsAppFlow`; o `WaSignupStep` só os recebe. O e2e roda no CI (este host não hidrata o app).
- [x] cada painel fechado fica `inert` e `aria-hidden`, com teste — painel de ajuda (`help/Sheet.tsx`, e2e `closed-panels-a11y`), `HelpHint` do `@hm/ui` (unit `HelpHint.test.tsx`: falha sem a correção, passa com ela), drawer "Novo produto" (asserções em `cockpit-enrichment`). O `NotificationCenter` já estava certo: no desktop não renderiza fechado e no mobile usa o `Sheet` corrigido na S29.
- [x] um único `<h1>` por tela — no mobile o título do `TopBar` era `<h1>` além do `<h1>` do `PageHeader`; virou `<p>` (é contexto da rota, não o título da página). No desktop o `TopBar` não tem título.

## Validação (2026-10-07)

- `pnpm typecheck` ✅ · `eslint` nos arquivos tocados ✅
- `pnpm --filter @hm/ui test` → 43 ✅ (inclui os 3 novos do `HelpHint`)
- `pnpm --filter @hm/web test` → 389 ✅
- e2e: no CI (`whatsapp-coexistence` sem `test.fail`, `closed-panels-a11y` novo, `cockpit-enrichment` com as asserções do drawer).
