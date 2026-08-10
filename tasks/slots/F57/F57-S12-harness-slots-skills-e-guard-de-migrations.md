---
id: F57-S12
title: Harness de slots — guard de migrations ligado, fases nomeadas, skills instaladas
phase: F57
status: available
priority: medium
estimated_size: S
depends_on: []
blocks: []
agent_id: orchestrator
source_docs:
  - tasks/slot.config.json
  - tasks/PROTOCOL.md
  - docs/audits/2026-08-08-fundacao-hm-init.md
---

# F57-S12 — O guard anti-colisão de migrations está desligado

> **Origem:** auditoria de fundação (/hm-init, 2026-08-08). Este slot conserta o
> harness que executa todos os outros.

## Objetivo

Ligar as proteções do sistema de slots que existem no `slot.py` mas estão desativadas
na config, e restaurar as skills de slot que faltam.

## Contexto / causa raiz (verificada)

### 1. `check-migrations` desligado num repo com 67 migrations

`tasks/slot.config.json`:

```json
"migrations": { "enabled": false, "path": null, "journal_path": null }
```

Mas o repo tem **67 arquivos `.sql`** em `packages/db/drizzle/` com journal em
`packages/db/drizzle/meta/`. O `scripts/slot.py` expõe o subcomando
`check-migrations` ("Verifica sincronia entre .sql e journal — opt-in via
slot.config.json") — e o opt-in nunca foi feito.

Migration é **o** recurso mais colidível em desenvolvimento paralelo por agentes:
dois slots geram `0067_*.sql` simultaneamente, ambos passam no `validate`, e o
conflito só aparece no merge — ou pior, no `deploy.sh` da produção. O histórico do
repo confirma que já mordeu: commit `99956380` — *"fix(db): registra no journal a
migration 0066"*, exatamente uma dessincronia `.sql` ↔ journal.

A ferramenta para prevenir isso já está escrita. Só está desarmada.

### 2. Metade das fases sem nome

`slot.config.json` → `phases` nomeia F0–F10, F38 e F41. O board tem **F0–F56**.
Fases F15, F25–F37, F39, F40, F42–F56 (a maior parte das 407 entregas) aparecem no
`STATUS.md` sem rótulo. Custa legibilidade a cada `slot.py status`.

### 3. As 12 skills de slot não estão no repo

`git ls-files .claude` lista **só** os 7 agentes (`orchestrator`, 5 engineers, `qa`,
`security-auditor`). Não há `.claude/skills/`. O template do `/hm-init` instala 12:
`slot-status`, `slot-claim`, `slot-finish`, `slot-validate`, `brief`, `plan-batch`,
`auto-review`, `slot-reconcile`, `preflight`, `open-pr`, `slot-next`, `worktree-clean`.

Sem elas, todo agente cai no `python scripts/slot.py …` cru — funciona, mas perde os
atalhos e as convenções que o harness assume, e cada agente reinventa a invocação.

Fonte: `C:\Users\roger\.claude\skills\hm-init\templates\tasks-system\.claude\skills\`.

### 4. `settings.local.json` não versionado

`.claude/settings.local.json` aparece como `??` no `git status`. Confirmar se deve
estar no `.gitignore` (é local por definição) — hoje não está em nenhum dos dois
lados, o que convida a commit acidental.

## Escopo (faz)

- Ligar `migrations` no `slot.config.json` com `path: "packages/db/drizzle"` e
  `journal_path: "packages/db/drizzle/meta/_journal.json"`; validar com
  `python scripts/slot.py check-migrations`.
- Completar o mapa `phases` com F11–F57 (usar os títulos reais do `docs/ROADMAP.md`
  e dos slots de cada fase); adicionar F57.
- Copiar as 12 skills do template para `.claude/skills/` e versioná-las.
- Adicionar `.claude/settings.local.json` ao `.gitignore`.
- Registrar em `tasks/PROTOCOL.md` que `check-migrations` roda no `validate`.

## Escopo (não faz)

- Alterar `scripts/slot.py` (a ferramenta está correta; só a config está errada).
- Reescrever slots de fases passadas.

## Arquivos permitidos

- `tasks/slot.config.json`
- `tasks/PROTOCOL.md`
- `tasks/README.md`
- `.claude/skills/**`
- `.gitignore`
- `CLAUDE.md`

## Arquivos proibidos

- `scripts/slot.py`
- `tasks/STATUS.md` (view derivada — só via `slot.py sync`)
- `tasks/slots/F0/**` … `tasks/slots/F56/**` (histórico é imutável)

## Definition of Done

- [ ] `python scripts/slot.py check-migrations` roda e passa (ou aponta divergência
      real, que então é corrigida).
- [ ] `python scripts/slot.py status` mostra nome para **toda** fase, F0→F57.
- [ ] As 12 skills presentes e versionadas em `.claude/skills/`.
- [ ] `.claude/settings.local.json` ignorado pelo git.
- [ ] `python scripts/slot.py sync` roda limpo e `STATUS.md` fica consistente.

## Validação

```bash
python scripts/slot.py check-migrations
python scripts/slot.py sync
python scripts/slot.py status
```

## Notas

- Este é o slot com melhor razão esforço/retorno da fase: config de ~10 linhas que
  liga uma proteção já escrita e testada contra a classe de colisão que este repo
  **já sofreu** uma vez.
- Faça-o antes de rodar `/hm-tasks` para gerar F58+, para que os novos slots nasçam
  com o guard ativo.
