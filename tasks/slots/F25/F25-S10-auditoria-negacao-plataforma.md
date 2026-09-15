---
id: F25-S10
title: Tentativa negada à camada de plataforma podia não ficar registrada — auditoria antes da resposta
phase: F25
status: done
priority: high
estimated_size: S
depends_on: [F25-S01]
blocks: []
source_docs:
  - docs/INDEX.md
agent_id: security-auditor
claimed_at: 2026-09-15T14:23:22Z
completed_at: 2026-09-15T14:56:14Z

---
# F25-S10 — Tentativa negada à camada de plataforma podia não ficar registrada

## Objetivo

Toda tentativa negada de acessar a camada de plataforma fica em `audit_logs` antes de o 403 sair; se
a gravação falhar, a falha aparece no log em vez de sumir.

## Contexto

Encontrado em 2026-09-15, investigando uma falha intermitente em
`platform/help.test.ts > não-admin → 403 e auditado` durante a F2-S22 (a falha acontecia com e sem a
correção daquele slot).

`requirePlatformAdmin` (`apps/api/src/middlewares/platform-admin.ts`) chama `void auditDenied(req)` e
responde 403 **na mesma hora**. A gravação da auditoria corre depois da resposta:

1. **O teste corre contra a gravação.** Consulta `audit_logs` logo após o 403 e às vezes chega antes
   da linha existir. Daí a intermitência.
2. **Falha de gravação some.** `auditDenied` engole qualquer erro num `catch {}` vazio. Se o banco
   recusar a linha, ninguém fica sabendo.

É a trilha de tentativas contra a camada mais sensível do produto (super-admin, segredos da
plataforma, impersonação). Uma trilha que pode faltar sem aviso não serve como prova de nada.

## Escopo

### files_allowed

- `apps/api/src/middlewares/platform-admin.ts`
- `apps/api/src/middlewares/platform-admin.test.ts`
- `apps/api/src/routes/platform/help.test.ts`
- `apps/api/src/routes/platform/models.test.ts`

### files_forbidden

- `packages/db/**`

## Escopo (faz)

- Aguardar a gravação da auditoria antes de responder 403. É o caminho raro (negação), então o custo
  de uma escrita a mais é aceitável.
- Falha na gravação continua sem derrubar a negação (o 403 sai igual), mas é registrada no log com o
  motivo — nunca silenciosa.
- Testes que conferem a auditoria filtram pelo membro que tentou (`actor_member_id`), não pela ação
  global: hoje qualquer linha antiga de outro teste satisfaz a asserção.
- Teste de que falha na gravação não impede o 403 e gera log.

## Definition of Done

- [x] 403 só sai depois de a linha estar em `audit_logs`. *(teste com gravador lento: falhava antes da correção, passa depois)*
- [x] Falha na gravação gera log de erro e o 403 continua saindo. *(teste com gravador que falha: nenhum log antes, um depois)*
- [x] `help.test.ts`, `models.test.ts` e `platform-admin.test.ts` conferem a linha do próprio membro. *(`models.test.ts` não confere auditoria — nada a mudar)*
- [x] `platform/help.test.ts` passa 20 vezes seguidas. *(30 de 30 no código final)*

## Resultado (2026-09-15)

- **O teste antigo não provava nada.** Com a espera de 150 ms removida, os dois testes de auditoria
  passaram 10 de 10 **antes** da correção: contra o Postgres local a gravação quase sempre vence a
  consulta. A prova veio de um gravador injetável (lento e com falha), que tornou a ordem e a falha
  determinísticas.
- **Falha intermitente não explicada.** Com a primeira versão da correção, `help.test.ts` passou 19 de
  20 — a saída foi descartada e a falha não foi identificada. No código final passou 30 de 30. A
  causa daquela falha continua desconhecida; se voltar, capturar a saída antes de concluir.
- **Revisão de segurança** (agente `security-auditor`): sem crítico nem alto. Corrigidos neste slot:
  - logger que lança transformava a negação em 500 → registro protegido, 403 sempre;
  - banco travado segurava o 403 até ~30s → espera máxima de 2s, `audit_timeout` no log;
  - `req.originalUrl` levava query string para a trilha e o log → caminho sem query;
  - erro do Drizzle anexa `params` → mensagem cortada em 300 caracteres.
  Cada um tem teste próprio (9 no arquivo).
- **Fora do escopo, virou slot:** nenhuma rota `/api/platform/*` tem limite de taxa (média, anterior a
  esta mudança) → F25-S11.
- `@hm/api` 1165/1165 no código final (1161/1161 na primeira versão); typecheck e lint limpos;
  auto-review sem achados.

## Validação

```bash
pnpm --filter @hm/api test
pnpm typecheck
pnpm lint
```
