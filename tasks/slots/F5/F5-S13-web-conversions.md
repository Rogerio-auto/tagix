---
id: F5-S13
title: Frontend conversões — botão "Marcar conversão" + modal + página /conversions + settings
phase: F5
status: blocked
priority: medium
estimated_size: M
depends_on: [F5-S12]
---
# F5-S13 — Conversões (web)

> **source_docs:** `docs/features/DASHBOARD.md` §13; `docs/UX_PRINCIPLES.md` §2/§3; `docs/ROADMAP.md` F5-S14
> **blocks:** —

## Objetivo
UI de conversões: botão "Marcar conversão" no header da conversa, no DealDetailDrawer e no contato; modal de marcação (tipo + valor + nota + atribuição sugerida); página `/conversions` (lista filtrada + cancelar); e `/settings/conversions` (CRUD de `conversion_types` + gatilhos por stage/tag).

## Escopo (faz)
- `apps/web/features/conversions/**`: `MarkConversionButton`, `MarkConversionModal`, `ConversionsPage` (filtros + cancelar), `ConversionTypesSettings` (CRUD + editor de gatilhos por stage/tag).
- `apps/web/app/(app)/conversions/**` + `app/(app)/settings/conversions/**`: rotas.
- Pontos de montagem do botão no ChatHeader/DealDrawer/ContatoPanel são gap-fill do orchestrator (padrão F3), componentes autocontidos.

## Fora de escopo
- API (F5-S12), automações backend (F5-S14).

## Arquivos permitidos
- `apps/web/features/conversions/**`
- `apps/web/app/(app)/conversions/**`
- `apps/web/app/(app)/settings/conversions/**`

## Definition of Done
- [ ] Marcar conversão (com valor obrigatório quando o tipo pede) registra via API; dedup 409 vira mensagem amigável; lista filtra e cancela; settings faz CRUD de types + gatilhos.
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations
- §3 modal curto e focado (tipo default pré-selecionado, valor com máscara BRL); confirmação sutil pós-registro; §2.7 skeleton na lista; estados 3-partes; tokens DS v2 (zero hex).

## Permission scope
- Marcar → `deal.convert` (STAFF); cancelar → `deal.cancel_conversion` (STAFF); settings de types/gatilhos → `pipeline.edit` (ADMINS).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
