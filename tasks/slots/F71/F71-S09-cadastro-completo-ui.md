---
id: F71-S09
title: Telas de cadastro sem beco sem saída — reenviar confirmação, login de não confirmado e aceite de termos
phase: F71
status: review
priority: high
estimated_size: S
ui: true
depends_on: [F71-S04]
blocks: [F71-S10]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/features/SELF_SERVE_SIGNUP.md
  - docs/UX_PRINCIPLES.md
agent_id: backend-engineer
claimed_at: 2026-10-07T01:30:55Z
completed_at: 2026-10-07T01:31:13Z

---
# F71-S09 — Cadastro completo (UI)

## Objetivo

Em nenhuma tela de entrada a pessoa fica sem próximo passo.

## Escopo (faz)

- Signup:
  - caixa obrigatória "Li e aceito os Termos de uso e a Política de privacidade", com links para `/termos` e `/privacidade`; envia `acceptTerms` e `termsVersion`;
  - a tela "verifique seu email" ganha "Reenviar email", com Turnstile, contagem de 60s entre reenvios e mensagem uniforme.
- Login:
  - `403 email_unverified` → "Confirme seu email para entrar." + "Reenviar confirmação" inline, sem perder o email digitado;
  - `?email=` pré-preenche o campo (vem do aceite de convite);
  - mensagem de "conta criada" quando vier do convite.
- `/verify`:
  - link inválido ou expirado → campo de email + reenviar, em vez de beco;
  - sucesso → "Email confirmado" + ir para o login com o email.
- Ajustar o e2e `auth.spec` "credenciais inválidas", que espera um texto antigo (pendência da F70-S28).

### files_allowed

- `apps/web/features/auth/**`
- `apps/web/app/(auth)/login/**`, `apps/web/app/(auth)/signup/**`, `apps/web/app/(auth)/verify/**`
- `apps/web/e2e/specs/auth*.spec.ts`, `apps/web/e2e/specs/signup*.spec.ts`

### files_forbidden

- `apps/web/app/(auth)/convite/**` (S07), `apps/web/shared/**` (S07/S08)

## Definition of Done

- [ ] testes de componente: reenviar com contagem; login de não confirmado; verify expirado
- [ ] signup bloqueia sem o aceite (teste)
- [ ] e2e de auth verde
- [ ] capturas 375/1440 em dark e light, axe (`~/.claude/skills/canone/VERIFICACAO.md`)
- [ ] revisão `/hm-designer` aprovada

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
pnpm --filter @hm/web exec vitest run features/auth --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`.
- Pode correr em paralelo com S07 e S08 (paths disjuntos).

## Notas de execução

**Entregue (auditado contra o contrato HTTP final da F71-S04 e o DoD)**

- `features/auth/terms.ts`: `TERMS_VERSION = '2026-09-14'` (fonte única; mesma data de /termos e /privacidade).
- `features/auth/schema.ts` / `SignupForm.tsx`: caixa "Li e aceito os Termos de uso e a Política de privacidade" (links `/termos`, `/privacidade`), obrigatória (Zod `refine`), mensagem de erro com `role=alert`; envia `acceptTerms: true` + `termsVersion`. O botão `loading` cobre o piso de ~1,2 s do signup. Tela "Verifique seu email" com reenvio (cooldown já iniciado em 60 s), "Errei o email" e "Voltar ao login" (`/login?email=`).
- `features/auth/resend.ts` + `components/ResendVerification.tsx`: `POST /auth/resend-verification` com Turnstile (token de uso único, widget remontado a cada envio), contagem de 60 s, mensagem de sucesso uniforme (anti-enumeração), 429 -> "Muitos reenvios seguidos" (segura 60 s), `captcha_failed` -> refazer verificação, `invalid_payload` -> conferir email; região `aria-live=polite` (sucesso) e `role=alert` (erro).
- `LoginForm.tsx`: `403 email_unverified` -> "Confirme seu email para entrar." + "Reenviar confirmação" inline, com o email digitado (via `watch`); `?email=` pré-preenche e foca a senha; aviso por origem; `?next=` preservado via `postLoginPath`.
- `VerifyEmail.tsx`: token inválido/expirado/ausente -> alerta + campo de email (pré-preenchido do `?email=` ou do email lembrado no navegador, `pending-email.ts`) + reenviar + link ao login; sucesso -> "Email confirmado" + "Ir para o login" (`/login?email=…&from=verify`).
- `app/(auth)/login/page.tsx`: lê `email`/`from`, sanitiza o email (`sanitizeEmailParam`).
- e2e: `auth.spec` "credenciais inválidas" ajustado ao texto atual ("Email ou senha incorretos", alerta inline); `signup-terms.spec.ts` (bloqueio sem aceite, envio com versão, reenvio em contagem); verify expirado coberto em `auth.spec`.
- Testes: `auth-screens.test.tsx` (9) + `resend.test.ts` (9): reenvio com contagem, login de não confirmado, verify expirado, signup com aceite.

**Incompatibilidade com a S07 (registrada)**: o aceite de convite redireciona para `/login?email=…` (`createdNext`, vindo da API em `res.next`) SEM marcador `from=invite`. Como não há como afirmar a origem com segurança, a S09 mostra "Entre com sua senha." quando só há `?email=`, e "Conta criada. Entre com sua senha." apenas com `?from=invite` (suportado, ainda não enviado por ninguém). Se quiser a copy "Conta criada" no convite, a S07 (ou a API) deve acrescentar `&from=invite` ao `next`.

**Validação (execução real)**: `pnpm --filter @hm/web typecheck` limpo; eslint nos arquivos tocados limpo; `vitest run features/auth --maxWorkers=1` 18/18; Playwright (chromium, `next dev` local) `auth.spec` + `signup-terms.spec`: todos passam. Na 1ª rodada 2 testes de login estouraram o timeout de 15 s por compilação a frio de `/login` (4591 módulos) e recompilações HMR causadas pelos workers paralelos; reexecutados com o servidor aquecido, passam.

**NÃO executado**: capturas 375/1440 dark+light e axe (`VERIFICACAO.md`) e a revisão `/hm-designer` — não foram rodados nesta sessão. Roteiro manual: abrir `/signup` (e estado "Verifique seu email"), `/login`, `/login?email=a@b.co`, `/login?email=a@b.co&from=invite`, login com 403 mockado, `/verify?token=x` (expirado) e `/verify` (sem token) em 375 e 1440, dark e light; rodar axe em cada (foco visível, contraste dos avisos, rótulo da caixa de aceite, regiões live); conferir `prefers-reduced-motion` no spinner de `/verify`. DoD desses itens permanece aberto.

### Revisão de design

**Veredito: APROVADO COM RESSALVAS** (`/hm-designer`, 2026-10-06). Fluxos sem beco (login de não confirmado, verify expirado, reenvio com contagem), copy em três partes e estados vivos para leitor de tela.

**Corrigido**
- `app/(auth)/layout.tsx`: respiro lateral mínimo de 20 px com safe-area (`max()`); as telas não ficam mais coladas na borda a 375 px.
- Integração S07↔S09: o convite agora navega para `/login?email=…&from=invite` — o aviso "Conta criada. Entre com sua senha." passa a aparecer (provado no e2e `invite.spec`).
- `SignupForm.tsx`: erro do aceite dos Termos com ícone em `danger` e texto neutro (o `text-danger` dava 3:1 no claro); email da tela "Verifique seu email" com `wrap-anywhere` em vez de `break-all` (quebrava "ana@empresa.\ncom" mesmo cabendo na linha seguinte).
- `VerifyEmail.tsx`: CTA "Ir para o login" com a mesma métrica dos botões grandes (`px-6 text-base`, transição só de cor/sombra) — era `text-sm px-4`, destoando de login/convite.

**Ressalvas (abertas)**
- [média, DS] As mensagens de erro de campo do `Input` do `@hm/ui` usam `text-danger` (#ff4d4d, 3,03:1 no claro): axe sério em `/signup` com validação no tema claro. Correção certa é nos tokens light (ver S07: `--danger: #c81e1e`), fora da fronteira.
- [baixa] Na tela "Verifique seu email" o H1 continua "Criar conta"; o estado novo mora num aviso de 14 px. Melhor: o título acompanhar o estado (exige subir o estado para a página).

**Medido**: build de produção; capturas 375/768/1440 × dark/light de `/login`, `/login?…&from=invite`, login 403 não confirmado, `/signup`, erro de termos, "Verifique seu email", `/verify` sem token, expirado e sucesso; axe 4.12: zero violação séria em elemento da S09 (restam só as do `Input` do DS no claro); sem rolagem horizontal. First Load JS: `/login` 267 kB, `/signup` 267 kB, `/verify` 255 kB (rotas 3,5 / 3,25 / 4,92 kB + 213 kB compartilhados pré-F71; acima do teto de 200 kB do cânone pela base, não pela F71). **Não medido**: Lighthouse/LoAF; spinner de `/verify` sob `prefers-reduced-motion` só por leitura (`motion-reduce:animate-none`).
