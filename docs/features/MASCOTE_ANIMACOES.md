# F76 — Mascote (direção C, Personagem) e animações do sistema

> **Status:** aprovado para construção (Rogério, 2026-10-16: direção C; o personagem é parte do sistema).
> **Decisão:** [ADR-006](../decisions/ADR-006-mascote-personagem-tecnologia-e-politicas.md) (tecnologia por spike
> medido, orçamento de atenção, política de carregamento).
> **Proposta de origem:** [`../design/copilot-botao-animacao.md`](../design/copilot-botao-animacao.md) e o demo
> [`copilot-botao-animacao.html`](../design/copilot-botao-animacao.html) (`?dir=C`). Contexto do Copiloto:
> [`copilot-integracoes-ux.md`](../design/copilot-integracoes-ux.md).
> **Slots:** `tasks/slots/F76/` (S01–S09). Corre **em paralelo** à F73 (frontend e `@hm/ui`); toca a F74 em dois
> contratos (§6.5 e §6.6).

---

## 1. Objetivo

O Copiloto ganha um personagem que dá vida e diversidade ao produto **sem custar atenção nem desempenho**: os
botões do Copiloto (sidebar e TopBar) com gradiente que varre as letras de vez em quando e o personagem que acena
ou brinca sob um orçamento de atenção; e o mesmo personagem, com parcimônia, nas esperas longas, no "pensando" do
Copiloto, nos estados vazios, nos recibos com Desfazer e no onboarding.

## 2. Princípios

1. **Conteúdo primeiro.** Esqueleto aparece em 0 ms; o personagem nunca atrasa nem substitui conteúdo.
2. **Um ator por vez.** No máximo um personagem animado por viewport. Os demais ficam em pose parada.
3. **Movimento significa estado.** Repouso não respira nem flutua; só pisca. Loop contínuo só em "pensando",
   enquanto existe trabalho real.
4. **Atenção é orçamento, não direito.** Chamar a pessoa tem cota, portões, aprendizado e silêncio (ADR-006 §4).
5. **Marca manda.** Cor por token; marca que proíbe personagem recebe o glifo parado (`glyph`).
6. **Acessível por construção.** `aria-hidden` no decorativo, anúncio em `aria-live="polite"`, movimento reduzido
   congela em pose, nada pisca acima de 3 Hz (pulso mais rápido 0,75 Hz), contraste AA do texto com gradiente,
   alvo ≥ 44 px no celular, zero layout shift.
7. **Peso é restrição de design.** Função inteira ≤ 30 KB gz (meta ≤ 12 KB), sem dependência nova salvo se o
   spike provar.

## 3. O personagem

### 3.1 Arte (S02)

- Base: o rig C do demo (cabeça com visor, dois olhos em pílula, antena com ponta de cor, corpo, dois braços),
  **refeito como arte final** com a sensibilidade do DS 3.0: geometria de raio coerente com `--r-*`, traço único
  (1,5 px no `md`), sem gradiente interno, sem brilho, sem roxo, sem faísca.
- **LODs desenhados à mão** (ADR-006 §3): `xs` 16–20 px (só cabeça + antena), `sm` 24 px (silhueta cabeça+corpo
  fundidos, sem braços em repouso; **um** braço só no aceno, traço ≥ 2 px renderizado), `md` 40–64 px (rig
  completo), `lg` 96–160 px (onboarding). Cada LOD na grade do seu tamanho (traço em pixel inteiro).
- **Folha de estados** (pose de entrada, pico e saída de cada estado) por LOD, nos dois temas e nas marcas.
- **Camadas** nomeadas e estáveis (contrato entre arte e código): `fig`, `body`, `head`, `visor`, `eyes`
  (`eyes-open`, `eyes-closed`, `eyes-happy`, `eyes-squint`), `antenna`, `antenna-tip`, `arm-l`, `arm-r`,
  `hand-r`. Pivôs documentados no `rig.json`.

### 3.2 Estados (máquina de estados em TS, S03)

| Estado | Duração e curva | Movimento | Gatilho | Nunca quando |
|---|---|---|---|---|
| `idle` | parado | nenhum | padrão | — |
| `blink` | 140 ms `--ease-mover` | `eyes` scaleY 1→0,12→1 | 4–9 s aleatório, só visível | aba oculta, Desligadas, reduced-motion |
| `wave` | 860 ms `--ease-mover` | antecipação +14°, braço `arm-r` 2 ciclos, antena atrasa (follow-through) | chamada do diretor de atenção | digitando, foco em campo, modal, arrasto |
| `play` | 700 ms | comprime e estica, salto de 3,6 px (no `md`) | primeiro uso, marcos (≤ 1×/semana) | Discretas |
| `thinking` | 1,6 s `linear` ∞ | antena gira a ponta, olhos varrem | trabalho real em curso (`Thinking`) | sem trabalho |
| `celebrate` | 900 ms | pulinho + olhos felizes | ação concluída com sucesso (recibo) | ação falhou |
| `sleep` | pose em 320 ms | olhos fechados, cabeça inclina 6° | vazio; aba parada 30 min | — |
| `confused` | 900 ms e fica na pose | cabeça inclina, olhos `squint`, ponta da antena em `--warn` | erro de integração que a pessoa resolve | erro que ela não resolve |
| `peek` | entra 320 ms, sai 240 ms | espia da borda (só a cabeça, clip) | sugestão pendente na alça | Copiloto aberto |
| `look` | 200 ms | olhos 1,1 px na direção (`up`/`left`/`right`) | hover no botão; painel aberto | — |

Transições: qualquer estado com fim volta para `idle`; `thinking` sai para `celebrate` (sucesso), `confused`
(erro resolvível) ou `idle`. Pedido de estado novo durante um estado de uma vez **enfileira** (máx. 1) em vez de
cortar, salvo `thinking`, que interrompe. Todos ≤ 900 ms fora de loop (cânone §4).

### 3.3 Gradiente nas letras (`GradientText`, S03)

Varredura de 900 ms `linear`, faixa de 56% da palavra a 105°, interpolada em oklab, posição por `@property
--cp-sweep` (`<percentage>`). Sem suporte a `@property` (Firefox < 128): texto sólido em `--cp-ink` e a varredura
não roda (detecção por `CSS.registerProperty` existir). Piso: cada parada (`--cp-ink`, `--cp-ink-a`, `--cp-ink-b`)
≥ 4,5:1 sobre `--surface` e `--surface-2`, luminância monotônica entre paradas (o teste de tokens mede). Medido
no demo: Leadium 13,9/6,2; Odonto 7,6/6,0; Maian 8,3/4,7 (escuro/claro). Fora do gatilho o texto é sólido.

### 3.4 Tokens novos (`@hm/design-tokens`, S03)

`--cp-ink`, `--cp-ink-a`, `--cp-ink-b` (texto/varredura), `--m-ink` (traço), `--m-fill` (corpo), `--m-accent`
(ponta da antena, braço no aceno), `--m-visor`, `--m-eye`, `--m-cut` (recorte sobre fundo), `--m-dur-blink`,
`--m-dur-wave`, `--m-dur-celebrate`. Por tema (`data-theme`) **e** por marca (`data-brand`, §5). Maian: letra
`#B4530F`, mascote `#D4610F` (o laranja `#EE7623` dá 2,9:1 no branco; nunca como texto). Nenhum hex em JSX.

## 4. Orçamento de atenção (S04)

Regra em ADR-006 §4. Implementação:

- **Diretor de atenção** (`useAttentionDirector`, em `apps/web/features/copilot/attention/`): máquina
  `Repouso → Fila → Chamada → Aguardando → Engajada | Ignorada`, `Formada`, `Silenciada`, conforme o diagrama do
  demo. Portões lidos de sinais do navegador: `visibilitychange`, `IntersectionObserver` do botão, `pointermove`/
  `keydown` (timestamps, sem registrar teclas), `document.activeElement` editável, `[aria-modal="true"]` aberto,
  `pointerdown` ativo, drag (`dragstart`/`dragend`), estado do Copiloto via `useCopilot().isOpen` (§6.5), e
  início da sessão (`sessionStorage`).
- **Entradas por evento:** `notify({ kind: 'briefing' | 'suggestion' | 'integration_error', key })` (o launcher
  deriva briefing/sugestão de `useCopilot().pending`; a F75 chama para erro de integração); `markOpened()` (o
  launcher chama ao abrir); `markActionDone()` (de `lastOutcome`; não gasta cota).
- **Saída:** `{ mascotState, sweep: boolean, signal: 'none'|'accent'|'warn', statusLine?: string }` para o
  launcher.
- **Persistência por membro, sem tabela nova:** em `members.notification_prefs` (jsonb que já guarda como o
  sistema chama a atenção da pessoa, inclusive `sound`), sob a chave `copilot`:

  ```ts
  copilot: {
    motion: 'live' | 'subtle' | 'off'                  // Vivas / Discretas / Desligadas
    attention: {
      day: string                                      // AAAA-MM-DD no fuso do membro
      ambientCount: number; eventCount: number; sweepCount: number
      lastCallAt: string | null; lastSweepAt: string | null
      ignoredStreak: number; cooldownFactor: 1 | 2 | 4
      ignoredLog: string[]                             // ISO, ≤ 8, janela de 7 dias
      openDays: string[]                               // AAAA-MM-DD, ≤ 7
      silencedUntil: string | null
      lastEventByKey: Record<string, string>           // dedup por evento (≤ 32 chaves)
    }
  }
  ```

  Rota nova `PUT /api/members/me/copilot` (merge com `jsonb_set`, nunca sobrescreve `in_app/email/push/sound`),
  Zod estrito, ≤ 4 KB. O cliente mantém cópia em `localStorage` (`hm:copilot:<memberId>`) e sincroniza entre abas
  por `BroadcastChannel`; grava no servidor com debounce de 5 s e em `pagehide` (`sendBeacon`). Conflito entre
  dispositivos: vence o maior contador do dia (conservador: chama menos).
- **Configurações → "Animações do Copiloto"** (seção pessoal no registro `apps/web/features/settings/shell/
  registry.tsx`, id `animacoes`): Vivas / Discretas / Desligadas com prévia ao vivo do personagem; mostra
  "Seu sistema pede menos movimento: usamos Discretas" quando `prefers-reduced-motion`.

## 5. Marcas e flag (S08)

- Sem mecanismo de marca por empresa hoje (só `--brand` e `settings.brand_color`). Criamos:
  `workspaces.settings.brand = { theme: 'leadium' | 'odonto' | 'maian', mascot: 'character' | 'glyph' }`
  (Zod; ausente = `{ theme: 'leadium', mascot: 'character' }`), definido **pela plataforma** (submarca é contrato,
  não preferência do cliente) em `PUT /api/platform/tenants/:id/brand`, devolvido em `/api/me` como
  `workspace.brand`, e aplicado no `<html data-brand>` pelo shell (sem flash: junto do script anti-flash de tema).
- **Odonto ("Arrimo por Arcada")**: `mascot: 'glyph'` forçado pela marca (o servidor rejeita `character` com
  `theme='odonto'`): glifo parado, varredura violeta só por evento, nenhum rosto, robô ou faísca em lugar nenhum
  (inclui `LongWait`, vazios e onboarding, que caem para skeleton + texto).
- **Maian**: tema claro laranja; padrão `glyph` até o Rogério decidir (pergunta aberta). Os tokens do personagem
  na marca Maian já existem para a troca ser só de flag.
- **Telemetria só de evento** (sem conteúdo, sem texto, sem rota): `POST /api/members/me/ui-events
  { events: [{ name: 'copilot_nudge', kind: 'ambient'|'briefing'|'suggestion'|'integration_error', outcome:
  'opened_60s'|'ignored'|'suppressed', motion: 'live'|'subtle'|'off' }] }` (lote ≤ 20, rate limit 30/min/membro),
  agregado em contadores Redis por dia e workspace (`ui:nudge:<dia>:<ws>:<kind>:<outcome>`, TTL 120 dias) e um log
  estruturado sem PII. Sem tabela. Leitura para a plataforma fica para quando houver painel (fora de escopo).

## 6. Contratos públicos (`@hm/ui`, S03; a F74 depende destes)

### 6.1 `Mascot`

```ts
type MascotState = 'idle'|'blink'|'wave'|'play'|'thinking'|'celebrate'|'sleep'|'confused'|'peek'
type MascotLook = 'none'|'up'|'left'|'right'
interface MascotProps {
  state?: MascotState                 // padrão 'idle'
  look?: MascotLook
  size: 16 | 20 | 24 | 32 | 40 | 48 | 64 | 96 | 128 | 160   // escolhe o LOD
  variant?: 'character' | 'glyph'     // padrão: do MascotStage (marca); 'glyph' = glifo parado
  motion?: 'live' | 'subtle' | 'off'  // padrão: do MascotStage (preferência + reduced-motion)
  autoBlink?: boolean                 // padrão true só em 'live'
  onStateEnd?: (s: MascotState) => void
  className?: string
}
```

Sempre `aria-hidden="true"`, `role` nenhum, tamanho fixo reservado (sem layout shift), pausa fora da viewport e
com aba oculta. Em `subtle`: só `look`, `thinking` reduzido a pulso de opacidade da ponta da antena (0,75 Hz) e
poses paradas. Em `off` ou reduced-motion: pose estática do estado (esmaecimento de 160 ms entre poses).

### 6.2 `MascotStage`

Provider no shell: `{ brandVariant, motion, claim(id): boolean, release(id) }`. `claim` implementa "um ator por
vez": o primeiro que pede anima; os outros recebem `false` e renderizam pose parada.

### 6.3 `GradientText`

`<GradientText as="span" sweep={boolean} onSweepEnd>Copiloto</GradientText>` — `sweep` dispara **uma** varredura;
reentrância ignorada até terminar. Texto real no DOM (lido por leitor de tela normalmente).

### 6.4 `LongWait` e `Thinking`

```ts
<LongWait pending={boolean} skeleton={ReactNode} label="Carregando o funil"
          progress?: { done: number; total: number } onCancel?: () => void />
// 0 ms: skeleton. ≥ 1.200 ms pendente: personagem 'thinking' (md) + label, se o MascotStage conceder; senão só
// label. Visível ⇒ fica ≥ 600 ms. ≥ 8 s: "Está levando mais que o normal". progress ⇒ barra real + contagem.
// onCancel ⇒ botão Cancelar a partir de 8 s. Odonto/glyph ⇒ skeleton + texto, sem personagem.

<Thinking active={boolean} label="Lendo o pipeline…" size?: 24 | 40 />
// Indicador "pensando" do Copiloto. Aparece após 300 ms de 'active' (evita flash), personagem em 'thinking' +
// label em GradientText com varredura contínua lenta (2,4 s), anúncio único em aria-live ao começar ("Copiloto
// pensando") e ao terminar não anuncia (quem anuncia o veredito é a F74). Respeita motion e marca.
```

### 6.5 Launcher do Copiloto (S05) — contrato com a F74

- A F74-S01 expõe a única porta pública do Copiloto, `useCopilot()` de `apps/web/features/copilot`: `available`,
  `open/close/toggle`, `isOpen`, `status` (`idle|thinking|reading|acting|error`), `pending` (`briefingItems`,
  `suggestions`, `approvals`) e `lastOutcome` (`action_done|action_failed|null`). A F76 só consome isso.
- A F76-S05 é dona de `apps/web/features/copilot/launcher/**` e monta `<CopilotLauncher variant="sidebar"|"rail" />`
  em `shared/components/layout/Sidebar.tsx` e `variant="topbar"|"mobile"` em `TopBar.tsx` (a F74 deixa esses
  arquivos para a F76).
- A alça de borda (A1) é da F74-S02 (`features/copilot/handle/**`); a F76 exporta `<CopilotPeek active />` (o
  personagem espiando, `clip-path`, sem layout shift) para a alça montar.
- Medidas da proposta: sidebar 212 × 52 (personagem 24 px, "Copiloto", linha de status), TopBar 36 px, barra
  recolhida 44 × 44 só com o personagem, celular 44 × 44 no TopBar. Quem chama é a sidebar; o TopBar só ganha
  vida quando a sidebar não está visível.

### 6.6 Recibo (S07) — contrato com a F74

`<ActionReceipt status="done"|"failed" message undoUntil?: Date onUndo?: () => void />` em `@hm/ui`: anel de 30 s
do Desfazer, personagem `celebrate` (24 px) só em `done`, chama `MascotStage.claim`. A F74 usa nos níveis 2 e 3.

## 7. Política de carregamento (S06) — onde o personagem entra

| Lugar | Comportamento | Slot |
|---|---|---|
| `apps/web/app/(app)/loading.tsx` (primeira carga do app autenticado) | skeleton do shell em 0 ms; `LongWait` após 1,2 s | S06 |
| Rotas pesadas: `pipeline`, `calendar` (já tem `loading.tsx`), `flows/[id]` (já tem), `campaigns`, `agents`, `knowledge`, `conversions`, `contacts`, `hoje` | `loading.tsx` próprio com skeleton fiel ao layout + `LongWait` | S06 |
| `conversations` (Inbox) | **só skeleton**, nunca personagem | S06 |
| `settings`, `help` | só skeleton (leve) | S06 |
| `(auth)`, `(public)`, `(platform)` | sem personagem | — |
| Fallbacks de `Suspense` com espera de dado do cliente (widgets da Home, gráficos) | skeleton; nunca personagem em KPI/número | S06 |
| "Pensando" do Copiloto | `Thinking` | S03 (componente), F74 (uso) |
| Sincronização, importação e ações em lote (F75 passo 5, importação CSV, ação de lote do Copiloto, envio de campanha em lote) | `LongWait` com `progress` real | S06 (padrão e uso nos existentes), F75-S10 (assistente) |
| Estados vazios: Copiloto, Atividade, Loja sem resultado, Pipeline vazio, Contatos vazio, Campanhas vazio, Flows vazio, Conhecimento vazio | pose parada (`sleep` ou `idle` `md`) + frase; sem loop | S07 |
| Card "Atenção" da Loja | pose `confused` parada (`sm`) | S07 (componente), F75-S09 (uso) |
| Assistente de mapeamento do ERP (passo 3) | só `thinking` enquanto propõe; nunca `confused` | F75-S10 consome `Thinking` |
| Recibo com Desfazer | `celebrate` só após sucesso | S07 |
| Onboarding / primeiro uso | apresentação do Copiloto (personagem `lg`, `play` 1 vez) + o gesto da borda; uma vez por membro (`tour_state['copilot-intro']`) | S07 |
| Inbox, mensagens a clientes, KPIs e números, toasts e notificações, ícone do PWA e badge | **nunca** | todos |

Contagem de tempo do `loading.tsx`: o Next mostra `loading.tsx` imediatamente; o `LongWait` interno mede desde o
mount. Um utilitário `useLongWait(pending)` serve aos casos fora de `loading.tsx` (mutations do TanStack Query).

## 8. Desempenho e verificação

- Peso: ≤ 30 KB gz para tudo da F76 (arte + CSS + TS + runtime se houver), medido por script do S01 e repetido no
  S09; nada da F76 no caminho crítico do LCP (o launcher pinta pose estática SSR; animação hidrata depois).
- INP p75 ≤ 200 ms nas telas com launcher; zero Long Animation Frame > 50 ms atribuível com CPU 4× mais lenta.
- Só `transform`, `opacity` e a variável registrada; `will-change` só durante o estado.
- Pausa com `visibilitychange` e `IntersectionObserver`; zero CPU em repouso (só o timer do piscar, que não roda
  com a aba oculta).
- Capturas 375/768/1440 × claro/escuro × marcas (Leadium, Odonto, Maian) × `motion` (live/subtle/off) ×
  reduced-motion; axe (`expectNoSeriousAxe`) nos dois temas.

## 9. Fora de escopo

- Nome próprio do assistente (pergunta aberta; o personagem é desenhado para servir a "Copiloto" ou a um nome).
- Painel de telemetria na plataforma (os contadores ficam no Redis).
- Personagem em e-mail, push, WhatsApp ou qualquer superfície que o cliente final vê.
- Som.

## 10. Mapa demo → slot

| Demo / pedido | Slot |
|---|---|
| Spike S × R medido, decisão | S01 |
| Arte C final, LODs, folha de estados, marcas | S02 |
| `Mascot`, máquina de estados, `GradientText`, `Thinking`, `LongWait`, `MascotStage`, tokens | S03 |
| Orçamento de atenção, persistência, "Animações do Copiloto" | S04 |
| Botões sidebar/TopBar/recolhida/mobile, alça espiando, gatilhos por evento | S05 |
| `loading.tsx` por grupo de rotas, Suspense, lote/sincronização | S06 |
| Vazios, recibo com Desfazer, onboarding | S07 |
| Flag por marca, temas Odonto/Maian, telemetria | S08 |
| QA: axe, reduced-motion, INP/peso/LoAF, capturas, `/hm-designer`, `review-animations` | S09 |

## 11. Ondas

- **Onda 1:** S01 (spike).
- **Onda 2:** S02 (arte) — portão `/hm-designer` antes de seguir.
- **Onda 3:** S03 (`@hm/ui`).
- **Onda 4:** S04 (atenção) ‖ S06 (carregamento) — no máximo 2 frontends simultâneos.
- **Onda 5:** S05 (launcher; também depende da F74-S01) ‖ S07 (vazios, recibo, onboarding).
- **Onda 6:** S08 (marcas, flag, telemetria).
- **Onda 7:** S09 (QA e portões).
