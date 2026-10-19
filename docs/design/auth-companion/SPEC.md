# Companheiro das telas de acesso — SPEC de arte e animação (F76-S10)

> **Status:** aprovada para construção pelos slots F76-S11 (motor), S12 (integração) e S13 (QA).
> **Base:** [`PLANO.md`](./PLANO.md) (plano do arquiteto) e [`reel-scene.json`](./reel-scene.json) (movimento medido do reel).
> Onde esta SPEC diverge do PLANO, a divergência está marcada com **[refino]** e o motivo vem junto (§10 resume).
> **Decisão de produto:** [ADR-006 §9](../../decisions/ADR-006-mascote-personagem-tecnologia-e-politicas.md).
> **Arte:** `apps/web/features/auth/companion/art/` · **Folha de poses:** [`poses.html`](./poses.html) (gerada por
> `node docs/design/auth-companion/poses.build.mjs` a partir da arte e dos tokens reais).

---

## 1. Conceito

O robô do Copiloto recebe a pessoa na porta. Não é mascote de app infantil nem efeito de landing page: é um
**colega discreto** que confirma o que a tela já diz. Três ideias seguram tudo:

1. **Posição é significado.** Onde ele está diz o que está acontecendo: no título = "agora é aqui"; no painel =
   "estou olhando de longe enquanto você trabalha"; olhos fechados no campo de senha = "não estou olhando".
2. **Uma cor só, e só quando significa algo.** Tinta, casco e vidro são neutros dos tokens. A ponta da antena é o
   único ponto de cor e fica **apagada em repouso**. Acende ao pensar, ao dar certo e na pose final.
3. **A sombra de contato é a assinatura.** Encolhe e esmaece com a altura; é ela que dá peso ao voo, sem brilho,
   sem rastro e sem partícula.

Referência de acabamento: Linear, Stripe, Vercel. Se uma pose nova pedir gradiente, brilho, faísca, cor extra ou
"fofura" (bochecha, coração, estrela), ela está errada.

## 2. Arte

### 2.1 Geometria

Arte original do Leadium, derivada do rig C de [`copilot-botao-animacao.html`](../copilot-botao-animacao.html) e
redesenhada por LOD. Traço único de **1,5 px**, pontas e juntas redondas. A borda **externa** de cada contorno cai em
pixel inteiro (o caminho fica 0,75 para dentro); preenchimentos sem traço (visor, olhos) caem em pixel inteiro.

| | `md-48` (lg+, postos `heading` e `perch`) | `inline-40` (< lg, posto `inline`) |
|---|---|---|
| Ponta da antena | círculo r 2,25 em (24; 3,5) | r 2 em (20; 2,75) |
| Cabeça (cápsula) | 9–39 × 8–30, raio externo 10 | 7–33 × 6–26, raio externo 9,25 |
| Visor | 13–35 × 12–26, raio 7 (estádio) | 11–29 × 10–22, raio 6 |
| Olhos | pílulas 4×6, x 17 e 27 | pílulas 4×6, x 14 e 22 (rosto maior em relação à cabeça) |
| Pescoço | vazio de 2 px (a cabeça flutua sobre o corpo) | vazio de 2 px |
| Corpo | torso trapezoidal arredondado, 17–31 × 32–43 | torso 14–26 × 28–37 |
| Braços | dois, saindo dos ombros, por baixo do torso (a junta some no preenchimento); o direito em dois ossos (`arm-r` → `hand-r`) | tocos fundidos ao contorno do torso; grupos `arm-*` vazios |
| Sombra | elipse 26×5 em (24; 45,5) | 21×3,5 em (20; 38,25) |

**[refino]** O corpo do rig C (retângulo com braços saindo de baixo) lia como "balde com alças" e os braços como
pernas, o mesmo defeito que derrubou a direção C em 2026-10-16. O torso afunila para baixo e os braços saem dos
ombros.

### 2.2 Camadas e pivôs (contrato com o motor)

`shadow` (irmã de `fig`) · `fig` › `halo`, `arm-l`, `arm-r` › `hand-r`, `body`, `head` › `antenna` › `antenna-tip`,
casco, `visor`, `eyes` › `eyes-open | eyes-closed | eyes-happy | eyes-squint`.

Pivôs, deslocamento do olhar e poses estão em [`art/rig.json`](../../../apps/web/features/auth/companion/art/rig.json),
fonte única: os componentes aplicam o pivô de cada camada a partir dele, e o motor (S11) anima entre as poses dele.
Regras de uso:

- `eyes` (grupo) é reservado ao **olhar** (`look`); o piscar escala `eyes-open` em Y. Nunca as duas coisas no mesmo nó.
- `fig` recebe esmagar/esticar/inclinar/pular com pivô na **base do corpo** (24; 43 / 20; 37).
- `shadow` fica fora de `fig`: quando o corpo pula, a sombra fica no chão e só encolhe.
- `halo` usa `vector-effect: non-scaling-stroke`: o anel escala sem engrossar.

### 2.3 Cor (só tokens existentes)

Variáveis locais em `[data-companion]` (`art/rig.css`); o F76-S03 as promove ao `tokens.css` sem renomear.

| Variável | Escuro | Claro | Uso |
|---|---|---|---|
| `--m-ink` | `--text` | `--text` | traço, ponta apagada |
| `--m-fill` | `--surface-2` | `--surface-2` | casco e torso |
| `--m-visor` | `--bg` | **`--text`** | visor: vidro escuro nos dois temas |
| `--m-eye` | `--text` | **`--surface`** | olhos: luz no vidro |
| `--m-accent` | **`--brand-text`** | `--brand-text` | ponta acesa, halo |
| `--m-warn` | `--warn` | `--warn` | ponta em `confused` |
| `--m-shadow` | `color-mix(in srgb, var(--text) 14%, transparent)` | idem | centro do gradiente da sombra |

- **[refino] Visor no claro.** O PLANO mapeava `--bg` (visor) sobre `--surface-2` (casco): 1,03:1, o visor some e o
  robô perde o rosto. O visor passa a ser vidro escuro nos dois temas, o que também casa com o `LogoMark` (bloco em
  `--text`) no claro.
- **[refino] Acento.** `--brand` é do único CTA da tela (DESIGN_SYSTEM e o comentário do `Logo.tsx`). A ponta é um
  sinal de 4,5 px, papel de ícone de marca, e `--brand-text` é o token para isso nos dois temas (é também o verde
  que o demo usava no escuro).
- **Contraste (calculado pelo gerador da folha):** traço sobre `--bg`/`--bg-elevated` 18,5/18,1:1 (escuro) e
  16,6/16,0:1 (claro); ponta acesa 15,4/15,1 e 5,9/5,7; alerta 12,7/12,4 e 5,8/5,6; olho sobre o visor 18,5 e 18,1.
  Todos ≥ 3:1 (WCAG 1.4.11).
- No escuro a "sombra" é uma poça de luz fraca (tinta clara a 14% sobre quase preto); no claro, sombra de verdade.
  É o mesmo token e lê como contato nos dois.

### 2.4 Balão de fala

`font-body` 13 px / 1,35, peso 500; `--text` sobre `--surface-3` (≥ 15:1 nos dois temas); borda 1 px `--border-2`;
padding 6 × 10; `--shadow-ds-1`; rabicho = quadrado de 6 px girado 45° com as duas bordas do lado de fora.
**[refino]** raio `--r-lg` (não `--r-pill`) e `max-width: 26ch`: todos os textos de §5 cabem numa linha, que com
raio 18 vira pílula; se um texto futuro quebrar, o balão de duas linhas continua elegante em vez de virar estádio.
Sempre `aria-hidden`, `pointer-events: none`.

Posição: no `heading` (desktop), **acima** da figura, alinhado à direita dela, 8 px de folga, rabicho para baixo
(centrado na figura). **[refino S14]** À esquerda, como estava, o balão cobria o eyebrow ("RECUPERAÇÃO DE ACESSO" no
`reset-sent`); acima há ≥ 64 px livres (padding do `main`) e nada de texto, e o balão não sai da coluna de 25rem.
No `inline` (celular), **abaixo** da figura, alinhado à direita dela, 8 px de folga, rabicho para cima. Nunca no `perch`.

## 3. Postos

| Posto | Onde (âncora por ref, nunca coordenada fixa) | Olhar | Significado |
|---|---|---|---|
| `heading` (lg+) | **em pé na linha do eyebrow** do cabeçalho (`AuthHeading` e cabeçalho do convite, ambos com `useCompanionAnchor('heading')`): centro da sombra na base do eyebrow (o primeiro `<p>` do header); centro x a 24 px para dentro da borda direita da coluna de 25rem | `none` | "agora é aqui" |
| `perch` (lg+) | **faixa em fluxo** no `BrandPanel` (`<CompanionPerch/>`, `flex-1 min-h-14`, sem texto), entre o eyebrow do painel e o bloco editorial. Caixa da figura DENTRO da faixa: `x` = início da faixa (= início do texto do painel); `y` = centro do campo focado, limitado à faixa. Faixa < 48 px de altura: fica no `heading` | `left` (para o formulário) | "olho de longe enquanto você trabalha" |
| `inline` (< lg) | caixa 40×40 reservada no SSR na ponta direita da linha do `Logo` (`<CompanionInlineSlot/>`) | `none` | os dois acima, no lugar; nunca voa |

**[refino S14] `perch` por construção.** A versão anterior fixava o centro em "borda do painel + 72 px", que caía
sobre o título e a numeração dos pilares (o QA do S13 mediu cobertura em 31 de 32 combinações de campo × viewport). O
`perch` agora é uma caixa real do layout: como a figura mora dentro dela, não existe viewport em que cubra texto. A
folga vertical do painel é dividida entre a faixa e um respiro de baixo (`flex-1` nos dois), o que preserva a
composição de antes (`justify-between`).

**Fallback de posto.** Se o posto pedido não existe (sem âncora, caixa zerada, faixa < 48 px), o motor usa o próximo
visível (`heading` → `perch` → `inline`; `perch` → `heading` → `inline`; `inline` → `heading` → `perch`). A figura nunca
fica com `visibility: hidden` por falta de âncora (ex.: convite carregando, sem cabeçalho).

**[refino]** O PLANO punha o centro da figura na linha do eyebrow; com 48 px isso invade o H1 em títulos longos
("Link de redefinição inválido" quebra até a borda). Em pé na linha, a figura ocupa só o espaço acima do cabeçalho
(o `main` tem ≥ 64 px de respiro no lg+) e nunca toca o título.

Medição: `getBoundingClientRect` relativa à raiz do layout; recalcula em `ResizeObserver` (raiz e âncoras),
`document.fonts.ready` e troca de etapa. **[refino S14] Sob transform de ancestral:** `getBoundingClientRect` inclui o
`transform` em andamento dos ancestrais (o `hm-rise` da coluna, 8 px; a entrada do `AuthStepTransition`, 4 px), então
a medida logo após a troca de etapa saía 0,4-8 px fora da linha. Depois de cada medição o motor procura animações
finitas em andamento cujo alvo contém o elemento medido (`document.getAnimations()`), espera todas
(`Promise.allSettled(finished)`) e remede na hora (`flushSync`); a correção chega como deslize curto de `y`, nunca como
pulo. Escolhido em vez de "medir sem o transform dos ancestrais" porque não presume o valor final do transform.

## 4. Estados e movimento

Curvas: `--ease` = cubic-bezier(.2,.8,.2,1); `--ease-spring` = cubic-bezier(.16,1,.3,1). Os quadros-pose estão no
`rig.json` (`lods.*.poses`) e desenhados na [folha](./poses.html).

### 4.1 Estados

| Estado | Gatilho | Movimento | Duração / curva | Pose (`rig.json`) |
|---|---|---|---|---|
| entrada | hidratado + `requestIdleCallback` (timeout 600 ms), ≥ 400 ms após o FCP | opacity 0→1, translateY −8→0, scale .92→1 | 320 ms `--ease-spring` | `rest` |
| repouso | padrão | nada; após cada pouso ou fim de estado, **respiração** de `fig` 0→−1,5→0 px, **máx. 3 ciclos**, pausa se houve tecla há < 1,5 s | 4,2 s cubic-bezier(.37,0,.63,1) | `rest` |
| piscar | aleatório 4–9 s, só visível | `eyes-open` scaleY 1→.12→1 | 140 ms `--ease` | `blink` |
| `look` | posto `perch`; erro de validação (olha o 1º campo inválido) | grupo `eyes` ±2 px (48) / ±1,5 (40); `up` −1,5 / −1 | 200 ms `--ease` | — |
| **`avert`** | `focusin` em `input[type=password]` | `eyes-closed` em 120 ms; `head` +8° e x +1,5 (para fora, à direita); olhar `right` | 240 ms `--ease`; volta em 200 ms no `focusout` | `avert` |
| `thinking` | envio pendente ≥ 300 ms | ponta **acende**, gira e pulsa scale 1↔1,15; olhos varrem ±1,5 px | 1,6 s `linear` ∞; sai na hora da resposta | `thinking` |
| `confused` | erro de credencial/servidor; link inválido | `head` −9° (240 ms `--ease-spring`), `eyes-squint`, ponta crossfade para `--m-warn` (160 ms) | 900 ms; fica até o próximo `focusin`/`input`, volta a `idle` em 200 ms | `confused` |
| `celebrate` | sucesso | 0–100 agacha (`crouch`: 1,04 × .92) → 100–360 pulo −6 px (−5 no 40) `--ease-spring` com `eyes-happy` (`jump`) → 360–620 pouso 1,05 × .95 e mola (`land`). Halo: r de .6 a 1,4 da cabeça, opacity .5→0, 480 ms a partir de 120 ms. Sombra no pico: scale .7, opacity .55 | 900 ms; olhos felizes seguram +1,2 s | `crouch`, `jump`, `land` |
| sucesso final | tela de sucesso que fica (`final: true`) | `celebrate` e então a pose final: olhos felizes, ponta acesa | — | `success` |

**[refino] `confused`:** a diagonal descendo para dentro (rig C) lia como raiva. Agora é assimetria: um olho em
traço baixo, o outro em pílula erguida 1 px. Lê "hm?", que é o que um erro resolvível pede.

**[refino] Ponta da antena:** apagada (`--m-ink`) em repouso. O PLANO dizia "único ponto de cor" sem dizer quando;
acesa o tempo todo seria um segundo verde ao lado do CTA.

### 4.2 Voo (`md-48` apenas)

Gatilhos: 1º foco num campo (`heading` → `perch`); troca de etapa (`perch` → `heading`). Nunca em outro momento.

- **Duração:** d = clamp(560, 420 + dist · 0,45, 760) ms (o reel faz 1,2 s; o cânone pede ≤ 900).
- **X:** cubic-bezier(.4, 0, .1, 1) (medido no reel).
- **Y:** arco; ápice = menor y − clamp(24, dist · 0,12, 56) px no offset .45, depois assenta em `--ease`.
- **Corpo:** antecipação 0–80 ms (`anticipate`: 1,06 × .92); em voo estica (`stretch`: inclina 7° para o lado do
  movimento, .96 × 1,05); ápice (`apex`: 4°, .97 × 1,04); pouso amassa (`squash`: 1,06 × .93) por 120 ms e volta em
  220 ms `--ease-spring`.
- **Antena (follow-through):** −10° na partida, +6° no pouso, assenta em 360 ms `--ease-spring`.
- **Sombra:** scale 1 → .6 e opacity 1 → .4 no ápice (relativas à sombra de repouso, que já tem 14%; o PLANO dizia
  .5 → .2 absolutas, que é a mesma razão).
- `will-change: transform` só durante o voo.

### 4.3 Troca de etapa (`AuthStepTransition`, S12)

Sai: opacity → 0 e blur 0 → 4 px em 160 ms `--ease`. Entra: opacity, blur 4 → 0, translateY 4 → 0 em 240 ms
`--ease-spring`. Blur só no bloco trocado; **não atrasa** o `focusOnMount` do H1.

### 4.4 Sucesso em três tempos (+ celebração)

Molde do cadastro → "Verifique seu email"; os outros seguem igual.

1. **Ação:** `Button loading` (indicador do botão, sempre) + `thinking` se passar de 300 ms.
2. **Prova** (0–240 ms após a resposta): a ponta pisca de 0,4 a 1 e escala 1 → 1,25 em 200 ms enquanto o formulário sai.
3. **Mensagem:** o novo `AuthHeading` entra em 240 ms e o voo para `heading` começa junto, pousando quando o título assenta.
4. **Celebração** depois do pouso; então o balão contextual (atraso 120 ms).

**Login:** `success{final:false}` dispara `celebrate` e o `router.push` sai no mesmo tick, sem retenção artificial.

## 5. Coreografia por fluxo e textos

| Fluxo | Chegada (balão 1, uma vez por sessão: `sessionStorage['hm:auth-companion:greeted']`) | Momento contextual (balão 2) |
|---|---|---|
| Login | "Que bom que voltou." | nenhum (o erro já tem `AuthNotice role=alert`) |
| Sessão expirada | sem balão | — |
| Cadastro | "Leva poucos minutos." | `signup-sent`: "O link está no seu email." |
| Verificação (`/verify`) | começa no `heading` em `thinking` (trabalho real) | sucesso final, sem balão; link inválido → `confused` |
| Reset (pedido) | sem balão | `reset-sent`: "O link já está a caminho." |
| Nova senha / convite | sem balão | sucesso final |

Textos em `apps/web/features/auth/companion/copy.ts`. **[refino]** "Leva uns dois minutos." prometia um número que
a tela não diz; "Leva poucos minutos." repete o lead ("Comece em minutos."). "Confira sua caixa de entrada." era o
H1 palavra por palavra, ao lado dele; "O link já está a caminho." diz o mesmo sem eco. A saudação do login não carrega
informação, então o `aria-hidden` não tira nada de quem usa leitor de tela.

O balão entra em 200 ms `--ease` (opacity, translateY 4 → 0, scale .96 → 1, origem no rabicho), sai em 140 ms
(translateY −2) no 1º `focusin`/`pointerdown`/`keydown` ou após 7 s.

## 6. O que adaptamos do reel e o que não

**Adaptamos:** voo em arco com mola e esmagar/esticar; voo só durante a troca de etapa; balão só em 2 momentos;
troca de etapa por fade + blur curto; sucesso em 3 tempos com celebração no fim; respiração (limitada a 3 ciclos) e
piscar; posição = significado; a pose final "olhos fechados felizes" (aqui: olhos felizes + ponta acesa).

**Não adaptamos:** o orbe e o rosto dele; o gradiente violeta-ciano e o brilho especular; a sombra projetada violeta;
o laranja/pêssego do painel; os cartões de dashboard flutuantes (o `BrandPanel` continua editorial, sem dado
inventado); as caixas de OTP (não existe OTP no Leadium; a verificação é por link); o cursor de demonstração; o voo de
1,2 s; a oscilação contínua de ±6 px; tapar os olhos com as mãos na senha (clichê "yeti", parece template); o
balão violeta.

## 7. Privacidade (regra dura, coberta por teste)

O motor só escuta `focusin`/`focusout` na raiz e lê **só** `target.type`, `getBoundingClientRect()` e se o alvo é
editável. **Nunca** lê `.value`, nunca escuta `input` nem `keydown.key`, não reage à dica de força da senha.
Atividade de teclado = um único horário `lastKeyAt`, usado só para pausar a respiração. Zero telemetria, zero rede,
nada guardado além da chave de saudação no `sessionStorage`. O `contract.ts` não tem parâmetro que carregue valor
(`CompanionSignal` é união fechada); `art/rig.test.ts` verifica.

## 8. Movimento reduzido

`prefers-reduced-motion: reduce` ⇒ `motion: 'off'`: não voa (troca de posto por crossfade de 160 ms), sem
respiração, sem piscar; cada estado vira a **pose parada** do `rig.json` com esmaecimento de 160 ms; `thinking` =
ponta acesa parada; `celebrate` = pose `success`; balão só com opacity; troca de etapa só com opacity em 120 ms.

## 9. Celular (< lg)

LOD `inline-40` na caixa reservada da linha do logotipo; **nunca voa** (o `perch` não existe sem o painel): troca de
estado no lugar, com os mesmos gatilhos (`avert` no campo de senha, `thinking`, `confused`, `celebrate`).
Teclado virtual aberto (`visualViewport.height < .75 · innerHeight`) esconde o balão e congela a respiração. O balão
vai por baixo da figura (§2.4). Toque não dispara nada no personagem (ele não é alvo de toque: `pointer-events: none`).

## 10. Divergências do PLANO (resumo)

| # | PLANO | SPEC | Motivo |
|---|---|---|---|
| 1 | `--m-accent` = `--brand` no escuro | `--brand-text` nos dois | `--brand` é do único CTA; ponta é ícone de marca |
| 2 | `--m-visor` `--bg`, `--m-eye` `--text` nos dois | no claro: `--text` / `--surface` | visor sumia no claro (1,03:1) |
| 3 | ponta: "único ponto de cor" | apagada em repouso; acende com significado | evita 2º verde ao lado do CTA |
| 4 | `heading`: centro na linha do eyebrow | em pé na linha | não invade o H1 |
| 5 | sombra 28×6, opacity .5→.2 | 26×5 (48) e 21×3,5 (40), opacity relativa 1→.4 | cabe na grade e na caixa; mesma razão |
| 6 | balão raio `--r-pill`, 22ch | `--r-lg`, 26ch | uma linha para todos os textos; 2 linhas sem virar estádio |
| 7 | "Leva uns dois minutos." / "Confira sua caixa de entrada." | "Leva poucos minutos." / "O link já está a caminho." | sem promessa nova; sem eco do H1 |
| 8 | squint do rig C | assimetria | a diagonal lia como raiva |
| 9 | corpo do rig C | torso com ombros | braços liam como pernas |
| 10 | (S14) `perch` a 72 px da borda do painel | faixa em fluxo no painel, personagem dentro | a coordenada fixa cobria o texto |
| 11 | (S14) balão à esquerda da figura no `heading` | acima, rabicho para baixo | cobria o eyebrow no desktop |

## 11. Peso e desempenho (metas para o S11/S13)

Fonte da arte (dois LODs, `rig.ts`, `rig.json`, `rig.css`), com comentários e as descrições do `rig.json`, mede
9,1 KB gz sem minificar (medido em 2026-10-19). No chunk o número cai (minificação; o webpack 5 descarta campos de
JSON importado que não são lidos, como `about` e `layers`): o S13 mede o chunk real. Função inteira ≤ 30 KB gz (meta 12 KB),
chunk lazy fora do LCP, zero CLS (palco absoluto, caixa do celular já reservada pelo stub), só `transform`/`opacity`,
pausa com `IntersectionObserver` + `visibilitychange`, sem rAF contínuo.
