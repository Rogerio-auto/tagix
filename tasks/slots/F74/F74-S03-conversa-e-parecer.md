---
id: F74-S03
title: Conversa e parecer (compositor, streaming do veredito, por quê, cartões de dados, fonte e hora, próximo passo, sugestões por tela, chip de contexto)
phase: F74
status: blocked
priority: critical
estimated_size: L
model: opus
ui: true
depends_on: [F74-S02, F74-S04]
blocks: [F74-S05, F74-S07, F74-S10, F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
  - docs/design/copilot-integracoes.html
  - docs/DESIGN_SYSTEM.md
agent_id: frontend-engineer
---
# F74-S03 — Conversa e parecer

## Objetivo

A conversa do Copiloto: a pessoa pede, e a resposta chega como **parecer**, não como chat. O veredito chega em streaming; depois vêm o porquê em números, os dados como componentes do app (lista de negócios, KPIs, série, funil, cartão de contato), a fonte com hora e o próximo passo clicável. As sugestões mudam conforme a tela, e o chip diz o que ele está vendo (A3).

## Contexto

Renderiza dentro das superfícies do S02 (substitui o stub `conversation/index.ts`) e usa os cartões de ação do S04 na linha do tempo. Os eventos são os do contrato (`turn_started`, `status`, `verdict_delta`, `tool_result`, `action_*`, `final`, `budget_exceeded`, `error`).

## Escopo (faz)

- `apps/web/features/copilot/conversation/**`:
  - `CopilotConversation.tsx`: linha do tempo + compositor; a rolagem gruda no fim só se a pessoa já estava no fim;
  - `Composer.tsx`: `textarea` que cresce até 6 linhas (16 px no celular), Enter envia, Shift+Enter quebra linha, ≤ 2.000 caracteres com contador perto do fim, desabilitado com motivo durante o turno, Esc cancela o turno (`cancelTurn`). **Sem botão de microfone na v1** (spec §10);
  - `Turn.tsx`, em ordem fixa:
    1. meta "Copiloto · 09:14";
    2. status vivo ("Lendo o pipeline…", o rótulo do servidor) com o indicador "pensando", que a F76 pode trocar pelo mascote via `useCopilot().status`; aqui é o glifo com varredura. Se `Thinking` de `@hm/ui` (F76-S03) já existir, use-o; senão, a F74-S12 troca;
    3. **Veredito** (`verdict_delta`; com reduced motion, o texto aparece inteiro no `final`, sem digitação);
    4. **Por quê** (≤ 3 linhas, números em IBM Plex Mono `tabular-nums`);
    5. **Dados** (cartões por `data_refs` na ordem);
    6. **Fonte** ("Com base em 23 mensagens e no histórico do negócio · dados de 09:14");
    7. **Próximo passo** (botões: `navigate` usa o router do Next; `ask` envia como nova pergunta);
  - `aria-live`: ao `final`, anuncia o veredito uma vez na região do S02. Nada é anunciado token a token;
  - estados:
    - vazio, com saudação zero ("Peça ao Copiloto…" + 3 sugestões da tela);
    - erro, com código e `ref` copiável, em 3 partes: o que houve, por quê, o que fazer;
    - `budget_exceeded`: "O Copiloto chegou ao limite do mês" + o que segue funcionando;
    - `rate_limited` e `turn_in_progress`;
  - `Suggestions.tsx`: sugestões por rota, as da maquete (`SUGS`): Início, Pipeline, Inbox, Integrações, Copiloto e Configurações. A tabela fica em `suggestions.ts`; não mostra sugestão de capacidade que o papel não tem (`capabilities`);
  - `ContextChip.tsx`: "Vendo: Maria Souza · Alinhadores" (rótulo do servidor; antes, o da rota). Clicar mostra o que ele usa ("Esta tela e o histórico desta conversa").
- `apps/web/features/copilot/cards/**`: renderizadores por `kind`, `deal_list`, `contact_card`, `deal_card`, `kpis`, `series` (SVG leve, sem lib nova, eixo e rótulo acessível), `funnel`, `event_list`, `conversation_list`, `campaign_card` e `table`.
  - Mesmo vocabulário visual do app (DS 3.0, componentes do `@hm/ui`).
  - Cada item com link para o lugar certo ("Abrir no Pipeline").
  - `truncated` → "mostrando 50 de 214 · ver no Pipeline".
  - Mostrar a hora do dado (`as_of`).
  - **Os números do cartão vêm do `data` do evento, nunca do texto do modelo.**
- Texto do modelo renderizado como **texto puro** (sem HTML, sem markdown de imagem, links só internos de uma allowlist de rotas; link externo vira texto), por causa da spec §8 R4.
- `briefing/index.ts`: **stub** de `BriefingCard` que o S05 substitui. A linha do tempo o renderiza quando o turno é de origem `briefing`.
- `apps/web/e2e/specs/copilot-conversation.spec.ts`: perguntas da maquete com o mock (funil, receita, resumo), com a ordem dos blocos, a fonte com hora, o próximo passo navegando, as sugestões trocando com a rota, o chip, os estados de erro e orçamento, e a resposta com link externo renderizada como texto.

## Fora de escopo

- Briefing (S05), celular (S10), integração com a API real (S12).

### files_allowed

- `apps/web/features/copilot/conversation/**`
- `apps/web/features/copilot/cards/**`
- `apps/web/features/copilot/briefing/index.ts`
- `apps/web/e2e/specs/copilot-conversation.spec.ts`

### files_forbidden

- `apps/web/features/copilot/core/**`
- `apps/web/features/copilot/actions/**` (S04; só importar)

## Definition of Done

- [ ] Formato fixo em todos os roteiros do mock (teste de componente pela ordem do DOM)
- [ ] Streaming suave: sem re-render da linha do tempo inteira por delta (teste de contagem de render); 60 fps no balão com 30 turnos (registro na nota)
- [ ] Cartões fiéis aos componentes do app, nos dois temas; `series` e `funnel` acessíveis (texto alternativo com os números)
- [ ] Texto do modelo sem HTML e sem link externo clicável (teste com payload malicioso)
- [ ] axe sem violação séria; capturas 1440 e 375 nos dois temas em `apps/web/e2e/.artifacts/f74-s03/`
- [ ] `/hm-designer` contra A3; "parece chat genérico" reprova

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/copilot/conversation features/copilot/cards --maxWorkers=1
pnpm exec eslint apps/web/features/copilot/conversation apps/web/features/copilot/cards --max-warnings=0
```

## Notas

- Agente: `frontend-engineer` (opus).
- "Sem 'Claro! Ótima pergunta'": isso é do prompt (F73-S04), mas a interface também não adiciona saudação nem avatar de chat.
