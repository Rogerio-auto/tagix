---
id: F8-S05
title: Settings panel shell — sidebar 3 níveis + busca Cmd+K + contadores + conteúdo lazy + /settings root
phase: F8
status: available
priority: high
estimated_size: M
depends_on: []
---
# F8-S05 — Settings panel shell

> **source_docs:** `docs/features/PERMISSIONS.md` §5, §5.1; `docs/UX_PRINCIPLES.md` §2/§3; `docs/ROADMAP.md` F8-S08
> **blocks:** F8-S04, F8-S06, F8-S07, F8-S08

## Objetivo
Substituir o redirect de `/settings` pelo painel real: layout 2-colunas (sidebar agrupada Pessoal/Workspace/Plataforma + conteúdo lazy RSC da seção ativa), busca global Cmd+K que localiza qualquer setting por nome/keyword, e contadores/alertas por item (ex: "Canais [3 ativos, 1 expirando]"). Define o **registry de seções** que F8-S04/S06/S07/S08 preenchem.

## Escopo (faz)
- `apps/web/app/(app)/settings/**`: layout + rota da seção (`/settings/[section]` ou nested), substitui o `page.tsx` de redirect.
- `apps/web/features/settings/shell/**`: `SettingsSidebar` (grupos + contadores + permission-gating por seção), `SettingsSearch` (Cmd+K), `SectionRegistry` (mapa seção→componente, com stubs para as seções que outros slots preenchem), `SettingsLayout`.
- Plataforma: grupo presente mas só visível a `platform_admin` (seções stubadas "em breve" — F2.5 é passe futuro).

## Fora de escopo
- Conteúdo das seções (F8-S04 dashboard, F8-S06 pessoal, F8-S07 workspace-org, F8-S08 integrações/tags/audit), seções de plataforma reais (F2.5).

## Arquivos permitidos
- `apps/web/app/(app)/settings/**`
- `apps/web/features/settings/shell/**`

## Definition of Done
- [ ] `/settings` abre o painel (não redireciona); sidebar agrupada com contadores; Cmd+K busca seções; seção lazy carrega no conteúdo; itens gated por permissão.
- [ ] Registry de seções com stubs — slots de seção só preenchem seus componentes, sem tocar o shell.
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations
- §2 navegação clara (sidebar agrupada, não gear-only); §5.1 cada seção é form único com dirty-tracking (padrão do shell); help inline via popover (não tooltip); §3 contadores/alertas com cor semântica; tokens DS v2 (zero hex).

## Permission scope
- Itens Workspace → ADMINS/MANAGERS conforme a seção; grupo Plataforma → só `platform_admin` (member.isPlatformAdmin).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Scaffold-then-fill: o `SectionRegistry` é dono deste slot; seções (S04/S06/S07/S08) só preenchem `features/settings/sections/<x>/**`. O `/settings/page.tsx` atual (redirect, fix 5db6417) é substituído aqui.
