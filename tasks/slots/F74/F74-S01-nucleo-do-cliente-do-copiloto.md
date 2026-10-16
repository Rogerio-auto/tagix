---
id: F74-S01
title: Núcleo do cliente do Copiloto (CopilotClient http e mock, SSE, store Zustand, contexto de página, provider e API useCopilot)
phase: F74
status: blocked
priority: critical
estimated_size: L
model: opus
ui: false
depends_on: [F73-S02]
blocks: [F74-S02, F74-S04, F74-S06, F74-S08, F74-S09, F74-S11, F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
  - docs/design/copilot-integracoes.html
  - docs/design/copilot-botao-animacao.md
  - docs/UX_PRINCIPLES.md
agent_id: frontend-engineer
---
# F74-S01 — Núcleo do cliente

## Objetivo

Toda a interface do Copiloto fala com **uma** fachada tipada, o `CopilotClient`, que tem duas implementações com o mesmo contrato (`@hm/shared/copilot`, F73-S02):

- `http`: a API real, com SSE por `fetch` + `ReadableStream`;
- `mock`: fixtures e roteiros determinísticos da Arcada, iguais à maquete.

O estado vive num store Zustand. As telas declaram o que a pessoa está vendo com `useCopilotPageContext`. O resto do app (inclusive a F76: botão e mascote) abre e consulta o Copiloto só por `useCopilot()`. Com isso a F74 inteira se desenvolve **sem backend**.

## Contexto

Não existe store de contexto de página nem chat de IA no app além do Playground (`features/agents/playground/useAgentPlaygroundStream.ts`, molde de leitura de SSE). Este slot não desenha nada: as superfícies são do S02.

## Escopo (faz)

- `apps/web/features/copilot/core/client/**`:
  - `types.ts`: `CopilotClient`, com **todos** os métodos da spec §5.2:
    - `me`, `updatePrefs`, `getSettings`, `updateSettings`;
    - `createSession`, `listSessions`, `listMessages`, `renameSession`, `archiveSession`;
    - `ask(sessionId, body, signal) → AsyncIterable<CopilotStreamEvent>`, `cancelTurn`;
    - `getProposal`, `confirm`, `adjust`, `cancel`, `undo`, `retryFailed`, `requestApproval`, `listApprovers`;
    - `listActivity`;
    - `getMemoryProfile`, `updateMemoryProfile`, `listFacts`, `addFact`, `forgetFact`, `restoreFact`, `correctFact`, `listMemorySources`;
    - `getBriefingToday`, `markBriefingSeen`;
    - `listSuggestions`, `decideSuggestions`, `getAutopilotRules`, `updateAutopilotRules`;
    - `getUsage`;
  - `http.ts`: sobre `shared/lib/api-client.ts` (cookie first-party, header de empresa ativa `X-Workspace-Id` da F71-S12). Cada resposta é validada com o Zod do contrato; `Idempotency-Key` (UUID v4) é gerado por **intenção do usuário** e reusado em retentativa; erros viram `CopilotClientError { code, status, ref }` com mensagens de `api-error-message.ts`;
  - `sse.ts`: leitor SSE robusto (frames partidos entre chunks, comentário de heartbeat, `AbortController`), validando cada frame em `CopilotStreamEventSchema`. Frame inválido descarta e loga (Sentry, sem conteúdo);
  - `mock/**`: implementação completa e determinística a partir de `@hm/shared/copilot/fixtures`.
    - Roteiros por intenção iguais à maquete: funil, receita, mover parados, lembrete, retorno, campanha, resumo, rascunho e briefing.
    - Atrasos realistas (TTFB 300 ms, deltas de 30 ms) desligáveis em teste.
    - Estados de proposta (`proposed → executing → completed/partially_completed`, desfazer) e bloqueios por papel e assinatura, controlados por `?copilot_mock_role=AGENT&copilot_mock_sub=readonly`, como o "Ver como" da maquete. Também `?copilot_mock_script=<roteiro>&copilot_mock_state=<status>`, que abre o Copiloto direto num roteiro e estado, para as capturas e o e2e de todos os slots;
  - `index.ts`: `getCopilotClient()`, que escolhe por `NEXT_PUBLIC_COPILOT_TRANSPORT` (`http` padrão; `mock` em dev e Ladle).
- `apps/web/features/copilot/core/store/**`: Zustand, com os slices
  - `ui`: `isOpen`, `size` (`bubble`\|`docked`\|`fullscreen`\|`sheet`), `ephemeral`, `opener` (elemento para devolver o foco);
  - `session`: sessão ativa e mensagens;
  - `turn`: status `idle|thinking|reading|acting|error`, veredito parcial, cartões do turno;
  - `proposals`: mapa por id, atualizado por SSE e por socket;
  - `context`;
  - `pending`: contagens para a F76: `briefingItems`, `suggestions`, `approvals`.
  Seletores estáveis (sem re-render global por token: o veredito parcial fica num slice isolado).
- `apps/web/features/copilot/core/context/**`:
  - `useCopilotPageContext(ctx | null)`: a tela declara e o hook limpa ao desmontar;
  - fallback por rota a partir de `usePathname()`, com tabela de padrões (`/pipeline`, `/conversations/[id]`, `/contacts`, `/hoje`, `/campaigns/[id]`, `/calendar`) que extrai `entity` do path quando houver;
  - validação local com `CopilotPageContextSchema`;
  - `contextLabel` vem do servidor (`turn_started`). Antes disso, o chip mostra o rótulo da rota ("Vendo: Pipeline").
- `apps/web/features/copilot/core/realtime/**`: escuta `copilot:proposal_updated`, `copilot:briefing_ready` e `copilot:suggestions_changed` pelo `shared/realtime` existente e atualiza o store.
- `apps/web/features/copilot/core/CopilotProvider.tsx` e `useCopilot.ts`: a API pública do resto do app.
  - `available` (de `GET /me`: falso em view-as, desligado ou sem `copilot.use`);
  - `open({ size?, prefill?, origin?, focus? })`, `close()`, `toggle()`, `ask(text, { origin })`;
  - `isOpen`, `size`, `status`, `pending`, `capabilities`;
  - `lastOutcome` (`'action_done'|'action_failed'|null`, para o "comemorou" e o "confuso" da F76).
  O provider faz o fetch de `/me` lazy (depois do primeiro paint) e **nunca** bloqueia o shell.
- `apps/web/features/copilot/surfaces/CopilotRoot.tsx`: **stub** que retorna `null` (o S02 é dono de `surfaces/**`). O provider o carrega com `next/dynamic` (`ssr: false`), para o chunk do Copiloto não entrar no First Load JS.
- `apps/web/features/copilot/index.ts`: exporta só `CopilotProvider`, `useCopilot`, `useCopilotPageContext` e os tipos públicos.
- Montagem: `apps/web/app/(app)/layout.tsx` envolve o `AppLayout` com `CopilotProvider` (dentro do `OnboardingProvider`).
- Mock de e2e: `apps/web/e2e/fixtures/copilot-mock.ts` (handler de `page.route` para `/api/copilot/**`, incluindo a resposta SSE como corpo `text/event-stream` com os frames do roteiro), registrado **uma vez** em `apps/web/e2e/fixtures/api-mock.ts`, com a API `mockCopilot(page, { role, subscription, script, state })`, equivalente aos parâmetros de URL do mock em app. Os slots seguintes só escrevem specs.

## Fora de escopo

- Qualquer pixel (S02 em diante). Ligar o modo http contra a API real e registrar contexto nas telas (S12).

### files_allowed

- `apps/web/features/copilot/core/**`
- `apps/web/features/copilot/index.ts`
- `apps/web/features/copilot/surfaces/CopilotRoot.tsx`
- `apps/web/app/(app)/layout.tsx`
- `apps/web/e2e/fixtures/copilot-mock.ts`
- `apps/web/e2e/fixtures/api-mock.ts`

### files_forbidden

- `apps/web/shared/components/layout/**` (shell; o botão é da F76)
- `packages/**`

## Contratos

- `useCopilot()` é a **única** porta do resto do app. A F76 consome `open`, `isOpen`, `status`, `pending` e `lastOutcome`. Mudança de forma nisso exige aviso em `tasks/COMMS.md`.

## Definition of Done

- [ ] Testes (vitest) do leitor SSE: frame partido em 3 chunks, 2 frames num chunk, heartbeat, frame inválido descartado, abort
- [ ] Teste de contrato: todas as fixtures do `@hm/shared` passam pelo mock e pelo `http` (com `fetch` mockado) e saem iguais
- [ ] Store: `open`/`close` devolvem o foco ao `opener`; `pending` atualiza por evento de socket; veredito parcial não re-renderiza o histórico (teste de contagem de render)
- [ ] Contexto: a tela declara e desmonta; o fallback por rota cobre a tabela; contexto inválido não vai para a rede
- [ ] `useCopilot().available = false` em view-as (mock de `/me`)
- [ ] First Load JS compartilhado sobe ≤ 2 KB gz (`pnpm --filter @hm/web build`; registrar antes e depois na nota)
- [ ] Zero `any`; nenhum hex, locale ou fuso literal

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/copilot/core --maxWorkers=1
pnpm exec eslint apps/web/features/copilot apps/web/e2e/fixtures/copilot-mock.ts --max-warnings=0
```

## Notas

- Agente: `frontend-engineer` (opus: arquitetura do cliente que 12 slots usam).
- **No máximo 2 workers de frontend em paralelo** (memória da máquina com typecheck e vitest de `@hm/web`).
- A F76 (botão e mascote, outro trabalho) usa `apps/web/features/copilot/{launcher,attention,intro}/**`. Nenhum slot da F74 toca essas pastas, e nenhum slot da F74 usa o glob `apps/web/features/copilot/**` inteiro.
