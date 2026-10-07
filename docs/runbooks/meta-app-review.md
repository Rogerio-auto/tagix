# Runbook — submeter o app Leadium ao App Review da Meta

> **Quando:** depois do deploy na VPS nova, com o código atual em produção.
> **Quem:** Rogério (o painel da Meta e o Business Manager são dele).
> **Kit completo:** [`docs/app-review/`](../app-review/README.md) — fichas, roteiros, conta de teste.
> **Instagram (histórico):** [`meta-app-review-instagram.md`](meta-app-review-instagram.md),
> agora coberto pelo kit.

---

## 1. Pré-requisitos (nada é submetido sem todos)

- [ ] Código atual em produção na VPS nova (`api.leadium.com.br/health` responde a versão nova).
- [ ] **Business Verification** concluída no Business Manager do Leadium.
- [ ] Pendências do kit fechadas ([README §4](../app-review/README.md)): painel conferido (§3
      abaixo), F69-S08 (Instagram), decisão do `ads_management`.
- [ ] Conta do revisor criada e seed rodado ([conta-de-teste.md](../app-review/conta-de-teste.md)).
- [ ] Screencasts do lote gravados e conferidos pelo checklist de
      [screencasts.md](../app-review/screencasts.md).

## 2. Conferir os endereços que a Meta chama (na VPS nova)

Rodar de qualquer máquina. O esperado está ao lado; qualquer outro código = parar e corrigir.

```bash
curl -s -o /dev/null -w '%{http_code}  privacidade (200)\n' https://app.leadium.com.br/privacidade
curl -s -o /dev/null -w '%{http_code}  termos (200)\n'      https://app.leadium.com.br/termos
curl -s -o /dev/null -w '%{http_code}  acompanhamento da exclusao (200)\n' \
  https://app.leadium.com.br/exclusao-de-dados/teste
curl -s -o /dev/null -w '%{http_code}  webhook com token errado (403)\n' \
  'https://api.leadium.com.br/webhooks/meta?hub.mode=subscribe&hub.challenge=1&hub.verify_token=errado'
curl -s -o /dev/null -w '%{http_code}  exclusao sem assinatura valida (400)\n' \
  -X POST https://api.leadium.com.br/meta/data-deletion -d signed_request=x
curl -s -o /dev/null -w '%{http_code}  desautorizacao sem assinatura valida (400)\n' \
  -X POST https://api.leadium.com.br/meta/deauthorize -d signed_request=x
```

Depois, no painel do app → **Webhooks**: **Testar** o campo `messages` (WhatsApp), `messages`
(Instagram) e `leadgen` (Página). Cada teste tem de aparecer no log da API em menos de 5 s.

Em **Configurações do app → Básico**, conferir que os campos apontam para esses endereços:

| Campo do painel | Valor |
|---|---|
| URL da Política de Privacidade | `https://app.leadium.com.br/privacidade` |
| URL dos Termos de Serviço | `https://app.leadium.com.br/termos` |
| URL de instruções/callback de exclusão de dados | `https://api.leadium.com.br/meta/data-deletion` |
| URL de retorno de chamada para cancelar autorização | `https://api.leadium.com.br/meta/deauthorize` |

## 3. Conferir o conjunto de permissões contra o painel

No painel do app → **Revisão do app → Permissões e recursos**. Para cada linha, anotar o nome
exibido no painel e a data. Nome diferente do código = corrigir
`apps/api/src/services/meta/permissions.ts` (login, saúde da conexão e kit mudam juntos) e só
então gravar.

| Permissão no código (lote 1) | Nome no painel | Acesso pedido | Conferido em |
|---|---|---|---|
| `whatsapp_business_management` | | Advanced | |
| `whatsapp_business_messaging` | | Advanced | |
| `business_management` | | Advanced | |
| `instagram_basic` | | Advanced | |
| `instagram_manage_messages` | | Advanced | |
| `instagram_manage_comments` | | Advanced | |
| `pages_show_list` | | Advanced | |
| `pages_manage_metadata` | | Advanced | |
| `leads_retrieval` | | Advanced | |
| `pages_manage_ads` | | Advanced | |
| `pages_read_engagement` | | Advanced | |

> Advanced Access porque o Leadium opera ativos de **outras empresas** (os clientes). Standard
> Access só vale para ativos do próprio dono do app.

Também conferir que o painel **não** tem casos de uso fora do escopo ainda ligados (Audience
Network e arrecadação de fundos — plano §1): caso de uso sobrando pede revisão de coisa que o app
não faz.

## 4. Submeter

Para cada permissão do lote, em **Permissões e recursos → Solicitar acesso avançado**:

1. **"How will your app use this permission?"** → colar o bloco em inglês da ficha
   ([permissoes.md](../app-review/permissoes.md)).
2. **Screencast** → anexar o vídeo indicado na ficha.
3. Marcar a declaração de uso conforme a Política da Plataforma.

Depois, em **Revisão do app → Solicitações**:

1. Descrição do app → o bloco "Contexto comum" do topo de [permissoes.md](../app-review/permissoes.md).
2. Instruções ao revisor → o bloco do §4 de [conta-de-teste.md](../app-review/conta-de-teste.md),
   com e-mail e senha preenchidos.
3. **Enviar.** Anotar a data e o id da solicitação abaixo.

| Lote | Enviado em | Id da solicitação | Resultado | Data do resultado |
|---|---|---|---|---|
| 1 | | | | |

## 5. Durante a revisão (dias a semanas)

- **Não** fazer deploy que mude os fluxos gravados. Correção de bug fora deles: ok.
- Conta do revisor ativa: conferir o trial/assinatura do workspace de demonstração toda semana.
- Pergunta da Meta chega no painel e no e-mail do app: responder em até 2 dias úteis, com novo
  vídeo se ela pedir.

## 6. Se reprovar

A Meta diz o motivo por permissão. Corrigir **só** o que ela apontou (texto, vídeo ou produto),
regravar o vídeo daquela permissão e reenviar só ela. Registrar o motivo na tabela do §4 e, se
for padrão que pode voltar, no §5 do runbook do Instagram ("Pontos que costumam reprovar").

## 7. Depois de aprovar

1. App em **Modo ao vivo** (se ainda não estava).
2. Lead em segundos: as Páginas cadastradas no modo reconciliação passam a receber pelo webhook
   sozinhas (F69-S13) — conferir em **Páginas recebendo** que mudaram para "em segundos".
3. F69-S03: fechar o item "lead chega à inbox em menos de 10 s" com um lead real.
4. Remover (ou manter, é fictício) o workspace de demonstração.
5. Abrir o lote 2 (F69-S04/S05) com a mesma estrutura.
