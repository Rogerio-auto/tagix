---
id: F71-S07
title: Tela de aceitar convite e gestão de membros com convites pendentes
phase: F71
status: review
priority: high
estimated_size: M
ui: true
depends_on: [F71-S05]
blocks: [F71-S10]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/UX_PRINCIPLES.md
  - docs/DESIGN_SYSTEM.md
agent_id: backend-engineer
claimed_at: 2026-10-07T01:30:04Z
completed_at: 2026-10-07T01:30:52Z

---
# F71-S07 — Convites (UI)

## Objetivo

A pessoa convidada abre o link e entra em poucos segundos. O admin vê e controla os convites: pendentes, reenviar, revogar, copiar link e reativar quem foi removido.

## Escopo (faz)

- `/convite/[token]` (rota pública, grupo `(auth)`, adicionada a `PUBLIC_PREFIXES`):
  - carrega o preview: "Fulano convidou você para a **Empresa** como Atendente";
  - **sem conta:** nome + senha (mesmas regras de força e o mesmo medidor do signup) → aceitar → `/login?email=…` com aviso "Conta criada. Entre com sua senha.";
  - **com conta, logado com o email certo:** um botão "Entrar na Empresa" → empresa ativa → `/`;
  - **com conta, deslogado:** "Entre para aceitar" → `/login?next=/convite/<token>`;
  - **logado com outro email:** explica e oferece sair e entrar com o email certo;
  - inválido/expirado: estado claro, sem detalhar o motivo, com "peça um novo convite a quem te convidou";
  - ignora o fragmento `#access_token` que o Supabase anexa e o remove da URL.
- Seção Membros (`MembersSection.tsx`):
  - lista de membros com status legível (Ativo, Removido, Bloqueado) e filtro "mostrar removidos";
  - lista de convites pendentes: email, papel, enviado há X, expira em Y; ações Reenviar, Copiar link (clipboard + toast) e Revogar (confirmação);
  - modal de convite: email, papel (sem OWNER) e departamento opcional; erro de limite de membros com CTA para billing;
  - toast "Convite enviado para x@y.com" só depois do 201;
  - reativar membro removido (`PATCH status:'active'`), também sujeito ao limite.
- Estados vazio, carregando e erro em tudo (UX_PRINCIPLES). Mobile 375px. Tokens do DS v2, sem hex.

### files_allowed

- `apps/web/app/(auth)/convite/**`
- `apps/web/features/invites/**` (novo)
- `apps/web/features/settings/sections/workspace-org/MembersSection.tsx`, `apps/web/features/settings/sections/workspace-org/queries.ts`
- `apps/web/shared/lib/public-routes.ts`
- testes ao lado (`*.test.tsx`) e `apps/web/e2e/specs/invite*.spec.ts` (novos; fixtures compartilhadas são da S10)

### files_forbidden

- `apps/web/features/auth/**`, `apps/web/app/(auth)/{login,signup,verify}/**` (S09), `apps/web/shared/components/layout/**` (S08)

## Definition of Done

- [ ] testes de componente dos 5 estados da tela de convite
- [ ] testes da seção de membros: reenviar, revogar, copiar, limite estourado
- [ ] e2e `invite.spec.ts` do aceite sem conta (com API mockada)
- [ ] capturas 375/768/1440 em dark e light, axe sem violação séria, orçamento de peso (`~/.claude/skills/canone/VERIFICACAO.md`)
- [ ] revisão `design-web` / `/hm-designer` aprovada

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
pnpm --filter @hm/web exec vitest run features/invites features/settings shared/lib --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`.

## Notas de execução

### Contrato consumido (pós-auditoria da S05; substitui o texto original do escopo)

- Preview: `POST /auth/invite/preview { token }` → `{ workspaceName, inviterName, role, emailMasked, requiresEmailProof, expiresAt }`. Sem `hasAccount`, sem token em path/query.
- Aceite: `POST /auth/invite/accept { token, name?, password?, emailProof? }`. `requiresEmailProof=false` → exige sessão do email certo (`401 login_required` → "Entre para aceitar" com `/login?next=/convite/<token>`; `403 wrong_account` → sair e entrar com o email certo). `requiresEmailProof=true` → prova vem do FRAGMENTO (`#token_hash=…&type=invite|magiclink`): `consumeProofFromFragment` lê `location.hash`, limpa com `history.replaceState` no primeiro efeito, guarda só em memória (estado React) e envia no corpo do submit. Sem fragmento (ou `403 email_proof_required`) → botão "Receber email de confirmação" (`POST /auth/invite/send-email`, cooldown de 60 s, `send_limit`, 503) e a explicação "enviamos o link para <emailMasked>". Nunca lê `token_hash` da query.
- Os 5 estados: (a) conta com senha logada → "Entrar na <Empresa>"; (b) deslogada → "Entre para aceitar"; (c) outro email → explica + sair; (d) prova válida → nome + senha com medidor, sucesso `/login?email=…` com "Conta criada. Entre com sua senha."; (e) sem prova → pedir/enviar email. Mais: inválido/expirado (sem detalhar motivo), carregando, indisponível (5xx com retry).
- Admin: `GET /api/members/invites` (+`seats`), `POST /api/members/invites` (201 `delivery sent|failed`; 200 `resent`), `POST …/:id/resend`, `DELETE …/:id`, `POST …/:id/link` (POST, troca o token; avisa que o link do email morre), `PATCH /api/members/:id {status:'active'}`. Erros por `err.code`: `seat_limit` (CTA para `/settings/billing`), `already_member`, `member_blocked`, `invite_pending`, `resend_cooldown|send_limit|invite_rate_limited`, `invite_quota_unavailable`, `link_unavailable`. `402 subscription_inactive` fica com o handler central (S08), sem toast duplicado. Toast "Convite enviado" só com `delivery:'sent'`; `failed` → "email não saiu, copie o link".
- `Referrer-Policy: no-referrer`: `metadata.referrer = 'no-referrer'` na página (meta tag) + robots noindex/nocache. Header HTTP real fica para a S10/infra (`next.config`/proxy não estão no files_allowed). O token só aparece no `next` do login e nunca é logado.

### Decisões

- View apresentacional (`InviteView`) separada do container (`InviteScreen`) e da decisão pura de etapa (`stage.ts`): permite testar os estados sem DOM (vitest roda em `node`, `renderToStaticMarkup`).
- Modal só para o formulário curto de convite (§2.3); ações de linha (reenviar/copiar/revogar) com loading por linha (§2.7), revogar com confirmação (§2.9), vazio/carregando/erro nas duas listas (§2.6/§2.11), ações por teclado/aria-label por email (§2.10).
- `route-guard.postLoginPath` agora preserva `?next=/convite/<token>` via `isReturnablePublicPath` (desvio autorizado; só essa linha + teste).
- `InviteView` põe `px-5 md:px-0`: o `(auth)/layout.tsx` combina `pl-safe pr-safe px-5` e as utilitárias `pl/pr-safe` (padding 0 fora de notch) vencem `px-5`, deixando TODAS as telas auth coladas na borda a 375 px. Bug de layout fora do files_allowed: ver pendência.
- `time.ts`: locale `pt-BR` fixo com eslint-disable justificado (evita hydration mismatch).

### Verificado (2026-10-06)

- `typecheck` ok; `eslint` nos arquivos tocados: 0 problemas; `vitest run features/invites features/settings shared/lib shared/auth --maxWorkers=1`: 11 arquivos, 142 testes, 0 falhas (inclui 15 testes dos estados da tela, 15 das ações reenviar/revogar/copiar/limite/reativar, 11 da seção de membros, `postLoginPath` com convite).
- Playwright (dev server local, API mockada): `invite.spec.ts` 4/4 (aceite sem conta com fragmento: URL limpa, prova só no corpo, nada em storage; senha fraca; sem fragmento → send-email + cooldown; inválido). Obs.: com servidor dev frio o primeiro `goto` pode estourar 15 s (compilação); passa a quente.
- Capturas (5 telas × 375/768/1440 × dark/light = 30) olhadas amostralmente: sem rolagem horizontal em nenhuma; axe-core 4.12 injetado em cada uma: 0 violações (nenhuma, nem moderada). Capturas ficaram fora do repo (scratchpad).

### Não verificado / pendências

- Orçamento de peso: o servidor era `next dev` (≈15 MB, sem significado). Medir em `next build && next start` (primeira carga ≤1 MB, fontes ≤100 KB) e Lighthouse mobile na S10.
- Revisão `design-web` / `/hm-designer` humana: não executada. Foco de teclado visível e reduced-motion verificados só por leitura de código.
- Teste de ações da seção de membros é por funções (`actions.ts`) + render estático; não há teste de interação com DOM (sem jsdom no @hm/web). Fluxo admin ponta a ponta (convidar/reenviar/revogar na tela) não tem e2e; roteiro manual: Configurações → Membros → Convidar (email válido → toast; plano cheio → CTA "Ver planos"); Reenviar (2x seguidas → aviso de cooldown); Copiar link (cola em aba anônima abre o convite, o link antigo do email passa a dar "não disponível"); Revogar (confirma → some da lista); reativar removido no limite → CTA.
- Header HTTP `Referrer-Policy` real (só há a meta tag) e `(auth)/layout.tsx` com `pl-safe/pr-safe` anulando `px-5` (afeta login/signup/verify): para a S09/S10.

### Revisão de design

**Veredito: APROVADO COM RESSALVAS** (`/hm-designer`, 2026-10-06). A tela de convite tem hierarquia clara (o "passe": empresa → quem convidou → papel → para/expira → ação) e todos os estados desenhados; as correções abaixo fecharam os defeitos de borda, contraste e integração.

**Corrigido**
- `app/(auth)/layout.tsx`: lateral mobile = `max(1.25rem, env(safe-area-inset-*))` (os `pl-safe/pr-safe` zeravam o `px-5` e colavam login/signup/verify/convite na borda a 375 px). `InviteView` perdeu o `px-5 md:px-0` duplicado.
- `features/invites/stage.ts` (`createdLoginHref`) + `InviteScreen.tsx`: o `next` da API passa pelo `safeNextPath` e, se for `/login`, ganha `from=invite` via `URLSearchParams` (externo/`//`/backslash → `/login?from=invite`; outro caminho interno intocado). Testes em `stage.test.ts` (5) e e2e `invite.spec` agora clica "Entrar" e confere o login com "Conta criada. Entre com sua senha." e o email preenchido.
- `InviteView.tsx`: estado "Conta criada" sem copy redundante ("Entre com a sua senha para abrir a <Empresa>"), ícone de sucesso; marca igual à das outras telas auth (◢ `text-brand`, 2xl, `mb-8`; sem `aria-label` em `div`).
- `PendingInvites.tsx`: "expirado" e "Revogar" deixaram de usar `text-warn`/`text-danger` em texto (1,5:1 e 3,0:1 no claro) → ponto/ícone colorido + texto neutro; ações com 44 px no toque (`max-md:h-11`); a 375 px "Revogar" vira só o ícone (nome acessível completo) e a linha de ações não quebra mais a destrutiva sozinha; `-ml-3` alinha o 1º botão fantasma à borda do conteúdo.
- `MembersSection.tsx`: selo de status com texto neutro + ponto de cor (o `text-success` dava 1,35:1 no claro); ações e select de papel com 44 px no toque.
- `InviteDialog.tsx`: email e papel com a mesma altura (44 px no toque, 40 px no desktop).

**Ressalvas (abertas)**
- [média, DS] Os tons de status (`--danger/--warn/--success`) não são redefinidos em `[data-theme='light']` (`packages/design-tokens/src/tokens.css`): qualquer texto colorido de status falha contraste no claro em todo o produto. Sugestão: no claro `--danger: #c81e1e` (≈5,3:1 sobre `#f4f7f4`), `--warn: #8a5a00` (≈5,5:1), `--success: #137a0e` (≈5,1:1).
- [baixa] Descrição da seção em `settings/shell/registry.tsx` ("Convidar, listar, mudar role, remover.") mistura inglês; fora da fronteira.
- [baixa] `heading-order` (moderado) no menu lateral de Configurações (rótulos "Pessoal/Workspace"); pré-existente.

**Medido**: build de produção (`next build` + `next start`) com captura 375/768/1440 × dark/light de 9 estados do convite + Membros + modal (Playwright, API mockada), axe-core 4.12 em cada uma: zero violação séria em elemento da S07; sem rolagem horizontal. First Load JS `/convite/[token]` = 274 kB (rota 8,13 kB + 213 kB compartilhados por todas as rotas). O orçamento do cânone (≤200 kB gz produto) já é estourado pela base compartilhada pré-F71 (213 kB, registrado no MOBILE_AUDIT); a parte da F71 é a rota (8 kB) e o modal já vive no chunk lazy da seção. **Não medido**: Lighthouse/LoAF, `prefers-reduced-motion` por captura (só leitura de código), teclado navegado de ponta a ponta.
