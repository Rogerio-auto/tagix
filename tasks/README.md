# tasks/ — sistema de slots para delegação de agentes

Este diretório coordena o desenvolvimento multi-agente do `tagix`. Cada unidade de
trabalho é um **slot**: um vertical slice com fronteira de arquivos explícita.

## Arquivos

- `PROTOCOL.md` — contrato lido por todo agente (ciclo de vida, regras invioláveis).
- `STATUS.md` — board derivado (gerado por `slot.py sync`; **não edite à mão**).
- `COMMS.md` — log append-only de mensagens entre agentes (criado no primeiro uso).
- `_TEMPLATE.md` — template de slot novo.
- `slot.config.json` — config do `slot.py` (especialistas por path, fases, validação).
- `slots/F<n>/` — slot files por fase.

## CLI

Tudo via `python scripts/slot.py` (Python 3.10+, stdlib-only). Veja `PROTOCOL.md`.

## Fluxo de criação de slots

Os slots de cada fase saem da decomposição das specs em `docs/` pela skill `/hm-tasks`.
A fase F0 (Fundação) está mapeada no `docs/ROADMAP.md` (F0-S01 … F0-S14).
