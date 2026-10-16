---
id: F75-S13
title: Portão de segurança da F75 — SSRF, cofre, isolamento entre empresas, webhook público e injeção via dado externo
phase: F75
status: blocked
priority: critical
estimated_size: M
model: opus
depends_on: [F75-S03, F75-S04, F75-S06, F75-S07, F75-S08, F75-S12, F75-S14, F75-S16]
blocks: [F75-S15]
source_docs:
  - docs/features/INTEGRACOES.md
  - docs/decisions/ADR-005-conectores-cofre-e-loja-de-integracoes.md
agent_id: security-auditor
---
# F75-S13 — Auditoria de segurança (portão `/hm-security`)

## Objetivo

Nenhum caminho da F75 deixa uma empresa ler ou escrever dado de outra, alcançar a rede interna, vazar
credencial, ser enganada por dado do ERP ou receber escrita indevida no sistema externo. Cada ameaça da spec §8
tem prova de conceito tentada e resultado registrado. Sem veredito APROVADO, a F75 não vai para produção.

## Contexto

Ameaças T1–T11 da spec §8, ADR-005 §3–§6. O `security-auditor` só lê e executa: achados viram slots de correção
(`F75-S17+`) criados pelo orquestrador; este slot não corrige código.

## Escopo (faz)

Rodar a skill `/hm-security` sobre o diff da F75 e, no mínimo:

- **T1 SSRF:** `ctx.fetch`, `generic-rest`, OAuth `tokenUrl`, MCP URL e o port do flow-engine (S16): IPs
  privados, `169.254.169.254`, IPv6 local, DNS rebinding (TTL 0 alternando), redirect para interno, esquema
  `file:`/`gopher:`, porta não padrão.
- **T2 multi-tenant:** RLS de todas as 12 tabelas com o papel `hm_app` e `app.workspace_id` vazio
  (`rls-empty-guc`), FKs compostas, `integration_endpoint_lookup` (o que devolve), troca de `connectionId` de
  outra empresa em toda rota `/api/integrations/connections/:id/*`, socket `integration:event` só na sala certa,
  chaves Redis por workspace.
- **T3 segredo:** grep de log/erro/resposta/Sentry em execução de teste com credencial marcada; `fingerprint`
  só 4 caracteres; lint do vault ativo; AAD impede mover ciphertext entre linhas; keyring e job de recifra.
- **T4/T5 injeção:** exemplo de mapeamento com instrução maliciosa, nome de produto com `<script>`, célula
  `=HYPERLINK(...)` no CSV de rejeitados, caminho `__proto__` no mapeamento.
- **T6 webhook público:** oráculo de 401, timing, replay, flood, 256 KB, JSON profundo.
- **T7 OAuth:** `state` reusado/expirado/de outro membro, PKCE, redirect aberto em `?erro=`.
- **T8 escrita:** `push` sem confirmação, conector SQL/MCP com `push`, Copiloto (ainda não existe: confirmar que
  nenhuma ferramenta escreve).
- **T9 planilha:** zip bomb, 50 mil+1 linhas, encoding hostil.
- **T10/T11:** contagem de pedidos entre empresas só devolve número; rotação de chave ponta a ponta no dev.
- Rever autorização por papel em todas as rotas contra a spec §7.

## Fora de escopo

- Corrigir (vira slot novo). Pentest de infraestrutura (Nginx, TLS) — fica para o `/hm-deploy`.

### files_allowed

- `tasks/slots/F75/F75-S13-auditoria-de-seguranca-das-integracoes.md`
- `docs/audits/f75-integracoes-seguranca.md`

## Definition of Done

- [ ] relatório `docs/audits/f75-integracoes-seguranca.md`: cada T1–T11 com PoC executada, evidência
      (comando/saída), severidade e status
- [ ] achados `critical`/`high` listados como slots de correção propostos (título, arquivos, DoD) para o
      orquestrador criar
- [ ] veredito final APROVADO / REPROVADO nas notas deste slot

## Validação

```bash
pnpm typecheck
node --env-file=.env packages/db/node_modules/vitest/vitest.mjs run --root packages/db src/rls.test.ts src/rls-empty-guc.test.ts --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/services/integrations src/routes/integrations src/routes/integrations-inbound --maxWorkers=1
```

## Notas

- Agente: `security-auditor` (`model: opus`).
