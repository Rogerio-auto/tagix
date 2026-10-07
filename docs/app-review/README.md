# Kit de App Review da Meta — Leadium

> **Slot:** F69-S10 · **Montado em:** 2026-10-07 · **App:** "Leadium"
> (`developers.facebook.com/apps/1241342414558641`)
> **Plano:** `docs/features/META_INTEGRACAO_PLAN.md` (§3 permissões, §4 requisitos)
> **Fonte única das permissões no código:** `apps/api/src/services/meta/permissions.ts`

Tudo o que é preciso para submeter o app: por permissão, o texto que vai no formulário da
Meta, o roteiro do screencast, a conta de teste e o fluxo que o revisor executa.

| Arquivo | Para quê |
|---|---|
| [permissoes.md](permissoes.md) | Uma ficha por permissão: o que faz no produto, o texto para colar no formulário, o screencast que a prova |
| [screencasts.md](screencasts.md) | Roteiro cena a cena de cada vídeo |
| [conta-de-teste.md](conta-de-teste.md) | Conta do revisor, workspace de demonstração por seed, contas de teste da Meta |
| [`docs/runbooks/meta-app-review.md`](../runbooks/meta-app-review.md) | O passo a passo da submissão, do pré-requisito ao pós-aprovação |

---

## 1. Quando submeter

**Depois do deploy na VPS nova.** Revisor e callbacks batem no app em produção:

- o revisor entra em `app.leadium.com.br` com a conta de teste e executa o fluxo;
- a Meta chama o webhook (`api.leadium.com.br/webhooks/meta`) e os callbacks de exclusão e
  desautorização (`api.leadium.com.br/meta/data-deletion`, `/meta/deauthorize`);
- o screencast tem de mostrar o mesmo app que o revisor vai abrir.

Hoje (2026-10-07) a produção antiga ainda responde e os endereços de conformidade já se comportam
certo (ver §3), mas ela roda um commit antigo e está congelada até a troca de VPS. Submeter
contra ela e depois trocar o código por baixo do revisor é pedir reprovação.

## 2. O que entra no 1º lote

O plano manda cada permissão ser pedida **só quando o fluxo que a usa existe e aparece no vídeo**
(risco nº 1 do §7: permissão sem uso visível reprova, e cada rodada custa semanas). Então a
submissão vai em lotes:

| Lote | Caso de uso | Permissões | Feature pronta? |
|---|---|---|---|
| **1** | WhatsApp | `whatsapp_business_management`, `whatsapp_business_messaging`, `business_management` | ✅ em produção |
| **1** | Mensagens e comentários do Instagram | `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `pages_show_list`, `pages_manage_metadata`, `business_management` | ✅ código pronto — **depende do F69-S08** (ver §4) |
| **1** | Leads dos anúncios | `leads_retrieval`, `pages_manage_ads`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement` | ✅ F69-S03 + F69-S13 |
| 2 | Resultado dos anúncios | `ads_read`, `business_management` (Advanced Access) | ❌ F69-S04 |
| 2 | Gerenciar anúncios | `ads_management`, `ads_read` (Advanced Access) | ❌ F69-S05 |
| 3 | Publicar no Instagram | `instagram_content_publish` | ❌ F69-S07 (depois do F69-S08) |
| 3 | Assistente de anúncios com IA | `ads_mcp_management` (Advanced Access) | ❌ F69-S09 |

Os lotes 2 e 3 ganham a ficha e o roteiro **junto com o slot da feature**, como o plano
determina (§6: "o roteiro de cada permissão é escrito junto com o slot que a usa"). Este kit
traz o formato; a ficha nova segue o mesmo molde de [permissoes.md](permissoes.md).

## 3. Requisitos de plataforma (§4 do plano)

Sem estes, **nenhuma** permissão é aprovada. Estado conferido em 2026-10-07 contra a produção atual:

| # | Requisito | Onde | Estado |
|---|---|---|---|
| 1 | Callback de exclusão de dados | `POST https://api.leadium.com.br/meta/data-deletion` (F69-S01) | ✅ no ar — `signed_request` inválido → `400` |
| 1b | Página de acompanhamento da exclusão | `https://app.leadium.com.br/exclusao-de-dados/<código>` | ✅ `200` |
| 2 | Callback de desautorização | `POST https://api.leadium.com.br/meta/deauthorize` | ✅ no ar (F69-S01) |
| 3 | Política de privacidade e termos, sem login | `https://app.leadium.com.br/privacidade`, `/termos` | ✅ `200` |
| 4 | Business Verification | Business Manager | 🧑 **conferir** no Business Manager (não dá para ver do código) |
| 5 | Webhook: desafio `GET` e `POST` < 5 s | `https://api.leadium.com.br/webhooks/meta` | ✅ token errado → `403`; o `POST` só enfileira |
| 6 | Conta de teste por fluxo | [conta-de-teste.md](conta-de-teste.md) | 🧑 criar depois do deploy |

**Repetir esta tabela na VPS nova antes de submeter.** O comando de conferência está no runbook (§2).

## 4. Pendências que travam o lote 1

1. **Conferir o conjunto de permissões no painel do app.** A Meta renomeia permissões; o nome que
   vale é o do painel "Permissões e recursos". O runbook tem a tabela para preencher com data.
   Diferença entre painel e `permissions.ts` → corrigir o código antes de gravar.
2. **F69-S08 — caminho de login do Instagram.** O código usa "Instagram API com Login do
   Facebook" (`instagram_*`). Se o caso de uso do app estiver configurado no caminho "Login do
   Instagram" (`instagram_business_*`), o vídeo mostra um login e o pedido diz outro — reprova.
   Sem o S08 fechado, o Instagram sai do lote 1 e WhatsApp + leads vão sozinhos.
3. **`ads_management` na lista de leads — decisão do Rogério.** `permissions.ts` pede
   `ads_management` no caso de uso "Leads dos anúncios", mas **nenhuma tela de leads a usa**: o fluxo
   inteiro roda com o token da página (`leadgen_forms` → `pages_manage_ads`, `/{form}/leads` e
   `/{leadgen_id}` → `leads_retrieval`, `subscribed_apps` → `pages_manage_metadata`). Pedir no lote 1
   é permissão sem uso visível. **Recomendação:** tirar `ads_management` de `leads` em
   `permissions.ts` (slot curto, fora da fronteira deste) e pedi-la no lote 2, com o F69-S05, que a
   mostra de verdade. Se ficar, o lote 1 não inclui `ads_management` no formulário e a saúde da
   conexão de leads vai acusar "falta permissão" até o lote 2.
4. **`pages_messaging`.** O runbook antigo do Instagram a listava; o código não a pede (o
   Instagram responde por `instagram_manage_messages`). **Não pedir.** O runbook foi alinhado.

## 5. Ordem de execução

1. VPS nova no ar com o código atual → repetir §3.
2. Fechar §4 (painel conferido, S08, decisão do `ads_management`).
3. Criar a conta do revisor e rodar o seed ([conta-de-teste.md](conta-de-teste.md)).
4. Gravar os screencasts ([screencasts.md](screencasts.md)).
5. Submeter pelo runbook, colando os textos de [permissoes.md](permissoes.md).
