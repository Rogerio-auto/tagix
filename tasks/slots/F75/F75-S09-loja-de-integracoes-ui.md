---
id: F75-S09
title: Loja de Integrações — catálogo, busca por intenção, detalhe, vazio inteligente e pedido
phase: F75
status: blocked
priority: high
estimated_size: M
model: opus
ui: true
depends_on: [F75-S07]
blocks: [F75-S10, F75-S11]
source_docs:
  - docs/features/INTEGRACOES.md
  - docs/design/copilot-integracoes.html
  - docs/design/copilot-integracoes-ux.md
  - docs/UX_PRINCIPLES.md
  - docs/DESIGN_SYSTEM.md
agent_id: frontend-engineer
---
# F75-S09 — Loja (UI): B1, B2 e B5

## Objetivo

A pessoa abre "Integrações", vê primeiro o estado do que já está conectado (Atenção no topo, com a causa no card),
encontra o que quer pelo que precisa sincronizar ("estoque", "boleto"), entende numa página o que a integração faz,
o que o Copiloto ganha, o que ela pede e quanto custa, e, quando o sistema não existe, tem dois caminhos concretos:
conectar agora por API/webhook ou pedir a integração.

## Contexto

Maquete `copilot-integracoes.html` `?solo=loja`, `?solo=detalhe`, `?solo=vazio` (e capturas `loja-*`,
`detalhe-*`, `vazio-*` em 1440/375 × claro/escuro). Contrato da API: spec §6 e o F75-S07.

## Escopo (faz)

- Rotas Next (App Router, grupo `(app)`):
  - `apps/web/app/(app)/integracoes/page.tsx` (B1 + B5 via `?busca=`), `loading.tsx` (skeleton fiel ao grid);
  - `apps/web/app/(app)/integracoes/[slug]/page.tsx`: sem conexão ⇒ detalhe (B2); com conexão ⇒ cartão de
    estado (selo, última sincronização, causa da Atenção) com o detalhe abaixo. O S11 substitui esse cartão pelo
    painel B4 completo.
- `apps/web/features/integrations/shared/`: cliente da API (TanStack Query, chaves `['integrations', …]`), tipos
  dos schemas de `@hm/shared/integrations`, monograma tipográfico (`MonoLogo`: 2 letras, filete inferior na cor
  semântica da categoria — tokens, sem hex), `StateBadge` (Conectar/Conectado/Atenção/Em breve/Bloqueado pelo
  plano; a cor nunca é o único sinal).
- `apps/web/features/integrations/store/`:
  - **B1:** cabeçalho "Integrações" + "Pedir uma integração"; categorias à esquerda (Todas, ERP, Financeiro e
    pagamentos, E-commerce, Marketing, Calendário, Automação, Dados e planilhas, Qualquer sistema) com contagem;
    busca no topo com atalho `/`; seções "Suas integrações" (Atenção primeiro, nota de causa) e "Explorar" com o
    card de destaque **"Conectar qualquer sistema"** sempre visível (com o mini código da maquete); "Em breve" com
    "Avise-me" (otimista, idempotente);
  - **B2:** hero com monograma, tabela "O que sincroniza" (dado, direção, efeito), "Depois de conectar, você pode
    pedir ao Copiloto" (exemplos do manifesto), "Permissões pedidas" (leitura/escrita/fora, em PT-BR), aside com
    preço/plano, botão **Conectar** (única cor forte da página; `locked` ⇒ CTA do plano), "Leva cerca de N
    minutos. Nada é gravado até o passo 5.", requer, frequência, histórico inicial;
  - **B5:** busca sem resultado ⇒ "Ainda não temos “<busca>”." com os dois cartões: "Conectar agora por API e
    webhook" (link para `/integracoes/qualquer-sistema`) e "Pedir esta integração" (formulário de 4 campos: sistema
    pré-preenchido com a busca, para quê em chips, quão importante, enviar) ⇒ "Pedido enviado. N empresas pediram
    o mesmo." (`sameRequestCount`).
- Navegação: item **Integrações** em `apps/web/shared/components/layout/nav.ts` (grupo de gestão, permissão
  `integration.view`, ícone de tomada), aparecendo também no sheet "Mais" do celular e no ⌘K (vêm do `nav.ts`);
  atualizar `nav.test.ts`.
- Estados vazio (empresa sem nenhuma conexão: "Suas integrações" some e "Explorar" sobe), carregando (skeleton) e
  erro (`ErrorState` com tentar de novo) em tudo. Card Atenção com a pose `confused` parada do personagem **se** o
  F76-S07 já estiver `done` (`<MascotPose state="confused" size={24} />` do `@hm/ui`); senão, só o ícone de alerta.
- Mobile 375: categorias viram chips roláveis horizontais, cards em uma coluna, alvo ≥ 44 px, busca 16 px.
- Testes de componente (busca por intenção, ordenação Atenção, Avise-me, formulário de pedido, `locked`).
- e2e `apps/web/e2e/specs/integrations-store.spec.ts` com a API mockada (padrão dos specs atuais).

## Fora de escopo

- Assistente (S10), painel de saúde e B6 (S11).

### files_allowed

- `apps/web/app/(app)/integracoes/page.tsx`
- `apps/web/app/(app)/integracoes/loading.tsx`
- `apps/web/app/(app)/integracoes/[slug]/page.tsx`
- `apps/web/features/integrations/shared/**`
- `apps/web/features/integrations/store/**`
- `apps/web/shared/components/layout/nav.ts`
- `apps/web/shared/components/layout/nav.test.ts`
- `apps/web/e2e/specs/integrations-store.spec.ts`

### files_forbidden

- `apps/web/features/integrations/{wizard,health,any-system}/**` (S10, S11)

## Definition of Done

- [ ] fiel à maquete B1/B2/B5 nos dois temas (comparar com as capturas da pasta `copilot-integracoes/`)
- [ ] busca "estoque" acha ERPs; "contábil" mostra B5 com o texto da busca no pedido
- [ ] teclado: `/` foca a busca, categorias são `aria-pressed`, cards são links, foco visível
- [ ] capturas 375/768/1440 em dark e light em `apps/web/e2e/.artifacts/f75-s09/`; axe sem violação séria
      (`expectNoSeriousAxe`); orçamento de peso (`~/.claude/skills/canone/VERIFICACAO.md`)
- [ ] nenhum hex literal; números em mono (`tabular-nums`)
- [ ] revisão `/hm-designer` aprovada contra B1, B2 e B5 (registrar veredito nas notas do slot)

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm exec eslint apps/web/features/integrations "apps/web/app/(app)/integracoes" apps/web/shared/components/layout
pnpm --filter @hm/web exec vitest run features/integrations shared/components/layout --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`. Rota em português (`/integracoes`) como na maquete e como `/hoje`/`/convite`.
- `[slug]/page.tsx` é tocado depois pelo S11 (sequencial: S11 depende deste). O S09 entrega o detalhe completo e,
  para conexão existente, um resumo de estado com link para o painel; o S11 troca pelo painel B4.
- `nav.ts` é arquivo disputado (a F74-S01 pode acrescentar o Copiloto): se houver slot aberto nele, sequenciar.
