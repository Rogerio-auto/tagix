# Fichas por permissão — lote 1

> Uma ficha por permissão. O bloco **"Texto para o formulário"** vai colado no campo *"How will
> your app use this permission?"*. Está em inglês porque a equipe de revisão da Meta lê em inglês;
> a ficha em português ao lado é para conferência.
>
> Regra de cada texto: diz **quem** usa (o dono do negócio que conectou a própria conta), **o
> quê** o app faz com a permissão, **onde** isso aparece no app, e **o que o app não faz**. O vídeo
> citado mostra exatamente isso.

Contexto comum, para abrir o formulário (campo de descrição do app):

```text
Leadium is a customer service and sales platform for small businesses. A business owner
connects their own WhatsApp Business account, Instagram professional account and Facebook
Pages to Leadium, and their team answers customers from a single inbox, organizes leads in a
sales pipeline and can turn on an AI assistant that hands the conversation to a human when the
customer is ready to buy. Leadium only acts on assets the business owner connected and
authorized, and every action is performed by the business or on its explicit behalf.
```

---

## WhatsApp

### `whatsapp_business_management`

- **No produto:** no Embedded Signup, ler a conta do WhatsApp Business e o número escolhido pelo
  cliente; inscrever a WABA no webhook; sincronizar os modelos de mensagem e mostrar o estado de
  cada um na tela de modelos (F58).
- **Vídeo:** W1 (conectar) e W3 (modelos).

```text
After the business owner completes WhatsApp Embedded Signup inside Leadium (Settings >
Channels > Connect > WhatsApp), we use this permission to read the WhatsApp Business Account
and the phone number they selected, to subscribe that account to our webhook, and to list and
sync the account's message templates. Templates are shown in Leadium (Settings > Channels >
Message templates) with
their approval status, so the business can see what it is allowed to send and create new
templates for Meta review. We only access the WhatsApp Business Accounts the owner shared with
Leadium during Embedded Signup.
```

### `whatsapp_business_messaging`

- **No produto:** receber as mensagens dos clientes do negócio na inbox e enviar as respostas
  do atendente (ou do assistente de IA), dentro da janela de 24 h ou com modelo aprovado fora dela.
- **Vídeo:** W2 (conversa).

```text
Leadium receives the messages that customers send to the business's WhatsApp number and shows
them in the business's inbox. The business's team, or an AI assistant the business configured,
replies from Leadium. Free-form replies are only sent inside the 24-hour customer service
window; outside it, the composer is blocked and only approved message templates can be sent.
Leadium never messages people who have not contacted the business or opted in.
```

### `business_management`

- **No produto:** operar como Tech Provider sob o Business do cliente: acessar os ativos
  (WABA, Páginas, conta do Instagram) que ele compartilhou na conexão.
- **Vídeo:** W1 e I1 (os dois mostram a escolha do Business e dos ativos).

```text
Leadium is a Tech Provider: each business connects its own Business Manager assets (WhatsApp
Business Account, Facebook Pages, Instagram professional account) to Leadium. We use this
permission to read the business assets the owner selected during login and to manage the
connection on their behalf. Leadium does not create, edit or remove anything in the business's
Business Manager beyond the asset subscriptions needed for the features the owner enabled.
```

---

## Instagram — mensagens e comentários

> Só entra no lote 1 com o **F69-S08** fechado (caminho de login confirmado).
> O runbook antigo listava `pages_messaging`: **não pedir** — o código não a usa.

### `instagram_basic`

- **No produto:** identificar a conta profissional conectada (id, @usuário, foto) e mostrar
  o @ na lista de canais e na inbox.
- **Vídeo:** I1.

```text
When the business owner connects their Instagram professional account to Leadium (Settings >
Channels > Connect > Instagram), we read the account's ID, username and profile picture to
identify the connected account and display its @handle to the business's team in the channel
list and in the inbox.
```

### `instagram_manage_messages`

- **No produto:** receber DMs, respostas e menções a stories na inbox e responder dentro da
  janela de mensagens.
- **Vídeo:** I2.

```text
Leadium receives Instagram Direct messages, story replies and story mentions sent to the
business's professional account and shows them in the business's inbox, where the business's
team (or its AI assistant) replies. Replies are only sent to people who messaged the business
first, within Instagram's messaging window.
```

### `instagram_manage_comments`

- **No produto:** listar os comentários nos posts e reels **do próprio cliente**, responder em
  público ou por DM, ocultar e excluir — sempre por um operador com permissão, um por vez.
- **Vídeo:** I3 (dedicado — é a permissão mais escrutinada).

```text
Leadium shows the comments left on the business's own Instagram posts and reels, so the
business's team can answer them in public, move the conversation to a private message, or hide
or delete spam and offensive comments. Every action is taken by a team member with the right
role, one comment at a time, and only on content published by the connected business account.
Leadium has no bulk moderation and never acts on other accounts' content.
```

### `pages_show_list`

- **No produto:** listar as Páginas do Facebook do usuário para ele escolher a Página ligada à
  conta do Instagram (I1) e a Página que recebe os leads (L1).
- **Vídeo:** I1 e L1.

```text
During connection we list the Facebook Pages the business owner manages, so they can choose
the Page linked to their Instagram professional account and the Pages whose lead ads should
deliver leads to Leadium. We only use Pages the owner explicitly selects.
```

### `pages_manage_metadata`

- **No produto:** inscrever a Página escolhida no webhook do app — eventos do Instagram (I1) e
  leads dos formulários (`leadgen`, L1). Sem ela, nada chega em tempo real.
- **Vídeo:** I1 e L1 (mostrar a Página passando a "recebendo").

```text
After the business owner selects a Page in Leadium, we subscribe that Page to our app's webhook
so that new Instagram messages and comments and new lead form submissions reach the
business's inbox in real time. We only subscribe the Pages the owner selected, and when the
owner removes a Page in Leadium we stop processing that Page's events.
```

---

## Leads dos anúncios

### `leads_retrieval`

- **No produto:** quando chega um lead de formulário, buscar os campos que a pessoa preencheu e
  o texto do termo de consentimento do formulário; criar contato, conversa, card no funil e aviso
  de lead novo. Reconciliação a cada 15 min para não perder lead.
- **Vídeo:** L2.

```text
When someone submits one of the business's lead ad forms, Leadium retrieves the answers they
entered and the form's consent text, and creates the contact, a conversation and a card in the
business's sales pipeline so the team can call or message the lead within seconds. The form's
consent text is stored with the lead as proof of consent. Leadium also re-checks the forms
every 15 minutes so no paid lead is lost if a webhook delivery fails.
```

### `pages_manage_ads`

- **No produto:** listar os formulários de lead da Página (`/{page}/leadgen_forms`) na
  reconciliação e associar cada lead ao formulário de origem.
- **Vídeo:** L2 (mostrar o lead com o formulário de origem).

```text
Leadium reads the list of lead forms that belong to the business's connected Page, so it can
match each lead to the form it came from and re-check those forms for leads that were not
delivered by webhook. Leadium does not create, edit or delete ads or forms.
```

### `pages_read_engagement`

- **No produto:** obter o token da Página escolhida e ler seus dados básicos (nome) para a
  conexão de leads.
- **Vídeo:** L1.

```text
After the business owner selects a Page to receive lead ads, Leadium reads the Page's basic
information and obtains the Page access token needed to receive and retrieve that Page's leads.
The Page name is shown in Leadium's list of Pages receiving leads.
```

### `pages_show_list` / `pages_manage_metadata`

Mesmas fichas da seção do Instagram (o texto já cobre os dois usos). No formulário a Meta pede
**um** texto por permissão — usar o texto da seção do Instagram, que menciona leads e Instagram.

### `ads_management` — fora do lote 1

Ver README §4.3: nenhuma tela de leads a usa. Pedir no lote 2, com o F69-S05.

---

## Molde para os lotes 2 e 3

````markdown
### `<permissão>`

- **No produto:** <o que faz, em linguagem de dono, e em que tela>.
- **Vídeo:** <id do roteiro em screencasts.md>.

```text
<Who uses it> ... <what Leadium does with it> ... <where it appears in the app> ...
<what Leadium never does with it>.
```
````
