# ADR-001 — Provedor de e-mail

> **Status:** aceita · **Data:** 2026-09-09 · **Fase:** F60 (canais)
> **Decisor:** decisão delegada pelo Rogério ("decide e documenta")
> **Contexto:** [`../features/CANAIS_PLAN.md`](../features/CANAIS_PLAN.md) §4

---

## Decisão

**Postmark** como provedor de e-mail, atrás de `IEmailProvider`, com esta separação de domínios:

| Direção | Domínio | Por quê |
|---|---|---|
| **Envio** | do **cliente** (`orcamento@cliente.com`), autenticado com SPF/DKIM/DMARC | O lead precisa ver o nome do negócio dele, não o nosso. E a reputação fica com quem manda |
| **Recebimento** | **nosso**, um só (`<canal>@inbox.tagix.io`), colocado como `Reply-To` | Ver §3 — é o que dissolve o problema mais chato desta decisão |

Fluxos separados por `Message Stream`: `transactional` para conversa, `broadcast` para campanha.

---

## O problema

O canal de e-mail (F60-S03) precisa de seis coisas:

1. enviar por **domínio do cliente**, com SPF/DKIM/DMARC — são N clientes, N domínios
2. **receber** a resposta e colocar na inbox
3. webhook de **retorno** (entrega, bounce duro, bounce leve, reclamação)
4. **assinatura** verificável no webhook
5. separar **transacional de marketing**, para campanha ruim não derrubar confirmação de agendamento
6. custo que caiba em US$ 800/mês por cliente (`AGENCIA_PLAN` §5)

---

## Opções

Estado verificado em 2026-09-09 (fontes no fim):

| | Postmark | Mailgun | Resend |
|---|---|---|---|
| Inbound | **Payload completo num webhook só** — conteúdo e dados já parseados | Parsing + **roteamento por regex** entre domínios, o mais poderoso dos três | **Só metadados**; o corpo e os anexos exigem chamada extra |
| Múltiplos domínios de envio | sim | sim | sim |
| Separação transacional × marketing | **Message Streams**, nativo | pools separados, configuração manual | mais simples, menos explícito |
| Roteamento inbound entre muitos domínios | simples, menos flexível | **o mais forte** | limitado |

**Resend sai primeiro.** Inbound só com metadados significa uma chamada de API extra para cada
e-mail recebido — no caminho mais sensível que existe aqui, que é "o cliente do meu cliente
respondeu". Uma falha nessa chamada extra é uma mensagem que não aparece na inbox e ninguém percebe.
O desenho existe por um motivo legítimo (limite de corpo em ambiente serverless), mas nós rodamos
worker em VPS, não função efêmera — pagamos o custo sem receber o benefício.

Sobra **Postmark × Mailgun**, e a diferença real é o roteamento inbound entre muitos domínios, onde
o Mailgun é claramente melhor. Foi aí que a decisão quase virou Mailgun.

---

## §3 — O que dissolveu o empate

O requisito "rotear inbound de N domínios de cliente" **não é um requisito de verdade**. Ele aparece
se você assumir que o e-mail volta para o mesmo domínio de onde saiu. Não precisa.

- **Enviar** pelo domínio do cliente é obrigatório: é o nome dele que o lead vê, e a reputação de
  entrega tem que ser dele.
- **Receber** no domínio do cliente é opcional: basta o cabeçalho `Reply-To` apontar para um endereço
  nosso.

Então cada canal de e-mail recebe um endereço de recebimento em **um domínio só, nosso**, no formato
`<id-do-canal>@inbox.tagix.io`, e o `Reply-To` de todo envio aponta para lá. O cliente do cliente
responde normalmente; a mensagem chega num domínio que **nós** controlamos, com MX configurado uma
vez, para sempre.

O que isso muda:

- **Onboarding de cliente novo:** DNS só para envio (SPF/DKIM). Sem MX, sem mexer no e-mail que a
  empresa já usa — e mexer em MX de cliente é a forma mais rápida de derrubar o e-mail dele e virar
  o culpado.
- **Roteamento inbound:** o endereço já identifica o canal. Não há regex, não há tabela de rotas.
- **A vantagem do Mailgun evapora**, e sobra a do Postmark: payload completo num webhook só, menos
  peças para falhar no caminho que mais importa.

O custo é estético: a resposta vai para um endereço `@inbox.tagix.io` em vez do domínio do cliente.
O remetente visível continua sendo o dele, e na prática ninguém lê o `Reply-To`.

---

## Consequências

**Boas**

- Um MX, configurado uma vez. Cliente novo não mexe no e-mail existente dele.
- `Message Streams` dá a separação transacional × marketing sem gambiarra — e o `FakeEmailProvider`
  já recusa `broadcast` sem `List-Unsubscribe`, que é a regra que protege a reputação.
- Inbound num payload só: menos chamada, menos falha, menos latência entre "respondeu" e "apareceu".

**Ruins, e assumidas**

- Postmark é mais caro por e-mail que Mailgun ou SES em volume alto de marketing. **Aceito por ora**:
  o volume inicial é baixo e a `IEmailProvider` torna barato mover só o `broadcast` para um provedor
  mais barato quando o número justificar. Transacional fica onde a entrega é melhor.
- `Reply-To` em domínio nosso é uma pequena quebra de white-label. Se um cliente reclamar, a saída é
  um subdomínio dele (`resposta.cliente.com`) com MX apontando para nós — volta a ser DNS por
  cliente, mas só para quem pedir.
- Roteamento inbound sofisticado (filtro, encaminhamento condicional) não existe aqui. Não é
  requisito hoje; se virar, é o gatilho para reavaliar o Mailgun.

**A verificar antes de integrar** (fatos voláteis, não travados aqui): preço por milheiro nos dois
fluxos, teto de tamanho de mensagem e de anexo, limite de domínios por conta, e o formato exato da
assinatura do webhook. O `FakeEmailProvider` cobre o contrato; o adapter real valida contra a API.

---

## O que torna reversível

`IEmailProvider` (F60-S03) tem quatro métodos: `send`, `parseInbound`, `parseEvents`,
`verifyWebhook`. Trocar de provedor é escrever uma classe. O `FakeEmailProvider` — que roda em
teste, sem credencial e sem rede — é a especificação executável do que o substituto precisa fazer.

Nenhuma decisão de produto depende de ser Postmark. O que depende é a separação de fluxos e o
domínio único de recebimento, e as duas sobrevivem à troca.

---

## Fontes

Verificadas em 2026-09-09:

- [Postmark vs. Resend: a detailed comparison for 2026 — Postmark](https://postmarkapp.com/compare/resend-alternative)
- [Compare Transactional Email Providers: Inbound Parsing & Routing (2026) — Mails.ai](https://mails.ai/blog/best-inbound-email-parsing-api-for-developers)
- [Best Inbound Email Notification APIs in 2026 — Pingram](https://www.pingram.io/blog/best-inbound-email-notification-apis)
- [Resend vs Postmark vs Mailgun for Solo Developers in 2026 — DevToolPicks](https://devtoolpicks.com/blog/resend-vs-postmark-vs-mailgun-solo-developers-2026)
