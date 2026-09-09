# DS 3.0 (Agency OS) — delta contra o DS v2 implementado

> **Documento:** análise da proposta "Tagix Design System 3.0 / Agency OS"
> **Data:** 2026-09-09 · análise sobre o arquivo completo (1.452 linhas, 86 KB)
> **Status:** ANÁLISE — nenhuma decisão tomada, nenhum token alterado
> **Artefato:** [`design/ds-3.0-agency-os.html`](./design/ds-3.0-agency-os.html) — abrir no navegador; é interativo (⌘K, troca de tema, scrollspy)
> **Referência atual:** [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) · `packages/design-tokens/src/{tokens.css,fonts.ts,tailwind-preset.ts}`

---

## 1. Veredito

A página é boa e está viva: tema persistido, paleta de comandos, scrollspy, contador de KPI,
tilt desabilitado sob `prefers-reduced-motion` e abaixo de 900px. Verifiquei os IDs que o script
usa — todos existem, a página não quebra.

Duas coisas valem mais que o restyling:

1. **É o spec visual do roadmap.** As superfícies que ela inventa — Content Studio, Approvals, Ads
   performance, market pill, speed-to-lead como KPI de primeira classe — são exatamente as fases
   F61–F67 de `features/AGENCIA_PLAN.md` e irmãos. A maquete mobile mostra "Estimate at 11:00 ·
   Kitchen · **Orlando**": é o nicho de reforma na Flórida que recomendei, desenhado por conta
   própria. A convergência não é coincidência — é sinal de que o produto está claro.
2. **As regras do §07 (Do/Don't) e do §05 (motion) são melhores que o que temos escrito hoje** e
   valem adoção independentemente da paleta e da tipografia (§5).

O que ela **não** é: um pacote de tokens pronto. O contrato de implementação que ela mesma declara
tem dois defeitos (§3.2) e adotá-la por cópia tem consequências que precisam de decisão consciente.

---

## 2. A reversão tipográfica — decisão do Rogério

DS 3.0 troca a família de títulos para **Space Grotesk**. `DESIGN_SYSTEM.md` §14, tabela de migração
v1 → v2, lista:

| v1 (legacy) | v2 (DS) |
|---|---|
| Inter, **Space Grotesk** | Manrope, Rajdhani, Chakra Petch, Orbitron |

**Space Grotesk é a fonte que o v2 deliberadamente abandonou.** Adotar o DS 3.0 não é escolher uma
tipografia nova — é reverter uma migração documentada. Pode estar certo: o v2 nunca foi validado em
uso real e Rajdhani é condensada demais para tabela densa. Mas é reversão declarada, com ADR
atualizado, não efeito colateral de colar um CSS.

| Papel | DS v2 (implementado) | DS 3.0 | Nota |
|---|---|---|---|
| Títulos | Rajdhani 600 | **Space Grotesk 600**, tracking −4,5% (display) / −3,5% (heading) | reversão do §14 |
| Corpo | Manrope **400 · 17px** | Manrope **500 · 15px**, lh 1,65 | ver abaixo |
| Números / dado | Chakra Petch | **IBM Plex Mono 500** | melhoria real: mono alinha coluna numérica |
| Display / selo | Orbitron | **removida** | 4 famílias → 3; a assinatura de marca perde endereço |

**O corpo merece atenção separada.** 17px/400 → 15px/500 é menor e mais pesado. Num CRM que a pessoa
lê o dia inteiro, reduzir o corpo é decisão de densidade, não de estética — e vai na direção
contrária do `MOBILE_UX`, que já força ≥16px em input no mobile. Se o objetivo é caber mais dado na
tela, existe caminho melhor: manter 16–17px e apertar `line-height` e espaçamento.

Três famílias em vez de quatro é ganho real de performance e coerência. A perda do Orbitron tira a
assinatura do logo/selo — se for adotado, decidir onde a marca passa a viver.

---

## 3. O contrato de implementação

### 3.1 O risco: colisão silenciosa de nomes

O §07 da página aponta explicitamente para `packages/design-tokens/src/tokens.css`. Ou seja, a
intenção declarada **é substituir o arquivo de tokens**. E os dois sistemas usam os mesmos nomes com
valores diferentes:

| Token | DS v2 | DS 3.0 |
|---|---|---|
| `--bg` | `#050505` | `#070907` |
| `--surface` | `#101311` | `#0E120F` |
| `--surface-2` | `#161A17` | `#131814` |
| `--surface-3` | `#1E231F` | `#192019` |
| `--brand` | `#1FFF13` | `#1FFF13` ✅ |

Soltar esse `:root` por cima do `tokens.css` **repinta as 34 telas já entregues** — sem erro de
compilação, sem teste quebrando, sem ninguém perceber até abrir a tela. Não é migração, é repintura.

Além disso, renomeações e lacunas impedem substituição direta:

- `--text-on-brand` (v2) → `--brand-ink` (DS 3.0) — rename
- `--bg-alt`, `--surface-inset` (v2) **não existem** no DS 3.0
- `--bg-elevated`, `--surface-glass` (DS 3.0) **não existem** no v2
- v2 tem os pares `--info-bg` / `--success-bg`; DS 3.0 os descarta
- v2 expõe a escala tipográfica como token (`--text-h1--font-weight`, consumido pelo
  `tailwind-preset.ts`); DS 3.0 usa `font:` shorthand cru — **não é consumível pelo preset**

### 3.2 O contrato contradiz o próprio artefato

Dois defeitos no bloco de código do §07:

1. **Radius renomeado só no contrato.** O bloco declara `--r-xs/--r-sm/--r-md/--r-lg`, mas o CSS da
   própria página usa `--radius-xs/--radius-sm/--radius-md/--radius-lg`. Copiar o contrato quebra a
   maquete que ele deveria descrever.
2. **É um recorte, não um contrato.** Omite `--danger`, `--warning`, `--info`, `--violet`,
   `--border`, `--border-2`, `--border-brand`, `--brand-soft`, `--brand-ink`, todas as sombras,
   todos os easings e **o tema claro inteiro**. Ninguém constrói a partir dele.

**Conclusão:** o DS 3.0 precisa ser *traduzido* para o formato de `packages/design-tokens`, com a
paleta completa e os dois temas. Traduzir é trabalho de um slot; copiar é um incidente.

---

## 4. Acessibilidade — o tema claro reprova

A página exibe um chip "Acessibilidade AA+". Medi os pares reais (WCAG 2.1, texto normal, piso 4,5:1):

| Par | Razão | |
|---|---|---|
| escuro · `--text-3 #7E897E` sobre `--surface` | 5,19:1 | ✅ |
| escuro · `--text-2 #C3CBC1` sobre `--surface` | 11,36:1 | ✅ |
| escuro · `--brand #1FFF13` sobre `--bg` | 14,62:1 | ✅ |
| escuro · `--brand-soft #B1FFAA` sobre `--surface` | 15,96:1 | ✅ |
| botão · `--brand-ink #071108` sobre `--brand` | 14,07:1 | ✅ |
| **claro · `--text-3 #788277` sobre branco** | **3,99:1** | ❌ só texto grande |
| claro · `--text-2 #465045` sobre branco | 8,42:1 | ✅ |
| **claro · `--brand #16E00A` sobre branco** | **1,79:1** | ❌ inutilizável como texto ou ícone |

O tema escuro é excelente — nada a corrigir. O claro tem dois defeitos:

1. `--text-3` é usado em dica, metadado, timestamp e legenda — **texto normal**. A 3,99:1 reprova.
   Escurecer para algo em torno de `#5F6A5E` resolve.
2. `--brand` no claro só serve como fundo ou acento, nunca como cor de texto. O v2 já tinha esse
   problema latente (mesmo verde); o DS 3.0 herdou sem resolver.

O chip "AA+" é hoje uma afirmação falsa. Corrigir os dois valores a torna verdadeira.

---

## 5. O que adotar mesmo sem decidir sobre a tipografia

Esta é a parte de maior retorno, e é independente das opções do §7.

### 5.1 Regras novas que o DS v2 não tem

Do §07 da página, três merecem virar regra do repositório:

- **"Não fazer hardcode de hex, moeda, fuso ou idioma dentro de componentes."** O v2 já proíbe hex
  em JSX; estender para moeda, fuso e idioma é exatamente o que o trabalho de dois mercados exige
  (`AGENCIA_PLAN` §3). Vira lint, não recomendação.
- **"Não mostrar custo de LLM ou infra para quem não pode agir sobre isso."** Regra de dashboard
  role-aware que hoje não está escrita em lugar nenhum, e que evita expor custo de IA ao cliente
  final.
- **"Separar visual da agência e visual seguro para o cliente por permissionamento."** Mesma ideia,
  aplicada à casca inteira.

Ironia útil: o próprio script da página faz `toLocaleString('en-US')` fixo no contador de KPI —
viola a regra que ela mesma escreve, três seções acima. É a melhor evidência de que a regra precisa
existir em lint e não em documento.

### 5.2 Linguagem de motion (§05)

Melhor do que temos hoje: 180–320ms, seguro sob reduced-motion, e quatro movimentos **nomeados por
função** — Lift (hover), Signal pulse (só live state), State morph (toggle/refresh/IA) e
Intelligence scan (geração/análise). Mais as três regras: movimento contínuo **só** quando comunica
"live"; entrada é fade + 4–10px; feedback responde em menos de 200ms antes da confirmação assíncrona.

`Intelligence scan` é diretamente útil ao Content Studio — dá vocabulário visual para "o agente está
gerando".

### 5.3 Rampa de marca e tokens de motion

`--brand-strong`, `--brand-bright`, `--brand-soft`, `--brand-ink` mais `--ease` / `--ease-spring`.
O v2 tem um verde só e `--border-brand`, o que força hover, foco, glow e estado desabilitado a serem
inventados caso a caso. Cabe no v2 sem quebrar nada. **É a adoção de menor risco e maior ganho.**

### 5.4 Princípios de mobile (§06)

Cinco princípios que batem quase 1:1 com o `features/APP_MOBILE_PLAN.md`. Um deles é melhor que o
que eu escrevi e vale incorporar:

> **Client-safe language** — "Receita atribuída", "Aguardando aprovação", "Próximas ações" no lugar
> de termos internos de infraestrutura.

---

## 6. Divergência a reconciliar com o plano do app

A página propõe **quatro** abas fixas — Home, Inbox, Calendar, More — enquanto `APP_MOBILE_PLAN`
§3.1 propõe **cinco** telas: Hoje, Conversas, Agenda, Funil, Resultado.

**A página está certa e eu ajusto o plano.** Quatro destinos estáveis mais "More" é a convenção iOS,
cabe melhor na zona do polegar, e Resultado é conteúdo da Home (a maquete faz exatamente isso:
receita atribuída no topo, depois "Needs your attention"). Funil vai para More.

Ajuste pendente em `APP_MOBILE_PLAN` §3.1 caso o DS 3.0 seja adotado — ou mesmo se não for, porque
a decisão de navegação independe da paleta.

---

## 7. Cuidado ao ler os números da maquete

As telas dentro do `.app-frame` usam corpo de 6 a 9px porque são maquete reduzida dentro da página.
**Não são valores de UI.** Copiar `font-size:7px` para o produto quebra o piso de acessibilidade e o
`MOBILE_UX` §1.5, que força ≥16px em input no mobile para impedir o zoom automático do iOS.

---

## 8. Caminhos

| Opção | O que envolve | Quando faz sentido |
|---|---|---|
| **A — regras e rampa** | §5.1 (três regras + lint), §5.2 (motion), §5.3 (rampa e easings). Zero risco visual, ganho imediato | Sempre. Vale mesmo que B e C nunca aconteçam |
| **B — repaleta sem trocar fonte** | A + traduzir a paleta para o formato do `tokens.css`, com os dois temas completos e os dois valores do §4 corrigidos. Mantém Rajdhani/Chakra/Orbitron | Se o incômodo é a cor, não a letra |
| **C — adoção completa** | B + reversão tipográfica declarada + ADR + decisão sobre o corpo 15 vs 17px + varredura das 34 telas + nova auditoria de a11y | Se o v2 não convence em uso real. É fase própria, não slot |

Recomendo **A agora, em qualquer cenário** — é barato, não toca em pixel existente e resolve lacunas
reais. B e C dependem de uma pergunta que só você responde: o que exatamente te incomoda no v2 hoje,
a cor ou a letra?

O que não é defensável em nenhum cenário é colar o CSS por cima do `tokens.css`.

---

## 9. Pendências

1. **Decisão do §2** (Space Grotesk) e escolha entre A, B e C.
2. Se for B ou C: corrigir os dois valores do tema claro (§4) **antes** de implementar.
3. Se for C: decidir o corpo (15px/500 vs 17px/400) e onde a marca vive sem o Orbitron.
4. Ajustar `APP_MOBILE_PLAN` §3.1 para quatro abas + More (§6) — independe das opções acima.

---

## 9. Correcoes apos a implementacao (F59-S08, 2026-09-09)

Ao implementar a opcao A eu li o codigo de perto e **duas afirmacoes deste documento estavam
erradas**. Ficam registradas aqui em vez de apagadas, porque o erro muda a conclusao.

### 9.1 A rampa de marca JA EXISTE no DS v2

O §5.3 dizia "o v2 tem um verde so mais `--border-brand`, o que forca hover, foco, glow e estado
desabilitado a serem inventados caso a caso". **Falso.** `packages/design-tokens/src/tokens.css` ja
define, e o preset Tailwind ja expoe:

| Token v2 | Valor | Equivalente DS 3.0 |
|---|---|---|
| `--brand` | `#1fff13` | `--brand` (identico) |
| `--brand-strong` | `#16e00a` | `--brand-strong` (identico) |
| `--brand-bright` | `#5bff51` | `--brand-bright` (`#72ff69` — tom diferente) |
| `--brand-soft` | `#7feb7b` | `--brand-soft` (`#b1ffaa` — tom diferente) |
| `--brand-faint` | `#abffa7` | — (nao existe no DS 3.0) |
| `--brand-price` | `#25f018` | — (nao existe no DS 3.0) |
| `--text-on-brand` | `#04210a` | `--brand-ink` (so rename) |

Ou seja: a rampa do v2 e **mais completa** que a do DS 3.0. O que a proposta traz de novo em cor sao
tons ligeiramente diferentes em `bright`/`soft` — preferencia estetica, nao lacuna. **Nao adotei**:
mexer no tom repinta componente existente, que e exatamente o risco do §3.1.

O `--brand-ink` tambem **nao foi criado**: e rename de `--text-on-brand`, que ja e o nome melhor
(diz o papel, nao a cor). Alias por alias adiciona um nome a manter sem resolver nada.

### 9.2 O contrato de radius do DS 3.0 esta CERTO; a pagina e que diverge

O §3.2 apontou que o bloco de codigo do §07 usa `--r-xs/--r-sm/--r-md/--r-lg` enquanto o CSS da
pagina usa `--radius-*`, e concluiu que "o contrato quebra a maquete". A leitura correta e outra: o
**repo ja usa `--r-xs`…`--r-pill`**. O contrato do §07 esta alinhado com o codigo real; quem
diverge e o CSS da propria pagina. Isso reforca que o §07 foi escrito olhando o repositorio.

### 9.3 O que sobrou da opcao A, e foi entregue

- **Tokens de motion** — lacuna real: nao havia nenhum. Entraram `--ease`, `--ease-spring`,
  `--dur-fast/base/slow`, expostos no preset Tailwind.
- **As tres regras de lint** — o item de maior valor, e o unico que muda comportamento futuro.

### 9.4 As regras foram para `warn`, com numero medido

O DoD do slot previa: mais de 10 ocorrencias fora da fronteira → `warn` com TODO datado. Medido:

| Regra | Ocorrencias |
|---|---|
| hex literal em componente | 19 |
| `toLocaleString/DateString/TimeString` com locale literal | 44 |
| `new Intl.*` com locale literal | 32 |
| fuso IANA literal | 14 |
| **total** | **109** |

Todas passam do limiar, entao as quatro entraram como `warn`. `pnpm lint` fecha com **0 erros e 109
avisos**: a divida fica visivel e **para de crescer**, sem travar o CI por debito que nao e deste
slot. Promover para `error` e o criterio de pronto do slot de limpeza (`tasks/COMMS.md`).

### 9.5 Conclusao revisada

A opcao B (repaleta) perde quase toda a justificativa tecnica: a paleta do v2 e completa e a do DS
3.0 nao acrescenta capacidade, so tom. A escolha entre elas e **estetica**, e portanto do Rogerio —
nao ha argumento de arquitetura de um lado nem do outro. A opcao C (tipografia) segue como estava:
e reversao declarada, com o custo do §2 e do §4.
