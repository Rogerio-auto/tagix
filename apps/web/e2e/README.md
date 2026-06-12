# e2e — Playwright (@hm/web) · F10-S03

Suite Playwright que cobre a **jornada crítica ponta-a-ponta**: login → conectar
canal → enviar mensagem → resposta do agente → trigger de flow → mover deal no
pipeline. Roda **headless e determinística** — nenhum serviço externo (API
`@hm/api`, WAHA, agent-runtime, Meta) precisa estar de pé: toda a rede que sai do
browser é interceptada nas fixtures.

## Pré-requisitos (uma vez)

A dependência `@playwright/test` ainda **não** está no `package.json` (será
adicionada pelo orchestrator no merge — ver "Wire" abaixo). Após instalada:

```powershell
# da raiz do monorepo
pnpm install
pnpm --filter @hm/web exec playwright install chromium
```

## Rodar

```powershell
# sobe o next dev na porta de teste (3100) automaticamente e roda tudo
pnpm --filter @hm/web exec playwright test

# UI mode / um spec só
pnpm --filter @hm/web exec playwright test --ui
pnpm --filter @hm/web exec playwright test e2e/specs/journey.spec.ts

# contra um servidor já no ar (pula o webServer)
$env:PLAYWRIGHT_BASE_URL = "http://localhost:3000"
pnpm --filter @hm/web exec playwright test
```

Relatório HTML (gerado em CI ou on-failure): `e2e/.artifacts/report`.

## Como é determinístico

- **Sem backend real.** `fixtures/api-mock.ts` intercepta `**/api/**`,
  `**/auth/**` e `**/socket.io/**` e responde com o seed de `fixtures/seed.ts`.
  O router é **stateful por página**: conectar canal, enviar mensagem, disparar
  flow e mover deal mutam o estado em memória, então os GETs seguintes (e as
  invalidações do React Query) refletem a mudança — como a API real faria.
- **Resposta do agente** é simulada: o primeiro POST de mensagem numa conversa
  encadeia uma resposta `senderType: "agent"` determinística (`seed.AGENT_REPLY`).
- **Socket.io** fica inerte (o handshake é respondido 200 vazio). A jornada usa
  polling/optimistic UI, não push de socket, então não há corrida.
- **Auth** via `storageState`: `global.setup.ts` injeta o cookie httpOnly
  `hm_session` (o shell trata presença = logado) e persiste em `e2e/.auth/state.json`,
  reaproveitado por todas as specs. `specs/auth.spec.ts` testa o fluxo de login
  real à parte (sem reusar o estado).

## Estrutura

```
e2e/
  global.setup.ts        # gera o storageState autenticado (projeto "setup")
  fixtures/
    seed.ts              # dados determinísticos (espelham os contratos de wire)
    api-mock.ts          # router stateful de interceptação de rede
    test.ts              # base test estendido (liga os mocks; expõe `mock`)
  pages/pom.ts           # page objects mínimos (seletores reais por role/testid)
  specs/
    auth.spec.ts         # login / redirect / validação (sessão limpa)
    journey.spec.ts      # a jornada completa encadeada (DoD principal)
    channels.spec.ts     # wizard de conexão + estados
    conversations.spec.ts# envio, otimismo, bloqueio de janela 24h
    pipeline.spec.ts     # render kanban + move-stage
```

Artefatos de execução (storageState, traces, report) ficam em `e2e/.auth/` e
`e2e/.artifacts/` — devem ser **gitignored** (ver "Wire").

## Seletores

Os page objects usam **seletores reais** lidos dos componentes de produção,
priorizando acessibilidade:

- Login: `getByLabel('Email'/'Senha')`, `getByRole('button', { name: 'Entrar' })`
  (`features/auth/components/LoginForm.tsx`).
- Canais: botão "Conectar canal", cards de provider por label, inputs por label
  (`features/channels/components/{ChannelsManager,ConnectWizard}.tsx`).
- Conversa: lista `getByRole('list', { name: 'Conversas' })`, composer por
  placeholder, botão "Enviar mensagem", bolhas por `data-direction`/`data-type`
  (`features/conversations/components/{ConversationsLayout,ChatList/ChatList,
  ChatList/ChatListItem,MessageComposer/MessageComposer,MessageBubble/MessageBubble}.tsx`).
- Flow manual: chips da `ManualFlowsQuickbar` + `TriggerConfirmModal`
  (`features/flow-builder/livechat/*`).
- Pipeline: headings de stage (`StageColumn`), cards de deal (`DealCard`), select
  de pipeline (`PipelinePage`).

## Wire (orchestrator, no merge)

1. **Dep:** adicionar `@playwright/test` como `devDependency` de `@hm/web` no
   `apps/web/package.json` e rodar `pnpm install` + `playwright install chromium`.
2. **Script** (opcional): `"e2e": "playwright test"` em `apps/web/package.json`.
3. **gitignore:** `apps/web/e2e/.auth/`, `apps/web/e2e/.artifacts/`,
   `apps/web/playwright-report/`, `apps/web/test-results/`.
4. **CI:** workflow dedicado é follow-up (F10 observability/CI), fora deste slot.
