---
id: F8-S10
title: Frontend ContactsPage (CRM) — lista + detalhe + tags + consentimento + marcar conversão + nav
phase: F8
status: in-progress
priority: high
estimated_size: L
depends_on: [F8-S09]
agent_id: backend-engineer
claimed_at: 2026-06-11T20:04:09Z

---
# F8-S10 — ContactsPage (web)

> **source_docs:** `docs/DATA_MODEL.md` §5; `docs/features/DASHBOARD.md` §13.4 (marcar conversão no contato); `docs/UX_PRINCIPLES.md` §2/§3; `docs/ROADMAP.md` F8 (Contatos)
> **blocks:** —

## Objetivo
Página de Contatos (CRM): lista paginada com busca + filtros (tag/source/opt-in), painel/drawer de detalhe (dados + tags + conversas associadas + deals + histórico de consentimento + conversões), ações (editar, tag, **Marcar conversão** — §13.4) e abrir conversa. **Re-adiciona o item "Contatos" no nav** (removido no fix 5db6417).

## Escopo (faz)
- `apps/web/app/(app)/contacts/**`: rota.
- `apps/web/features/contacts/**`: `ContactsPage` (lista + filtros + busca), `ContactDetailDrawer` (tabs: overview/tags/conversas/deals/consentimento), `MarkConversionButton` (reusa o de F5-S13), `queries.ts`/`types.ts`.
- `apps/web/shared/components/layout/Sidebar.tsx`: re-adicionar `{ href: '/contacts', label: 'Contatos', icon: Users, perm: 'contact.view' }`.

## Fora de escopo
- API (F8-S09), settings, dashboard.

## Arquivos permitidos
- `apps/web/app/(app)/contacts/**`
- `apps/web/features/contacts/**`
- `apps/web/shared/components/layout/Sidebar.tsx`

## Definition of Done
- [ ] Lista com busca/filtros + paginação; drawer de detalhe com tabs; editar/tag/marcar-conversão/abrir-conversa funcionam; nav "Contatos" volta gated por `can('contact.view')`.
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations
- §2 drawer lateral (não modal full-screen) para detalhe; §2 nav 1ª classe (fecha o link "Contatos" removido); §2.7 skeleton; §3 estados empty/error 3-partes; tokens DS v2 (zero hex).

## Permission scope
- Ver → `contact.view` (STAFF); editar/tag → `contact.edit`; marcar conversão → `deal.convert`. Esconder ações sem permissão.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Único slot da F8 que toca a Sidebar (fecha o link "Contatos"). Reusa `MarkConversionButton` de F5-S13. Slot L — se passar de ~500 linhas, separe o ContactDetailDrawer.
