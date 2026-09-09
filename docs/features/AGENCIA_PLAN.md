# Plano — tagix como plataforma de agência (Brasil + Estados Unidos)

> **Documento:** plano de negócio + delta de plataforma
> **Versão:** 0.2 — 2026-09-08 (v0.1 era US-only; esta rodada incorpora as decisões do Rogério e o mercado BR)
> **Status:** PROPOSTA — aguarda aprovação. Nenhuma alteração de código antes disso.
> **Documentos irmãos:** [`CANAIS_PLAN.md`](./CANAIS_PLAN.md) · [`CONTENT_STUDIO_PLAN.md`](./CONTENT_STUDIO_PLAN.md)
> **Research de base:** [`../research/2026-09-08-modelo-agencia-local.md`](../research/2026-09-08-modelo-agencia-local.md)

---

## 0. Decisões desta rodada

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Quem é o tenant | **Você é a agência.** Workspace = empresa cliente. Sem white-label revendido, sem hierarquia agência→subconta |
| 2 | Cliente entra no produto | **Sim.** Calendário, aprovação de conteúdo e dashboard são telas do tagix, não relatório enviado |
| 3 | Preço | **US$ 800/mês**, com gestão de Google Ads e Meta Ads inclusa para os primeiros clientes. Verba de anúncio é **repasse**, nunca sua (§5) |
| 4 | Outbound frio | **Fora deste produto.** É prospecção sua, em repositório separado, depois. O tagix não ganha motor de prospecção fria (§4.2) |
| 5 | Meta Business Manager | **BM da agência com acesso delegado aos ativos do cliente** (§6) |
| 6 | Mercados | **Brasil E Estados Unidos**, no mesmo produto (§3) |
| 7 | Canais | **Paridade com o GoHighLevel**: e-mail, SMS, webchat, Messenger, voz — ver [`CANAIS_PLAN.md`](./CANAIS_PLAN.md) |
| 8 | Nicho | **Pendente** — recomendação fundamentada em §7 |
| 9 | Publicação de conteúdo | Produz + agenda + publica (Instagram/Facebook, TikTok) |
| 10 | Idioma do conteúdo | Bilíngue por padrão (pt-BR + en-US) |

---

## 1. A mudança de posicionamento

O tagix foi especificado como SaaS multi-tenant vendido a PMEs. A mudança é de canal de venda, não
de produto: ele passa a ser a **plataforma de entrega de uma agência**.

| | SaaS | Agência |
|---|---|---|
| Quem configura | o cliente, sozinho | você, uma vez por cliente |
| O que o cliente compra | acesso a software | resultado |
| Onde está a margem | assinatura × contas | pacote fechado ÷ **horas por cliente** |
| O que trava a escala | aquisição e churn | **custo marginal de cada cliente novo** |

Consequência arquitetural direta: **tudo que reduz o custo marginal de um cliente novo tem
prioridade sobre tudo que reduz o atrito de auto-cadastro.** Self-serve signup e catálogo de planos
viram secundários; template de workspace e valores por conta viram críticos.

---

## 2. Correção — sobre "o Aparecer é o diferencial"

Você perguntou o que aquele parágrafo queria dizer. Ele estava mal escrito e afirmava mais do que
eu podia sustentar. A frase correta é o **oposto** do que você entendeu:

**Não, não estão fazendo isso lá.** O modelo estudado no research (Theo/GoHighLevel) para no
tráfego pago — todo o entregável dele é anúncio, landing page, CRM e automação. Conteúdo não
aparece uma única vez nos 24 minutos.

Mas a versão original ("ninguém empacotou") era absolutista demais. O quadro real é este:

| O que existe hoje | O que falta |
|---|---|
| Ferramentas genéricas de conteúdo com "brand voice" — um campo de texto onde você descreve seu tom. Produz média do treino, não a sua voz | Voz **extraída de evidência** (o material que a pessoa já produziu), versionada e criticável |
| Ferramentas de corte automático de vídeo longo — boas no corte, cegas no que o negócio precisa dizer | Corte que sai de uma **tese aprovada**, não de um pico de energia no áudio |
| Agências artesanais que fazem conteúdo bem, cobrando caro, sem escala | O mesmo trabalho como **pipeline replicável** |
| Plataformas de agência (GHL e similares) com CRM + automação + anúncio | Conteúdo dentro da mesma plataforma que já tem **as conversas reais do cliente** como matéria-prima |

O diferencial defensável não é "fazemos conteúdo". É a **combinação**: a plataforma que atende o
cliente final já tem as perguntas reais que ele recebe, as objeções que perde, o vocabulário do
dono. Nenhuma ferramenta de conteúdo tem isso, porque nenhuma delas é a inbox. Essa é a frase que
eu deveria ter escrito.

---

## 3. Dois mercados, um produto

Este é o eixo arquitetural mais importante desta rodada. Brasil e EUA não são "o mesmo produto com
tradução" — divergem em canal, lei, moeda, fuso e funil. Se essa diferença virar `if (mercado ===
'US')` espalhado pelo código, o produto apodrece em seis meses. Ela precisa ser **um objeto de
configuração**.

### 3.1 Market pack

```ts
// packages/shared/src/markets.ts — fonte única, tipada, testada
interface MarketPack {
  code: 'BR' | 'US'
  currency: 'BRL' | 'USD'
  locales: readonly Locale[]        // BR: ['pt-BR']  ·  US: ['en-US', 'pt-BR']
  defaultTimezone: string
  timezonePerContact: boolean       // BR: false (1 fuso dominante) · US: true (obrigatório)
  channels: readonly ChannelKind[]
  outbound: Record<ChannelKind, OutboundPolicy>
  payments: 'abacatepay' | 'stripe'
  addressFormat / phoneFormat / taxId
}
```

`workspaces.market` decide tudo. Nenhuma regra de conformidade fora deste pacote.

### 3.2 O delta concreto

| Dimensão | Brasil | Estados Unidos |
|---|---|---|
| Canal dominante | WhatsApp, com folga | WhatsApp **dentro da comunidade brasileira**; e-mail e SMS para o público americano |
| SMS | pouco usado, caro, baixa resposta | **canal de primeira classe** — exige registro 10DLC (§4.3) |
| E-mail | relevante | crítico, e é o **único** caminho legal de prospecção fria (§4.4) |
| Lei de outbound | LGPD — base legal, finalidade, opt-out | TCPA + CAN-SPAM + leis estaduais |
| Fuso | 1 dominante | 4+ simultâneos → fuso **por contato**, não por campanha |
| Pagamento | AbacatePay / PIX (pronto) | Stripe USD (campos já reservados em `plans`) |
| Avaliações | Google Maps | Google Maps + Yelp, com regra da FTC sobre supressão |
| Idioma | pt-BR | pt-BR **e** en-US no mesmo workspace |

### 3.3 Templates por nicho × mercado

O template de workspace (o "snapshot" do research) não é por nicho — é por **nicho × mercado**.
`reforma/BR` e `remodeling/US` são o mesmo negócio com funil diferente: no Brasil o lead cai no
WhatsApp e o agente resolve; nos EUA o lead chega por formulário, recebe SMS em 60 segundos, e a
sequência de nutrição é por e-mail.

Estrutura proposta:

```
templates/
  <nicho>/
    _base.json              o que é comum ao nicho nos dois mercados
    BR.json                 canais, sequências, prompts, campos, fusos, valores
    US.json
```

Exportar/importar JSON validado por Zod, por comando. Como é ferramenta interna sua e não feature
vendida, não precisa de UI de autoria, versionamento público nem marketplace.

### 3.4 Valores personalizados por workspace

Pré-requisito do template. `{{nome_empresa}}`, `{{endereco}}`, `{{link_review}}`,
`{{meta_dataset_id}}`, `{{fuso}}`, `{{horario_funcionamento}}` referenciados dentro de flows,
prompts de agente, campanhas e e-mails. Trocar de cliente vira editar N variáveis num lugar em vez
de caçar a mesma string em cinco automações. É a diferença entre onboarding de meio dia e de uma
semana — e é a peça isolada de maior retorno sobre esforço do plano inteiro.

---

## 4. Conformidade de outbound

**Escopo, corrigido:** a prospecção fria é sua, será feita em repositório separado e depois. O tagix
**não** ganha motor de prospecção fria — some daqui a lista fria, o disparo em massa para
desconhecido e o domínio de prospecção separado.

**O que continua valendo, e é a maior parte:** o cliente da agência manda mensagem para os leads
**dele**. Nos EUA, mensagem de marketing por SMS para o lead dele exige consentimento registrado,
registro 10DLC e tratamento de revogação — mesmo o lead sendo "quente", vindo de formulário. Um
formulário preenchido só vale como consentimento se o texto exibido disser isso e você guardar a
prova.

Ou seja: §4 continua sendo pré-requisito de qualquer disparo americano. O que mudou é a **razão** —
não é mais "você vai prospectar frio", é "seu cliente vai mandar SMS, e a responsabilidade encosta
em você que operou o disparo". A seção abaixo é factual, com fonte e data.

### 4.1 O que a lei exige nos EUA

- **Consentimento prévio expresso e por escrito** para chamada ou mensagem de *marketing* a
  telefone celular. Isto continua valendo.
- Em **24/01/2025** o Eleventh Circuit **anulou** a regra de "consentimento um-para-um" da FCC, e a
  FCC removeu o texto e não recorreu. **Atenção ao escopo:** o que caiu foi a restrição de um
  consentimento servir a vários compradores (o "buraco do gerador de leads") — **não** o requisito
  base de consentimento. Quem leu a manchete e concluiu que ficou liberado, entendeu errado.
- Desde **11/04/2025** vale a regra de revogação: o consumidor pode revogar por **qualquer meio
  razoável** — você **não pode exigir** uma palavra-chave específica — e a revogação deve ser
  honrada o quanto antes, no máximo em **10 dias úteis**. É permitida **uma** mensagem de
  esclarecimento após a revogação.
- A cláusula "um STOP revoga tudo da empresa" foi adiada para **31/01/2027**.

**Consequência de desenho, e é uma boa:** casar `STOP` não basta. "any reasonable means" significa
que "para de me mandar mensagem", "não tenho interesse", "me tira daí" contam. Isso exige um
**detector de revogação por linguagem natural, em português e inglês, rodando no inbound antes do
agente** — e é exatamente o tipo de coisa que a plataforma já sabe fazer. Vira feature, não custo.

E: honrar na hora. A lei dá 10 dias úteis; provar que você honrou no nono é mais caro que honrar no
primeiro segundo.

### 4.2 Outbound frio — fora deste repositório

Fica registrado para quando você montar o outro projeto, e para que ninguém tente encaixar isso
aqui depois:

| Canal | Frio nos EUA | Por quê |
|---|---|---|
| **SMS para consumidor** | **Não** | Marketing por SMS a celular exige consentimento prévio por escrito. Não existe SMS frio legal em escala. Penalidade é por mensagem, e a litigância é ativa |
| **E-mail B2B** | **Sim** | CAN-SPAM não exige opt-in prévio. Exige remetente e assunto não enganosos, endereço físico válido e opt-out funcional e honrado |
| **Ligação manual 1:1** | Com cuidado | Sem discador automático; listas Do-Not-Call federal e estaduais se aplicam; B2B tem tratamento distinto de residencial |
| **DM fria no Instagram** | Regra de plataforma | Não é lei, é política da Meta. Risco é bloqueio de conta, não multa |

**Consequência prática para o tagix:** o produto continua precisando do motor de consentimento e do
detector de revogação (§4.4, §4.1) — porque o disparo do seu cliente para os leads dele passa pelas
mesmas regras. O que **não** entra aqui é lista fria, importação de base comprada e domínio de
prospecção. Se um dia isso aparecer num pedido, é sinal de que o outro projeto vazou para dentro
deste.

E o portão precisa ser **código, não disciplina** — a pessoa apressada às 23h não vai lembrar da
regra, e nos EUA quem opera o disparo responde junto.

### 4.3 10DLC — e o prazo escondido no onboarding

Desde **01/02/2025** as operadoras americanas **bloqueiam 100%** do tráfego 10DLC não registrado —
bloqueio, não afunilamento. Registro tem duas camadas, marca e campanha, com descrição do fluxo de
opt-in, e em 2026 as operadoras **auditam depois da aprovação**: registro é estado contínuo, não
formulário único. Prazo típico: 3–7 dias úteis por campanha, 1–4 semanas ponta a ponta.

**Isto é um item de caminho crítico de onboarding, não de engenharia.** Cliente americano que
assina hoje só manda SMS em 1 a 4 semanas. O runbook de onboarding tem que abrir o registro no
**dia 1**, antes de qualquer configuração de funil.

### 4.4 O motor de consentimento

**O que já existe:** `contacts` tem `marketing_opt_in` (booleano), `opt_in_method`, `opt_in_source`,
`opt_in_at`, `opt_out_at` e `opt_out_reason`. A intuição estava certa desde o início — o problema é
que é **um consentimento só, para todos os canais**, e a lei americana é por canal e por finalidade.
Quem aceitou receber WhatsApp não consentiu SMS de marketing.

**O que falta:**

```
contact_consents      canal · finalidade transacional|marketing · status granted|revoked|never
                      · fonte · PROVA (texto exato exibido, URL, timestamp, IP)
                      · capturado_por · mercado
contact_suppressions  supressão global e por canal, com motivo e origem
contacts.timezone     novo — hoje o fuso é da campanha, com default America/Sao_Paulo
contacts.address      hoje é modelado para o Brasil (cep, bairro); precisa da forma US
contacts.document     CPF/CNPJ; nos EUA não há equivalente obrigatório
```

Migrar o booleano atual para `contact_consents` é migration de dados, não de schema apenas —
o valor existente vira uma linha de consentimento de canal WhatsApp com a proveniência que já
está gravada. Fazer isso **antes** de existir volume é barato; depois, não.

Portão único, chamado em três lugares (worker outbound, agendador de campanha, tools do agente):
nenhuma mensagem promocional sai sem consentimento registrado quando o market pack exigir, e a
recusa é **registrada, nunca silenciosa**. Janela horária pelo fuso do contato.

Desenhar já com escopo "empresa inteira" na revogação, mesmo antes de 31/01/2027 — implementar
depois vira migration de dados de consentimento, que é o pior tipo de migration que existe.

### 4.5 Avaliações

O padrão brasileiro de perguntar a nota e mandar o link só para quem deu 5 é **proibido** nos EUA:
Google trata como review gating e a FTC tratou supressão de avaliação negativa como prática
enganosa. Redesenho: pedir a **todos**, e abrir canal de feedback privado **em paralelo**, nunca
como desvio. Vira regra no flow engine — o handler de pedido de avaliação recusa condicional sobre
nota antes do envio do link.

---

## 5. Economia unitária a US$ 800

### 5.1 A estrutura

```
Receita                                    US$ 800 / cliente / mês
Verba de anúncio                           REPASSE — cartão do cliente, na conta dele
                                           Nunca no seu cartão, em nenhuma hipótese

COGS alvo ≤ 20%                            US$ 160
  IA (conteúdo + agente + voz)                    50
  Transcrição + renderização                      15
  E-mail + SMS (+ taxas fixas 10DLC)              20
  Infra amortizada (VPS, R2, Postgres)            25
  Reserva                                         50
Margem bruta                               ~80%, antes do seu tempo
```

### 5.2 Onde isso quebra

O custo que mata não é o de IA — é o **seu tempo**. A US$ 800 com gestão de Google Ads e Meta Ads
inclusa, o ponto de equilíbrio fica em torno de **2–3 h/cliente/mês depois do onboarding**. Se
passar disso, o problema não é o preço: é que o template não está pronto.

Duas travas que eu colocaria explicitamente:

1. **Gestão de anúncios inclusa é oferta de lançamento, com prazo.** Vale para os primeiros 3–5
   clientes, para você aprender o funil do nicho com dinheiro real. Depois vira linha separada ou
   percentual da verba — senão você trava a operação em trabalho manual que não escala e que nenhum
   template resolve.
2. **Verba de anúncio nunca passa pela sua conta.** Além do risco de crédito, financiar anúncio de
   cliente transforma sua agência em banco de um negócio local — e é assim que agência boa quebra.

### 5.3 Teto de IA e budget guard

`workspace_ai_budgets`: teto mensal por workspace, alerta em 70%, **corte antes da chamada** (não
depois — estimar o custo, comparar com o saldo, recusar se furar). Teto por peça de conteúdo além
do teto mensal. Custo real vai para `llm_usage_logs`, que já existe. Ponto de partida: US$ 50/mês
por cliente, ajustado com medição real após os três primeiros.

---

## 6. Meta Business Manager

Sua decisão — BM da agência com acesso delegado — está certa, com uma precisão que vale travar
agora porque o custo de errar aparece só na saída do cliente:

**O BM da agência é _parceiro_ nos ativos, e o cliente é _dono_ da Página, do Instagram, do
dataset (pixel) e, quando possível, da conta de anúncios.** Você recebe acesso delegado; não
titularidade.

- **Antipadrão:** o BM da agência ser *dono* da Página ou do pixel do cliente. Quando o cliente sai,
  ou ele perde o histórico de conversão dele, ou vocês têm uma negociação feia. A Meta também
  desencoraja.
- **Exceção pragmática:** cliente sem BM nenhum — você cria a conta de anúncios sob o seu BM e
  concede acesso. Página e Instagram continuam do cliente, sempre.
- **Não confundir com o Tech Provider.** O tagix já é Tech Provider da Meta para mensageria; é um
  app separado do BM de anúncios. Dois eixos, duas configurações.

**Efeito no produto:** o send-back de conversão precisa de dataset e token **por cliente**, guardado
em `channel_secrets` (AES-256-GCM já existe), referenciado como valor personalizado
`{{meta_dataset_id}}` / `{{capi_token}}`. É o mecanismo do research, com criptografia decente.

### 6.1 Sobre incluir anúncio "na ferramenta"

Duas leituras, duas respostas:

- **Incluir o serviço no pacote:** sim, §5.2, com prazo.
- **Construir um gerenciador de anúncios dentro do tagix:** não. É reconstruir Ads Manager e Google
  Ads, e nada disso te diferencia.

O que o produto precisa é o que fecha a narrativa de resultado, e só:

1. **Send-back de conversão** — Meta CAPI e Google offline conversions, disparados pelas transições
   de pipeline (agendou, compareceu, vendeu). É o que muda a conversa de "custo por lead" para
   "custo por venda".
2. **Leitura de desempenho no dashboard** — investimento, custo por lead, custo por agendamento,
   custo por venda, por campanha. Somente leitura.

Criação e otimização continuam nos gerenciadores nativos, onde já são melhores do que qualquer
coisa que você construiria.

---

## 7. Nicho — recomendação

Você pediu ajuda para escolher. Os critérios que importam, nesta ordem:

1. O cliente final tem ticket que **torna US$ 800 obviamente barato**
2. Volume de donos brasileiros no nicho, nos dois mercados
3. O gargalo dele é **lead e agendamento** — que é o que a plataforma já resolve melhor
4. Conteúdo tem matéria-prima **abundante e gratuita**
5. **Foto importa** (você vai construir a F62)
6. Regulação leve — sem restrição de promessa
7. Sazonalidade baixa

### Recomendação: reforma e construção residencial

*Remodeling, pintura, piso, drywall, telhado, landscaping.* Nos EUA, começando pela **Flórida**;
no Brasil, o mesmo nicho com o template `reforma/BR`.

**Por quê:**

- **A conta de ROI se fecha na primeira reunião.** Uma cozinha de US$ 15–30 mil, um telhado de
  US$ 10–25 mil. **Um** job fechado paga um a dois anos de agência. Nenhum outro nicho torna a
  venda tão fácil.
- **Presença brasileira massiva** em construção nos EUA — Flórida, Massachusetts, Nova Jersey,
  Connecticut, Geórgia. E no Brasil o nicho é universal, o que valida o market pack de verdade.
- **Speed-to-lead decide.** Quem pede orçamento de reforma pede três. Quem responde primeiro ganha.
  É literalmente o que a plataforma faz melhor, e é um argumento de venda que se demonstra em 60
  segundos numa call.
- **Matéria-prima de conteúdo infinita e de graça.** Antes/depois, obra andando, erro comum, "por
  que esse orçamento é mais caro". O celular do dono já está cheio disso e ele não usa.
- **A foto é a feature.** Foto de obra é sempre ruim: contraluz, grande angular torta, entulho no
  canto. Correção de exposição, verticais e céu entrega valor visível no primeiro dia. Casa
  exatamente com a trilha "ambiente/serviço" da F62, incluindo a regra de antes/depois receber o
  mesmo tratamento.
- **Regulação leve.** Licenciamento estadual de contractor existe, mas não há restrição de promessa
  como em saúde, imigração ou financeiro.
- **Bilíngue com motivo real.** O dono atende a comunidade brasileira **e** o cliente americano. É
  o caso que mais justifica a voz calibrada em dois idiomas.

**Riscos e como tratar:**

| Risco | Tratamento |
|---|---|
| Sazonalidade em estado frio | Começar pela Flórida, onde há obra o ano todo |
| Ciclo de venda longo — o cliente julga por job fechado, não por lead | É exatamente o que o send-back de conversão e o dashboard de pipeline resolvem (§6.1) |
| Contractor desorganizado não responde o lead | É o argumento de venda do agente, não um obstáculo |
| Ticket alto atrai concorrência de agência americana | Você compete em português, com quem prefere fechar em português. Essa é a vantagem estrutural |

### Segundo template, depois: estética e beleza

Salão, sobrancelha, lash, estética. Presença brasileira enorme, agendamento é o coração do negócio,
altamente visual, recorrência alta. Fica em segundo porque o ticket final é baixo (US$ 50–300),
então US$ 800 exige volume — venda mais difícil — e parte do nicho escorrega para *med spa*, que é
regulado.

### O que eu não começaria

| Nicho | Por quê |
|---|---|
| Restaurante e alimentação | Margem não paga US$ 800 com folga, e o valor ali é marca, não lead — é o pior encaixe para um produto de lead e agendamento |
| Imigração e contabilidade | Promessa regulada; risco de exercício não autorizado da advocacia |
| Clínicas médicas e odontológicas | HIPAA + promessa regulada. Ticket ótimo, complexidade alta demais para o primeiro |
| Corretores de imóveis | Mercado de ferramenta saturadíssimo e comissão demorada |

### Quantos: **um**

Um nicho, um mercado, 3–5 clientes, um template. O segundo nicho só depois do primeiro template
sobreviver a três clientes **sem virar customização**. Esse é o teste — se o cliente 3 exigiu tanto
ajuste quanto o cliente 1, o template não existe, e abrir o segundo nicho só multiplica o problema.

---

## 8. Ordem de execução

```
F57 / F58   fechar o que está aberto (CI, supply chain, deploy, campanhas)
                                      ↓
F59  Fundação de mercado + conformidade
     market packs · fuso por contato · motor de consentimento · detector de
     revogação em NL · valores personalizados por workspace
                                      ↓
F60  Canais de paridade                   ← e-mail P0, webchat P1, SMS/10DLC P1
     ver CANAIS_PLAN.md
                                      ↓
F61  Aplicativo do cliente (PWA)          ← barato: a F36 já entregou a base
     ver APP_MOBILE_PLAN.md
                                      ↓
F62  Voz de marca            ─┐
F63  Estratégia de conteúdo   │  Content Studio — o diferencial
F64  Studio de material       │  ver CONTENT_STUDIO_PLAN.md
F65  Fotos                    │
F66  Calendário e publicação ─┘
                                      ↓
F67  Template de workspace + send-back de conversão + dashboard de anúncios
F68  Stripe USD (só quando houver auto-serviço)
```

**Por que conformidade e canais vêm antes do conteúdo.** Não por preferência — por consequência.
Mesmo sem prospecção fria (§4.2), o disparo do seu cliente para os leads dele nos EUA passa por
consentimento registrado, 10DLC e revogação; operar isso sem portão cria passivo por mensagem para
quem operou. E o conteúdo, que é o diferencial, vende o **segundo** contrato: o primeiro se fecha
com atendimento e velocidade, que já estão prontos.

**Por que o app entra antes do Content Studio.** É a fase mais barata da lista — a F36 já entregou
34 telas responsivas, manifest e casca mobile; falta service worker, push, instalação e a visão de
dono. E é o que o cliente **abre todo dia**: o produto que ele sente é o do telefone, não o do
desktop que ele nunca abre. Retenção por poucas semanas de trabalho, antes de meses de conteúdo.

**Prazos externos, começam no dia 1 e não dependem de código:** registro 10DLC (1–4 semanas por
cliente), App Review da Meta para publicação de conteúdo, app do TikTok.

**Stripe fica por último de propósito:** como agência, você cobra por contrato — nota, Stripe
direto, ACH. Cobrança dentro da plataforma só é necessária quando o cliente se auto-serve.

---

## 9. Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| Disparo frio antes do motor de consentimento | Passivo por mensagem, no seu cliente e por tabela em você | F59 antes de qualquer campanha americana. Portão em código |
| Agência generalista | Template não fecha, margem some, o plano perde a premissa | §7 — um nicho, teste dos três clientes |
| Gestão de anúncios sem prazo | Sua semana vira operação de tráfego; nenhum template resolve | §5.2 — oferta com data de revisão |
| Verba de anúncio no seu cartão | Risco de crédito que quebra agência boa | Repasse, sempre |
| Compliance espalhada em `if` | Apodrece em 6 meses; um mercado quebra o outro | Market pack como fonte única (§3.1), testado |
| Conteúdo genérico | Churn no mês 2 | Voz por evidência + crítica editorial (`CONTENT_STUDIO_PLAN` §3, §10) |
| Plataforma vira produto de um cliente só | Cada pedido vira feature; volta a dívida do v1 | Todo pedido entra como slot com `files_allowed`. Sem atalho fora do `PROTOCOL.md` |
| F57/F58 param | Base instável embaixo do módulo novo | Fechar antes de abrir a F59 |

---

## 10. O que este plano NÃO propõe

Fronteira explícita: nada aqui propõe construtor de landing page, white-label revendido, hierarquia
agência→subconta, marketplace de templates, gerenciador de anúncios dentro do produto, nem
substituir o AbacatePay. Se algum entrar, entra como decisão nova e documentada — não por deriva.

---

## 11. Ainda em aberto

1. **Praça inicial:** Flórida é a minha recomendação (§7). Confirmar muda o fuso padrão, o
   licenciamento a validar e a sazonalidade do funil.
2. **Volume-alvo no primeiro ano.** Define se o template precisa suportar 5 ou 50 clientes — e
   isso muda o quanto vale automatizar o onboarding.
3. **Quem opera o disparo americano.** Se o SMS sai da conta do cliente, sob o 10DLC dele, o risco
   é primariamente dele. Se sai de infraestrutura sua, você entra junto. A decisão muda o desenho
   do onboarding de canal, não só o contrato.

**Resolvido em 2026-09-08:** o outbound frio é prospecção sua, em repositório separado, depois
(§4.2). Sai do escopo deste produto — o que fica é o motor de consentimento, que o disparo do
cliente exige de qualquer forma.

---

## Fontes

Fatos regulatórios verificados em 2026-09-08:

- [Eleventh Circuit Vacates FCC's TCPA One-to-One Consent Rule — Morrison Foerster](https://www.mofo.com/resources/insights/250130-eleventh-circuit-vacates-fcc-s-tcpa-one-to-one-consent-rule)
- [FCC Repeals One-to-One Consent Rule Following Eleventh Circuit Decision — Womble Bond Dickinson](https://www.womblebonddickinson.com/us/insights/blogs/fcc-repeals-one-one-consent-rule-following-eleventh-circuit-decision)
- [The TCPA's New Opt-Out Rules Take Effect on April 11, 2025 — Bryan Cave Leighton Paisner](https://www.bclplaw.com/en-US/events-insights-news/the-tcpas-new-opt-out-rules-take-effect-on-april-11-2025-what-does-this-mean-for-businesses.html)
- [FCC partially delays new TCPA consent revocation rules — Nixon Peabody](https://www.nixonpeabody.com/insights/alerts/2025/04/11/fcc-partially-delays-new-tcpa-consent-revocation-rules)
- [A2P 10DLC Compliance: 2026 Registration & Approval Guide — JustCall](https://justcall.io/blog/10dlc-compliance-guide.html)
- [A2P 10DLC Compliance in 2026: What's Changed — Apten](https://www.apten.ai/blog/a2p-dlc-compliance-2026)

Nada aqui é aconselhamento jurídico. Antes do primeiro disparo americano, validar §4 com advogado
de TCPA — o custo de uma consulta é ordens de grandeza menor que o de uma ação coletiva.
