---
id: F25-S08
title: Páginas Secrets + Uso (frontend) — rotação de platform_secrets + dashboard de custo LLM
phase: F25
status: in-progress
priority: medium
estimated_size: L
depends_on: [F25-S04, F25-S05, F25-S06]
agent_id: frontend-engineer
source_docs:
  - docs/ROADMAP.md#F2.5
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-06-13T01:46:16Z

---
# F25-S08 — Páginas Secrets + Uso

> **source_docs:** `docs/ROADMAP.md` F2.5-S04/S05; `docs/UX_PRINCIPLES.md`
> **blocks:** —

## Objetivo

Duas páginas do painel: **PlatformSecrets** (lista keys com key_version/updated_at — nunca o valor — e rotaciona com confirmação) e **LlmUsageDashboard** (gasto por workspace/modelo/dia-mês, top spenders, alertas de cap próximo) — consumindo F25-S04/S05, DS v2 dark-first.

## Contexto

Shell/nav do F25-S06. APIs: secrets (S04), usage rollup (S05). A página de Secrets é sensível (operação destrutiva-ish → confirmação forte); a de Uso é analítica (charts).

## Escopo (faz)

- `apps/web/app/(platform)/secrets/page.tsx` + `apps/web/features/platform-admin/secrets/**`: lista de keys (sem valor, mostra key_version/updated_at), input de rotação com **confirmação explícita** + feedback de auditoria; estado "rotacionado".
- `apps/web/app/(platform)/usage/page.tsx` + `apps/web/features/platform-admin/usage/**`: dashboard de custo (gráficos por workspace/modelo/dia; tabela top-spenders; banner de cap-alerts). Reusa os charts/skeletons existentes (lazy se pesado, padrão F10-S06/S10).

## Fora de escopo

- Shell/nav (S06). Modelos/Políticas (S07). Backend (S04/S05).

## Arquivos permitidos

- `apps/web/app/(platform)/secrets/**`
- `apps/web/app/(platform)/usage/**`
- `apps/web/features/platform-admin/secrets/**`
- `apps/web/features/platform-admin/usage/**`

## Arquivos proibidos

- `apps/web/features/platform-admin/shell|lib/**` (S06 — reusar), `apps/web/app/(platform)/models|policies/**` (S07)

## Definition of Done

- [ ] Secrets: lista sem valor em claro; rotação pede confirmação e mostra resultado/auditoria; Uso: gráficos + top-spenders + cap-alerts corretos.
- [ ] Charts pesados via lazy boundary com skeleton (não regredir bundle); DS v2 dark-first (zero hex).
- [ ] `pnpm --filter @hm/web typecheck` + lint + `build` verdes.

## UX considerations

- **§2.9** (botão-suicida): rotação de secret exige confirmação explícita (impacto: pode derrubar integração se valor errado).
- **§2.5** (tooltip-substituto): explicar cada secret/cap com help inline `?`, não tooltip.
- **§3.6** skeleton nos charts; **§3.9** (timeline) opcional para histórico de gasto.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Reusa `features/platform-admin/lib` (S06) e os skeletons/lazyClient do web (F10). Paraleliza com F25-S07.
