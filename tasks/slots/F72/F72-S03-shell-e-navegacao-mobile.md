---
id: F72-S03
title: Shell do produto no DS 3.0 e navegação mobile com 4 abas mais Mais
phase: F72
status: blocked
priority: critical
estimated_size: M
ui: true
depends_on: [F72-S01]
blocks: [F72-S04, F72-S05, F72-S06, F72-S07, F72-S08]
source_docs:
  - docs/features/DS3_ADOCAO.md
  - docs/features/APP_MOBILE_PLAN.md
  - docs/design/ds-3.0-agency-os.html
---
# F72-S03 — Shell e navegação mobile

## Objetivo

A casca do app (sidebar, topbar, conteúdo, faixas de conta) segue o "Product shell" da maquete. No celular, a navegação vira 4 abas fixas (Home, Inbox, Agenda, Mais), com o resto num sheet "Mais".

## Escopo (faz)

- `Sidebar` (248px):
  - grupos de navegação, item ativo com marca precisa (não neon gritante);
  - seletor de empresa (F71-S08) e pílula de mercado reservada (sem dado inventado).
- `TopBar` (68px):
  - busca/⌘K (`shared/components/command`), notificações e usuário;
  - corrigir o `pt-safe` sob a faixa de conta (ressalva da F71-S08).
- `BottomNav`:
  - Home, Inbox, Agenda e Mais, na zona do polegar, com selo de não lidas na Inbox;
  - "Mais" abre um sheet com Funil, Contatos, Campanhas, Agentes, Flows, Conhecimento, Conversões, Configurações e Ajuda;
  - corrigir o contraste do rótulo ativo no claro (axe da F71-S08).
- `nav.ts` como fonte única dos destinos e da ordem, e por papel (role-aware): quem não pode agir não vê.
- `PageHeader` / `PageContainer` com o ritmo editorial do DS 3.0.
- Faixa de conta, impersonation banner e workspace switcher no visual novo.
- Regra do §07: nada de custo de LLM ou infra na casca para quem não pode agir sobre isso.

### files_allowed

- `apps/web/shared/components/layout/**`
- `apps/web/shared/components/{account-banner,workspace-switcher,impersonation-banner,command}/**`
- `apps/web/app/(app)/layout.tsx`
- `apps/web/e2e/specs/shell*.spec.ts`, `apps/web/e2e/specs/mobile-nav*.spec.ts` (novos)

## Definition of Done

- [ ] desktop: sidebar e topbar fiéis à maquete, nos dois temas
- [ ] mobile 375: 4 abas + Mais; todo destino antigo continua alcançável (teste: cada rota do `nav.ts` tem caminho)
- [ ] teclado: navegação da sidebar, ⌘K, foco visível; sheet "Mais" com trap de foco e Esc
- [ ] axe sem violação séria nos dois temas (inclui o rótulo ativo da bottom nav)
- [ ] e2e de navegação mobile
- [ ] revisão `/hm-designer` contra a seção "Product shell" e "Mobile"

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run shared --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`. Paralelo à S02.
