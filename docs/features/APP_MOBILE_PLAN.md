# Plano — Aplicativo do cliente (PWA, iPhone-first)

> **Documento:** plano de produto + arquitetura do app de acompanhamento do CRM
> **Versão:** 0.1 — 2026-09-08
> **Status:** PROPOSTA — aguarda aprovação
> **Fase sugerida:** F61 (antes do Content Studio — é barato e é o que o cliente toca todo dia)
> **Base já pronta:** F36 (Mobile Responsive & PWA, 14 slots, concluída) · [`../MOBILE_UX.md`](../MOBILE_UX.md) · [`MOBILE_RESPONSIVE_PLAN.md`](./MOBILE_RESPONSIVE_PLAN.md)
> **Documentos irmãos:** [`AGENCIA_PLAN.md`](./AGENCIA_PLAN.md) · [`CANAIS_PLAN.md`](./CANAIS_PLAN.md)

---

## 1. O ponto de partida é melhor do que parece

Não é greenfield. A F36 já entregou 14 slots de mobile e o produto **já é instalável**:

| Já existe | Onde |
|---|---|
| Manifest completo (`standalone`, ícones maskable 192/512, tema DS v2) | `apps/web/app/manifest.ts` |
| Bottom tab bar thumb-first, drawer "Mais", TopBar compacto, safe-area | `shared/components/layout/**` |
| 34 telas responsivas com padrão próprio por arquétipo (cockpit → pilha de views, kanban → seletor + lista, tabela → cards, drawer → bottom-sheet) | F36-S03…S13 |
| Auditoria de UX e performance mobile | F36-S14 |

**O que não existe:** service worker (a F36-S02 deixou o offline-shell como opcional e ele não foi
registrado), Web Push, fluxo de instalação, badge de não-lidos, e uma **visão de dono** — hoje o
mobile é o produto inteiro encolhido com carinho, não a tela que um dono de obra abre no semáforo.

Isso muda a natureza do trabalho: não é "fazer um app", é **fechar os quatro furos que separam um
site responsivo de um aplicativo**.

---

## 2. PWA ou App Store — a decisão

**Recomendação: PWA. E a razão principal não é custo, é que o gargalo real não está onde parece.**

### 2.1 O que o iPhone permite hoje

Estado verificado em 2026-09-08:

| Capacidade | Situação no iOS |
|---|---|
| Web Push | Funciona desde o iOS 16.4, **exclusivamente para web app na tela de início** — precisa do "Adicionar à Tela de Início" |
| Declarative Web Push | Adicionado no Safari 18.4 para PWA instalado — entrega mais confiável, menos dependente de service worker acordar |
| Instalação | O iOS 26 tornou **web app o padrão** para o que se adiciona à tela de início |
| Badge no ícone | Disponível junto com o suporte de push |
| Cota de armazenamento | Cache API ~50 MB por partição — folgado para um CRM que não guarda vídeo |
| Expurgo em 7 dias | **Não se aplica a app na tela de início.** O limite de 7 dias é do Safari navegando, não do web app instalado |
| Persistent Storage | Desde o Safari 17, dá para pedir proteção contra expurgo — e **exige permissão de notificação**, que este app vai pedir de qualquer forma |

Ou seja: os dois medos clássicos de PWA no iPhone — "não tem notificação" e "o iOS apaga os dados"
— **não valem mais** para um app instalado que a pessoa usa todo dia. O primeiro foi resolvido em
2023 e melhorado em 2025; o segundo nunca se aplicou à tela de início.

### 2.2 O gargalo verdadeiro

O que sobra é **um só problema, e ele não é técnico**: no iPhone não existe convite de instalação.
A pessoa precisa abrir no Safari, tocar em Compartilhar e escolher "Adicionar à Tela de Início".
Sem isso não há push, não há ícone, não há app.

Um dono de obra de 45 anos não faz esses três toques sozinho. Nem lendo um tutorial.

**A solução é de onboarding, não de plataforma:** a instalação acontece **junto com você**, na
mesma reunião em que o cliente assina. Você abre no telefone dele, instala, ativa a notificação e
manda o primeiro lead de teste na frente dele. Leva dois minutos, e é uma reunião que você já vai
fazer. Como você é a agência e o onboarding é assistido (§1 do `AGENCIA_PLAN`), o maior obstáculo
do PWA no iPhone simplesmente não te atinge — ele atinge produto self-serve.

### 2.3 E a notificação de lead novo não depende do push

Este é o argumento que fecha a decisão. O ponto crítico do produto é o **speed-to-lead abaixo de 60
segundos**, e a plataforma já notifica o dono **por WhatsApp**. O público — dono de negócio
brasileiro — vive no WhatsApp e responde lá antes de qualquer coisa.

Então a arquitetura certa é: **WhatsApp é o transporte de notificação primário, com link profundo
para a tela certa do app.** É mais confiável que push nativo, já está construído, e funciona mesmo
se a pessoa nunca instalar. O Web Push vira **reforço** — melhora a experiência de quem instalou,
não sustenta o produto sozinho.

Quando a notificação crítica não depende do push, e o push funciona, e a instalação é assistida, o
argumento restante para a App Store é vitrine — e vitrine não é problema seu, porque **você não
distribui esse app: você o entrega ao cliente que acabou de assinar contrato.**

### 2.4 Quando reabrir a discussão

Vale considerar a App Store se aparecer um destes:

- o cliente **pede** o app na loja como sinal de seriedade e isso está travando venda
- surgir necessidade de integração nativa de verdade: ligar pelo app com identificação, ler agenda
  do telefone, gravar chamada
- a taxa de instalação assistida cair na prática (medir, não supor)

**O caminho de escape, se acontecer:** empacotar o mesmo Next.js com Capacitor — um código só, push
nativo por APNs, presença na loja. Custo: US$ 99/ano, pipeline de build e revisão da Apple. E uma
ressalva honesta: a diretriz 4.2 da Apple rejeita app que seja só um webview embrulhado. Passa se
levar push nativo e integração de verdade; não passa se for um atalho para o site.

**Decisão: PWA agora, Capacitor documentado como escape.** Não construir para a loja antes de ter
cliente pedindo.

---

## 3. O que o dono precisa ver

Erro clássico — e o que o mobile de hoje faz — é entregar o produto inteiro encolhido. O dono não é
atendente. Ele abre o telefone entre uma tarefa e outra e quer responder três perguntas:

1. **Entrou lead? Alguém respondeu?**
2. **O que eu tenho hoje?**
3. **Como está o mês?**

### 3.1 As telas do app

**Quatro abas fixas + "Mais".** A v0.1 deste documento propunha cinco abas; a proposta DS 3.0
(ver [`../DESIGN_SYSTEM_V3_DELTA.md`](../DESIGN_SYSTEM_V3_DELTA.md) §6) propõe quatro, e está certa:
quatro é a convenção iOS, cabe na zona do polegar, e Resultado é conteúdo da Home, não destino.

| Aba | Conteúdo | Por quê |
|---|---|---|
| **Hoje** (início) | resultado do mês no topo · leads novos sem resposta com o tempo correndo · compromissos de hoje · o que precisa dele | A única tela que importa. Tempo de resposta em destaque, porque é o número que fecha venda. Absorve o antigo "Resultado" — a renovação se decide aqui, e precisa ser honesta inclusive quando o mês está ruim |
| **Conversas** | inbox em pilha de views, já responsiva da F36 | Ele responde do telefone. É o uso mais frequente |
| **Agenda** | dia e semana, confirmar, remarcar, marcar falta | Em obra, remarcação acontece no telefone |
| **Mais** | Funil (seletor de estágio + lista de cards, ação explícita e não gesto fino) · aprovações de conteúdo · relatório detalhado | Kanban no celular não se arrasta. E o que é semanal não merece uma aba permanente |

Perfil, integrações, configuração de agente, flows e campanhas **não entram no app**. Ficam no
desktop, onde você configura. O app é operação, não administração — e essa fronteira é o que o
impede de virar o produto inteiro encolhido outra vez.

**Linguagem segura para o cliente** (regra vinda do DS 3.0 §06): "Receita atribuída", "Aguardando
aprovação", "Próximas ações" — nunca termo interno de infraestrutura, fila ou custo de modelo.

### 3.2 Ações em uma mão

Responder, ligar (`tel:`), abrir o WhatsApp do contato, confirmar compromisso, mover estágio,
marcar como vendido. Tudo na zona do polegar, alvo de 44px, e **nenhuma ação destrutiva sem
confirmação** — o produto vai ser usado com uma mão, andando.

---

## 4. Arquitetura

### 4.1 As quatro peças que faltam

| Peça | Detalhe |
|---|---|
| **Service worker** | App shell em cache, estratégia por rota (shell primeiro, dado da rede com fallback), versionamento e atualização sem quebrar sessão. Next.js 15 com `output: 'standalone'` já em produção — o SW entra como asset, sem mudar o deploy |
| **Web Push** | VAPID, `push_subscriptions` por membro **e por dispositivo** (a mesma pessoa tem iPhone e desktop), Declarative Web Push onde houver suporte, e degradação silenciosa onde não houver |
| **Instalação** | Detectar `display-mode: standalone`; se não estiver instalado e for iOS, mostrar as instruções ilustradas de Compartilhar → Adicionar à Tela de Início. E um **modo de onboarding assistido** para você conduzir na reunião |
| **Leitura offline** | Últimas conversas, compromissos de hoje e cards do funil legíveis sem rede. **Escrita offline não** — mensagem que "saiu" e não chegou é pior que erro honesto. Fila de envio com estado visível, sim; ilusão de envio, não |

### 4.2 Notificação — o roteador

Um evento (lead novo, mensagem, compromisso, no-show) precisa decidir **por onde avisa**, sem
duplicar:

```
evento → preferências do membro → canais elegíveis
  push (se instalado e permitido)  ·  WhatsApp (sempre disponível)  ·  e-mail (resumo)
       ↓
  dedupe: se a pessoa abriu o app em N minutos, não manda WhatsApp
  silencia por horário e por fuso do membro
```

Sem esse roteador, o dono recebe a mesma coisa três vezes e desliga tudo — e aí você perdeu o canal
que sustentava o speed-to-lead. Preferência por tipo de evento, não um interruptor geral.

### 4.3 Segurança

- Sessão longa no dispositivo é conveniência **e** risco: celular de obra se perde. Sessão por
  dispositivo, revogável pelo desktop, com lista de dispositivos ativos.
- Notificação na tela bloqueada **não mostra conteúdo de mensagem de cliente** por padrão —
  título e origem, e o conteúdo depois de desbloquear. Dado de cliente final em tela bloqueada de
  telefone perdido é vazamento.
- O `push_subscriptions` é workspace-scoped com RLS, como tudo (regra F0-S04).

### 4.4 Desempenho

Alvo em 4G, aparelho de dono de negócio e não iPhone novo: **Hoje interativa em até 2,5s** em
visita repetida. O app shell vem do cache e o dado chega por cima. A F36-S14 já deixou uma linha de
base de auditoria; esta fase estende para o modo instalado.

---

## 5. Faseamento

| Slot | Entrega |
|---|---|
| **F61-S01** | Service worker + app shell + versionamento + estratégia de cache por rota |
| **F61-S02** | Tela **Hoje** — a visão de dono, com o relógio de resposta |
| **F61-S03** | Web Push: VAPID, assinatura por dispositivo, Declarative Web Push, degradação |
| **F61-S04** | Roteador de notificação + dedupe + preferências por tipo de evento + fuso |
| **F61-S05** | Fluxo de instalação iOS + detecção de standalone + modo assistido de onboarding |
| **F61-S06** | Leitura offline (conversas, agenda do dia, funil) + estado de rede honesto |
| **F61-S07** | Tela **Resultado** com comparação mês a mês |
| **F61-S08** | Badge de não-lidos + link profundo (notificação e WhatsApp abrem a tela certa) |
| **F61-S09** | Sessão por dispositivo + revogação + privacidade da tela bloqueada |
| **F61-S10** | QA em iPhone real: instalação, push, offline, desempenho em 4G |

**Sobre o QA:** simulador não reproduz push nem instalação no iOS. Precisa de iPhone físico. Se não
houver um à mão, isso é um item de compra antes da F61, não uma surpresa no meio dela.

---

## 6. Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| Cliente nunca instala | Sem push, sem ícone, sem app | Instalação assistida na reunião de onboarding (§2.2). Medir a taxa real |
| Notificação duplicada em três canais | O dono desliga tudo e o speed-to-lead morre | Roteador com dedupe (§4.2), não três integrações independentes |
| O app vira o produto inteiro encolhido | Volta o problema que a F36 já enfrentou uma vez | Fronteira do §3.1 escrita como regra: operação sim, administração não |
| Escrita offline | Mensagem que "saiu" e não chegou; cliente perdido sem ninguém saber | Só leitura offline. Fila com estado visível, nunca ilusão de envio |
| Apple mudar a política de PWA | Push ou instalação regridem | Capacitor documentado como escape (§2.4). O código é o mesmo — o risco é de prazo, não de reescrita |
| Celular perdido com sessão ativa | Vazamento de dado de cliente final | Sessão por dispositivo revogável + privacidade na tela bloqueada (§4.3) |

---

## 7. Em aberto

1. **O app é só do dono, ou a equipe dele também usa?** Secretária e vendedor têm necessidades
   diferentes das do dono — a tela **Hoje** de um vendedor é a fila dele, não o resultado do mês.
   Muda §3.1 e o roteador de notificação.
2. **Android importa agora?** Tudo aqui funciona melhor no Android (instalação com convite nativo,
   push sem fricção). A pergunta é só se vale QA dedicado já na F61.
3. **Existe iPhone físico para teste?** Item de F61-S10.

---

## Fontes

Verificadas em 2026-09-08:

- [Do Progressive Web Apps Work on iOS? The Complete Guide for 2026 — MobiLoud](https://www.mobiloud.com/blog/progressive-web-apps-ios/)
- [PWA iOS Limitations and Safari Support 2026 — MagicBell](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [What PWAs Can and Cannot Do on iOS in 2026 — OJapp](https://tips.ojapp.app/en/pwa-ios-2026-complete-guide/)
- [Safari iOS PWA Data Persistence Beyond 7 Days — Apple Developer Forums](https://developer.apple.com/forums/thread/710157)
