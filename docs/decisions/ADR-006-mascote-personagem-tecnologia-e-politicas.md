# ADR-006 — Mascote "Personagem" (direção C): tecnologia, orçamento de atenção e política de carregamento

> **Status:** aceita (direção, políticas e critério) · **tecnologia: pendente do spike medido F76-S01** ·
> **emenda 1 (2026-10-19, §9):** companheiro nas telas de acesso
> **Data:** 2026-10-16 · **Fase:** F76
> **Decisor:** Rogério (direção C); critérios e números delegados ("decide e documenta")
> **Contexto:** [`../design/copilot-botao-animacao.md`](../design/copilot-botao-animacao.md),
> [`../features/MASCOTE_ANIMACOES.md`](../features/MASCOTE_ANIMACOES.md)

---

## 1. Decisão

1. **Direção C (Personagem)**, contra a recomendação B (Órbita, 28/30). Motivo do Rogério (16/10/2026):
   "fica mais viva, dá um ar de mais diversidade". O personagem passa a ser **parte do sistema**, não só do
   botão: carregamento longo, "pensando", estados vazios, recibos e onboarding, sob as regras deste ADR.
2. **Os dois defeitos que deram 17/30 à direção C são requisitos, não aceitos como custo:**
   - *"Os braços viram ruído a 24 px"* → **rig com nível de detalhe (LOD)** em três cortes desenhados à mão,
     não escalados (§3). A 24 px o personagem não tem braços em repouso.
   - *"Pede Rive, runtime pesado"* → a tecnologia é escolhida por **spike medido** com critério fixado
     aqui (§2), não por preferência. Hipótese de partida: SVG + CSS em camadas com máquina de estados em TS.
3. **Orçamento de peso: 30 KB gz** para a função inteira (arte de todos os LODs, CSS, máquina de estados,
   diretor de atenção, `GradientText`, `LongWait`/`Thinking`), contando chunk lazy e WASM. Meta: ≤ 12 KB gz.
4. **Orçamento de atenção** do demo vira regra de produto (§4), com telemetria só de evento.
5. **Política de carregamento**: esqueleto sempre imediato; o personagem só entra em espera longa (§5).
6. **Por marca:** flag `mascot: 'character' | 'glyph'` por workspace/marca, cores por token. Odonto ("Arrimo
   por Arcada") é `glyph` por regra de marca. Maian: decisão aberta do Rogério (padrão `glyph` até decidir).

## 2. Tecnologia — critério do spike (F76-S01)

Duas implementações do **mesmo** personagem (rig C do demo, LOD 24 e 48), com os estados repouso, pisca,
acena, pensando e comemora:

- **S** — SVG inline em camadas + CSS keyframes/WAAPI + máquina de estados TS (`data-state`).
- **R** — Rive (`@rive-app/canvas-lite` ou o runtime WebGL/Canvas mais leve disponível na data, versão
  com ≥ 2 semanas), arquivo `.riv` com state machine e inputs de cor.

Medição em build de produção (`next build && next start`), Chromium via Playwright, **CPU 4× mais lenta**
(CDP `Emulation.setCPUThrottlingRate`), 3 rodadas, mediana:

| # | Critério | Como mede | Limite para aprovar |
|---|---|---|---|
| 1 | Peso gz total da função | `gzip -9` de cada chunk/asset carregado pela função (JS, CSS, SVG, `.riv`, `.wasm`) | **≤ 30 KB** (duro) |
| 2 | INP | `web-vitals` `onINP` num roteiro de 20 cliques em controles vizinhos com o personagem acenando em loop forçado | p75 ≤ 200 ms **e** delta ≤ 10 ms contra a página sem personagem |
| 3 | Quadros longos | Long Animation Frames (`PerformanceObserver` `long-animation-frame`) em 60 s de roteiro | zero LoAF > 50 ms atribuível ao personagem; soma de `blockingDuration` ≤ 100 ms |
| 4 | Ociosidade | CPU (`Performance.getMetrics` `TaskDuration`) em 30 s de repouso, aba visível | ≤ 1 % de uma thread (repouso não anima) |
| 5 | Tema e marca | troca de `data-theme` e de marca em execução | cor muda por token CSS sem recarregar arte |
| 6 | Movimento reduzido e pausa | `prefers-reduced-motion`, `visibilitychange`, fora da viewport | congela no quadro-pose; zero frames renderizados fora da tela |
| 7 | Primeira pintura do botão | tempo do mount até o quadro pose visível | ≤ 1 frame após hidratação (sem flash de vazio) |

**Regra de decisão:** R só vence se passar **todos** os 7 critérios **e** for melhor que S em expressividade
avaliada pelo `/hm-designer` com capturas lado a lado. Empate ou falha em qualquer critério → **S**.
O resultado (números, versões, comandos) é anexado na §8 deste ADR pelo F76-S01; sem esse anexo o F76-S03
não começa.

## 3. Rig com nível de detalhe (LOD)

| LOD | Tamanho de uso | O que tem | O que não tem |
|---|---|---|---|
| `xs` | 16–20 px (selo, inline em texto) | cabeça (visor + 2 olhos) e ponta da antena | corpo, braços |
| `sm` | 24 px (botão, alça, "pensando" inline) | cabeça, visor, olhos, antena, ombros fundidos ao corpo numa silhueta só | braços em repouso; **um** braço aparece só durante `wave`, com traço ≥ 2 px renderizado |
| `md` | 40–64 px (vazios, recibo, LongWait) | cabeça, corpo, dois braços, antena com follow-through | — |
| `lg` | 96–160 px (onboarding) | `md` com detalhes de visor e mãos | — |

Cada LOD é desenhado na grade do próprio tamanho (traços em pixel inteiro), nunca o `lg` reduzido. A escolha do
LOD é automática pelo `size` do componente.

## 4. Orçamento de atenção (regra de produto)

Portões (todos abertos): aba visível e botão na viewport; ponteiro parado ≥ 20 s e sem tecla ≥ 4 s; sem foco em
campo editável, modal, arrasto ou ponteiro pressionado; Copiloto fechado; fora dos 3 primeiros minutos da sessão.

Cotas: chamada ambiente 2/dia (cooldown 12 min); por evento cooldown 3 min (briefing 1/dia, sugestão 1 a cada
2 h, erro 1 por integração por dia); **teto somado de 4 chamadas/dia**; varredura ambiente 10/dia (6 min entre
elas). Prioridade: erro > briefing > sugestão. "Ação concluída" não gasta cota.

Aprendizado: ignorar = 60 s sem abrir após chamada (aviso de erro não conta). 2 ignoradas seguidas dobram o
cooldown (até ×4). 4 ignoradas em 7 dias → 7 dias silenciada (sem chamada ambiente; evento vira varredura com
sinal aceso). Quem abriu o Copiloto em ≥ 3 dos últimos 7 dias ("formada") não é mais chamada.

Modos por membro: **Vivas** (padrão), **Discretas** (padrão quando o SO pede movimento reduzido), **Desligadas**.
Os números são hipótese até a telemetria `nudge → aberto em 60 s` calibrar; mudar número exige atualizar este ADR.

## 5. Política de carregamento

- **Esqueleto (skeleton) é imediato e sempre primeiro.** O personagem nunca substitui nem atrasa conteúdo.
- O personagem entra só após **1.200 ms** de espera contínua; uma vez visível, fica **≥ 600 ms** (não pisca);
  após **8 s** mostra texto honesto ("Está levando mais que o normal"); trabalho com progresso real mostra o
  progresso, não o personagem sozinho.
- **Um ator por vez:** no máximo um personagem animado por viewport; os demais ficam em pose parada.
- Permitido: primeira carga/rota pesada, "pensando" do Copiloto, sincronização/importação/ações em lote, estados
  vazios (pose parada), recibo de ação com Desfazer (comemora só após sucesso), onboarding.
- **Proibido:** Inbox e mensagens a clientes, KPIs e números, toasts e notificações, ícone do PWA e badge,
  páginas públicas/autenticação (exceto as telas de acesso, ver a emenda do §9), erros que a pessoa não resolve.

## 6. Consequências

- Componentes públicos em `@hm/ui`: `Mascot`, `GradientText`, `Thinking`, `LongWait`, `MascotStage`
  (contrato na spec §6). A F74 (Copiloto) consome `Thinking` e o launcher; não reimplementa.
- Tokens novos em `@hm/design-tokens` por tema e marca (`--cp-ink*`, `--m-*`), com teste de contraste.
- Nenhuma tabela nem coluna nova: o modo (Vivas/Discretas/Desligadas) e o estado do orçamento vão em
  `members.notification_prefs.copilot` (o jsonb que já guarda como o sistema chama a atenção da pessoa, inclusive
  o som), por rota própria que faz merge; a marca e a flag em `workspaces.settings.brand`. Telemetria em
  contadores Redis, sem tabela.
- Se o spike escolher R: arte vira `.riv` autorado no editor Rive (trabalho humano ou de designer com a
  ferramenta), o runtime é lazy e só carrega depois do LCP; o resto deste ADR não muda.

## 7. Alternativas rejeitadas

- **B · Órbita** (recomendada pela proposta): mais leve e legível, mas o Rogério escolheu expressividade e
  diversidade. Fica como **fallback `glyph`** para marcas que proíbem personagem.
- **Lottie:** cor travada no JSON, fraco em estados, player pesado.
- **Personagem em todo loading:** atrasa a percepção (o cânone pede skeleton) e vira ruído.

## 8. Resultado do spike (preenchido por F76-S01)

*Pendente.* Tabela dos 7 critérios × S/R com números, versões das libs, hash do commit, comandos de
reprodução e a decisão final.

## 9. Emenda 1 — companheiro das telas de acesso (Rogério, 2026-10-19)

> Plano: [`../design/auth-companion/PLANO.md`](../design/auth-companion/PLANO.md) · arte e animação:
> [`../design/auth-companion/SPEC.md`](../design/auth-companion/SPEC.md) · slots F76-S10..S13.

**Decisão do Rogério:** o personagem passa a aparecer em `apps/web/app/(auth)/**` (login, cadastro, verificação,
redefinição de senha e convite). Isso emenda o §5, que continua proibindo `(public)` e `(platform)`; a palavra
"autenticação" da lista de proibidos do §5 passa a significar só essas duas.

**Escopo e limites.**

1. Só reage a ações da própria pessoa (foco, envio, resultado, troca de etapa). Nunca chama atenção por conta
   própria, nunca acena sozinho e não usa o orçamento de atenção do §4, que vale só dentro do app autenticado.
2. Um ator: um único personagem por tela.
3. Balão em no máximo 2 momentos por fluxo, sempre redundante ao texto visível (ou só saudação, sem informação) e
   `aria-hidden`.
4. Nunca substitui o indicador do botão. `thinking` só aparece depois de 300 ms de envio pendente; a regra de
   1.200 ms do §5 vale para carregamento de rota, não para reação a envio.
5. Privacidade: olha para o campo focado e só lê o tipo e a posição do elemento. Nunca lê o valor, a senha, as
   teclas nem a força da senha. Zero telemetria e zero rede; a única coisa guardada é a chave de saudação no
   `sessionStorage`. O contrato público não tem parâmetro que carregue valor de campo.
6. Movimento: voo ≤ 760 ms, estados ≤ 900 ms fora de loop, só `transform`/`opacity`, pausa fora da viewport e com aba
   oculta. A respiração é exceção ao "repouso não respira nem flutua" de `MASCOTE_ANIMACOES.md` §2.3, limitada a 3
   ciclos após cada pouso, e depois só o piscar. `prefers-reduced-motion` = poses estáticas e crossfade de 160 ms.
7. Peso ≤ 30 KB gz (meta ≤ 12 KB), chunk lazy fora do LCP, zero CLS.
8. Cor: a ponta da antena é o único ponto de cor, **apagada em repouso**, e usa `--brand-text` (ícone de marca),
   nunca `--brand`, que continua sendo do único CTA da tela.

**Marcas.** Telas de acesso só na marca Leadium (o web não tem `data-brand` antes do login). Odonto = `glyph`, que
nas telas de acesso significa nada. Maian = `glyph` até decisão. Se o `data-brand` passar a existir antes do login,
vale a mesma regra: renderiza só sem `data-brand` ou com `data-brand="leadium"`.

**Tecnologia.** Módulo isolado `apps/web/features/auth/companion` na hipótese S (SVG inline em camadas + CSS/WAAPI +
máquina de estados TS), com contrato de camadas e estados idêntico à spec §3.1/§3.2 e pivôs/poses no `art/rig.json`.
Não depende do F76-S01: serve de medição real da hipótese S para ele. O F76-S03 o absorve como adaptador sobre
`@hm/ui` `Mascot`. Se o S01 escolher Rive, o módulo é descartado ou migrado sem mudar esta emenda.

**Contrato estendido.** Novo estado `avert` (olhos fechados, cabeça 8° para fora, 240 ms) na spec §3.2/§6.1.

**Continua proibido:** Inbox e mensagens a clientes, KPIs, toasts e notificações, ícone do PWA, páginas públicas e
de plataforma, e qualquer reação a conteúdo digitado.
