# update.ps1 — sincroniza ~/.claude/ (local) -> este repo, e commita/pusha
# Uso:  ./update.ps1 "mensagem de commit"

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Message
)

$ErrorActionPreference = 'Stop'

function Info($m) { Write-Host "i  $m" -ForegroundColor Blue }
function Ok($m)   { Write-Host "OK $m" -ForegroundColor Green }
function Warn($m) { Write-Host "!  $m" -ForegroundColor Yellow }

$RepoDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeHome = Join-Path $env:USERPROFILE '.claude'
$SkillsDir  = Join-Path $ClaudeHome 'skills'

# --- CLAUDE.md + settings.json -------------------------------------------------
$claudeMd = Join-Path $ClaudeHome 'CLAUDE.md'
$settings = Join-Path $ClaudeHome 'settings.json'
if (Test-Path $claudeMd) { Copy-Item $claudeMd (Join-Path $RepoDir 'CLAUDE.md') -Force; Ok 'CLAUDE.md -> repo' }
if (Test-Path $settings) { Copy-Item $settings (Join-Path $RepoDir 'settings.json') -Force; Ok 'settings.json -> repo' }

# --- Skills versionadas (espelha as pastas que já existem no repo) -------------
$repoSkills = Join-Path $RepoDir 'skills'
if (Test-Path $repoSkills) {
  Get-ChildItem $repoSkills -Directory | ForEach-Object {
    $local = Join-Path $SkillsDir $_.Name
    if (Test-Path $local) {
      Remove-Item $_.FullName -Recurse -Force
      Copy-Item $local $_.FullName -Recurse -Force
      Ok ("  skill: {0} -> repo" -f $_.Name)
    } else {
      Warn ("  skill {0} não existe em ~/.claude/skills — pulando" -f $_.Name)
    }
  }
}

# --- Commit + push -------------------------------------------------------------
Set-Location $RepoDir
git add .
$pending = git status --porcelain
if (-not $pending) { Info 'Nada mudou. Nada a commitar.'; exit 0 }

git commit -m $Message
git push
Ok 'Sincronizado com o GitHub.'
