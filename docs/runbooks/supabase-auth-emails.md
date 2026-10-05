# Runbook — Emails de autenticação do Supabase (Leadium)

> **Feature:** F71 — Contas e convites (slot F71-S02). Base: `docs/features/CONTAS_E_CONVITES.md`
> (achados A1, A4, B3; §8 riscos) e `docs/features/SELF_SERVE_SIGNUP.md` (F44).
> **Audiência:** quem administra o projeto Supabase de produção (hoje, o Rogério).
> **Quando rodar:** antes de abrir cadastro/convite em produção, e depois de qualquer mudança
> de domínio, de SMTP ou dos templates. É ação humana no painel; nenhum deploy faz isso.

## Por que isso importa

A API lê o token do link de email e o valida no servidor. Se o template do Supabase não
mandar o link no formato que o app espera, a pessoa clica, a página não acha token e a conta
fica `invited` para sempre (achado A1). O template **padrão** do Supabase usa
`{{ .ConfirmationURL }}`, que passa pelo servidor do Supabase e devolve a sessão no fragmento
da URL — o app do Leadium não usa esse caminho.

| Email | Quem dispara (API) | Página do app | O que a página lê |
|---|---|---|---|
| Confirm signup | `signUp` / `resendVerification` | `/verify` | `token_hash` (valida com `type=email`) |
| Reset password | `requestPasswordReset` | `/reset-password` | `token_hash` (valida com `type=recovery`) |
| Invite user | `sendInvite` (pessoa sem conta) | `/convite/<token>` | o **nosso** token, no caminho |
| Magic link | `sendSignInLink` (pessoa com conta) | `/convite/<token>` | o **nosso** token, no caminho |

Convite e link de acesso apontam direto para o destino (`{{ .RedirectTo }}`): o que dá acesso
é o token do Leadium no caminho (uso único, 7 dias, só o hash no banco), não a sessão do
Supabase. Isso também protege contra antivírus de email que "clicam" nos links (Outlook Safe
Links etc.): abrir a página não consome nada; só o envio do formulário consome.

## Pré-requisitos

- Acesso de owner ao projeto no painel do Supabase.
- Domínio do app: `https://app.leadium.com.br` (ver `deploy-production.md`).
- Na API de produção: `AUTH_EMAIL_REDIRECT_URL=https://app.leadium.com.br` (sem barra no fim).
  Sem ela, convite e link de acesso **recusam** o envio (de propósito: sem base, o Supabase
  cairia no Site URL e o token do convite se perderia).
- `SUPABASE_SERVICE_KEY` configurada na API (convite, lookup e troca de senha são admin).
- Credenciais de um SMTP transacional próprio (passo 1).

## 1. SMTP próprio

O SMTP embutido do Supabase é só para teste: limite de envio por hora muito baixo e, nos
projetos atuais, entrega apenas para emails do time do projeto. Em produção, sem SMTP
próprio, o cadastro e o convite param de entregar email sem nenhum erro visível no app.

Painel: **Authentication → Emails → SMTP Settings** (em versões antigas do painel:
Project Settings → Authentication → SMTP).

1. Ative **Enable Custom SMTP**.
2. Provedor: Postmark (stream **transacional**, o mesmo previsto na F60-S04). Amazon SES ou
   Resend também servem; o que importa é ser transacional e ter DKIM no domínio.
3. **Sender email:** `nao-responda@leadium.com.br`. **Sender name:** `Leadium`.
4. Host, porta (587, STARTTLS), usuário e senha do provedor. A senha do SMTP fica só no
   painel do Supabase e no cofre de senhas; nunca em `.env` commitado nem em chat.
5. DNS do `leadium.com.br`: SPF incluindo o provedor, DKIM do provedor e DMARC
   (`p=quarantine` depois de uma semana limpa em `p=none`).
6. **Authentication → Rate Limits:** suba "emails por hora" para o volume esperado
   (ponto de partida: 100/h). A API já limita por IP/email antes de chegar aqui.

## 2. URL Configuration

Painel: **Authentication → URL Configuration**.

1. **Site URL:** `https://app.leadium.com.br`
2. **Redirect URLs** (uma por linha, exatamente assim):

   ```
   https://app.leadium.com.br/verify
   https://app.leadium.com.br/reset-password
   https://app.leadium.com.br/convite/**
   ```

   `/convite/**` precisa do `**`: o token muda a cada convite. Um destino fora da lista faz o
   Supabase trocar o link pelo Site URL — o convite chegaria sem token e não funcionaria.
3. Não adicione curingas largos (`https://app.leadium.com.br/**`, `*.leadium.com.br`): cada
   destino aberto é um open-redirect em potencial.

## 3. Provider de email

Painel: **Authentication → Sign In / Providers → Email**.

- **Enable Email provider:** ligado.
- **Confirm email:** ligado (bloqueio duro da F44: sem confirmar, não entra).
- **Secure email change:** ligado.
- **Email OTP Expiration:** `86400` (24 h, o máximo). Vale para o link de confirmação de
  cadastro e o de redefinição de senha. Uma hora é pouco para quem cria a conta e só abre o
  email no dia seguinte; o link é de uso único e pode ser reenviado.
- **Minimum password length:** 10, igual à validação do app (`signup.ts`). A regra forte
  (letras e números) fica no app; o Supabase só segura o piso.

## 4. Templates

Painel: **Authentication → Emails → Templates**. Para cada template abaixo, troque
**Subject** e **Message body (HTML)** pelo texto indicado. Não use `{{ .ConfirmationURL }}`
em nenhum deles.

O HTML é propositalmente simples (tabela + estilos inline): é o que renderiza igual em Gmail,
Outlook e Apple Mail, inclusive no modo escuro.

### 4.1 Confirm signup

**Subject:** `Confirme seu email no Leadium`

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;padding:40px;">
      <tr><td style="font-size:20px;font-weight:600;color:#09090b;letter-spacing:-0.01em;">Leadium</td></tr>
      <tr><td style="padding-top:24px;font-size:16px;line-height:24px;color:#27272a;">
        Falta um passo para ativar sua conta. Confirme que este email é seu:
      </td></tr>
      <tr><td style="padding-top:24px;">
        <a href="{{ .SiteURL }}/verify?token_hash={{ .TokenHash }}&type=email"
           style="display:inline-block;background:#09090b;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:8px;">Confirmar email</a>
      </td></tr>
      <tr><td style="padding-top:24px;font-size:13px;line-height:20px;color:#71717a;">
        O link vale por 24 horas e funciona uma vez. Se você não criou uma conta no Leadium, ignore este email.
      </td></tr>
    </table>
  </td></tr>
</table>
```

### 4.2 Reset password

**Subject:** `Redefinir sua senha do Leadium`

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;padding:40px;">
      <tr><td style="font-size:20px;font-weight:600;color:#09090b;letter-spacing:-0.01em;">Leadium</td></tr>
      <tr><td style="padding-top:24px;font-size:16px;line-height:24px;color:#27272a;">
        Recebemos um pedido para redefinir a senha da sua conta.
      </td></tr>
      <tr><td style="padding-top:24px;">
        <a href="{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery"
           style="display:inline-block;background:#09090b;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:8px;">Definir nova senha</a>
      </td></tr>
      <tr><td style="padding-top:24px;font-size:13px;line-height:20px;color:#71717a;">
        O link funciona uma vez. Se não foi você, ignore este email: sua senha continua a mesma.
      </td></tr>
    </table>
  </td></tr>
</table>
```

### 4.3 Invite user

**Subject:** `Você foi convidado para o Leadium`

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;padding:40px;">
      <tr><td style="font-size:20px;font-weight:600;color:#09090b;letter-spacing:-0.01em;">Leadium</td></tr>
      <tr><td style="padding-top:24px;font-size:16px;line-height:24px;color:#27272a;">
        Você foi convidado para entrar numa empresa no Leadium. Abra o convite para ver quem convidou e criar sua senha.
      </td></tr>
      <tr><td style="padding-top:24px;">
        <a href="{{ .RedirectTo }}"
           style="display:inline-block;background:#09090b;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:8px;">Abrir convite</a>
      </td></tr>
      <tr><td style="padding-top:24px;font-size:13px;line-height:20px;color:#71717a;">
        O convite vale por 7 dias. Se você não esperava este email, ignore: nada acontece sem você abrir o convite.
      </td></tr>
    </table>
  </td></tr>
</table>
```

### 4.4 Magic link

Usado só para convidar quem **já tem conta** no Leadium (o app não oferece login sem senha).
Se um dia o login por link entrar no produto, este template precisa ser revisto.

**Subject:** `Você tem um novo convite no Leadium`

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;padding:40px;">
      <tr><td style="font-size:20px;font-weight:600;color:#09090b;letter-spacing:-0.01em;">Leadium</td></tr>
      <tr><td style="padding-top:24px;font-size:16px;line-height:24px;color:#27272a;">
        Você foi convidado para mais uma empresa no Leadium. Entre com a sua conta de sempre e aceite o convite.
      </td></tr>
      <tr><td style="padding-top:24px;">
        <a href="{{ .RedirectTo }}"
           style="display:inline-block;background:#09090b;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:8px;">Ver convite</a>
      </td></tr>
      <tr><td style="padding-top:24px;font-size:13px;line-height:20px;color:#71717a;">
        O convite vale por 7 dias. Se você não esperava este email, ignore.
      </td></tr>
    </table>
  </td></tr>
</table>
```

### Templates que ficam como estão

"Change email address" e "Reauthentication" não são usados pelo app hoje. Não apague; só
troque o nome do remetente (vem do SMTP) para que não saiam como "Supabase".

## 5. Teste ponta a ponta (produção)

Use uma caixa real que você controla e que **não** tenha conta no Leadium (ex.: um alias
`rogerio+f71-<data>@...`). Abra cada email no Gmail **e** no Outlook web se possível.

### 5.1 Confirm signup

1. Crie uma conta em `https://app.leadium.com.br/signup`.
2. O email chega em menos de 1 minuto, remetente `Leadium <nao-responda@leadium.com.br>`,
   sem cair no spam.
3. Passe o mouse no botão: o link é
   `https://app.leadium.com.br/verify?token_hash=…&type=email` (não `…supabase.co/auth/v1/verify`).
4. Antes de clicar, tente entrar em `/login`: o app recusa (depois da F71-S04, com
   "confirme seu email").
5. Clique: `/verify` mostra sucesso. Entre em `/login` com a senha criada: entra.
6. Clique no mesmo link de novo: a página diz que o link é inválido ou expirou.

### 5.2 Reset password

1. Em `/login`, "Esqueci minha senha", com o email do teste 5.1.
2. O link é `https://app.leadium.com.br/reset-password?token_hash=…&type=recovery`.
3. Defina uma nova senha; entre com ela; a senha antiga não entra mais.
4. Repita com um email que não existe: a tela responde igual e nenhum email chega.

### 5.3 Invite user (depois da F71-S05)

1. Logado como OWNER/ADMIN, convide um email **sem conta** em Configurações → Membros.
2. O email "Você foi convidado para o Leadium" chega; o link é
   `https://app.leadium.com.br/convite/<token>` (o token é longo e aleatório).
3. Abra: a página mostra a empresa e quem convidou; defina a senha; o app manda para
   `/login` com o email preenchido; entre: você está na empresa que convidou.
4. Abra o mesmo link de novo: "convite inválido ou já usado".

### 5.4 Magic link (depois da F71-S05)

1. Convide para **outra** empresa o email do teste 5.3 (que agora tem conta).
2. Chega "Você tem um novo convite no Leadium"; o link é `/convite/<token>`.
3. Logado com essa conta, aceite: a nova empresa vira a ativa e o seletor mostra as duas.

### 5.5 Busca de conta por email exato (A4)

Confere como o `filter` da API admin se comporta neste projeto (o adapter já não depende
disso, mas o registro ajuda em incidente). Num terminal com a service key **fora do
histórico** (PowerShell: `$env:SK = Read-Host -MaskInput`):

```powershell
$h = @{ apikey = $env:SK; Authorization = "Bearer $env:SK" }
Invoke-RestMethod -Headers $h "https://<projeto>.supabase.co/auth/v1/admin/users?filter=ana%40exemplo.com&per_page=100" |
  Select-Object -ExpandProperty users | Select-Object email
```

Esperado: a lista traz todo email que **contém** o texto (ex.: `joana@exemplo.com` junto com
`ana@exemplo.com`). Registre o resultado em `tasks/slots/F71/F71-S02-*.md`, seção "Notas de
execução". Depois: `Remove-Item Env:SK`.

## Checklist de verificação em produção

- [ ] SMTP próprio ligado; remetente `Leadium <nao-responda@leadium.com.br>`
- [ ] SPF, DKIM e DMARC do `leadium.com.br` válidos (teste com mail-tester.com: nota ≥ 9)
- [ ] Rate limit de emails por hora ajustado
- [ ] Site URL = `https://app.leadium.com.br`
- [ ] Redirect URLs: `/verify`, `/reset-password`, `/convite/**` — e nenhum curinga largo
- [ ] Confirm email ligado; OTP expiration 86400; senha mínima 10
- [ ] Template "Confirm signup" usa `{{ .SiteURL }}/verify?token_hash={{ .TokenHash }}&type=email`
- [ ] Template "Reset password" usa `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`
- [ ] Templates "Invite user" e "Magic link" usam `{{ .RedirectTo }}`
- [ ] Nenhum template usa `{{ .ConfirmationURL }}`
- [ ] API de produção com `AUTH_EMAIL_REDIRECT_URL=https://app.leadium.com.br` e `SUPABASE_SERVICE_KEY`
- [ ] Teste 5.1 (cadastro) ok, incluindo link reusado recusado
- [ ] Teste 5.2 (reset) ok, incluindo email inexistente com resposta igual
- [ ] Teste 5.3 (convite sem conta) ok — após F71-S05
- [ ] Teste 5.4 (convite com conta) ok — após F71-S05
- [ ] Teste 5.5 registrado no slot

## Quando algo dá errado

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Email não chega, app não mostra erro | SMTP embutido ou rate limit do Supabase | Passo 1; Authentication → Logs, filtrar por `mail` |
| Link aponta para `…supabase.co/auth/v1/verify` | Template ainda com `{{ .ConfirmationURL }}` | Passo 4 |
| `/verify` diz "link inválido" no primeiro clique | Template sem `token_hash`, ou OTP expirado | Passo 4; conferir OTP expiration |
| Convite abre a home em vez de `/convite/…` | `/convite/**` fora das Redirect URLs | Passo 2 |
| Convite falha ao enviar na tela de membros | `AUTH_EMAIL_REDIRECT_URL` ou service key ausente na API; rate limit | Variáveis da API; enquanto isso, use "copiar link" do convite |
| Email cai no spam | DKIM/DMARC ausentes ou remetente diferente do domínio autenticado | Passo 1, item 5 |
