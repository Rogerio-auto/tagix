# Runbook — Restaurar o banco a partir do backup de deploy

> **Quando usar:** uma migration passou, o deploy terminou, e o dado ficou errado.
> Rollback de imagem devolve o código; **não** devolve o schema nem o dado.
> **Pré-requisito:** o deploy que causou o problema gerou um dump — desde F57-S07 isso é garantido,
> e o deploy **aborta** se o dump falhar.

---

## 1. Onde está o backup

`deploy.sh` grava em `/opt/leadium/backups`, um por deploy, nomeado por timestamp UTC + sha:

```bash
ssh root@187.77.237.233
ls -lht /opt/leadium/backups | head
# leadium-20260909T143000Z-9d5a9bca.dump
```

O sha no nome é o commit **que estava sendo implantado**. Ou seja: o dump
`...-9d5a9bca.dump` é o estado do banco **antes** das migrations de `9d5a9bca`.

Retenção: os 10 mais recentes (`BACKUP_KEEP`). Deploys antigos são podados.

---

## 2. Decida o que você quer

Restaurar é destrutivo — o `--clean` derruba objetos antes de recriar. Antes de rodar, saiba qual
dos dois casos é o seu:

| Situação | O que fazer |
|---|---|
| A migration corrompeu ou apagou dado | Restore completo (§3) |
| A migration está certa, mas o **código** quebrou | **Não restaure.** Faça rollback da imagem (`rollback-deploy.md`) — o schema novo geralmente é compatível com o código antigo quando a migration foi aditiva |
| Só uma tabela ficou errada | Restore seletivo (§4) — muito menos arriscado |

**A pergunta que decide:** a migration foi aditiva (coluna nova, tabela nova) ou destrutiva
(coluna removida, tipo alterado)? Aditiva quase nunca precisa de restore.

---

## 3. Restore completo

```bash
ssh root@187.77.237.233
set -a; . /opt/leadium/.env; set +a
PG=$(docker ps --format '{{.Names}}' | grep '^leadium_postgres' | head -1)
DUMP=/opt/leadium/backups/leadium-20260909T143000Z-9d5a9bca.dump

# 1) Pare quem escreve, para não gravar por cima durante o restore.
docker service scale leadium_api=0 leadium_workers=0

# 2) Segurança: um dump do estado ATUAL, antes de sobrescrevê-lo.
#    Se o restore for a decisão errada, este é o caminho de volta.
docker exec "$PG" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > /opt/leadium/backups/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).dump

# 3) Restore.
docker exec -i "$PG" pg_restore -U "$PG_USER" -d "$PG_DB" --clean --if-exists < "$DUMP"

# 4) Volte os serviços.
docker service scale leadium_api=1 leadium_workers=1
```

O passo 2 não é excesso de zelo: restore é decisão tomada sob pressão, e é comum descobrir depois
que o problema era outro.

---

## 4. Restore seletivo (uma tabela)

Menos arriscado e quase sempre suficiente:

```bash
docker exec -i "$PG" pg_restore -U "$PG_USER" -d "$PG_DB" \
  --data-only --table=contacts --disable-triggers < "$DUMP"
```

`--disable-triggers` evita que a reinserção dispare os hooks de aplicação. **RLS continua valendo** —
o restore roda como owner do banco, então confira o `workspace_id` das linhas depois.

---

## 5. Depois de restaurar

1. **Confira a contagem** das tabelas que importam:
   ```bash
   docker exec "$PG" psql -U "$PG_USER" -d "$PG_DB" -tAc \
     "select 'contacts='||count(*) from contacts; select 'messages='||count(*) from messages;"
   ```
2. **Verifique o `schema_migrations`.** Se você restaurou para antes das migrations, o Drizzle vai
   querer reaplicá-las no próximo deploy — o que é o comportamento certo, mas precisa ser
   intencional.
3. **Registre o incidente** em `docs/audits/`: qual migration, qual dump, o que se perdeu entre o
   dump e o restore.

---

## 6. O que este backup NÃO cobre

Ele é um retrato do **momento do deploy**. Tudo que entrou entre o dump e o incidente se perde no
restore completo — se o problema só apareceu horas depois, você perde essas horas.

A resposta certa para isso é backup contínuo com PITR (`wal-g` ou `pgbackrest`), que está fora do
escopo do F57-S07 de propósito e merece slot próprio. Este runbook fecha o buraco agudo do deploy,
não o problema geral de recuperação.
