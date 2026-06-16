# UX_PRINCIPLES — Princípios de interação do Highermind v2

> **Documento:** padrões de UX inegociáveis. Todo slot de frontend tem que passar nesses princípios antes de ser considerado pronto.
> **Audiência:** quem implementa (Claude `/hm-engineer`), quem decompõe (`/hm-tasks`), quem revisa (`/hm-designer`).
> **Versão:** 0.1 — 2026-06-XX
> **Princípio fundador:** O v1 sofreu com UX ruim — micro-cliques, modais que cobriam tudo, interações ambíguas (texto vs arrastar), funcionalidades escondidas atrás de ícones obscuros. O v2 corrige cada uma dessas falhas com **um padrão nomeado**.

---

## 1. Filosofia em três frases

1. **Fluido, dinâmico, didático, sem poluição.** Cada ação custa o mínimo de clique e cognição.
2. **A interface ensina o uso.** Empty states convidam, help inline tira dúvida, navegação é previsível.
3. **Toda interação tem uma intenção primária óbvia.** Se o usuário tem que pensar "o que esse botão faz?", a UI falhou.

---

## 2. Anti-padrões nomeados do v1 (não repetir)

Cada um tem um **nome próprio** pra ser citável em PR review.

### 2.1 "Síndrome da engrenagem" (gear-only entry)

**O que era:** no Flow Builder do v1, pra editar um node você tinha que clicar exatamente numa engrenagem minúscula no canto do node. Se errasse o pixel, nada acontecia.

**Por que é ruim:** ação primária (editar) escondida em ícone secundário (settings). Engrenagem deveria ser apenas pra **configurações avançadas**, nunca pra ação principal.

**Regra v2:**
- **Ação primária do componente = clique no corpo do componente** (área generosa, com hover state claro).
- Duplo-clique abre o **inspector lateral** (não modal sobreposto).
- Engrenagem, se existir, abre **submenu de ações secundárias** (duplicar, exportar, deletar) — nunca a edição em si.

**Aplicação concreta no Flow Builder:**
- Clique no node → **seleciona** (highlight) + mostra inspector lateral aberto.
- Duplo-clique → entra em **modo edição inline** (se for texto curto) ou abre inspector expandido.
- Engrenagem do node → menu kebab com "Duplicar, Desconectar, Excluir".

---

### 2.2 "Drag-arrasta-tudo" (text-drag overlap)

**O que era:** dentro de uma caixa de texto de um node, você ia selecionar texto arrastando, e o **node inteiro arrastava junto** porque o evento de drag não era diferenciado entre "arrastar componente" e "selecionar texto dentro do componente".

**Por que é ruim:** confusão de affordance. Texto deve sempre se comportar como texto.

**Regra v2:**
- **Drag pra mover componente acontece apenas em uma `drag handle` explícita** — ícone `≡` no header do node, ou cursor `grab`/`grabbing` em região específica.
- Áreas de input/textarea/conteúdo de texto **NUNCA propagam drag pro componente pai**. `e.stopPropagation()` em mousedown de texto.
- Cursor visual diferencia: `text` em zonas de texto, `grab` em zonas de drag.

**Implementação técnica:**
- ReactFlow node custom: registra `nodrag` className em campos de input.
- DnD-kit (pipeline): drag handle isolada com `useDraggable` apenas no header do card.

---

### 2.3 "Modal-cobre-tudo" (full-screen modal)

**O que era:** abrir detalhe de uma conversa, deal ou agente abria modal que ocupava 90% da tela, escondendo tudo o resto. Pra ver outra coisa: fechar, navegar, abrir de novo.

**Por que é ruim:** quebra contexto. Você perde a lista de onde veio. Volta significa scroll de novo. Comparação entre items é impossível.

**Regra v2:**
- Detalhes de items abrem em **side drawer** (painel lateral, deslizando da direita), tipicamente 480-640px de largura.
- Lista por trás continua visível (em ~40% restante da tela), mantendo contexto.
- Drawer fecha com `Esc`, clicar fora ou X — três caminhos previsíveis.
- Modal é reservado pra **confirmações destrutivas** (delete, etc.) ou **wizards multi-step** (criar campanha). Não pra "ver detalhe".

**Exceções aceitas:**
- Modal pequena de confirmação (300-400px).
- Wizards multi-step inerentemente lineares (criar campanha, criar agente).
- Visualizadores de mídia em tela cheia (lightbox de imagem).

---

### 2.4 "Caça ao tesouro" (hidden feature)

**O que era:** funcionalidades importantes escondidas atrás de menus de 3 níveis, ícones genéricos sem label, ou só descobertas por acidente.

**Por que é ruim:** se você precisa de documentação pra encontrar uma feature, a UX errou.

**Regra v2:**
- **Ações primárias têm label, não só ícone** quando a ação não é universalmente reconhecida.
- Ícones sem label são aceitos apenas pros 6 universais: **busca, fechar, voltar, configurações, perfil, notificações**.
- Toda outra ação ou tem label visível, ou tooltip explícito ao hover, ou ambos.
- Features importantes têm **path de entrada óbvio** (botão na barra principal da feature, não menu kebab).

---

### 2.5 "Tooltip-substituto" (tooltip-as-help)

**O que era:** explicação importante de funcionalidade complexa colocada em tooltip de 1 linha que sumia em 2 segundos.

**Por que é ruim:** tooltip é pra **identificação** (nome do botão), não pra **explicação** (como funciona). Documentação importante não cabe em 1 linha.

**Regra v2:**
- Tooltip = label curto (nome da ação, atalho de teclado). Máximo 1 linha.
- Explicação de feature = **HelpPanel lateral** que abre clicando no `?` ao lado do nome da seção.
- HelpPanel persiste até user fechar. Inclui texto, exemplos, link pra doc completa.
- Em features complexas (Flow Builder, Campanhas, Agente IA), o `?` está sempre visível no header da feature.

---

### 2.6 "Empty-state-vazio" (true empty state)

**O que era:** tela vazia quando você abria uma feature sem dados ainda. Sem orientação, sem CTA.

**Por que é ruim:** usuário não sabe o próximo passo. Abandono.

**Regra v2:**
- Toda feature tem **3 estados explícitos**: empty (zero dado), loading (busca em progresso), populated (com dado). Cada um tem layout dedicado.
- Empty state **sempre** tem: ilustração ou ícone grande, título, 1-2 linhas explicando, **CTA primário** (botão verde-neon, único).
- Exemplo: `/conversations` empty → "Nenhuma conversa ainda" + "Conecte um canal pra começar a receber mensagens" + botão "[Conectar canal]".

---

### 2.7 "Click-fantasma" (no feedback on action)

**O que era:** você clicava em algo, e por 2 segundos parecia que nada aconteceu (sem loading, sem mudança visual, sem feedback).

**Por que é ruim:** usuário clica de novo, pensa que travou, dispara ação duplicada.

**Regra v2:**
- **Toda ação assíncrona dispara feedback imediato** (< 100ms):
  - Botão entra em estado `loading` com spinner.
  - Disabled durante a ação (impede duplo clique).
  - Cursor `wait` em interações longas.
- **Confirmação visual ao final** (toast de sucesso/erro), com mensagem específica.
- Operações > 500ms mostram **skeleton loading** no espaço onde o conteúdo vai aparecer (não spinner solto no meio da tela).

---

### 2.8 "Form-de-um-monstro" (mega form)

**O que era:** form de 30 campos numa página só, sem agrupamento, sem progresso, sem salvamento parcial.

**Por que é ruim:** intimida. Erros invalidam tudo. Sair pelo meio perde trabalho.

**Regra v2:**
- Form longo é **wizard multi-step** com progresso visual.
- Cada step tem objetivo claro ("Step 2 de 5: Recipients").
- **Salvamento automático** ao avançar de step (draft).
- Validação acontece **por step**, não no fim.
- Step opcional é marcado.
- Voltar não perde dados do step seguinte.

---

### 2.9 "Botão-suicida" (destructive without confirm)

**O que era:** botão "Excluir" diretamente clicável, sem confirmação ou com confirmação trivial ("Tem certeza? [OK]").

**Por que é ruim:** acidentes acontecem. Operações irreversíveis precisam de **fricção proporcional**.

**Regra v2:**
- **Soft delete** (suspender, arquivar) → confirmação simples ("Sim/Cancelar").
- **Hard delete** (impossível recuperar) → **typing-to-confirm**: usuário precisa digitar nome do recurso ou palavra-chave (`REMOVER`, `DELETE <nome>`) antes do botão habilitar.
- Toast de undo (8s) após delete soft, quando possível.
- Operações em lote destrutivas mostram **preview do que vai ser afetado** antes.

---

### 2.10 "Atalho-fantasma" (no keyboard support)

**O que era:** lista de itens onde tudo era clique. Power users sem como acelerar.

**Por que é ruim:** usuários frequentes (atendentes) atendem o dia inteiro. Cada clique extra = 1000s de cliques no mês.

**Regra v2:**
- **Atalhos universais** sempre disponíveis: `Cmd/Ctrl+K` (busca global), `?` (atalhos da página atual), `Esc` (fechar/voltar).
- **Em listas**: `↑`/`↓` navega, `Enter` abre, `R` responde (quando aplicável), `A` atribui, etc.
- **Em modais/drawers**: `Esc` fecha; `Cmd+Enter` confirma; `Tab` navega.
- Lista de atalhos visível em `/settings/me/atalhos` e via `?` em qualquer página.

---

### 2.11 "Erro-misterioso" (cryptic error)

**O que era:** erro mostrado como "Erro 500. Tente novamente." Sem informação útil. Sem o que fazer.

**Por que é ruim:** usuário fica preso. Suporte é acionado pra coisa trivial.

**Regra v2:**
- Erro tem **3 partes**:
  1. **O que aconteceu** ("Falha ao enviar mensagem").
  2. **Por que** (curto, plain language: "Janela de 24h da Meta fechou").
  3. **O que fazer** ("Use um template aprovado pra reabrir a conversa.").
- Erro técnico tem ID copiável pra suporte (`Ref: hm_err_abc123`).
- Stack trace nunca vai pro usuário final — só pro log.

---

### 2.12 "Notificação-spam" (over-notification)

**O que era:** notificação pra todo evento, gerando ruído tão grande que tudo virava ignorável.

**Por que é ruim:** atenção do usuário se desgasta. Notificação importante se perde.

**Regra v2:**
- Notificação é **por evento que requer atenção**, não por mudança de estado qualquer.
- 3 níveis: **toast** (info passageira, 4s), **inbox de notificações** (persistente até lida), **push/email** (urgente).
- Toggle granular por tipo de evento em `/settings/me/notificacoes`.
- **Agrupamento inteligente**: 5 mensagens novas no mesmo chat = 1 notificação "5 novas", não 5.

---

## 3. Princípios positivos (o que SIM fazer)

### 3.1 Selecionar antes de agir

Padrão **macOS Finder**: clica seleciona, segundo clique edita. Reduz ações acidentais.

### 3.2 Drawer lateral em vez de modal

Já coberto no §2.3. Mantém contexto. Permite comparação.

### 3.3 Help inline com `?`

Já coberto no §2.5. HelpPanel persistente.

### 3.4 Estado vazio convida

Já coberto no §2.6. Empty state com CTA.

### 3.5 Cursor + hover state ensina

O cursor diz "isso é clicável" (`pointer`), "isso é arrastável" (`grab`), "isso é texto" (`text`). Hover state diz "isso vai acontecer se você clicar".

### 3.6 Skeleton loading

Já coberto no §2.7. Conteúdo aparece no lugar dele, não num spinner perdido.

### 3.7 Atalhos pra power users

Já coberto no §2.10. Atendente mais rápido = menos custo operacional pro cliente.

### 3.8 Density adaptável

Toggle no `/settings/me/preferências`: **confortável** (mais espaço, default) vs **compacto** (mais densidade, pro power user). Aplica nas listas (ChatList, Pipeline).

### 3.9 Linha do tempo (timeline) pra eventos

Contato, deal, campanha — todos têm timeline visual ordenada cronologicamente. Não tabela, não scroll horizontal. Vertical com ícones e relativo a "agora" ("há 2h").

### 3.10 Animação Motion One — pequena, intencional

- Transições de drawer/modal: 200ms ease-out.
- Hover states: 150ms.
- Toasts entram/saem: 250ms.
- Animação que não comunica intenção = excluir.

---

## 4. Checklist Definition of Done UX (todo slot frontend)

Toda PR de frontend tem que marcar todos:

- [ ] Ação primária do componente é clique no corpo (não engrenagem)
- [ ] Drag de componente NÃO interfere em seleção de texto
- [ ] Detalhe abre em drawer, não modal full-screen (a menos que seja wizard ou confirmação)
- [ ] Toda ação importante tem path de entrada óbvio (não escondida em menu profundo)
- [ ] Explicação de feature está em HelpPanel `?`, não em tooltip
- [ ] Empty state implementado com CTA
- [ ] Loading state implementado (skeleton ou spinner contextual)
- [ ] Error state implementado com 3 partes (o quê, por quê, o que fazer)
- [ ] Forms longos quebrados em wizard com salvamento entre steps
- [ ] Ações destrutivas têm confirmação proporcional (typing-to-confirm em hard delete)
- [ ] Atalhos de teclado relevantes implementados
- [ ] Hover states + cursor states corretos em interativos
- [ ] Notificações respeitam agrupamento (sem spam)
- [ ] Acessibilidade: focus ring, ARIA roles, contraste AAA em texto principal
- [ ] Density aceita preference (`/settings/me`) em listas longas
- [ ] Animations curtas (< 250ms) e propositais

---

## 5. Como `/hm-tasks` deve aplicar isso

Quando decompõe uma feature em slots de frontend, `/hm-tasks` precisa:

1. **Ler este doc** antes de definir o escopo de qualquer slot de frontend.
2. **Listar o anti-padrão do v1** que o slot precisa evitar (se houver paralelo).
3. **Citar quais princípios positivos o slot aplica**.
4. **Incluir o checklist DoD UX** nas validações do slot.

Exemplo de slot bem escrito:

```yaml
---
id: F4-S11-flow-editor-canvas
title: Flow Editor Canvas com ReactFlow
phase: F4
estimated_size: M
ux_considerations:
  - "Aplica regra 2.1 — clique no node seleciona + abre inspector; engrenagem só pra menu kebab."
  - "Aplica regra 2.2 — campos de texto dentro do node têm className 'nodrag' + stopPropagation."
  - "Aplica regra 2.3 — inspector lateral, não modal."
  - "Aplica regra 2.6 — empty state mostra ilustração + CTA 'Adicionar primeiro node'."
---
```

E nas validações:

```bash
# Validation commands
pnpm test apps/web/features/flow-builder/components/FlowEditor.test.tsx
pnpm test:e2e flow-editor-interactions    # cobre selecionar, drag, text-select, drawer
```

Atualizar `hm-tasks/SKILL.md` pra incluir esse fluxo (§7 abaixo).

---

## 6. Como `/hm-designer` deve auditar

`/hm-designer` (revisão de interface) checa cada item do checklist §4 num PR. Se algum estiver `❌`, é blocker.

`/hm-designer` também valida princípios visuais do DS v2 (cores, tipografia, espaçamento, hex hardcoded).

---

## 7. Update obrigatório no `hm-tasks/SKILL.md`

Adicionar trecho na skill:

```markdown
### Para slots de frontend, OBRIGATÓRIO

Antes de fechar o slot, leia `docs/UX_PRINCIPLES.md` e adicione no frontmatter:

- `ux_considerations`: lista de regras (numeradas como em UX_PRINCIPLES §2 e §3) que o slot evita ou aplica.
- DoD do slot inclui automaticamente os items do checklist `UX_PRINCIPLES.md §4` que sejam relevantes.

Se você não conseguir listar nenhuma consideração de UX no slot, o slot não é de frontend OU você não entendeu o escopo — pare e re-leia.
```

---

## 8. Mobile é cidadão de primeira classe

> **Mudança de postura (F36).** O v1 deste doc tratava mobile como "fase 2"
> (responsive opcional). **Não é mais.** O produto tem que ser excepcional no
> celular — em TODAS as telas. Mobile não é o desktop encolhido: é o mesmo produto
> redesenhado para o toque e a mão única, com a mesma identidade DS v2.

Os padrões mobile (thumb-first, pilha de views, drawer→**sheet**, tabela→cards,
gestos, safe-area, alvos de toque, PWA) vivem em **`docs/MOBILE_UX.md`** — leitura
obrigatória para qualquer slot de frontend, junto com este doc. Pontos-chave:

- **Drawer → sheet (§2.3 no mobile).** Abaixo de `md` (768px) o drawer lateral vira
  **bottom-/full-sheet** (componente `@/shared/components/Sheet`): handle de arraste,
  `Esc`/swipe-down/backdrop, focus-trap + restauração de foco.
- **Thumb-first.** Ação primária na zona do polegar (rodapé), nav primária = bottom
  tab bar. Alvos ≥ 44×44px (`.touch-target`); inputs ≥ 16px (evita zoom iOS);
  safe-area (`.pb-safe`/`.pt-safe`/…) nas bordas do device.
- **Corte canônico (D4).** Estrutura/comportamento que muda no mobile usa
  `useBreakpoint().isMobile` (`@/shared/hooks`), não número solto nem `window.innerWidth`.
- **Continuidade.** Mesmos tokens, mesma identidade dark-first. Animações
  `motion-safe` < 250ms; orçamento de performance mobile (Lighthouse mobile ≥ 90).

Genéricos universais (cobrir como "óbvio", sem enumerar): code splitting por rota
(Next.js cobre automático), inputs sem `<label>` (a11y básica), cores sem contraste
AA mínimo (DS v2 enforça).

---

## 9. Não-objetivos UX MVP

- ❌ Customização visual profunda (skins, layouts dinâmicos)
- ❌ Modo "tour guiado" interativo em primeira sessão (vai com onboarding fase 2)
- ❌ Anúncios in-app de novidades (changelog feature)
- ❌ A/B testing de UI
- ❌ Tradução pra outros idiomas além de pt-BR (i18n estrutura preparada, mas só pt-BR no MVP)
- ❌ Edição estrutural do Flow canvas no celular (degradação honesta — mobile é
  inspecionar/operar; desenhar grafo fica em ≥ tablet; ver `MOBILE_UX.md §2`)

---

> Princípios UX duros e nomeados. Quando alguém disser "essa interação tá estranha", você pode dizer **qual** princípio foi violado. Isso é como produto world-class é feito.
