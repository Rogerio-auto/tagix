# PROTOCOL — contrato de execução de slots

> Lei para todo agente (humano ou IA) que trabalha neste repo. `tasks/STATUS.md` é
> uma **view derivada** — nunca edite à mão. Os frontmatters dos slots são a fonte
> da verdade. Toda mutação passa por `python scripts/slot.py`.

## Ciclo de vida de um slot

```
available → claimed → in-progress → review → done
```

1. **Escolher** um slot com `status: available` cujos `depends_on` estejam todos `done`:
   ```powershell
   python scripts/slot.py list-available
   ```
2. **Claim** (atômico: valida main limpo, cria branch `feat/<slot-id>`, atualiza frontmatter + STATUS.md):
   ```powershell
   python scripts/slot.py claim F0-S02
   ```
3. **Implementar** respeitando o `files_allowed` do slot. Edição fora da fronteira é violação.
4. **Validar** antes de fechar (roda o bloco `## Validação` do slot):
   ```powershell
   python scripts/slot.py validate F0-S02
   ```
5. **Finish** (marca `review`, commita chore):
   ```powershell
   python scripts/slot.py finish F0-S02
   ```
6. Abrir PR / pedir review. Após merge em `main`:
   ```powershell
   python scripts/slot.py done F0-S02 --pr-url <url>
   ```

## Regras invioláveis

- **Nunca** edite `STATUS.md` à mão. Use `python scripts/slot.py sync`.
- **Nunca** crie branch manual (`git checkout -b`). O `claim` cria com o nome canônico.
- **Worker só toca o slot que claimou.** Precisa mexer em arquivo de outro slot? Escreve em `tasks/COMMS.md` e pede — não toca.
- **`files_allowed` é fronteira sagrada.** Se sentir vontade de "editar rapidinho um arquivo de fora", PARE e crie um sub-slot.
- **Todo slot que cria tabela com `workspace_id` inclui RLS policy no mesmo PR** (DoD obrigatório).
- **Sem `any`, sem dívida.** Padrão world-class do `CLAUDE.md` global vale em todo slot.
- **COMMS.md é append-only.** Audit trail; nunca apague linhas.

## Comandos úteis

```powershell
python scripts/slot.py status            # board compacto
python scripts/slot.py status --phase F0 # só a fase F0
python scripts/slot.py brief F0-S02      # briefing self-contained de um slot
python scripts/slot.py plan-batch --size 4   # lote paralelizável (sem overlap de files)
python scripts/slot.py sync              # regenera STATUS.md a partir dos frontmatters
```

> Decomposição de uma spec em slots: use a skill `/hm-tasks` (lê PRD/ARCHITECTURE/feature docs e gera os slots da fase).
