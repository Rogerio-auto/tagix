# Runbook — Meta App Review (Instagram Messaging)

> **Quando:** antes de tirar o canal Instagram do Dev Mode (pré-disparo comercial — F1.5).
> **Postura:** Highermind como **Tech Provider** único (mesmo Meta App de WhatsApp).
> **Pré-requisitos:** app já em produção para WhatsApp; webhook único `/webhooks/meta` no ar;
> Business Verification concluída no Meta Business Manager.

---

## 1. Objetivo

Submeter à Meta o conjunto de permissions Instagram que o produto usa, com caso de uso,
justificativa e screencast por permission. Sem App Review aprovada, o app só envia/recebe
para contas de teste (Dev Mode) — inviável para clientes reais.

## 2. Permissions a submeter

| Permission | Para quê (caso de uso no tagix) | Justificativa para a Meta |
|---|---|---|
| `instagram_basic` | Ler perfil da IG Business Account vinculada (id, username) no connect e na inbox. | Identificar a conta conectada e exibir o @handle ao operador. |
| `instagram_manage_messages` | Receber DMs/story replies/story mentions e responder dentro da janela de mensagens. | Atendimento conversacional 1:1 iniciado pelo usuário (opt-in implícito). |
| `instagram_manage_comments` | Listar, responder (público/DM), ocultar e excluir comentários em posts/reels. | Moderação de comentários sob posts do próprio cliente, por operadores autorizados. |
| `pages_show_list` | Listar as Páginas FB do usuário no wizard de conexão. | Selecionar a Página vinculada à IG Business Account. |
| `pages_manage_metadata` | Inscrever a Página + IGBA no webhook do app (subscription). | Habilitar recebimento de eventos IG no webhook unificado. |
| `pages_messaging` | Enviar mensagens via a Página vinculada (Messenger Platform underlying IG). | Entregar respostas do operador/agente ao usuário. |
| `business_management` | Operar sob o Business do cliente (Tech Provider). | Conexão multi-tenant gerida pelo Highermind. |

> **`instagram_manage_comments` é o item mais escrutinado.** Preparar screencast dedicado
> (ver §4) mostrando que a moderação é sempre sobre posts do próprio cliente e por um operador
> com permissão (`owner`/`admin`/`supervisor`), nunca em massa nem em contas de terceiros.

## 3. Checklist de submissão

- [ ] App em **Live Mode** para WhatsApp (histórico de uso legítimo ajuda a IG review).
- [ ] **Business Verification** aprovada.
- [ ] **Data Deletion / Data Handling**: URL de política de privacidade + endpoint de data deletion publicados.
- [ ] **Webhook** configurado e respondendo `200` em < 5s ao challenge GET e ao POST.
- [ ] Conta de teste IG **Business/Creator** (Personal é rejeitada pelo connect — §2.5 do código).
- [ ] Para cada permission: **caso de uso escrito** (tabela §2) + **screencast** (§4).
- [ ] App Settings → **App Review → Permissions and Features**: solicitar cada permission acima.
- [ ] Texto do "How will your app use this permission?" copiado da coluna Justificativa.

## 4. Screencasts por permission (roteiro)

Cada screencast deve mostrar o fluxo **de ponta a ponta**, com login real e dados reais (mascarar PII na edição):

1. **Connect (instagram_basic, pages_show_list, pages_manage_metadata, business_management):**
   wizard → Facebook Login com scopes combinados → seleção de Página + IGBA → subscription do webhook
   → mensagem de teste → `is_active=true`.
2. **DM (instagram_manage_messages, pages_messaging):** usuário envia DM ao IG do workspace →
   conversa aparece na inbox → operador responde dentro da janela 24h.
3. **Comentários (instagram_manage_comments):** usuário comenta num post do workspace →
   comment thread aparece na inbox → operador responde publicamente, responde por DM (comment-to-DM),
   oculta e exclui (com confirmação) — deixando claro que tudo é sobre post do próprio cliente.

## 5. Pontos que costumam reprovar (mitigação)

| Motivo comum de reprovação | Como evitamos |
|---|---|
| Permission sem caso de uso claro/visível no screencast | Roteiro §4 cobre cada permission explicitamente. |
| Moderação de comentários parecendo abuso/spam | Mostrar gate de permissão e que é sobre o próprio post; nunca ação em massa. |
| Envio proativo fora da janela sem justificativa | Demonstrar enforcement de 24h + MESSAGE_TAG (HUMAN_AGENT) com banner de aviso. |
| Webhook lento (> 5s) | Webhook só enfileira e responde 200; processamento é assíncrono nos workers. |
| Falta de data deletion | Endpoint e política publicados antes da submissão. |

## 6. Pós-aprovação

- Mudar o app para **Live Mode** no IG.
- Monitorar `instagram_manage_comments` (a Meta pode revisar periodicamente) — manter
  o módulo de comments atrás da feature flag `IG_COMMENTS_ENABLED` (INSTAGRAM.md §17) para
  desligar sem derrubar o DM core caso a permission seja revogada.
- Rotação anual do System User token (INSTAGRAM.md §15) — cron mensal testa validade.
