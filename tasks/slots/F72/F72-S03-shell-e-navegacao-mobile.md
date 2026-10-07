---
id: F72-S03
title: Shell do produto no DS 3.0 e navegação mobile com 4 abas mais Mais
phase: F72
status: review
priority: critical
estimated_size: M
ui: true
depends_on: [F72-S01]
blocks: [F72-S04, F72-S05, F72-S06, F72-S07, F72-S08]
source_docs:
  - docs/features/DS3_ADOCAO.md
  - docs/features/APP_MOBILE_PLAN.md
  - docs/design/ds-3.0-agency-os.html
agent_id: backend-engineer
claimed_at: 2026-10-07T20:09:53Z
completed_at: 2026-10-07T20:11:44Z

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

## Notas de execução (frontend-engineer, 2026-10-07)

### Entregue

- `nav.ts` reescrito como fonte única: grupos `today/work/automate/manage` (rótulos mono na Sidebar), `tab` (home/inbox/agenda), `mobileLabel` (Home, Inbox, Funil), `MORE_ORDER`, helpers `groupNavItems/mobileTabItems/moreNavItems/activeNavItem/isNavActive`. Entrou `/conversions` (Conversões, `pipeline.view`), que existia como rota mas não tinha caminho na nav. Item ativo agora é o de prefixo mais específico (antes `/flows/backup` acendia também Flows).
- `Sidebar` 248px (64px recolhida), `BrandMark` (68px, alinhado à TopBar), nav em grupos, item ativo = `surface-2` + barra de 2px em `--brand-text` (sem `hm-flow-neon`), selo de não lidas da Inbox em mono (`useInboxUnread`, chave `['conversations', {}]`, o socket já invalida). `WorkspaceSwitcher` virou cartão hairline (semântica e testes intactos).
- `TopBar` 68px no desktop (gatilho de busca/⌘K que abre a `CommandPalette`, `MarketPill` reservada que não renderiza sem dado, sino, tema). Mobile: empresa + contexto da rota, busca, sino, tema e conta.
- `BottomNav`: 4 abas (Home, Inbox, Agenda, Mais), aba ativa em `--brand-text` + traço de 2px (estado não depende só de cor), vidro (`surface-glass` + blur), selo de não lidas; "Mais" abre o `Sheet` com grade 3 colunas (Funil, Contatos, Campanhas, Agentes, Flows, Conhecimento, Conversões, Backup de Flows, Dashboard, Configurações, Ajuda). Papel sem Agenda vê 3 abas + Mais.
- Safe-area: `AppShellFrame` zera `pt-safe` da TopBar (`[data-topbar]`) e das faixas seguintes quando há faixa (`[data-banner]`) acima. `ImpersonationBanner` ganhou `data-banner`, `pt-safe`, tokens (`violet`) e estado de loading.
- `CommandPalette`: destinos vêm do `nav.ts` por papel, trap de Tab, superfície de vidro, rodapé de atalhos. `PageHeader` com `description` e escala editorial (`text-h4` -> `md:text-h3`). `AppLayout`: gutter `px-4 py-5 md:px-8 md:py-8`.
- Regra do §07: a casca não renderiza custo de LLM/infra (teste unitário em `nav.test.ts` e e2e em `shell.spec.ts`).

### Validações (números reais)

- `pnpm --filter @hm/web typecheck`: OK, 0 erros.
- `vitest run shared --maxWorkers=1`: 15 arquivos, 179/179 verdes (inclui `nav.test.ts` novo: 18 testes; `WorkspaceSwitcher.test.tsx` e `account-banner.test.ts` seguem verdes).
- ESLint em `shared/components` + 3 specs novos: 0 erros, 0 warnings.
- `pnpm --filter @hm/web build`: OK; First Load JS compartilhado 213 kB (igual ao pós-S01).
- Playwright (dev server local, `--workers=1`): `mobile-nav.spec.ts` + `mobile-nav-chrome.spec.ts` + `shell.spec.ts` = 24 de 25 na rodada completa; a falha foi `page.goto` timeout (dev server recompilando, flake de ambiente) e o teste passou isolado (3/3, dark e light). Capturas em `apps/web/e2e/.artifacts/f72-s03/` (1440 dark/light, 375 dark/light, sheet Mais).
- Contraste do item ativo medido no e2e (WCAG, cor computada vs `--surface`): >= 4,5:1 nos dois temas (verde em ambos). Não há axe no repositório; a verificação é por cálculo no teste, não por axe.

### Fora do `files_allowed` / pendências

- `apps/web/e2e/mobile-navigation.spec.ts` (F36-S14, fora de `specs/`) agora está obsoleto: espera Dashboard/Conversas na barra. Substituído por `specs/mobile-nav.spec.ts`; precisa ser removido ou ajustado pelo orchestrator.
- `/hoje` quebra sob o mock padrão do e2e (`TodayClient` lê `esfriando` de resposta ausente): os specs usam `/`, `/conversations` e `/calendar`. Corrigir o mock quando a S04 reconstruir a Home.
- "Home" no celular aponta para `/hoje` e Dashboard (`/`) foi para "Mais"; a S04 decide se unifica as duas rotas.
- Antes de `/api/me` hidratar, itens com permissão ficam ocultos (falha fechada, convenção do projeto): a aba Agenda aparece um instante depois das outras duas.
- Revisão `/hoje` -> `/hm-designer` contra "Product shell" e "Mobile" ainda não feita.

### Revisao de design

Veredito inicial: REPROVADO. O anel `focus-visible:shadow-glow-md` falhava contraste (WCAG 1.4.11) no tema claro. Corrigido, fica APROVADO.

- Foco: trocado por `focus-visible:focus-ring` (outline 2px `--brand-text`, offset 2px) em BottomNav (abas e sheet; abas com `-outline-offset-2` para o anel ficar dentro da barra), Sidebar, TopBar, UserMenu (itens do menu com offset negativo, por causa do `overflow-hidden`), WorkspaceSwitcher, ImpersonationBanner e, pelo mesmo defeito, SkipLink, WorkspaceList e AccountBanner.
- Vocabulario unico nos dois breakpoints: Home, Inbox, Agenda, Pipeline (sem `mobileLabel`). Grupo "Hoje" virou "Visao geral" (nao colide com o item). Sheet "Mais": Pipeline, Dashboard, Contatos...
- TopBar mobile: so a empresa (o titulo e o `<h1>` do PageHeader); botao de tema movido para o menu da conta.
- ImpersonationBanner: "Vendo como a empresa <nome> · somente leitura" (nome via workspace ativo; a sessao so traz o UUID).
- Sidebar: `transition-all` nos rotulos trocado por `transition-[max-width,margin,opacity]`.
- shell.spec.ts: prova de anel de foco (outline solid >= 2px) e de reduced-motion (`transition-property: none`). Capturas refeitas em build de producao (`next start`), `animations: 'disabled'` e espera do sheet, nos 2 temas.
- Validacao: tsc web limpo, vitest shared 179/179, eslint limpo, e2e shell + mobile-nav + mobile-nav-chrome 28/28 (`--workers=1`).
