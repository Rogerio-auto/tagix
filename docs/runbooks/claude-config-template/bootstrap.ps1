# bootstrap.ps1 — instala/atualiza Claude Code + skills numa máquina Windows
# Uso:  ./bootstrap.ps1
# Idempotente: pode rodar várias vezes sem efeito colateral.

$ErrorActionPreference = 'Stop'

function Info($m) { Write-Host "i  $m" -ForegroundColor Blue }
function Ok($m)   { Write-Host "OK $m" -ForegroundColor Green }
function Warn($m) { Write-Host "!  $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "X  $m" -ForegroundColor Red; exit 1 }

# --- paths ---------------------------------------------------------------------
$RepoDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeHome = Join-Path $env:USERPROFILE '.claude'
$SkillsDir  = Join-Path $ClaudeHome 'skills'
$BackupDir  = Join-Path $ClaudeHome ("backups\manual\{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

# --- pré-requisitos ------------------------------------------------------------
Info 'Verificando pré-requisitos...'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die 'node não instalado. Veja dev-environment-windows.md §3' }
if (-not (Get-Command npm  -ErrorAction SilentlyContinue)) { Die 'npm não instalado.' }

$nodeMajor = [int]((node -v) -replace 'v(\d+)\..*','$1')
if ($nodeMajor -lt 22) { Warn "Node $nodeMajor detectado — recomendado >= 22. Continuando, mas pode falhar." }

Ok 'Pré-requisitos OK'

# --- Claude Code CLI -----------------------------------------------------------
Info 'Verificando Claude Code CLI...'
if (Get-Command claude -ErrorAction SilentlyContinue) {
  Ok ("Claude Code já instalado: {0}" -f (claude --version 2>$null | Select-Object -First 1))
} else {
  Info 'Instalando Claude Code CLI globalmente...'
  npm install -g '@anthropic-ai/claude-code'
  Ok ("Claude Code instalado: {0}" -f (claude --version 2>$null | Select-Object -First 1))
}

# --- ~/.claude/ ----------------------------------------------------------------
Info "Preparando $ClaudeHome..."
New-Item -ItemType Directory -Force -Path $ClaudeHome, $SkillsDir | Out-Null

# Backup do que vai ser sobrescrito
$claudeMd = Join-Path $ClaudeHome 'CLAUDE.md'
$settings = Join-Path $ClaudeHome 'settings.json'
if ((Test-Path $claudeMd) -or (Test-Path $settings)) {
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  if (Test-Path $claudeMd) { Copy-Item $claudeMd $BackupDir }
  if (Test-Path $settings) { Copy-Item $settings $BackupDir }
  Info "Backup do estado atual: $BackupDir"
}

# --- CLAUDE.md global ----------------------------------------------------------
$srcClaude = Join-Path $RepoDir 'CLAUDE.md'
if (Test-Path $srcClaude) { Copy-Item $srcClaude $claudeMd -Force; Ok 'CLAUDE.md sincronizado' }
else { Warn 'CLAUDE.md não encontrado no repo — pulando' }

# --- settings.json -------------------------------------------------------------
$srcSettings = Join-Path $RepoDir 'settings.json'
if (Test-Path $srcSettings) { Copy-Item $srcSettings $settings -Force; Ok 'settings.json sincronizado' }
else { Warn 'settings.json não encontrado no repo — pulando' }

# --- Skills --------------------------------------------------------------------
Info 'Copiando skills...'
$srcSkills = Join-Path $RepoDir 'skills'
if (Test-Path $srcSkills) {
  Get-ChildItem $srcSkills | ForEach-Object {
    $target = Join-Path $SkillsDir $_.Name
    if ($_.PSIsContainer) {
      if (Test-Path $target) { Remove-Item $target -Recurse -Force }
      Copy-Item $_.FullName $target -Recurse -Force
      Ok ("  skill: /{0}" -f $_.Name)
    } else {
      Copy-Item $_.FullName $target -Force
      Ok ("  skill: /{0}" -f ($_.BaseName))
    }
  }
} else { Warn 'Pasta skills/ não encontrada no repo — pulando' }

# --- Resumo --------------------------------------------------------------------
Write-Host ''
Write-Host '==============================================================='
Write-Host '  Bootstrap completo'
Write-Host '==============================================================='
Write-Host ''
Write-Host ("  Claude Code CLI:  {0}" -f (claude --version 2>$null | Select-Object -First 1))
Write-Host ("  CLAUDE.md:        {0}" -f $claudeMd)
Write-Host ("  settings.json:    {0}" -f $settings)
Write-Host ("  Skills em:        {0}" -f $SkillsDir)
Write-Host ''
Write-Host '  Skills disponíveis:'
Get-ChildItem $SkillsDir -Directory | ForEach-Object { Write-Host ("    /{0}" -f $_.Name) }
Get-ChildItem $SkillsDir -Filter *.md -File | ForEach-Object { Write-Host ("    /{0}" -f $_.BaseName) }
Write-Host ''
Write-Host "  Abra um terminal novo e digite 'claude' pra começar."
Write-Host ''
