<#
.SYNOPSIS
  Runs targeted tests for the current worktree in the shared GitHub Codespace (about 10-60 s
  instead of a 3-5 min lane CI round). Nothing is installed on this machine.

.DESCRIPTION
  Snapshots the working tree, including uncommitted and untracked files, without touching the
  index or HEAD. Force-pushes it to wip/<name>; no workflow triggers on wip/**. Then runs
  scripts/cs/run.sh from origin/main inside the Codespace. Runs are serialized there by a lock.

.EXAMPLE
  pwsh -NoProfile -File <main checkout>\scripts\cs-test.ps1 -Suite sql -Filter b2_
  pwsh -NoProfile -File <main checkout>\scripts\cs-test.ps1 -Suite app -Filter DeliverySection
  pwsh -NoProfile -File <main checkout>\scripts\cs-test.ps1 -Suite all
#>
param(
  [ValidateSet('sql', 'tsc', 'jest', 'app', 'deno', 'all')][string]$Suite = 'all',
  [string[]]$Filter = @(),
  [string]$Name,              # wip branch suffix; defaults to the worktree folder name
  [string]$Codespace,         # defaults to $env:QS_CODESPACE, then the repo's first Codespace
  [string]$Repo = 'sushruth5454/quickserve'
)
$ErrorActionPreference = 'Stop'
$root = (git rev-parse --show-toplevel).Trim()
if (-not $Name) { $Name = Split-Path $root -Leaf }
$ref = "wip/$($Name -replace '[^A-Za-z0-9._-]', '-')"

# Snapshot the working tree through a temporary index so the agent's own index stays untouched.
$tmpIndex = Join-Path ([IO.Path]::GetTempPath()) "qs-cs-index-$PID"
try {
  $env:GIT_INDEX_FILE = $tmpIndex
  git -C $root read-tree HEAD
  git -C $root add -A
  $tree = (git -C $root write-tree).Trim()
} finally {
  Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
  Remove-Item $tmpIndex -ErrorAction SilentlyContinue
}
$commit = (git -C $root commit-tree $tree -p HEAD -m "cs-test snapshot").Trim()
git -C $root push -q -f origin "${commit}:refs/heads/$ref" 2>$null
if ($LASTEXITCODE) { throw "push to $ref failed" }

if (-not $Codespace) { $Codespace = $env:QS_CODESPACE }
if (-not $Codespace) { $Codespace = (gh codespace list -R $Repo --json name -q '.[0].name').Trim() }
if (-not $Codespace) { throw "No Codespace for $Repo. Create one: gh codespace create -R $Repo -b main -m basicLinux32gb --idle-timeout 30m" }

git -C $root fetch -q origin main
$runner = (git -C $root show origin/main:scripts/cs/run.sh | Out-String) -replace "`r", ''
$remoteArgs = @($ref, $Suite) + $Filter
Write-Host "cs-test: $ref @ $($commit.Substring(0, 8)) suite=$Suite on $Codespace"
$runner | gh codespace ssh -c $Codespace -- env "CS_EXPECT=$commit" bash -s -- @remoteArgs
exit $LASTEXITCODE