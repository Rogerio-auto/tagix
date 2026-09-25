"""Regressão do incidente de 2026-09-22: limpar um worktree não pode apagar nada do checkout principal.

O `slot.py validate` cria junctions de node_modules no worktree apontando para o main, e o
node_modules do main aponta para packages/* (como o pnpm faz). No Windows, `git worktree remove
--force` atravessa essas junctions e esvazia packages/* do main. O `worktree-clean` passou a
desfazer os links antes de remover.

Rodar: python -m unittest scripts/tests/test_worktree_clean.py -v
"""
from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SLOT_PY = Path(__file__).resolve().parent.parent / "slot.py"
_spec = importlib.util.spec_from_file_location("slot", SLOT_PY)
slot = importlib.util.module_from_spec(_spec)
sys.modules["slot"] = slot  # dataclasses do slot.py consultam o módulo registrado
_spec.loader.exec_module(slot)  # type: ignore[union-attr]


def _run(*args: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(list(args), cwd=cwd, capture_output=True, text=True)


def _link_dir(link: Path, target: Path) -> None:
    link.parent.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], check=True, capture_output=True)
    else:
        link.symlink_to(target, target_is_directory=True)


class WorktreeCleanTest(unittest.TestCase):
    """Monta o mesmo desenho do incidente num repositório git descartável."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="wtclean-"))
        self.main = self.tmp / "main"
        self.pkg_file = self.main / "packages" / "db" / "src" / "index.ts"
        self.pkg_file.parent.mkdir(parents=True)
        self.pkg_file.write_text("export const ok = true;\n", encoding="utf-8")
        (self.main / ".gitignore").write_text("node_modules/\n", encoding="utf-8")
        for cmd in (["git", "init", "-q"], ["git", "add", "-A"],
                    ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]):
            _run(*cmd, cwd=self.main)
        # node_modules do main aponta para o pacote do workspace
        _link_dir(self.main / "apps" / "web" / "node_modules" / "@hm" / "db", self.main / "packages" / "db")
        # worktree com o link criado por _link_node_modules_for_validate
        self.wt = self.tmp / "worktrees" / "agent-teste"
        r = _run("git", "worktree", "add", "-q", str(self.wt), cwd=self.main)
        self.assertEqual(r.returncode, 0, r.stderr)
        _link_dir(self.wt / "apps" / "web" / "node_modules", self.main / "apps" / "web" / "node_modules")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_worktree_remove_com_links_desfeitos_preserva_o_main(self) -> None:
        self.assertEqual(slot._unlink_node_modules_links(self.wt), 1)
        _run("git", "worktree", "remove", "--force", str(self.wt), cwd=self.main)
        self.assertTrue(self.pkg_file.exists(), "o arquivo do main foi apagado")
        self.assertTrue((self.main / "apps" / "web" / "node_modules" / "@hm" / "db").exists())

    def test_ignora_node_modules_real(self) -> None:
        real = self.wt / "packages" / "x" / "node_modules"
        real.mkdir(parents=True)
        self.assertEqual(slot._unlink_node_modules_links(self.wt), 1)  # só o link, não a pasta real
        self.assertTrue(real.is_dir())

    @unittest.skipUnless(sys.platform == "win32", "o bug é do Git no Windows")
    def test_controle_sem_a_correcao_o_git_atravessa_a_junction(self) -> None:
        """Documenta o comportamento que causou o incidente. Se um dia o Git corrigir, este teste é pulado."""
        _run("git", "worktree", "remove", "--force", str(self.wt), cwd=self.main)
        if self.pkg_file.exists():
            self.skipTest("esta versão do Git não atravessa junctions")
        self.assertFalse(self.pkg_file.exists())


if __name__ == "__main__":
    unittest.main()
