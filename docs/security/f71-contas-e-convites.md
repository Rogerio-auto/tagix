# Security Audit — F71 Contas, Convites e Modo só leitura

> **Escopo:** F71 (slots S01–S10): cadastro com prova de e-mail, convites (`member_invites`, migração 0094),
> sessão com empresa ativa, `is_platform_admin`, view-as, modo só leitura por assinatura
> (`subscription-guard`, `/api/v1`, worker outbound), socket em tempo real, troca de senha.
> Árvore auditada: branch `feat/f71-s10` com correções não commitadas.
> **Veredito final:** **APROVADO COM RESSALVAS** — nenhum CRITICAL/HIGH aberto. O HIGH original (F-01) e os
> MEDIUM de runtime (F-02, F-03) foram corrigidos e re-verificados; os MEDIUM restantes (F-04..F-07) estão
> encaminhados a slots (S11, S12, S15) e não bloqueiam o merge do S10, mas bloqueiam o go-live público
> dos fluxos afetados enquanto não entregues (ver "Riscos residuais").

## Sumário executivo

A primeira passada reprovou a fase por F-01: `/api/v1/**` (API key) ignorava o modo só leitura (PoC: POST
`upsert_contact` em empresa `expired` retornava 200). Após as correções, o PoC foi refeito contra o Postgres real
(teste `apps/api/src/routes/v1/routes.test.ts`, bloco "modo só leitura por assinatura (F71, F-01)": cria workspace
por caso, chave com todos os escopos, monta `createV1Router()`): `expired`, `canceled` e `trial` vencido dão **402
`subscription_inactive`** em POST e **200** em GET; `past_due` e `trial` válido seguem **200** em POST. O worker
outbound agora também é portão (F-02) e o socket revalida a sessão (F-03). Nenhuma regressão encontrada nas
correções; há observações novas de baixa severidade (N-01..N-03).

Testes executados nesta rodada (todos verdes):

- API: `src/middlewares src/socket src/routes/v1 src/auth src/routes/workspace src/routes/members` — 29 arquivos, 421 testes.
- Workers: `src/outbound src/lib` — 8 arquivos, 92 testes.

## Modelo de ameaça (T1–T9) — status pós-correção

| # | Ameaça | Status | Prova |
|---|---|---|---|
| T1 | Convite forjado/reutilizado/expirado | OK | token só como hash (CHECK rejeita plaintext), uso único, expiração; testes de invite.ts e invites.integration.test.ts |
| T2 | Convite escalando para OWNER | OK | CHECK da tabela rejeita OWNER (PoC em 2 workspaces na 1ª passada); Zod no boundary |
| T3 | Vazamento cross-workspace de convites | OK | RLS de member_invites provada por PoC (2 workspaces); migração 0094 verificada |
| T4 | Aceite com conta/e-mail errado | OK (ressalva F-08) | exige login ou prova de e-mail do convidado; respostas uniformes; agora com auditoria (F-16) |
| T5 | Takeover de conta no cadastro | OK com ressalva (F-07 estrutural, S15) | prova de e-mail exigida; pre-hijack segue como risco estrutural até S15 |
| T6 | Membro bloqueado/removido mantém acesso | OK (era parcial) | HTTP: requireAuth por request; socket: disconnect imediato + revalidação 60 s (F-03) |
| T7 | Escrita com assinatura inativa por canais paralelos | OK (era FALHA) | /api/v1 402 (F-01, PoC real); outbound com portão (F-02, subscription-gate.test.ts, 8 testes) |
| T8 | View-as escalando para escrita/outra identidade | OK | read-only duro; claim de outro member 403; agora por authUserId (F-13) |
| T9 | Abuso de endpoints públicos (signup, senha) | OK | balde signup_ip 10/h; me_password 10/15 min (F-09/F-10) |

## Achados F-01 .. F-18

| ID | Sev. | Status | Resumo / PoC | Referência |
|---|---|---|---|---|
| F-01 | ALTO | CORRIGIDO | /api/v1 ignorava só-leitura. lookupApiKey faz innerJoin workspaces e traz status e trial_ends_at; requireApiKey responde 402 em método não seguro quando inativa (trial vencido conta como expirado). PoC refeito: 402/200 conforme acima. | apps/api/src/middlewares/api-key.ts:112-120, apps/api/src/services/api-keys.ts |
| F-02 | MÉDIO | CORRIGIDO | Worker outbound enviava ao provider com empresa inativa. Portão antes de resolver canal e consent: falha permanente skipped_subscription_inactive, mensagem vira failed, sem retry. typing_indicator isento. past_due e trial válido enviam (testado). | apps/workers/src/outbound/worker.ts:240-262, apps/workers/src/lib/subscription-gate.ts |
| F-03 | MÉDIO | CORRIGIDO | Socket autenticava só no handshake. Agora: disconnectMemberSockets (room member:ID, disconnectSockets via adapter Redis) ao bloquear, inativar ou remover; timer de 60 s re-resolve a sessão (token inválido ou membro diferente derruba; indisponibilidade de infra mantém). Reconexão recusada (handshake exige membership active). | apps/api/src/socket/revalidate.ts, member-disconnect.ts, index.ts; apps/api/src/routes/workspace/workspace.ts:274,330 |
| F-04 | MÉDIO | ENCAMINHADO ao slot F71-S12 | Empresa ativa global por navegador (cookie): abas com empresas diferentes operam na última escolhida. Correção: header X-Workspace-Id por aba validado contra membership. | slot S12 |
| F-05 | MÉDIO | ENCAMINHADO ao slot F71-S11 | Sentry no web sem scrubbing (beforeSend) pode enviar URL com token ou PII. | slot S11 |
| F-06 | MÉDIO | ENCAMINHADO ao slot F71-S11 | Web sem headers de segurança (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy). | slot S11 |
| F-07 | MÉDIO | ENCAMINHADO ao slot F71-S15 (estrutural) e S19 (adjacente) | Pre-hijack: quem cadastra o e-mail alheio antes do dono define a senha. Mitigado pela prova de e-mail; fecha com verify define a senha (S15). Nota adjacente (poluição ao provisionar empresa para conta confirmada) revertida por decisão de produto (spec, seção 1 item 3) e vira S19. | slots S15, S19; apps/api/src/auth/signup.ts |
| F-08 | BAIXO | ENCAMINHADO ao slot F71-S13 | Preview do convite expõe requiresEmailProof (oráculo de existência de conta). | slot S13 |
| F-09 | BAIXO | CORRIGIDO | Troca de senha aceitava mínimo 8 e sem teto. Agora strongPassword (mínimo 10, letra e número) e rate limit 10 a cada 15 min por IP. | apps/api/src/routes/members/me.ts:72-86,116 |
| F-10 | BAIXO | CORRIGIDO | Signup sem teto por IP (variar e-mail escapava). Balde signup_ip 10 por hora antes do balde IP+e-mail. | apps/api/src/auth/routes.ts (signupIpLimiter) |
| F-11 | BAIXO | ENCAMINHADO ao slot F71-S14 | upsertMemberFromInvite pode reativar membro blocked em corrida (aceite x bloqueio); a API já nega o aceite de bloqueado, falta a trava no pacote. | slot S14; packages/db |
| F-12 | BAIXO | ACEITO | completeAccount roda antes do claim do convite; falha entre os dois deixa conta completa sem membership, recuperável pelo reaceite. Sem ganho de acesso. | apps/api/src/auth/invite.ts |
| F-13 | BAIXO | CORRIGIDO | View-as exigia member.id igual a adminMemberId; com outra empresa ativa o admin legítimo ficava trancado. Agora compara authUserId com a membership do claim, que deve seguir is_platform_admin e active (fail-closed). Claim de outra pessoa: 403 (teste dedicado). | apps/api/src/middlewares/impersonation.ts:112-139 |
| F-14 | INFO | ACEITO | is_platform_admin é por linha de members; promover em uma empresa não escala em outras. Sem escalada comprovada. | ver respostas abaixo |
| F-15 | BAIXO | ENCAMINHADO (S11 e S13) | Token do convite pode aparecer em next= do login e em logs ou Referer; aceite inline (S13) e fragmento (S11) removem o caminho. | slots S11, S13 |
| F-16 | BAIXO | CORRIGIDO | Aceites negados sem trilha. Ação member.invite_accept_denied (actorType system), metadata só com reason (enum fechado) e emailMasked; nunca token, hash, prova ou e-mail completo; best-effort (falha de auditoria não muda a resposta uniforme). | apps/api/src/auth/invite.ts (auditDenied), apps/api/src/routes/workspace/invites.ts |
| F-17 | INFO | ENCAMINHADO ao slot F71-S14 | findPendingByTokenHash depende dos papéis do Postgres e do RLS FORCE; documentar e testar o contrato de papel. | slot S14 |
| F-18 | INFO | PARCIAL: comentário CORRIGIDO; resto ENCAMINHADO (S14, S18) | Comentário de invite.ts ajustado (fragmento, não query). Pendentes: REDACT_PATHS do logger, /metrics público (rede interna), XFF cru, hit() do rate limit não atômico, departmentId do convite não aplicado, last_owner. | slots S14, S18 |

## Respostas explícitas

1. **Lacuna /api/v1 + outbound: resolvida?** Sim. /api/v1 bloqueia escrita com 402 (PoC em Postgres real, 5 cenários) mantendo GET 200. Outbound bloqueia envio ao provider para expired, canceled e trial vencido, sem bloquear typing_indicator, past_due nem trial válido. Os demais workers já tinham portão (S06/S07).
2. **Risco S03 view-as:** controlado. Read-only duro, sem rotas de plataforma ou secret, claim de outro member recusado (403, testado), expiração e auditoria preservadas. F-13 troca a identidade comparada para authUserId e mantém fail-closed.
3. **Risco S03 is_platform_admin:** aceito (F-14). O flag vive por linha de members; não há caminho para usuário comum ou convidado defini-lo (convite não carrega o campo, Zod estrito) e o view-as revalida a membership no banco a cada request. Sem escalada comprovada.

## Observações novas da re-verificação (sem regressão)

- **N-01 (BAIXO, aceito):** o 402 do requireApiKey vem antes do rate limit. Só responde a quem já provou posse de chave válida, e o status da assinatura é dado que o titular já enxerga; não é oráculo para terceiros. Escritas rejeitadas não consomem a cota da chave (cada uma ainda faz um lookup no banco).
- **N-02 (BAIXO):** a revalidação do socket cria um timer e uma resolução de sessão (banco e provider) por socket a cada 60 s; em escala alta, considerar jitter ou batch por membro. Troca de empresa ativa em outra aba derruba o socket antigo (a resolução cai em outro membro); o cliente precisa reconectar (confirmar na UX do S12).
- **N-03 (INFO):** o portão do outbound falha fechado para empresa inexistente (not_found) e propaga exceção de banco para o retry normal da fila; mensagem de empresa inativa vira failed visível, sem reenvio automático ao pagar (reenvio manual).
- Corrida do disconnect: o desconector roda após o commit e a reconexão é recusada pelo handshake (membership active); não há janela de reentrada. Falha do desconector é engolida e o timer fecha em até 60 s.

## Riscos residuais e pendências humanas

- **Supabase (manual, antes do go-live):**
  - Atualizar os templates de e-mail (Invite user, Magic link, Confirm signup, Reset password) para linkar com token_hash no fragmento (#token_hash=...&type=...), conforme runbook supabase-auth-emails.md (depende do web do S11).
  - Desligar "Allow new users to sign up" para que só a API (service key) crie contas.
  - Conferir o comportamento do GoTrue com "Confirm signup" para conta não confirmada (reenvio ou atualização de senha), pois afeta o pre-hijack (F-07).
  - Configurar SMTP próprio (o padrão do Supabase tem limite e remetente genérico).
  - Definir AUTH_EMAIL_REDIRECT_URL e SUPABASE_SERVICE_KEY nos ambientes (service key jamais no web).
- **Backfill:** revisar a lista de empresas postas em trial pelo backfill (trial vencido vira só leitura imediatamente, inclusive por /api/v1 e outbound agora).
- **Abertos MEDIUM (F-04..F-07):** web sem headers/CSP e Sentry sem scrubbing (S11), empresa ativa por aba (S12), pre-hijack estrutural (S15). Não abrir o cadastro publicamente antes de S11 e S15.
- **Abertos BAIXO/INFO:** F-08, F-11, F-15, F-17, F-18 (S13, S14, S18). S16 e S17 são UX, sem impacto direto de segurança; o backend é a fonte da verdade.

## O que NÃO foi verificado

- Supabase real (GoTrue, templates, SMTP, Confirm signup de conta não confirmada): só fakes e provider mockado.
- Socket ao vivo com múltiplas instâncias e adapter Redis: disconnect verificado por leitura e testes unitários (fakes), sem PoC de duas instâncias.
- Providers reais de canais (Meta/WAHA) no outbound: testado com fakes.
- Headers do web em produção, Sentry real e várias abas (S11 e S12 ainda sem código).
- Entrega de e-mail, carga e performance da revalidação de sockets, pentest externo.
