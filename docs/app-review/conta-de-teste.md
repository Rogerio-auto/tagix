# Conta de teste e workspace de demonstração

> O revisor da Meta entra no Leadium com uma conta nossa e executa os fluxos dos screencasts.
> A conta precisa existir **em produção**, ter dados plausíveis e **nenhum dado real**.

## 1. Conta do revisor no Leadium

Criada **pelo cadastro normal** do app em produção, nunca por seed: o seed não mexe no provedor
de autenticação, e o cadastro real é justamente o que o revisor precisa ver funcionando.

1. Em `https://app.leadium.com.br/signup`, criar a conta:
   - e-mail: uma caixa dedicada que o Rogério controla (ex.: `app-review@<domínio da Arcada>`);
     **não** usar o e-mail pessoal;
   - **Nome do workspace:** "Leadium Demo" → o slug fica `leadium-demo` (se já existir, o
     cadastro gera `leadium-demo-2`; usar o slug que aparecer em Configurações);
   - senha forte, gerada e guardada no gerenciador de senhas.
2. Confirmar o e-mail. O workspace nasce com o trial de 15 dias (F71): **conferir que o trial não
   vence no meio da revisão** — se a revisão passar de 15 dias, estender a assinatura do
   workspace pelo super-admin.
3. Dar à conta o papel **owner** (padrão de quem cria): o revisor precisa conectar canais e
   moderar comentários, que pedem papel de gestão.

## 2. Dados de demonstração (seed)

Contatos, etiquetas e um funil com negócios, para a inbox e o funil não aparecerem vazios.
Tudo fictício por construção (`packages/db/src/seed/app_review_demo.ts`):

- telefones com **DDD 00**, que não existe no Brasil;
- e-mails em **`example.com`** (domínio reservado para exemplo);
- nomes inventados ("Ana Exemplo", "Bruno Demonstração"…);
- tudo marcado com `source = 'demo_app_review'`.

**Nenhum canal** é criado: um canal falso apareceria como "Conectado" no vídeo. Os canais são
conectados de verdade, na gravação.

Rodar **na VPS** (o seed recusa produção sem as duas confirmações):

```bash
# na VPS, no container/ambiente que tem DATABASE_URL de produção
APP_REVIEW_SEED_ALLOW_REMOTE=1 \
APP_REVIEW_SEED_CONFIRM_DATABASE=leadium \
pnpm --filter @hm/db exec tsx src/seed/app_review_demo.run.ts --workspace leadium-demo
```

Idempotente: rodar de novo não duplica nem desfaz o que foi mexido na mão. Para ensaiar antes,
rodar igual na máquina local contra um workspace de dev (sem as variáveis de confirmação).

**Remover depois da aprovação** (opcional — os dados são fictícios): apagar os contatos e
negócios com `source = 'demo_app_review'` e o funil "Demonstração — App Review", ou excluir o
workspace inteiro.

## 3. Contas de teste do lado da Meta

| Para quê | O que criar | Onde |
|---|---|---|
| WhatsApp (W1–W3) | Número de teste da WABA de teste do app | Painel do app → WhatsApp → API Setup |
| Cliente no WhatsApp (W2) | Um celular que **não** é o número conectado, adicionado como destinatário de teste | Mesmo painel |
| Instagram (I1–I3) | Conta **profissional** (Business/Creator) ligada a uma Página de teste — conta pessoal é rejeitada pelo connect | Instagram + Página do Facebook |
| Cliente no Instagram (I2, I3) | Conta pessoal separada para mandar Direct e comentar | Instagram |
| Leads (L1, L2) | Página de teste com um formulário de lead | Gerenciador de Anúncios → Formulários instantâneos |
| Disparo do lead (L2) | Lead Ads Testing Tool | `developers.facebook.com/tools/lead-ads-testing` |

Todas as contas da Meta ficam no Business Manager do Leadium, **não** no da Arcada nem no de
cliente.

## 4. O que vai no formulário da Meta (campo de instruções ao revisor)

```text
Test account for Leadium (production): https://app.leadium.com.br/login
Email: <app-review e-mail>
Password: <password>

The workspace "Leadium Demo" contains only fictitious data. To test each permission, follow
the steps shown in the attached screencasts:
- WhatsApp: Settings > Channels > Connect > WhatsApp.
- Instagram: Settings > Channels > Connect > Instagram.
- Lead ads: Settings > Meta — Facebook e Instagram > "Leads dos anúncios" > Connect, then add a
  Page under "Páginas recebendo" and create a test lead with the Lead Ads Testing Tool.
The interface is in Portuguese; the screencasts have English captions for every step.
```
