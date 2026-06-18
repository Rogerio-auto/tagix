<#
.SYNOPSIS
  Dispara o deploy de produção da Leadium na VPS (Windows -> SSH -> deploy.sh).

.DESCRIPTION
  Fluxo "atualizou -> deploy":
    1. (opcional) git push da branch para o origin.
    2. SSH na VPS e executa /opt/leadium/scripts/deploy.sh <branch>,
       que faz git pull + build + docker stack deploy + migrations.

  Pré-requisito: chave SSH em ~/.ssh/leadium_vps autorizada no root da VPS.

.EXAMPLE
  ./scripts/deploy.ps1
  ./scripts/deploy.ps1 -Branch main -Push
#>
[CmdletBinding()]
param(
  [string]$Branch = "main",
  [switch]$Push,                      # se setado, faz git push antes de deployar
  [string]$VpsHost = "187.77.237.233",
  [string]$Key = "$HOME\.ssh\leadium_vps"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Key)) {
  Write-Error "Chave SSH não encontrada em $Key. Gere/instale a chave da VPS primeiro."
}

if ($Push) {
  Write-Host "→ git push origin $Branch" -ForegroundColor Cyan
  git push origin $Branch
}

Write-Host "→ Disparando deploy na VPS ($VpsHost), branch '$Branch'…" -ForegroundColor Cyan
# -t aloca TTY para as cores/streaming do deploy.sh aparecerem em tempo real.
ssh -t -i $Key -o StrictHostKeyChecking=accept-new "root@$VpsHost" "bash /opt/leadium/scripts/deploy.sh $Branch"

if ($LASTEXITCODE -ne 0) {
  Write-Error "Deploy retornou código $LASTEXITCODE — veja o log acima."
}
Write-Host "✔ Deploy finalizado." -ForegroundColor Green
