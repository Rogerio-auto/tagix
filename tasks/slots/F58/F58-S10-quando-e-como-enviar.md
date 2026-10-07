---
id: F58-S10
title: Configurar quando e como enviar sem termos técnicos
phase: F58
status: done
priority: high
estimated_size: M
depends_on: [F58-S06]
blocks: [F58-S12]
agent_id: frontend-engineer
source_docs:
  - docs/features/CAMPAIGNS.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-10-07T18:05:04Z
completed_at: 2026-10-07T18:28:55Z

---
# F58-S10 — Configurar quando e como enviar sem termos técnicos

## Objetivo

Criar a etapa **Quando enviar**, com agora/agendar, horários permitidos e ritmo
recomendado. Limites técnicos ficam em configurações avançadas e sempre mostram o
efeito em duração e quantidade por dia.

## Escopo

### files_allowed

- `apps/web/features/campaigns/editor/delivery/**`

### files_forbidden

- `apps/web/features/campaigns/editor/CampaignEditor.tsx`
- `apps/api/**`
- `apps/workers/**`

## Definition of Done

- [x] Escolha principal é **Enviar agora** ou **Agendar**, com data/hora/timezone claros.
  Evidência: `StartChoice.tsx`; confirmação por extenso com nome do fuso e `GMT±n`, e "No seu
  relógio" quando o fuso do navegador difere. Testes `DeliveryStep.test.tsx › agendamento e fuso`.
- [x] Horários oferecem presets legíveis e editor semanal acessível; não usam “send window” na UI.
  Evidência: `HoursPicker.tsx` (4 presets + Personalizar; editor por dia com faixas rotuladas
  "Segunda, faixa 1: começa às"). O teste `linguagem › não usa termo técnico` varre o HTML por
  send window / janela de envio / rate / tier / broadcast / drip.
- [x] Ritmo padrão recomendado mostra duração estimada, não “rate/min” isolado.
  Evidência: `PacePicker.tsx` — cada ritmo diz "Termina hoje às 10:40 · 3 dias"; a unidade por
  minuto só existe em Configurações avançadas, ao lado de "até N por hora · este público em X".
- [x] Limite diário aparece em avançado e alerta quando o público será dividido em mais de um dia.
  Evidência: `AdvancedSettings.tsx` + aviso `split_days` no resumo com o motivo (seu limite,
  capacidade do número, horários ou ritmo). Testes `model.test.ts › limite por dia` e
  `DeliveryStep.test.tsx › limite diário menor que o público`.
- [x] Resumo reage imediatamente a público, tier, quality e horário selecionado.
  Evidência: `forecastDelivery` (puro, local, sem rede) alimenta resumo, ritmos e avançado a cada
  mudança. Testes: público (mais contatos → mais tempo), tier (público acima da capacidade →
  perigo; capacidade menor que o limite próprio vence), quality (YELLOW dobra a duração, RED
  bloqueia), horário (início fora do horário → "espera o horário abrir").
- [x] Mobile, teclado, DST e timezone inválido têm cobertura.
  Evidência: mobile (faixa-resumo `md:hidden` no topo, alvos `min-h-11`, campos `h-11 text-base`
  ≥ 16 px, grade de 2 colunas só em `lg`); teclado (radiogroup com um único Tab e setas/Home/End —
  `nextOptionIndex` + markup); DST (Nova York início/fim, Lisboa; faixa de 5 h no domingo do
  salto; aviso inline); fuso inválido (bloqueia, preservado na hidratação, erro em 3 partes,
  opção "não reconhecido"). O e2e Playwright não hidrata neste host Windows: a cobertura é por
  testes unitários + markup estático (`renderToStaticMarkup`).

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
```

## Notas

- A correção do runtime de agendamento e ritmo pertence ao F58-S11.

## Entrega

Commit de implementação: `6bbdd217` — `feat(web): etapa Quando enviar sem termos tecnicos (F58-S10)`.

Tudo em `apps/web/features/campaigns/editor/delivery/` (fronteira respeitada; nada em
`CampaignEditor.tsx`, `apps/api/**` ou `apps/workers/**`):

- `timezone.ts`: fuso e horário de parede puros (`Intl`). Validação de IANA, partes locais,
  `resolveWallTime` com `exact`/`gap`/`ambiguous` (regra `compatible` do Temporal), rótulos
  (`GMT-3`, "Horário de Brasília"), catálogo de fusos do Brasil. Locale e fuso padrão vêm do
  market pack (`getMarketPack('BR')`).
- `schedule.ts`: estimativa dia a dia, correta no horário de verão, espelhando o worker (ritmo
  GCRA, faixas `[início, fim)` no fuso, limite diário que vira no fuso, prazo final que corta).
- `model.ts`: valor da etapa, presets de horário e ritmo, editor semanal, validação, avisos
  (`forecastDelivery`), payload (`toDeliveryPayload`), hidratação (`fromStoredDelivery`),
  navegação de teclado.
- `queries.ts`: `useDeliveryContext(campaignId)`, `POST /builder/estimate` sem sobreposição, só
  para ler público elegível salvo + qualidade + capacidade diária do número.
- Componentes: `DeliveryStep.tsx` (etapa), `StartChoice.tsx` (+ `TimezoneField`),
  `HoursPicker.tsx`, `PacePicker.tsx`, `AdvancedSettings.tsx`, `DeliverySummary.tsx`
  (+ `DeliverySummaryStrip` do celular), `ChoiceGroup.tsx`, `DeliveryHelp.tsx`, `field.ts`,
  `index.ts`.
- Testes: `timezone.test.ts` (11), `schedule.test.ts` (11), `model.test.ts` (28),
  `DeliveryStep.test.tsx` (16).

### Contrato com o orquestrador (F58-S13)

`<DeliveryStep value onChange mode campaignId audienceSize? channelHealth? contactQuietHours?
readOnly? showAllErrors? onEditAudience? onReadinessChange? />`

- Estado inicial: `fromStoredDelivery(detail.campaign)` (lê `timezone`, `startAt`, `endAt`,
  `sendWindows`, `rateLimitPerMinute`, `dailyLimit`) ou `emptyDeliveryStep(fusoDoWorkspace)`.
- `onReadinessChange` publica `{ canAdvance, issues, notices, payload }`. `payload` é o pedaço do
  `PATCH /api/campaigns/:id`: `{ timezone, startAt, endAt, sendWindows: { enabled, timezone,
  windows }, rateLimitPerMinute, dailyLimit }`. `startAt: null` = começa ao iniciar;
  `dailyLimit: null` = sem limite próprio. O mesmo fuso vai em `timezone` e em
  `sendWindows.timezone` (o worker usa um para os horários e o outro para virar o limite diário).
- `canAdvance` é `false` com pendência, com fuso inválido, em leitura, ou quando a configuração
  não termina nem em um ano (`notices` traz `unfeasible`). Avisos de qualidade/capacidade NÃO
  bloqueiam a etapa: a Revisão (preflight) decide o que bloqueia o início.
- Botão final da Revisão: `payload.startAt !== null` → "Agendar campanha"; senão "Iniciar campanha".
- `audienceSize` sobrepõe o público salvo (público ainda não persistido); `channelHealth`
  sobrepõe a consulta (se o assistente já tiver o estimate). Sem `campaignId` e sem esses props,
  o resumo mostra o vazio que leva ao público.

### Decisões

- **Estimativa local, não a do servidor.** O `POST /builder/estimate` (F58-S06) conta 1.440
  min/dia e ignora o corte de ritmo por qualidade amarela. A tela promete o que o worker faz:
  ritmo efetivo, faixas reais no fuso (no dia do horário de verão a faixa tem 1 h a menos),
  limite que vira à meia-noite do fuso. A consulta ao servidor fica só para público e saúde do
  número.
- **Sequência:** o resumo estima a PRIMEIRA mensagem para todo o público e diz, em texto, que as
  seguintes seguem as esperas e dividem ritmo e limite. Somar as seguintes à primeira onda (como
  o estimate do servidor faz) mentiria sobre quando "todos receberam".
- **Ritmos:** Cuidadoso 20/min, Recomendado 30/min (padrão da API), Rápido 60/min (teto antes do
  aviso `CAMPAIGN_RATE_TOO_HIGH`). Personalizado 1–600 em avançado, com aviso acima de 60.
- **Limite por dia desligado por padrão** (`dailyLimit: null`): vale a capacidade do número.
  Rascunhos antigos com `dailyLimit = 1000` (padrão do `POST /campaigns`) aparecem com o limite
  ligado: a tela mostra o que está salvo.
- **Padrão de horários = horário comercial.** "Qualquer horário" existe, com aviso de madrugada
  (o preflight também avisa).
- **Faixa não atravessa a meia-noite** (o worker só entende `[início, fim)` no mesmo dia): a tela
  recusa e explica "use uma faixa em cada dia".
- **Fuso inválido é preservado**, nunca trocado em silêncio pelo padrão: trocar mudaria o horário
  do envio sem ninguém ver.
- **Agendamento com folga mínima de 1 min**; a etapa reavalia "já passou" a cada 30 s. Se o
  horário vencer antes da ativação, o backend começa na hora (comportamento da F58-S11).
- **Horário de verão:** horário inexistente avança pelo tamanho do salto; repetido vale a primeira
  ocorrência; os dois avisam ao lado do campo.
- Sem `--brand` na etapa (fica para o CTA do assistente); escolhido = borda `text-mid` +
  `surface-2`; avisos em `info`/`warn`/`danger`.
- UX_PRINCIPLES aplicados: §2.1, §2.4, §2.5, §2.6, §2.7, §2.10, §2.11, §3.6, §8.

### Validação

- `pnpm --filter @hm/web typecheck`: verde.
- `pnpm --filter @hm/web test`: 52 arquivos, 622 testes verdes (66 novos neste slot).
- `eslint apps/web/features/campaigns/editor/delivery`: 0 erros, 0 avisos.
- `pnpm --filter @hm/web build`: verde (47/47 páginas). A primeira tentativa falhou no download
  de fonte do `next/font` (`app/layout.tsx`, rede); a segunda passou sem mudança de código.
- Desempenho: 4 estimativas de 100 mil contatos com limite diário em ~8 ms (teste com teto 400 ms).
- Validação visual pendente (Rogério): a etapa ainda não está montada no assistente; entra no
  F58-S13.
