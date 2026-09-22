# Integração Meta — os casos de uso do app Leadium e o App Review

> **Status:** planejado em 2026-09-14 · **Fase:** F69
> **Pedido:** adaptar o sistema aos casos de uso configurados no app Meta "Leadium"
> (`developers.facebook.com/apps/1241342414558641`) para submeter ao App Review e ir a produção.
> **Relaciona:** `AGENCIA_PLAN.md` §6 (Meta Business Manager), `CONTENT_STUDIO_PLAN.md` §7
> (publicação), `CANAIS_PLAN.md`, `docs/runbooks/meta-app-review-instagram.md`.

---

## 1. O escopo

O app tem sete casos de uso. **Cinco entram**, dois ficam de fora por decisão do Rogério:

| Caso de uso no app | Entra? | O que é para o produto |
|---|---|---|
| Criar e gerenciar anúncios com a API de Marketing | ✅ | Ler resultado e operar campanhas das contas de anúncio dos clientes |
| Capturar e gerenciar leads de anúncios | ✅ | Lead do formulário cair na inbox em segundos — o número que fecha venda |
| Conectar-se com clientes pelo WhatsApp | ✅ | **Já existe** (Embedded Signup, coexistência, modelos) — falta só o kit de review |
| Gerenciar mensagens e conteúdo no Instagram | ✅ | DM e comentários **já existem**; publicação de conteúdo **não** |
| Criar e gerenciar anúncios com o servidor MCP de anúncios | ✅ | Agente de IA operando anúncio, com aprovação humana |
| Anuncie no seu app com o Meta Audience Network | ❌ | Monetização de app próprio — não é o negócio |
| Campanhas de arrecadação de fundos | ❌ | Será removido do app |

> **Leitura do pedido.** O Rogério escreveu "menos os últimos dois", mas descreveu os dois como
> "a parte de aplicativo" e "arrecadação de fundos". Na tela, os dois últimos são Audience Network
> e **servidor MCP**. Segui a descrição, que é específica: saem Audience Network e arrecadação; o
> servidor MCP **entra**. Se a intenção era tirar o MCP, basta não executar o F69-S09.

---

## 2. O que já existe e o que falta

Levantado no código em 2026-09-14:

| Peça | Situação |
|---|---|
| WhatsApp: Embedded Signup (`FB.login` com `config_id`), coexistência, envio, modelos HSM | ✅ em produção |
| Instagram: DM, story reply/mention, comentários (listar, responder, ocultar, excluir) | ✅ código pronto |
| Webhook único `/webhooks/meta` | ✅ trata `whatsapp_business_account`, `instagram` e — desde a F69-S03 — `page` (campo `leadgen`) |
| Escopos pedidos no login do Instagram | `pages_show_list, pages_manage_metadata, instagram_basic, instagram_manage_messages, business_management` |
| **Callback de exclusão de dados** | ❌ **não existe** — e sem ele o App Review reprova |
| Lead Ads (`leadgen`) | ✅ F69-S03 (2026-09-15): assinatura da página, busca imediata com retry, reconciliação a cada 15 min, contato + conversa + card + aviso, termo do formulário guardado como prova. **Bloqueio de 2026-09-22 (§4.1):** o app não tem `pages_manage_metadata`, então `subscribed_apps` falha e **o webhook de lead não chega para ninguém** — nem com função no app. Ler lead por formulário não depende dela ([Retrieving Leads](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving): exigida "if using webhooks"), então a saída é o modo reconciliação da F69-S13 até o App Review. Pendente também: concessão de canal a partir das caixas (F69-S11) |
| Marketing API (contas de anúncio, insights, gestão) | ❌ |
| Envio de conversão de volta para a Meta | ❌ |
| Instagram — publicação de conteúdo | ❌ |
| Servidor MCP de anúncios | ❌ |

---

## 3. Permissões por caso de uso

Fatos voláteis, verificados em 2026-09-14. **Antes de submeter, confirmar cada nome no painel
"Permissões e recursos" do próprio app** — a Meta renomeia permissões com frequência, e o nome
exibido no painel é o que vale.

| Caso de uso | Permissões | Fonte |
|---|---|---|
| Leads de anúncios | `leads_retrieval`, `pages_manage_ads`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, `ads_management` | [Meta — Lead Ads](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads), [Webhooks for Leads](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/) |
| API de Marketing | `ads_read`, `ads_management`, `business_management` — com **Advanced Access** e **Business Verification** | [Meta — atualização do Ads Management Standard Access](https://developers.meta.com/blog/updates-to-ads-management-standard-access-feature/) |
| Servidor MCP de anúncios | `ads_mcp_management` com **Advanced Access** quando opera contas de **outras empresas** (é o nosso caso: agência) | [PPC Land, 2026-07-16](https://ppc.land/meta-opens-ads-mcp-to-any-app-cutting-integration-code-to-zero/) |
| Instagram — conteúdo | publicação exige permissão de *content publish* aprovada; operar contas que não são suas exige Advanced Access | [Postproxy, 2026](https://postproxy.dev/blog/post-to-instagram-via-api/) |
| WhatsApp | `whatsapp_business_management`, `whatsapp_business_messaging`, `business_management` | já em uso |

**Advanced Access vale por permissão.** Cada uma precisa de justificativa própria e de um
screencast que mostre o fluxo inteiro: conectar a conta, o pedido da permissão, e a permissão
sendo usada.

### 3.1 A questão do Instagram que precisa de verificação

A Meta mantém dois caminhos para o Instagram, com nomes de permissão diferentes:

- **Instagram API com Login do Facebook** — `instagram_basic`, `instagram_manage_messages`,
  `instagram_manage_comments`, `instagram_content_publish`. É o que o código usa hoje.
- **Instagram API com Login do Instagram** — família `instagram_business_*`.

O F69-S08 existe para verificar **qual dos dois o caso de uso do app configura** e alinhar o
login antes de gravar os screencasts. Submeter com um conjunto e o login pedir o outro reprova a
revisão — e cada rodada de revisão custa semanas.

---

## 4. Requisitos de plataforma que valem para todos

Sem estes, **nenhuma** permissão é aprovada:

1. **Callback de exclusão de dados.** A Meta chama a URL com um `signed_request` quando a pessoa
   remove o app e pede exclusão. A resposta precisa trazer uma URL de acompanhamento e um código
   de confirmação. URL que devolve 404 na hora da revisão reprova.
   ([Meta — Data Deletion Request Callback](https://developers.facebook.com/documentation/development/create-an-app/app-dashboard/data-deletion-callback))
2. **Callback de desautorização** — a pessoa tirou o acesso: parar de usar o token na hora.
3. **Política de privacidade e termos** publicados e acessíveis sem login.
4. **Business Verification** concluída no Business Manager.
5. **Webhook** respondendo ao desafio `GET` e ao `POST` em menos de 5 segundos.
6. **Conta de teste** para cada fluxo que o revisor vai executar.

---

### 4.1 Configuração do login da conexão (Facebook Login for Business) — F69-S12

O app Leadium é do tipo **Business**. Nele, o login da conexão por workspace (Configurações → Meta e o
conectar do Instagram) **precisa** de uma configuração do Facebook Login for Business: o `FB.login`
usa `config_id`, e não `scope`. Com `scope`, o login abre, mas a troca do código no servidor falha com
`OAuthException 100 / 36008` ("redirect_uri is identical…") — foi o erro da primeira conexão real, em
2026-09-15. ([Meta — Facebook Login for Business](https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business))

É uma configuração **separada** da do Embedded Signup do WhatsApp (`META_CONFIG_ID`): pede outro
conjunto de permissões e não abre o cadastro de número.

**Criada em 2026-09-22.** `META_LOGIN_CONFIG_ID = 1072538632222832`
(nome `Leadium — conexão por workspace`, app `1241342414558641`, portfólio `4136770246588242`).
A do Embedded Signup do WhatsApp é a outra da lista: `7SionTech2` = `739536855573340`.

**Caminho no painel:** Painel do app → **Login do Facebook para Empresas** → **Configurações**
(o segundo item do submenu; o primeiro é o OAuth do app) → **+ Criar configuração**. URL direta:
`developers.facebook.com/apps/1241342414558641/business-login/configurations/`.

O assistente tem 5 passos, e dois deles **não podem ser alterados depois**:

1. **Nome:** `Leadium — conexão por workspace`.
2. **Variação de login:** **Geral**. A outra opção (*Cadastro incorporado do WhatsApp*) é a da
   `META_CONFIG_ID` — ela abre o cadastro de número, não serve aqui. **Irreversível.**
3. **Tipo de token de acesso:** **Token de acesso do usuário**. **Irreversível.** O painel sugere
   *token de usuário do sistema* para "acesso contínuo aos ativos", mas a implementação é de token de
   usuário: `connection.ts` troca o `code` por um token curto e faz `fb_exchange_token` para o
   long-lived, depois lê `GET /me/permissions`. Consequência aceita: o token do usuário expira em
   ~60 dias e a conexão precisa ser refeita — a tela de saúde da conexão é quem avisa.
4. **Ativos:** **o passo é pulado.** Com token de usuário o painel desabilita a seleção de ativos
   ("Não é possível selecionar ativos porque você optou por usar um token de acesso de usuário").
   Os ativos vêm do que o usuário marca no popup de login.
5. **Permissões:** o seletor **só oferece permissões que já têm nível de acesso** no caso de uso
   correspondente (*Pronto para teste* ou *Pronto para publicar*). Permissão em
   *Adicionar à análise do app* simplesmente não aparece na lista.

**Marcadas (10):** `leads_retrieval`, `pages_manage_ads`, `pages_read_engagement`, `pages_show_list`,
`ads_management`, `ads_read`, `ads_mcp_management`, `business_management`, `instagram_basic`,
`instagram_content_publish`.

**Faltando, porque o painel não as oferece** — três nomes que `permissions.ts` exige:

- **`pages_manage_metadata` — bloqueio real do fluxo de leads.** Em *Casos de uso → Capturar e
  gerenciar leads de anúncios* ela está com status vazio e ação *Adicionar à análise do app*: o app
  não tem nem acesso padrão a ela. É a permissão que autoriza `POST /{page}/subscribed_apps`
  (`apps/api/src/routes/meta/lead-sources.ts`), ou seja, **assinar a página para receber `leadgen`**.
  Sem App Review não há como assinar a página, e sem assinatura não chega webhook de lead — nem para
  quem tem função no app. Isso move o App Review de "necessário para escalar" para "necessário para o
  fluxo de lead funcionar uma vez".
- **`instagram_manage_messages` e `instagram_manage_comments` — nomes provavelmente errados.** O caso
  de uso *API do Instagram* deste app está na variante **login do Instagram**, cujas permissões se
  chamam `instagram_business_basic`, `instagram_business_manage_messages` e
  `instagram_business_manage_comments`. O seletor do login só ofereceu `instagram_basic` e
  `instagram_content_publish`. **Decidir antes de mexer no código:** manter o Instagram na variante
  *login do Facebook* (nomes legados, tokens de página — casa com o desenho atual) ou migrar para
  *login do Instagram* (nomes `instagram_business_*`, outro fluxo de token). Só depois atualizar
  `USE_CASE_PERMISSIONS.instagram`.

A configuração é **editável** depois (botão *Editar* na lista), então as três entram quando ganharem
nível de acesso — sem criar outra configuração e sem trocar o `config_id`.

**Levar para o produto:** `META_LOGIN_CONFIG_ID=1072538632222832` no `.env` de produção; o compose
mapeia para o build arg `NEXT_PUBLIC_META_LOGIN_CONFIG_ID`. É **build-time**: exige rebuild da imagem
do web, reiniciar não basta. O ID é público (vai no navegador).

As permissões de fato concedidas continuam conferidas no servidor (`GET /me/permissions`), e a tela diz
o que falta por caso de uso.

---

## 5. Decisões de desenho

1. **Lead de formulário é tratado como WhatsApp, não como planilha.** Entra na inbox, dispara o
   aviso de lead novo (F61-S04), vira card no funil e conta no tempo de resposta. É o uso que faz
   o cliente sentir o produto no primeiro dia.
2. **Lead é buscado no instante em que o webhook chega.** A Meta guarda o dado do formulário por
   90 dias; perder a busca é perder o lead sem aviso.
3. **O texto de consentimento do formulário vira prova.** Nos EUA, formulário de anúncio é a
   origem de consentimento mais comum — e a mais contestada. *Como ficou (F69-S03):* o termo e o
   texto de cada caixa são **copiados** junto do lead, com formulário e data. A concessão em
   `contact_consents` (F59-S03) espera o cliente dizer qual caixa autoriza qual canal: o texto
   da caixa é livre, e deduzir o canal dele seria afirmar um consentimento que ninguém deu.
4. **Gestão de anúncios começa por leitura.** Pausar e ajustar orçamento vêm depois, com
   confirmação e auditoria; criar campanha do zero fica para quando houver demanda medida.
   Mexer no dinheiro do cliente sem trilha é o jeito mais rápido de perder um contrato.
5. **O agente de IA nunca gasta sozinho.** Pelo servidor MCP ele sugere e prepara; toda ação que
   muda orçamento, status ou público passa por aprovação humana e por teto de gasto por workspace.
6. **Tokens por workspace, cifrados, com as permissões concedidas registradas.** Quando falta uma
   permissão, a tela diz qual e oferece reconectar — em vez de falhar no meio de uma ação.
7. **Um webhook só.** `/webhooks/meta` ganha o objeto `page` (campo `leadgen`) no mesmo
   caminho de assinatura e fila que já protege WhatsApp e Instagram. *Como ficou:* sem dedup de
   borda — o worker reserva o lead por `leadgen_id` e trava a linha, então reentrega e
   reconciliação viram duplicata inofensiva. Falha no enqueue devolve 503 para a Meta reentregar.
8. **Assinar página sem apagar o que ela já recebe.** `subscribed_apps` define a lista inteira de
   campos do app na página; a assinatura lê a lista atual e envia a união com `leadgen`.

---

## 6. Faseamento — F69

| Slot | Entrega | Depende de |
|---|---|---|
| **F69-S01** | Conformidade de plataforma: callbacks de exclusão e desautorização, política e termos públicos | — |
| **F69-S02** | Conexão Meta por workspace: login com as permissões dos casos de uso, token cifrado, permissões concedidas, reconexão guiada | S01 |
| **F69-S03** | Leads de anúncios: assinatura `leadgen`, busca imediata, contato + card + aviso, consentimento com prova | S02 |
| **F69-S04** | API de Marketing — leitura: contas de anúncio, gasto, leads, custo por lead, resultado por campanha | S02 |
| **F69-S05** | API de Marketing — gestão: pausar, ativar e ajustar orçamento, com confirmação e auditoria | S04 |
| **F69-S06** | Conversão de volta para a Meta: lead qualificado, agendado e fechado viram evento da campanha | S03, S04 |
| **F69-S07** | Instagram — publicação de conteúdo: imagem, carrossel e reels, com fila e agendamento | S08 |
| **F69-S08** | Instagram — verificar o caminho de login do caso de uso e alinhar permissões | S02 |
| **F69-S09** | Servidor MCP de anúncios: agente sugere e prepara, humano aprova, teto de gasto | S05 |
| **F69-S10** | Kit de App Review: roteiro de screencast e justificativa por permissão, contas de teste, runbook | S01–S09 |

**Ordem que eu recomendo:** S01 → S02 → **S03** → S04 → S08 → S07 → S05 → S06 → S09 → S10.
Lead de anúncio vem logo depois da conexão porque é o que muda o dia do cliente; o kit de review
fecha a fase, mas o roteiro de cada permissão é escrito junto com o slot que a usa.

**A F69 absorve a parte de anúncios da F67.** A F67 continua com o template de workspace
(`remodeling`) e o painel consolidado.

---

## 7. Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| Submeter permissão sem uso visível no screencast | Reprovação e nova rodada de semanas | Cada slot entrega o fluxo demonstrável da sua permissão |
| Nome de permissão mudar entre planejamento e submissão | Screencast gravado para o conjunto errado | §3 e F69-S08: conferir no painel do app antes de gravar |
| Agente mexer em orçamento sem supervisão | Prejuízo do cliente, contrato perdido | Aprovação humana e teto de gasto obrigatórios (§5.5) |
| Lead perdido por falha de busca | Lead pago que nunca chega | Busca imediata com retry, reconciliação periódica, alerta |
| Token de página expirar ou perder permissão | Leads param de chegar em silêncio | Saúde da conexão no painel e aviso ao dono |
