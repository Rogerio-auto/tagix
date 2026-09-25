"""F70-S22: o deploy.sh migra ANTES de subir o código novo.

Achado HIGH-1 da auditoria pré-deploy de 25/09: o script fazia `docker stack deploy` e só depois
migrava. Com start-first, a api e os workers novos entravam no ar contra o schema velho (tabela
`outbox` inexistente, colunas da 0088 faltando) e, se a migração falhasse, ficavam assim.

O teste roda o deploy.sh de verdade, no bash, com `docker`, `git` e `sleep` falsos no PATH. Os
falsos só registram cada chamada num arquivo e devolvem o que o script espera; nada fala com um
Docker de verdade. O compose usado é o de produção, copiado, então o recorte da primeira
instalação é testado contra o arquivo real.

Rodar: python -m pytest -q scripts/tests/test_deploy_order.py
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEPLOY_SH = REPO / "scripts" / "deploy.sh"
PROD_COMPOSE = REPO / "infra" / "docker" / "docker-compose.prod.yml"
SHA = "abc1234"

FAKE_DOCKER = r"""#!/usr/bin/env bash
# docker falso: registra a chamada e responde como um Swarm saudável.
st="$FAKE_STATE"
printf 'docker %s\n' "$*" >> "$st/calls.log"
case "$1 $2" in
  "node ls" | "network inspect") exit 0 ;;
  "compose --env-file") exit 0 ;;
  "service inspect") [ -f "$st/postgres_service" ]; exit $? ;;
  "stack deploy")
    file=""; prev=""
    for a in "$@"; do [ "$prev" = "-c" ] && file="$a"; prev="$a"; done
    n=$(find "$st" -maxdepth 1 -name 'stack_deploy_*' | wc -l)
    cp "$file" "$st/stack_deploy_$n.yml"
    touch "$st/postgres_service"
    exit 0 ;;
  "stack services") echo "ID NAME MODE REPLICAS IMAGE"; exit 0 ;;
  "ps --filter") [ -f "$st/postgres_service" ] && echo "leadium_postgres.1.x1y2z3"; exit 0 ;;
  "inspect --format") echo healthy; exit 0 ;;
  "service ps") svc="$3"; echo "leadium-${svc#leadium_}:$FAKE_SHA"; exit 0 ;;
esac
if [ "$1" = "exec" ]; then
  case "$3" in
    psql) echo "${FAKE_USER_TABLES:-42}"; exit 0 ;;
    pg_dump)
      [ "${FAKE_PGDUMP_RC:-0}" = "0" ] || exit "$FAKE_PGDUMP_RC"
      printf '%4096s' x; exit 0 ;;
  esac
fi
if [ "$1" = "run" ]; then exit "${FAKE_MIGRATE_RC:-0}"; fi
echo "docker falso: chamada inesperada: $*" >&2
exit 97
"""

FAKE_GIT = r"""#!/usr/bin/env bash
# git falso: o blob do deploy.sh muda depois do reset quando FAKE_SELF_CHANGES=1.
st="$FAKE_STATE"
printf 'git %s\n' "$*" >> "$st/calls.log"
case "$*" in
  "rev-parse --short HEAD") echo "$FAKE_SHA" ;;
  "rev-parse HEAD") echo "${FAKE_SHA}0000000000000000000000000000000000" ;;
  "rev-parse HEAD:scripts/deploy.sh")
    if [ "${FAKE_SELF_CHANGES:-0}" = "1" ] && [ -f "$st/reset_done" ]; then echo novo; else echo velho; fi ;;
  reset*) touch "$st/reset_done" ;;
esac
exit 0
"""

FAKE_SLEEP = "#!/usr/bin/env bash\nexit 0\n"


def _find_bash() -> str | None:
    """No Windows, o bash do Git for Windows (o `bash` do PATH pode ser o do WSL)."""
    if sys.platform == "win32":
        git = shutil.which("git")
        if git:  # Git\cmd\git.exe (PowerShell) ou Git\mingw64\bin\git.exe (Git Bash)
            for root in Path(git).resolve().parents:
                for cand in (root / "bin" / "bash.exe", root / "usr" / "bin" / "bash.exe"):
                    if cand.is_file():
                        return str(cand)
        return None
    return shutil.which("bash")


BASH = _find_bash()


def _posix(p: Path) -> str:
    return p.as_posix()


@unittest.skipIf(BASH is None, "bash indisponível")
class DeployOrderTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="deploy-order-"))
        self.app = self.tmp / "app"
        self.state = self.tmp / "state"
        self.bin = self.tmp / "bin"
        for d in (self.app / "scripts", self.app / "infra" / "docker", self.app / ".git", self.state, self.bin):
            d.mkdir(parents=True)
        shutil.copyfile(DEPLOY_SH, self.app / "scripts" / "deploy.sh")
        shutil.copyfile(PROD_COMPOSE, self.app / "infra" / "docker" / "docker-compose.prod.yml")
        (self.app / ".env").write_bytes(b"PG_USER=leadium\nPG_PASSWORD=segredo\nPG_DB=leadium\n")
        for name, body in (("docker", FAKE_DOCKER), ("git", FAKE_GIT), ("sleep", FAKE_SLEEP)):
            f = self.bin / name
            f.write_bytes(body.encode("utf-8"))
            f.chmod(0o755)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    # --- infraestrutura do teste ---------------------------------------------------------
    def _deploy(self, *, postgres_exists: bool = True, **fake_env: str) -> subprocess.CompletedProcess:
        if postgres_exists:
            (self.state / "postgres_service").touch()
        env = {k: v for k, v in os.environ.items() if not k.startswith(("FAKE_", "LEADIUM_"))}
        env.update(
            APP_DIR=_posix(self.app),
            FAKE_STATE=_posix(self.state),
            FAKE_SHA=SHA,
            TMPDIR=_posix(self.tmp),
            FAKE_BIN=_posix(self.bin),
        )
        env.pop("BACKUP_DIR", None)
        env.update(fake_env)
        # Os falsos entram no PATH DE DENTRO do bash: o bash.exe do Git for Windows põe o
        # mingw64/bin (com o git real) na frente de qualquer PATH herdado.
        launcher = (
            'b="$FAKE_BIN"; if command -v cygpath >/dev/null 2>&1; then b="$(cygpath -u "$b")"; fi; '
            'export PATH="$b:$PATH"; exec bash "$0" "$@"'
        )
        return subprocess.run(
            [BASH, "-c", launcher, _posix(self.app / "scripts" / "deploy.sh"), "main"],
            env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120,
        )

    def _calls(self) -> list[str]:
        log = self.state / "calls.log"
        return log.read_text(encoding="utf-8").splitlines() if log.exists() else []

    def _index(self, calls: list[str], needle: str) -> int:
        for i, line in enumerate(calls):
            if needle in line:
                return i
        self.fail(f"chamada com {needle!r} não aconteceu:\n" + "\n".join(calls))

    @staticmethod
    def _stack_deploys(calls: list[str]) -> list[str]:
        return [c for c in calls if c.startswith("docker stack deploy")]

    def _assert_fakes_used(self, calls: list[str]) -> None:
        # Garante que nada caiu num docker/git de verdade.
        self.assertIn("docker node ls", calls)

    # --- deploy de rotina -----------------------------------------------------------------
    def test_rotina_backup_e_migracao_vem_antes_do_stack_deploy(self) -> None:
        r = self._deploy()
        calls = self._calls()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self._assert_fakes_used(calls)

        build = self._index(calls, "docker compose --env-file")
        dump = self._index(calls, "pg_dump")
        migrate = self._index(calls, "@hm/db migrate")
        deploys = self._stack_deploys(calls)
        self.assertEqual(len(deploys), 1, deploys)
        stack = calls.index(deploys[0])
        verify = self._index(calls, "docker service ps leadium_api")
        self.assertLess(build, dump)
        self.assertLess(dump, migrate, "o backup tem de vir antes da migração")
        self.assertLess(migrate, stack, "a migração tem de vir ANTES do stack deploy")
        self.assertLess(stack, verify)

        self.assertIn("--prune", deploys[0])
        self.assertIn("docker-compose.prod.yml", deploys[0])
        # A migração roda com a imagem NOVA, na rede interna do stack.
        self.assertIn(f"leadium-api:{SHA}", calls[migrate])
        self.assertIn("--network leadium_leadium_internal", calls[migrate])
        dumps = list((self.app / "backups").glob(f"leadium-*-{SHA}.dump"))
        self.assertEqual(len(dumps), 1)

    def test_migracao_falhou_nenhum_stack_deploy(self) -> None:
        r = self._deploy(FAKE_MIGRATE_RC="1")
        calls = self._calls()
        self.assertNotEqual(r.returncode, 0)
        self._assert_fakes_used(calls)
        self.assertEqual(self._stack_deploys(calls), [], "código novo subiu com a migração falhando")
        self.assertEqual(sum("@hm/db migrate" in c for c in calls), 6, "são 6 tentativas")
        out = r.stdout + r.stderr
        self.assertIn("ANTES do stack deploy", out)
        self.assertIn("pg_restore", out, "a mensagem tem de trazer o comando de restore")

    def test_backup_falhou_nao_migra_nem_sobe(self) -> None:
        r = self._deploy(FAKE_PGDUMP_RC="1")
        calls = self._calls()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("pg_dump FALHOU", r.stdout + r.stderr)
        self.assertFalse(any("@hm/db migrate" in c for c in calls))
        self.assertEqual(self._stack_deploys(calls), [])

    # --- primeira instalação -------------------------------------------------------------
    def test_primeira_instalacao_sobe_so_o_postgres_migra_e_depois_o_resto(self) -> None:
        r = self._deploy(postgres_exists=False, FAKE_USER_TABLES="0")
        calls = self._calls()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self._assert_fakes_used(calls)

        deploys = self._stack_deploys(calls)
        self.assertEqual(len(deploys), 2, deploys)
        bootstrap, full = (calls.index(d) for d in deploys)
        migrate = self._index(calls, "@hm/db migrate")
        self.assertLess(bootstrap, migrate)
        self.assertLess(migrate, full)
        self.assertNotIn("--prune", deploys[0], "o deploy parcial não pode podar nada")
        self.assertNotIn("docker-compose.prod.yml", deploys[0])
        self.assertIn("--prune", deploys[1])
        self.assertIn("docker-compose.prod.yml", deploys[1])
        # Banco sem tabela: nada a proteger, sem dump (um dump vazio travaria a instalação).
        self.assertFalse(any("pg_dump" in c for c in calls))
        self.assertIn("backup pulado", r.stdout)

        # O compose do bootstrap é o recorte do compose de produção: só o Postgres, com a
        # rede e os volumes de nomes idênticos (senão o Postgres montaria um volume vazio).
        cut = (self.state / "stack_deploy_0.yml").read_text(encoding="utf-8")
        services = [ln.strip().rstrip(":") for ln in cut.split("volumes:")[0].split("networks:\n")[0].splitlines()
                    if ln.startswith("  ") and not ln.startswith("   ") and ln.strip().endswith(":")]
        self.assertEqual(services, ["postgres"], cut)
        self.assertIn("image: pgvector/pgvector:pg16", cut)
        self.assertIn("- leadium_pgdata:/var/lib/postgresql/data", cut)
        self.assertIn("\n  leadium_internal:\n    driver: overlay\n    attachable: true", cut)
        self.assertIn("\nvolumes:\n", cut)
        self.assertNotIn("configs:", cut)

    def test_primeira_instalacao_com_migracao_falhando_so_o_postgres_fica_no_ar(self) -> None:
        r = self._deploy(postgres_exists=False, FAKE_USER_TABLES="0", FAKE_MIGRATE_RC="1")
        calls = self._calls()
        self.assertNotEqual(r.returncode, 0)
        deploys = self._stack_deploys(calls)
        self.assertEqual(len(deploys), 1, deploys)
        self.assertNotIn("docker-compose.prod.yml", deploys[0])
        self.assertIn("Primeira instalação", r.stdout + r.stderr)

    def test_stack_removido_com_dados_faz_backup(self) -> None:
        """Serviço ausente mas volume com dados (ex.: `docker stack rm`): o backup não é pulado."""
        r = self._deploy(postgres_exists=False, FAKE_USER_TABLES="120")
        calls = self._calls()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertLess(self._index(calls, "pg_dump"), self._index(calls, "@hm/db migrate"))

    # --- re-exec (§1.1) --------------------------------------------------------------------
    def test_reexec_roda_a_versao_nova_uma_vez_e_mantem_a_ordem(self) -> None:
        r = self._deploy(FAKE_SELF_CHANGES="1")
        calls = self._calls()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("Re-executando a versão nova", r.stdout)
        self.assertEqual(sum(c.startswith("git reset --hard") for c in calls), 2, "re-exec uma vez só")
        deploys = self._stack_deploys(calls)
        self.assertEqual(len(deploys), 1)
        self.assertLess(self._index(calls, "@hm/db migrate"), calls.index(deploys[0]))


@unittest.skipIf(BASH is None, "bash indisponível")
class DeployScriptLintTest(unittest.TestCase):
    def test_bash_n(self) -> None:
        r = subprocess.run([BASH, "-n", _posix(DEPLOY_SH)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    @unittest.skipIf(shutil.which("shellcheck") is None, "shellcheck fora do PATH (rode: npx shellcheck scripts/deploy.sh)")
    def test_shellcheck(self) -> None:
        r = subprocess.run(["shellcheck", str(DEPLOY_SH)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)


if __name__ == "__main__":
    unittest.main()
