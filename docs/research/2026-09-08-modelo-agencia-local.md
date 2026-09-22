# Research — O modelo "monta uma vez, vende para todo negócio local"

> **Data:** 2026-09-08
> **Fonte:** [Theo Cavaliere — "Monte 1 Vez → Venda Para Todo Negócio Local"](https://www.youtube.com/watch?v=q4FVB200R0k) (23m51s)
> **Transcrição:** [`transcripts/2026-09-08-yt-q4FVB200R0k-theo-cavaliere.md`](./transcripts/2026-09-08-yt-q4FVB200R0k-theo-cavaliere.md)
> **Por que está aqui:** insumo para o plano de virar o tagix em produto de agência
> (ver `docs/features/AGENCIA_PLAN.md`). Documento de leitura, não de decisão.

---

## 1. O que o vídeo é

Um walkthrough de produto: como um operador de agência solo montou **um entregável replicável**
em cima do GoHighLevel (GHL) e o revendeu para negócios locais nichados por ~R$ 2.000/mês.
Alegação de resultado: 0 → R$ 24k/mês em 12 meses, sem equipe.

É conteúdo comercial (afiliado GHL, CTA de teste grátis + comunidade). O valor aqui **não é a
recomendação de ferramenta** — é o desenho operacional que ele expõe sem querer. O GHL é o
concorrente direto de referência do que o tagix seria como plataforma de agência.

---

## 2. O entregável, decomposto

O "serviço" vendido tem cinco peças. Nenhuma é sofisticada isolada; o valor está no pacote fechado.

| # | Peça | O que é | Tempo em tela |
|---|---|---|---|
| 1 | **Tráfego** | Google Ads (escolha deliberada sobre Meta Ads: "monto uma vez, quase não tem manutenção") | 00:25–01:11 |
| 2 | **Landing page** | Gerada por IA a partir de prompt/clonagem de uma LP que converte; publicada em domínio do cliente | 01:11–04:10 |
| 3 | **CRM white-label** | Inbox multicanal + pipeline + dashboard, com a marca da agência e domínio próprio | 04:11–05:08 |
| 4 | **Automações + agente IA** | 5 automações + bot de qualificação/agendamento | 05:08–20:02 |
| 5 | **Replicação** | Snapshots (templates de conta inteira) + valores personalizados | 20:28–23:47 |

### 2.1 As cinco automações (o núcleo real do produto)

1. **Novo lead / speed-to-lead** (06:17) — gatilho na primeira resposta com tag de origem →
   atribui a um usuário → joga na pipeline → notifica o cliente → manda WhatsApp → liga o agente.
   Meta explícita: **primeiro contato em menos de 60 segundos**.
2. **Confirmação + lembrete de agendamento** (15:01) — gatilho `appointment.confirmed` →
   **desliga a IA** → move o card → dispara conversão de volta pro ads → WhatsApp de confirmação
   → espera → lembrete 2h antes.
3. **No-show** (18:17) — arrastar o card para "não compareceu" dispara fluxo de remarcação.
4. **Vendido** (18:36) — arrastar para "vendido" envia a conversão de venda de volta pro ads.
5. **Pedido de avaliação Google** (18:49) — pergunta a nota por WhatsApp; **5 → manda o link
   público de review; 1–4 → não manda link, abre canal de feedback privado**.

### 2.2 O agente de qualificação (08:04–15:01)

- Prompt em três blocos: **personalidade / meta / informações adicionais**.
- Ações declarativas, não código: `agendar compromisso` (ligado a um calendário),
  `informação de contato` (extrai campos do lead da própria conversa — motivo, histórico —
  com descrição + exemplos por campo), `acompanhamento automático` (follow-ups **contextuais**,
  não mensagens pré-prontas; escadas 1h → 4h → 1d, até 5 tentativas).
- Duas escadas de follow-up separadas: "contato ocupado" e "contato solicitou horário X".
- Janela de horário permitido para follow-up.
- Multimodal ligado (interpreta imagem e áudio).
- Debounce de 7s antes de responder; teto de mensagens por conversa.

### 2.3 Replicação — a parte que importa

- **Snapshot**: template de uma subconta inteira (pipelines, automações, agentes, calendários,
  sites) que se importa em uma conta nova. Fechou cliente → cria subconta → importa snapshot.
- **Valores personalizados**: variáveis de conta (`{{pixel}}`, `{{token_capi}}`, `{{link_review}}`,
  `{{nome_empresa}}`) referenciadas dentro das automações. Trocar de cliente = editar N variáveis
  num lugar, não caçar 12 ocorrências em 5 automações.
- **Nicho obrigatório**: ele afirma explicitamente que o copy-paste só fecha se a agência for
  nichada — as "peculiaridades por cliente" precisam ser poucas para o template sobreviver.
- **White-label**: marca + domínio da agência no app, e o app mobile não carrega a marca do GHL.

---

## 3. Leitura crítica

**O que é sólido e vale copiar como princípio:**

- **O produto não é uma feature, é um pacote fechado e replicável.** A margem da agência vem da
  razão entre "vendas" e "customização por venda". Todo desenho de produto de agência é uma
  aposta em reduzir o denominador.
- **Templates de tenant inteiro + variáveis de conta.** É o mecanismo que transforma trabalho
  de projeto em trabalho de produto. Hoje o tagix não tem análogo — tem templates de *agente*
  (`agent_templates`), não de *workspace*.
- **Conversão de volta pro ads (CAPI / Google offline conversions).** É o que muda a conversa
  com o cliente de "custo por lead" para "custo por agendamento / por venda". O tagix já tem o
  domínio `conversions` no schema, mas não o send-back para as plataformas de mídia.
- **Gating de review por nota.** Detalhe pequeno, efeito grande em retenção. E é a única peça do
  vídeo que tem risco de compliance sério fora do Brasil (ver §4).
- **Desligar a IA em transição de estado.** Handoff explícito, não implícito.

**O que é fraco ou é vício de venda:**

- **"Google Ads porque não dá manutenção"** é racionalização de operação solo, não verdade de
  performance. Serve como argumento de custo operacional, não de resultado pro cliente.
- **Clonar landing page de terceiro** ("clone essa página e mantenha o máximo de detalhes") é
  passivo jurídico e, para o nosso padrão, entregável indefensável.
- **API não-oficial de WhatsApp** ("plugin que transforma SMS em WhatsApp"). Risco de ban da
  conta do cliente e violação de ToS. O tagix já decidiu o oposto: Meta Cloud API como canal de
  primeira classe, WAHA restrito a caso legado.
- **Números sem verificação.** R$ 24k/mês, 30% de conversão da LP, R$ 21/lead — tudo asserção,
  nenhuma auditável. Tratar como ordem de grandeza, não como benchmark.
- **Zero conteúdo.** O modelo inteiro depende de tráfego pago. Não há nada sobre orgânico,
  posicionamento ou produção de conteúdo — que é exatamente onde o plano do tagix diverge.

---

## 4. O que não transfere para o mercado US

O vídeo é 100% Brasil. Copiar a mecânica sem tradução regulatória quebra em quatro pontos:

| Peça | Brasil | EUA |
|---|---|---|
| Outbound por SMS/WhatsApp | LGPD + regras Meta | **TCPA**: consentimento escrito prévio, revogação por **qualquer meio razoável** (não só `STOP`), janela horária no fuso do destinatário, multa por mensagem. Registro **10DLC** obrigatório para SMS A2P |
| WhatsApp como canal padrão | Dominante | Dominante **dentro da comunidade brasileira**; marginal para público americano geral — SMS e e-mail voltam a importar |
| Pedido de avaliação com gating por nota | Prática comum | **Review gating é proibido pelo Google e pela FTC** ("review suppression"). Perguntar a nota antes e filtrar quem recebe o link é exatamente o padrão vetado. Precisa ser redesenhado: pedir a todos, e usar o canal de feedback privado em paralelo, não como desvio |
| Cobrança | PIX / AbacatePay (já integrado) | **Stripe USD** — o schema `plans` já tem `stripe_product_id`/`stripe_price_id` reservados, mas não há adapter |

Há ainda o eixo bilíngue: empresa brasileira nos EUA opera em português internamente e precisa
falar inglês com parte do público. Isso é requisito de produto, não detalhe de i18n.

---

## 5. Delta contra o tagix hoje

| Peça do modelo | Estado no tagix | Observação |
|---|---|---|
| Inbox multicanal + pipeline + dashboard | ✅ existe (F1–F5) | mais completo que o do vídeo |
| Agente IA de qualificação + agendamento | ✅ existe (F2, LangGraph + OpenRouter) | mais capaz; falta o empacotamento "3 blocos de prompt + ações declarativas" |
| Follow-up contextual multi-escada | 🟡 parcial | há `reply_if_idle_sec`; não há escada com estados "ocupado"/"horário solicitado" |
| Automações / flows | ✅ existe (flow-engine) | |
| Campanhas | ✅ existe (F58 em curso) | |
| **Snapshot de workspace** | ❌ não existe | maior lacuna de modelo de negócio |
| **Valores personalizados por conta** | ❌ não existe | pré-requisito do snapshot |
| **Hierarquia agência → subcontas** | ❌ não existe | há workspaces isolados + painel de plataforma, não parentesco |
| **White-label (marca/domínio por agência)** | ❌ não existe | DS v2 é fixo |
| **Send-back de conversão (Meta CAPI / Google)** | ❌ não existe | `conversions` existe como schema interno |
| Landing page builder | ❌ não existe | fora de escopo declarado até aqui |
| Cobrança em USD | ❌ não existe | só AbacatePay (BR) |
| **Produção de conteúdo** | ❌ não existe | não existe no modelo do vídeo também — é a divergência deliberada |

---

## 6. Conclusão para o plano

O vídeo confirma a tese econômica do serviço de agência (pacote fechado + replicação por
template + nicho) e entrega um checklist de mecânica operacional que o tagix cobre em maior
parte. As lacunas reais são de **empacotamento** (snapshot, variáveis de conta, hierarquia de
agência, white-label) e de **mercado** (Stripe USD, TCPA, bilíngue), não de capacidade técnica.

E o diferencial do plano do tagix está justamente onde o modelo do vídeo é cego: **o entregável
dele começa e termina no tráfego pago**. Conteúdo — estratégia, roteiro na voz do cliente,
material bruto virando peça publicável, foto tratada — é trabalho que hoje toda agência faz à
mão e cobra à parte, e é o candidato natural a virar o segundo módulo replicável.
