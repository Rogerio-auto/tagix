---
id: F71-S08
title: Seletor de empresa no shell e aviso de trial, convite pendente e modo só leitura
phase: F71
status: review
priority: high
estimated_size: M
ui: true
depends_on: [F71-S03, F71-S06]
blocks: [F71-S10]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/UX_PRINCIPLES.md
  - docs/DESIGN_SYSTEM.md
agent_id: backend-engineer
claimed_at: 2026-10-07T01:31:16Z
completed_at: 2026-10-07T01:32:04Z

---
# F71-S08 — Seletor de empresa e avisos de conta

## Objetivo

Quem está em mais de uma empresa troca entre elas em dois cliques e sempre sabe em qual está. Quem está em trial, tem convite pendente ou caiu para só leitura vê isso com clareza e sabe o que fazer.

## Escopo (faz)

- Seletor de empresa no cabeçalho da `Sidebar` (desktop) e no `UserMenu` (mobile):
  - nome da empresa ativa sempre visível;
  - lista de `memberships` com papel e atalho de teclado; só aparece como seletor se houver 2+;
  - a troca chama `POST /api/me/workspace` e depois limpa **todo** o cache do React Query, reconecta o socket e vai para `/`, sem vazar dado da empresa anterior na tela;
  - estado da troca (carregando, erro).
- `auth.store.ts` guarda `memberships`.
- Faixa de conta no shell (`(app)/layout.tsx`), uma por vez, por prioridade:
  1. só leitura (`expired`/`canceled`): "Sua empresa está em modo só leitura. Escolha um plano para voltar a editar." + CTA para billing;
  2. trial ≤ 3 dias: "Seu teste termina em N dias." + CTA;
  3. `past_due`: "Pagamento pendente." + CTA;
  4. convite pendente (`GET /api/me/invites`): "Você foi convidado para a Empresa X." + Aceitar (vai para `/convite/<token>`, ou aceita inline).
- Handler central de erro: `402 subscription_inactive` → toast explicando o só leitura (sem deslogar), uma vez por sessão de tela.
- Botões de escrita principais desabilitados com tooltip em modo só leitura, onde for barato. A guarda real é no servidor (S06).

### files_allowed

- `apps/web/shared/components/layout/Sidebar.tsx`, `apps/web/shared/components/layout/UserMenu.tsx`
- `apps/web/shared/components/workspace-switcher/**` (novo)
- `apps/web/shared/components/account-banner/**` (novo)
- `apps/web/shared/stores/auth.store.ts`
- `apps/web/shared/lib/api-client.ts`, `apps/web/shared/lib/query-client.ts`
- `apps/web/shared/realtime/**`
- `apps/web/app/(app)/layout.tsx`
- testes ao lado e `apps/web/e2e/specs/workspace-switch*.spec.ts` (novos)

### files_forbidden

- `apps/web/shared/components/layout/TopBar*` (F70-S32), `apps/web/features/auth/**` (S09)

## Definition of Done

- [ ] teste: troca limpa o cache e reconecta o socket
- [ ] teste: seletor some com 1 empresa
- [ ] teste: prioridade das faixas
- [ ] teste: 402 mostra o toast e não desloga
- [ ] capturas 375/768/1440 em dark e light, axe, peso (`~/.claude/skills/canone/VERIFICACAO.md`)
- [ ] revisão `design-web` / `/hm-designer` aprovada

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
pnpm --filter @hm/web exec vitest run shared --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`.
- Conflito evitado: o TopBar é da F70-S32. Se o seletor precisar entrar no TopBar, sequenciar depois da F70-S32.

## Notas de execução

**Entregue (em `apps/web/shared/**` e `app/(app)/layout.tsx`)**
- `workspace-switcher/`: cabeçalho da Sidebar mostra SEMPRE o nome da empresa ativa; com 2+ memberships vira menu (`role=menu`, Esc, clique fora, foco inicial na lista, `aria-expanded`), com 1 é só rótulo (sem botão). Lista com papel e atalho `Alt+Shift+1..9` (`WorkspaceSwitchHost`, cortina durante a troca; estado carregando/erro). No mobile a lista está no `UserMenu` (variant compact).
- `switch-workspace.ts`: `POST /api/me/workspace` -> `cancelQueries` + `queryClient.clear()` (cache inteiro) -> `applyMe` no store -> `reconnectSocket()` (as rooms vêm do cookie no handshake) -> navega para `/`. Falha: nada local muda; 404 reidrata a lista; 403 de view-as tem mensagem própria.
- `auth.store.ts` guarda `memberships`; `markSubscriptionInactive`.
- `account-banner/`: UMA faixa por prioridade (só leitura > trial <= 3 dias > `past_due` > convite). Status efetivo espelha a S06: `trial` com `trialEndsAt <= agora` conta como `expired` (banner e `useIsReadOnly`). Cobrança não é dispensável; trial/convite sim.
- Handler central: `api-client` + `query-client` chamam o ouvinte em `402 subscription_inactive`; `SubscriptionInactiveBridge` mostra UM toast por empresa/sessão de tela e NÃO desloga.
- `useIsReadOnly` + `READ_ONLY_TOOLTIP` exportados para desabilitar botões de escrita. NÃO foi aplicado a botões das features (fora dos `files_allowed`); a guarda real é o 402 do servidor. Follow-up por feature.

**Decisão: convite pendente sem botão de aceite.** `GET /api/me/invites` não devolve o token e o aceite exige a prova de posse (link do email). A faixa informa "Você foi convidado para <Empresa>" e o botão "Ver como entrar" expande a instrução de abrir o link do email (e checar spam / pedir novo convite). Sem rota inventada. **Follow-up sugerido ao Rogério:** endpoint de aceite autenticado (`POST /api/me/invites/:id/accept`, com o email da sessão verificado == email do convite) permitiria "Aceitar" inline.

**Riscos herdados da S03 que afetam a UI**
- `is_platform_admin` é por linha de `members`: se a empresa ativa não tem a flag, o painel de plataforma some após a troca (e volta ao trocar de volta). Não é bug da troca; avaliar flag por usuário.
- View-as (impersonação) com outra empresa ativa: a troca é bloqueada pelo servidor (`impersonation_read_only`); a UI mostra "Saia do modo de visualização para trocar de empresa". Atenção a combinações view-as + cookie `hm_workspace` divergente.

**Verificação (executada)**
- `pnpm --filter @hm/web typecheck`: limpo. `npx eslint` nos arquivos tocados: sem saída (limpo). `vitest run shared --maxWorkers=1`: 14 arquivos, 159 testes verdes (troca limpa cache e reconecta; seletor some com 1 empresa; prioridade das faixas; 402 com toast único sem deslogar).
- Playwright (chromium, `next dev`, API mockada) `workspace-switch.spec.ts`: 14/14 passam; porém em dev frio houve timeouts intermitentes de `page.goto` (recompilação com outros workers editando a árvore) que passaram ao reexecutar. Capturas 375/768/1440 dark+light em `apps/web/e2e/.artifacts/f71-s08/` (inspecionadas 1440 dark e 375 light: ok).
- axe (axe-core 4.12 injetado em spec temporária, removida): nenhuma violação nos componentes da S08 (faixa, seletor, lista). Ocorrências fora do escopo: `aria-allowed-role` (aside/drawer), `region`, `empty-heading` no drawer de onboarding, `color-contrast` do rótulo ativo da bottom-nav no tema light (375).
- NÃO verificado: peso/Web Vitals (Lighthouse) do `VERIFICACAO.md` — não executado; revisão `design-web`/`/hm-designer` pendente. Observação visual: no desktop o nome "Studio V…" trunca por causa do chip do atalho.

### Revisão de design

**Veredito: APROVADO COM RESSALVAS** (`/hm-designer`, 2026-10-06). Seletor com o padrão certo (nome da empresa como cabeçalho, menu só com 2+), uma faixa por vez e sem deslocar o shell.

**Corrigido**
- `workspace-switcher/WorkspaceList.tsx`: o atalho saiu da linha do nome para a linha do papel, à direita, e some na empresa ativa (só o check). "Studio Vértice" e "Proprietário" cabem inteiros na Sidebar de 240 px (antes "Studio V…"). Teste em `WorkspaceSwitcher.test.tsx`.
- `workspace-switcher/labels.ts`: `AGENT` → "Atendente" (era "Agente"; Membros/Convites já diziam "Atendente" e "Agente" no produto é o bot de IA — glossário do INDEX — que aparece logo abaixo no item "Agentes").
- `WorkspaceSwitcher.tsx`: `title` com o nome da empresa também com a Sidebar aberta (nome longo truncado continua legível no hover).
- `account-banner/AccountBanner.tsx`: botões da faixa com área de toque de 44 px sem crescer a faixa (`::after` −6 px); `pt-safe` na faixa (com `viewport-fit=cover` ela ficava sob o notch no iPhone).

**Ressalvas (abertas)**
- [média] Com a faixa ativa, o `TopBar` mobile continua aplicando `pt-safe` abaixo dela (espaço vazio extra só em aparelho com notch). O certo é o `TopBar` não somar a safe-area quando houver faixa acima — fora da fronteira (`TopBar.tsx`).
- [baixa, registrado e não corrigido por escopo] axe `color-contrast` (sério) do rótulo ativo da bottom-nav no tema claro a 375 px (`#1fff13` sobre branco, 1,36:1).
- [baixa] Ícone `text-warn` da faixa de pagamento fica pálido no claro (mesma causa de DS da S07: tons de status sem variante light).

**Medido**: `workspace-switch.spec` regerou as capturas em `apps/web/e2e/.artifacts/f71-s08/` (build de produção); axe 4.12 sem violação nos componentes da S08. **Não medido**: Lighthouse/LoAF; aparelho real com notch.
