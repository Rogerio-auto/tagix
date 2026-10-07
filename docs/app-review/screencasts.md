# Roteiros dos screencasts — lote 1

> Regras que valem para todos (a Meta reprova por qualquer uma):
>
> - **Fluxo inteiro, sem corte no meio:** entrar no Leadium → conectar → a permissão sendo
>   pedida na janela da Meta → a permissão sendo usada no app.
> - **Produção** (`app.leadium.com.br`) com a conta do revisor ([conta-de-teste.md](conta-de-teste.md)).
>   Nada de `localhost`.
> - **Mostrar a tela de consentimento da Meta** com a lista de permissões legível (pausar 2 s nela).
> - **Legendas em inglês** na edição, uma por passo ("Business owner connects their WhatsApp
>   account", "The permission is used here: …"). O app está em português; a legenda é a ponte.
> - **Sem dado real:** só a conta de demonstração e as contas de teste da Meta. Borrar qualquer
>   número ou nome real que escape.
> - 1080p, cursor visível, sem música, 1 a 4 min cada. Arquivo: `<id>-<permissoes>.mp4`.
>
> Cada vídeo cobre as permissões listadas no cabeçalho. Um vídeo pode servir a várias
> permissões; no formulário, anexar o mesmo arquivo em cada uma.

---

## W1 — Conectar o WhatsApp (Embedded Signup)

**Prova:** `whatsapp_business_management`, `business_management`

1. Login no Leadium com a conta do revisor. Legenda: *"Business owner signed in to Leadium."*
2. **Configurações → Canais → Conectar** → **WhatsApp**.
3. Escolher o modo (Cloud API) → **Continuar** → **Conectar com a Meta**.
4. Janela da Meta: escolher o Business, a conta do WhatsApp Business e o número de teste.
   **Pausar na lista de permissões.**
5. De volta ao Leadium: **Nome do canal** → **Conectar WhatsApp** → toast "WhatsApp conectado".
6. A lista de canais mostra o número como **Conectado**. Legenda: *"Leadium read the WhatsApp
   Business Account and number the owner selected, and subscribed it to the webhook."*

## W2 — Conversa no WhatsApp

**Prova:** `whatsapp_business_messaging`

1. Do celular de teste, mandar "Olá, quero saber o preço" para o número conectado.
2. A conversa aparece na inbox em segundos. Legenda: *"Incoming customer message."*
3. Responder pelo composer → a resposta chega no celular (mostrar o celular).
4. Mostrar uma conversa **fora da janela de 24 h**: o composer bloqueado e o aviso de que só
   modelo aprovado pode ser enviado. Legenda: *"Free-form replies only inside the 24-hour window."*

## W3 — Modelos de mensagem

**Prova:** `whatsapp_business_management`

1. **Configurações → Canais** → no canal do WhatsApp, **Modelos de mensagem** (tela "Modelos de
   mensagem do WhatsApp", F58-S05).
2. **Sincronizar modelos** → os modelos da WABA de teste aparecem com o estado de aprovação.
3. Abrir um modelo e mostrar a prévia. Legenda: *"Templates are read from the business's own
   WhatsApp Business Account."*

---

## I1 — Conectar o Instagram

**Prova:** `instagram_basic`, `pages_show_list`, `pages_manage_metadata`, `business_management`

> Gravar **só depois do F69-S08**: o login que aparece aqui tem de ser o do caso de uso
> configurado no painel.

1. **Configurações → Canais → Conectar** → **Instagram**.
2. Login da Meta: **pausar na lista de permissões**.
3. Escolher a Página e a conta profissional de teste.
4. A lista de canais mostra o **@** da conta. Legenda: *"Leadium reads the account's ID and
   username, and subscribes the selected Page to receive messages and comments."*

## I2 — Direct do Instagram

**Prova:** `instagram_manage_messages`

1. Da conta pessoal de teste, mandar um Direct para a conta profissional.
2. A conversa aparece na inbox. Responder → a resposta chega (mostrar o app do Instagram).
3. Responder a um story da conta profissional → aparece na inbox como resposta a story.

## I3 — Comentários (vídeo dedicado)

**Prova:** `instagram_manage_comments`

> A permissão mais escrutinada. O vídeo precisa deixar claro: **post do próprio negócio**,
> **um comentário por vez**, **operador com permissão**.

1. Da conta pessoal de teste, comentar num post **da conta profissional conectada**.
2. O comentário aparece no Leadium. Legenda: *"Comments on the business's own post."*
3. **Responder em público** → mostrar a resposta no post.
4. **Responder por Direct** → mostrar o Direct.
5. Comentar "spam" de novo → **Ocultar** → mostrar oculto no Instagram.
6. **Excluir** outro comentário → confirmar no diálogo → some do post.
7. Legenda final: *"One comment at a time, by a team member with permission. No bulk actions."*

---

## L1 — Conectar a Página aos leads

**Prova:** `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`

1. **Configurações → Meta — Facebook e Instagram** → em **Casos de uso**, marcar **Leads dos
   anúncios** → **Conectar**.
2. Login da Meta: **pausar na lista de permissões**.
3. Em **Páginas recebendo** → **Adicionar página** → escolher a Página de teste.
4. Toast **"Página conectada aos leads"**. A Página aparece em **Páginas recebendo**, entregando
   em segundos. Legenda: *"The selected Page is subscribed to lead form submissions."*

## L2 — Lead chegando

**Prova:** `leads_retrieval`, `pages_manage_ads`

1. Abrir o **Lead Ads Testing Tool** da Meta
   (`developers.facebook.com/tools/lead-ads-testing`), escolher a Página e o formulário de teste
   → **Create lead**.
2. Voltar ao Leadium: o lead aparece em **Últimos leads**, com o formulário de origem.
   Legenda: *"Lead retrieved within seconds, matched to its form."*
3. Abrir o contato: os campos que a pessoa preencheu e o termo de consentimento do formulário.
4. Abrir o **Funil**: o card do lead na primeira etapa. Abrir a inbox: a conversa do lead.

---

## Checklist antes de exportar cada vídeo

- [ ] Começa com o login no Leadium e termina com a permissão em uso.
- [ ] A lista de permissões da Meta aparece legível.
- [ ] Legendas em inglês em cada passo.
- [ ] Nenhum dado real visível.
- [ ] É produção (`app.leadium.com.br` na barra de endereço).
