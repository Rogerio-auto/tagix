---
id: F15-S09
title: IG App Review runbook + opt-out keyword parity + PII redact docs
phase: F15
status: available
priority: low
estimated_size: S
depends_on: []
agent_id: general-purpose
source_docs:
  - docs/features/INSTAGRAM.md
---

# F15-S09 — IG App Review runbook + opt-out + redact

> **source_docs:** `docs/features/INSTAGRAM.md` §15, §17
> **blocks:** —

## Objetivo

Fechar os itens de compliance/operacional do canal IG que não dependem do pipeline: o runbook de App Review da Meta (documentação de uso de cada permission, em especial `instagram_manage_comments`), e a documentação da paridade de opt-out por keyword (STOP/PARAR/SAIR/CANCELAR) + regra de redação de PII (igsid/username) nos logs.

## Contexto

Itens transversais de INSTAGRAM.md §15 (segurança/compliance). O App Review é pré-requisito de produção do canal; o opt-out e o redact são regras que o pipeline (S03/S04) aplica, mas a documentação/checklist mora aqui. Slot independente (docs) — pode rodar em paralelo desde o início.

## Escopo (faz)

- `docs/runbooks/meta-app-review-instagram.md` (novo): para cada permission IG usada (instagram_basic, instagram_manage_messages, instagram_manage_comments, pages_*), o caso de uso, screencast/checklist e justificativa — pronto para submissão.
- `docs/features/INSTAGRAM.md` (apêndice opt-out/redact) **ou** `docs/runbooks/`: documentar a paridade de opt-out keyword IG↔WA e a regra de Pino redact para `igsid`/`username`.

## Fora de escopo

- Implementar opt-out/redact no código (é regra aplicada por F15-S03/S04 — aqui é só doc/checklist).

## Arquivos permitidos

- `docs/runbooks/meta-app-review-instagram.md`
- `docs/runbooks/ig-compliance-optout-redact.md`

## Arquivos proibidos

- Código de produção (este slot é só docs).

## Definition of Done

- [ ] Runbook de App Review cobre cada permission IG com caso de uso + justificativa submetível.
- [ ] Doc de opt-out keyword parity + PII redact (igsid/username) clara e acionável.

## Validação

```bash
test -f docs/runbooks/meta-app-review-instagram.md
test -f docs/runbooks/ig-compliance-optout-redact.md
```

## Notas

- Executor: **general-purpose** (docs). Independente — pode ser pego junto do F15-S01.
