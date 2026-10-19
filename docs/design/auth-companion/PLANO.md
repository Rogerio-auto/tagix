# Companheiro das telas de acesso — plano do arquiteto (Opus, 2026-10-19)

> Fonte de verdade dos slots F76-S10..S13. A análise de movimento do reel de referência está em
> [`reel-scene.json`](./reel-scene.json) (medida por pixel). O reel empresta a **coreografia**; a arte é a do Leadium.
> Este plano foi verificado contra o código em 2026-10-19; onde diz "não existe", foi conferido.

## 0. Fatos verificados que moldam o plano

- **Não existe OTP no Leadium.** A verificação é por link (`VerifyEmail.tsx` lê `?token=`). O "passo 2" do reel mapeia para
  dois estados que já existem: "Verifique seu email" (`SignupForm.tsx`, estado `sentTo`) e "link enviado"
  (`ResetPasswordForm.tsx`, estado `sent`). Não inventar campo de código.
- **Não existe botão de mostrar senha** (`packages/ui/src/Input/Input.tsx`). A regra "não olha" = foco num `input[type=password]`.
- **Tokens que existem** (`packages/design-tokens/src/tokens.css`): curvas `--ease` (0.2,0.8,0.2,1) e `--ease-spring`
  (0.16,1,0.3,1); durações `--dur-fast` 120, `--dur-base` 200, `--dur-slow` 320; cores `--surface*`, `--text*`, `--brand`,
  `--brand-text`, `--warn`, `--success`, `--border*`, `--shadow-ds-*`. **Não existem** `--ease-mover`, `--ease-saida`, `--m-*`
  (só no demo `.html`).
- O web não tem marca por empresa (`data-brand`). Telas de acesso = sempre marca Leadium.
- Conflito de regra: `MASCOTE_ANIMACOES.md` §2.3 "repouso não respira nem flutua; só pisca". O reel respira → emenda (§3).
- Layout atual `apps/web/app/(auth)/layout.tsx`: formulário à esquerda (≤ 44rem, coluna de 25rem), `BrandPanel` editorial à
  direita (lg+). No celular o logotipo fica no topo. `AuthKit.tsx` já é `'use client'`.
- Testes de tela existentes: `apps/web/e2e/specs/auth-ds3.spec.ts` (captura + axe em todas as telas de acesso).

## 1. Conceito de arte e animação

**Ideia.** O companheiro é o mesmo robô do Copiloto (rig C), que te recebe na porta. Calmo, editorial, monocromático. A
antena é o **único ponto de cor**. A assinatura visual é a **sombra de contato**: encolhe e esmaece com a altura, dando peso
ao voo sem efeito nenhum. Referência de acabamento: Linear e Stripe, não app infantil.

**Material e luz.** Chapado, traço único de 1,5 px (md), sem gradiente interno, sem brilho, sem roxo, sem faísca. A única
"luz" é a sombra de contato: elipse 28×6 com radial-gradient de `--text` a 14%, com `opacity` e `scale` animados.

**Geometria.** Rig C do demo (`copilot-botao-animacao.html`), redesenhado numa grade de 48 com traço em pixel inteiro.
Camadas exatamente como na spec §3.1: `fig, body, head, visor, eyes (eyes-open|closed|happy|squint), antenna, antenna-tip,
arm-l, arm-r, hand-r`. A versão mobile (40 px) é desenhada à mão, com braços fundidos ao corpo.

**Paleta: só tokens existentes**, mapeados em variáveis locais com escopo em `[data-companion]` (o F76-S03 depois promove
estes nomes ao `tokens.css` sem renomear):

| Variável local | Token (escuro / claro) | Uso |
|---|---|---|
| `--m-ink` | `--text` | traço |
| `--m-fill` | `--surface-2` | corpo e cabeça |
| `--m-visor` | `--bg` | visor |
| `--m-eye` | `--text` | olhos |
| `--m-accent` | `--brand` (escuro) / `--brand-text` (claro) | ponta da antena, halo |
| `--m-warn` | `--warn` | ponta da antena em `confused` |
| `--m-shadow` | `color-mix(--text 14%, transparent)` | sombra de contato |

Traço contra `--bg` e `--bg-elevated` ≥ 3:1 (WCAG 1.4.11). Nenhum hex em JSX nem em CSS do módulo.

**Balão de fala.** `font-body`, 13 px / 1.35, peso 500; texto `--text` sobre `--surface-3`; borda 1 px `--border-2`; raio
`--r-pill`; padding 6×10; `--shadow-ds-1`. Rabicho: quadrado de 6 px girado 45°. Largura máx. 22ch. Texto ≥ 4,5:1.
`aria-hidden`: o texto sempre repete o que o H1 ou o lead já dizem.

### 1.1 Posição = significado

| Lugar | Desktop (lg+) | Celular (< lg) |
|---|---|---|
| "Agora é aqui" | Posto `heading`: ponta direita da linha do eyebrow do `AuthHeading` (centro na linha, 24 px para dentro da borda da coluna de 25rem). Nunca cobre o H1. | Posto `inline`: caixa 40×40 reservada no SSR na ponta direita da linha do `Logo`. Nunca voa. |
| "Estou olhando de longe enquanto você trabalha" | Posto `perch`: no `BrandPanel`, `x = borda esquerda do painel + 72 px`; `y` = centro do campo focado, limitado a 96 px do topo e do pé. Olha para a esquerda (para o formulário). | No lugar, olhando para a esquerda. |
| "Não estou olhando" (senha) | No `perch`: olhos fechados e cabeça virada para fora (direita). | Mesmo, no lugar. |

Âncoras por ref, nunca por coordenada fixa: o `<header>` do `AuthHeading`; `<CompanionPerch/>` dentro do `BrandPanel`;
`<CompanionInlineSlot/>` na linha do logotipo; o `event.target` do `focusin`. Medição com `getBoundingClientRect` relativa à
raiz do layout (coordenadas do documento: rolar não exige recálculo). Recalcula em `ResizeObserver` (raiz e âncoras),
`document.fonts.ready` e troca de etapa.

### 1.2 Estados, gatilhos, movimento e tempos (curvas: `--ease`, `--ease-spring`, ou a indicada)

| Estado / movimento | Gatilho | Movimento | Duração / curva |
|---|---|---|---|
| **entrada** | após hidratação, `requestIdleCallback` (timeout 600 ms), ≥ 400 ms após o FCP | opacity 0→1, translateY −8→0, scale .92→1 | 320 ms `--ease-spring` |
| **voo** (posto → posto) | 1º foco num campo (`heading`→`perch`); troca de etapa (`perch`→`heading`) | X: `cubic-bezier(.4,0,.1,1)` (medido no reel). Y: arco com ápice = menor y − clamp(24, dist·0,12, 56) px no offset .45, depois assenta em `--ease`. Antecipação 0–80 ms (scaleY .92 / scaleX 1,06, pivô na base). Em voo estica 1,05/.96 e inclina ±7°. Pouso: amassa .93/1,06 por 120 ms e volta em 220 ms `--ease-spring`. Antena atrasa: −10° na partida, +6° no pouso, assenta em 360 ms `--ease-spring`. Sombra: scale 1→.6 e opacity .5→.2 no ápice. | d = clamp(560, 420 + dist·0,45, 760) ms (o reel faz 1,2 s; o cânone pede ≤ 900) |
| **deslize** (`perch` segue o foco) | foco passa de um campo a outro | translateY até o centro do novo campo, sem arco | 320 ms `--ease` |
| **piscar** | aleatório 4–9 s, só visível | olhos scaleY 1→.12→1 | 140 ms `--ease` |
| **respiração limitada** | após cada pouso ou fim de estado | `fig` translateY 0→−1,5→0 px; **máx. 3 ciclos**, depois só pisca; pausa se houve tecla nos últimos 1,5 s (só o horário, nunca a tecla) | 4,2 s `cubic-bezier(.37,0,.63,1)` |
| `look` | posto `perch`, ou erro de validação (olha o 1º campo inválido) | olhos ±2 px na grade de 48 | 200 ms `--ease` |
| **`avert`** (estado novo) | `focusin` em `type=password` | `eyes-closed` aparece em 120 ms; cabeça +8° para fora e translateX 1,5 px | 240 ms `--ease`; volta em 200 ms no `focusout` |
| `thinking` | envio pendente há ≥ 300 ms | ponta da antena gira e pulsa, olhos varrem ±1,5 px | 1,6 s `linear` em loop; sai na hora da resposta |
| `confused` | erro de credencial/servidor; link inválido (erro que a pessoa resolve) | cabeça −9° (240 ms `--ease-spring`), `eyes-squint`, ponta da antena em `--m-warn` (crossfade 160 ms) | 900 ms; fica na pose até o próximo `focusin`/`input`, depois `idle` em 200 ms |
| `celebrate` | sucesso | 0–100 agacha .92 → 100–360 pulo −6 px `--ease-spring` com `eyes-happy` → 360–620 pouso .95 e mola. Halo: círculo de traço `--m-accent` de r .6 a 1,4 da cabeça e opacity .5→0, 480 ms a partir de 120 ms | 900 ms; olhos felizes seguram +1,2 s |
| **sucesso final** | tela de sucesso que fica (`final: true`) | `celebrate` e depois a ponta da antena **fica acesa** (pose final; equivale ao halo/olhos fechados do reel) | — |
| **balão** | só nos 2 momentos (§1.3) | entra: opacity, translateY 4→0, scale .96→1, origem no rabicho. Sai: 140 ms, translateY −2 | entra 200 ms `--ease`; some no 1º `focusin`/`pointerdown`/`keydown` ou após 7 s |
| **troca de etapa** (`AuthStepTransition`) | o estado muda na mesma rota | sai: opacity→0 e blur 0→4 px em 160 ms `--ease`. Entra: opacity, blur 4→0, translateY 4→0 em 240 ms `--ease-spring` | blur só no bloco trocado; **não atrasa** o `focusOnMount` do H1 |

**Movimento reduzido:** não voa (troca de posto por crossfade de 160 ms), sem respiração, sem piscar, poses estáticas com
esmaecimento de 160 ms, balão só com opacity, etapa só com opacity em 120 ms.

**Sucesso em 3 tempos** (cadastro → "Verifique seu email"; os outros seguem o molde): (1) **Ação** — `Button loading` + `thinking`;
(2) **Prova** — 0–240 ms após a resposta a ponta da antena pisca de 0,4 a 1 e scale 1→1,25 em 200 ms enquanto o formulário
sai; (3) **Mensagem** — o novo `AuthHeading` entra em 240 ms e o voo para `heading` começa junto, pousando quando o título
assenta; (4) **Celebração** depois do pouso, e então o balão contextual (atraso 120 ms). **Login:** `success{final:false}`
dispara `celebrate` e o `router.push` sai no mesmo tick, sem retenção artificial.

### 1.3 Coreografia por fluxo e textos do balão (PT-BR, sem tom de venda)

| Fluxo | Chegada (balão 1, uma vez por sessão via `sessionStorage['hm:auth-companion:greeted']`) | Momento contextual (balão 2) |
|---|---|---|
| Login | "Que bom que voltou." | nenhum (o erro já tem `AuthNotice role=alert`) |
| Sessão expirada | sem balão | — |
| Cadastro | "Leva uns dois minutos." | `signup-sent`: "O link está no seu email." |
| Verificação (`/verify`) | começa no `heading` em `thinking` (trabalho real) | sucesso final, sem balão; link inválido → `confused` |
| Reset (pedido) | sem balão | `reset-sent`: "Confira sua caixa de entrada." |
| Nova senha / convite | sem balão | sucesso final |

### 1.4 O que adaptamos do reel e o que não

**Adaptamos:** voo em arco com mola e esmagar/esticar; voo só durante a troca de etapa; balão só em 2 momentos; troca de
etapa com fade+blur curto; sucesso em 3 tempos com celebração no fim; respiração (limitada a 3 ciclos) e piscar;
posição = significado.

**Não adaptamos:** o orbe, o gradiente violeta-ciano e o brilho especular; o laranja/pêssego do painel; os cartões de
dashboard flutuantes (o `BrandPanel` editorial continua sem dado inventado); as caixas de OTP; o cursor de demonstração; o
voo de 1,2 s; a oscilação de ±6 px; tapar os olhos com as mãos na senha (clichê "yeti", parece template).

### 1.5 Privacidade (regra dura, coberta por teste)

O diretor só escuta `focusin`/`focusout` na raiz e lê **só** `target.type`, `getBoundingClientRect()` e se o alvo é
editável. **Nunca** lê `.value`, nunca escuta `input` nem `keydown.key`, não reage à dica de força da senha. Atividade de
teclado = um único horário `lastKeyAt`, usado só para pausar a respiração. Zero telemetria, zero rede, nada guardado além
da chave de saudação no `sessionStorage`.

## 2. Arquitetura técnica e contrato

**Estratégia (a): módulo isolado e descartável** em `apps/web/features/auth/companion/`, hipótese S (SVG inline em camadas +
CSS/WAAPI + máquina de estados TS). Por quê: o F76 está parado no S01; as telas de acesso ficam fora do shell (sem diretor de
atenção, `MascotStage`, marca ou preferência de membro); camadas, nomes de estado, `MascotLook` e props espelham a spec
§3.1/§3.2/§6.1 (o F76-S03 depois importa arte e `machine.ts` e o módulo vira adaptador fino sobre `<Mascot>`); serve de
medição real da hipótese S para o S01; se o S01 escolher Rive, descarta-se um diretório.

| Arquivo (em `apps/web/features/auth/companion/`) | Conteúdo |
|---|---|
| `contract.ts`, `index.ts`, `copy.ts` | tipos, API pública, textos do balão |
| `art/rig-md-48.tsx`, `art/rig-inline-40.tsx`, `art/rig.json` | arte e pivôs |
| `machine.ts` | máquina pura: fila de no máx. 1; `thinking` interrompe; estados com fim voltam a `idle` |
| `director.ts` | sinais + foco → `{station, state, look, bubble}` |
| `flight.ts` | gerador de keyframes WAAPI: arco, mola, esmagar |
| `anchors.tsx` | `useCompanionAnchor`, `CompanionPerch`, `CompanionInlineSlot` |
| `AuthCompanionRoot.tsx` | provider + palco `absolute inset-0 pointer-events-none aria-hidden`; figura via `next/dynamic` `ssr:false` |
| `CompanionFigure.tsx`, `Bubble.tsx`, `companion.css` | figura (`data-state`, `data-look`), balão, estilos (só no chunk lazy) |

```ts
export type MascotState = 'idle'|'blink'|'wave'|'play'|'thinking'|'celebrate'|'sleep'|'confused'|'peek'|'avert'
export type MascotLook = 'none'|'up'|'left'|'right'
export type CompanionStation = 'heading'|'perch'|'inline'
export type AuthStep = 'login'|'signup'|'signup-sent'|'verify-pending'|'verify-done'|'verify-invalid'
  |'reset-request'|'reset-sent'|'reset-new'|'reset-done'|'invite'|'invite-done'
export type CompanionSignal =
  | { type: 'submit' } | { type: 'settled' }
  | { type: 'error'; kind: 'validation'|'credentials'|'server' }
  | { type: 'success'; final: boolean }
export function useAuthCompanion(): { signal(s: CompanionSignal): void }   // no-op fora do provider
export function useAuthCompanionStep(step: AuthStep): void                // efeito: anuncia a etapa
export function useCompanionAnchor<T extends HTMLElement>(name: 'heading'): RefCallback<T>
// CompanionFigure: { state; look; size: 40|48; motion: 'live'|'off'; autoBlink?; onStateEnd? } (subconjunto de MascotProps)
```

Integração (arquivo por arquivo): ver os `files_allowed` e o escopo do F76-S12. Desempenho e acessibilidade: tudo
`aria-hidden`, sem foco possível, `pointer-events:none`; só `transform`/`opacity` (blur só no bloco do formulário);
`will-change` só durante o voo; pausa com `IntersectionObserver` + `visibilitychange` (`getAnimations().pause()`, timer do
piscar limpo); sem rAF contínuo; zero deslocamento de layout (palco absoluto, caixa mobile reservada no SSR); fora do
caminho do LCP (chunk lazy após hidratação); teclado virtual aberto (`visualViewport.height < .75·innerHeight`) esconde o
balão e congela a respiração; renderiza só se `<html>` não tiver `data-brand` ou for `leadium`;
`COMPANION_CHUNK_MARKER` dentro do chunk lazy, para o teste de peso.

## 3. Emenda proposta ao ADR-006 (colar como §9)

> **§9. Emenda 1 — companheiro das telas de acesso (Rogério, 2026-10-19).** Decisão do Rogério: o personagem passa a
> aparecer em `apps/web/app/(auth)/**` (login, cadastro, verificação, redefinição de senha e convite). Isso emenda o §5, que
> só continua proibindo `(public)` e `(platform)`.
> **Escopo e limites.** (1) Só reage a ações da própria pessoa (foco, envio, resultado, troca de etapa). Nunca chama
> atenção por conta própria, nunca acena sozinho e não usa o orçamento de atenção do §4, que vale só dentro do app
> autenticado. (2) Um ator: um único personagem por tela. (3) Balão em no máximo 2 momentos por fluxo, sempre redundante
> ao texto visível e `aria-hidden`. (4) Nunca substitui o indicador do botão. `thinking` só aparece depois de 300 ms de
> envio pendente; a regra de 1.200 ms do §5 vale para carregamento de rota, não para reação a envio. (5) Privacidade: olha
> para o campo focado e só lê o tipo e a posição do elemento. Nunca lê o valor, a senha, as teclas nem a força da senha. Zero
> telemetria e zero rede. (6) Movimento: voo ≤ 760 ms, estados ≤ 900 ms fora de loop, só `transform`/`opacity`, pausa fora
> da viewport e com aba oculta. A respiração é exceção ao "repouso não anima" de `MASCOTE_ANIMACOES.md` §2.3, limitada a 3
> ciclos após cada pouso, e depois só o piscar. `prefers-reduced-motion` = poses estáticas e crossfade de 160 ms. (7) Peso ≤
> 30 KB gz (meta ≤ 12 KB), chunk lazy fora do LCP, zero CLS.
> **Marcas.** Telas de acesso só na marca Leadium. Odonto = `glyph`, que nas telas de acesso significa nada. Maian =
> `glyph` até decisão. Se o `data-brand` passar a existir antes do login, vale a mesma regra.
> **Tecnologia.** Módulo isolado `apps/web/features/auth/companion` na hipótese S, com contrato de camadas e estados
> idêntico à spec §3.1/§3.2. Não depende do F76-S01. O F76-S03 o absorve como adaptador sobre `@hm/ui` `Mascot`. Se o S01
> escolher Rive, o módulo é descartado ou migrado sem mudar esta emenda.
> **Contrato estendido.** Novo estado `avert` (olhos fechados, cabeça 8° para fora, 240 ms) na spec §3.2/§6.1.
> **Continua proibido:** Inbox e mensagens a clientes, KPIs, toasts e notificações, ícone do PWA, páginas públicas e de
> plataforma, e qualquer reação a conteúdo digitado.

O slot S10 também atualiza `MASCOTE_ANIMACOES.md`: §3.2 linha `avert`; §7 linha `(auth)` → "companheiro reativo (ADR-006 §9)";
§2.3 nota da exceção.

## 4. Deploy seguro (resumo; detalhes no relatório da sessão)

Dois deploys. **Deploy 1** (backend, Copiloto **desligado** por `COPILOT_ENABLED`, F75-S16, migration 0097 aditiva) depois dos
gates; **Deploy 2** (companheiro, só web, sem migration) depois do F76-S13. O trabalho em andamento do F73-S14 **fica fora**
do deploy. Pontos de parada que exigem "vai" explícito do Rogério: push para o origin; merge/push no `main` do origin;
qualquer `ssh` na VPS; edição do `/opt/leadium/.env`; rodar `deploy.ps1`; qualquer migration/restore/rollback em produção.
