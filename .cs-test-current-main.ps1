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
$env:GIT_CONFIG_COUNT = '1'
$env:GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader'
$env:GIT_CONFIG_VALUE_0 = "AUTHORIZATION: basic $env:GH_GIT_BASIC"
$root = (git rev-parse --show-toplevel).Trim()
if (-not $Name) { $Name = Split-Path $root -Leaf }
$ref = "wip/$($Name -replace '[^A-Za-z0-9._-]', '-')"

# Snapshot the working tree through a temporary index so the agent's own index stays untouched.
$tmpIndex = Join-Path ((git -C $root rev-parse --absolute-git-dir).Trim()) "cs-index-$PID"
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
$runner = @'
set -uo pipefail
ref="$1"; suite="$2"; shift 2
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=http.https://github.com/.extraheader
export GIT_CONFIG_VALUE_0="AUTHORIZATION: basic ${GH_GIT_BASIC:?}"
cd /workspaces/quickserve || exit 2
work=/workspaces/qs-o24-cm05-run-4e2079
if [ -e "$work" ]; then echo "cs-test: refusing to replace existing isolated worktree $work"; exit 2; fi
target="refs/cs/run-$$"
git fetch -q origin "+$ref:$target" || { echo "cs-test: cannot fetch $ref"; exit 2; }
commit="$(git rev-parse "$target")"
git worktree add -q --detach "$work" "$target" || exit 2
git update-ref -d "$target"
cleanup() { git -C /workspaces/quickserve worktree remove --force "$work" >/dev/null 2>&1 || true; }
trap cleanup EXIT
if [ -n "${CS_EXPECT:-}" ] && [ "$commit" != "$CS_EXPECT" ]; then
  echo "cs-test: checked out $commit, expected $CS_EXPECT"; exit 2
fi
if [ ! -x /workspaces/quickserve/app/node_modules/.bin/tsc ] || [ ! -x /workspaces/quickserve/app/node_modules/.bin/jest ]; then
  echo "cs-test: existing app dependencies are missing; refusing an unrequested install"; exit 2
fi
ln -s /workspaces/quickserve/app/node_modules "$work/app/node_modules"
echo "== testing $ref @ $(git -C "$work" rev-parse --short HEAD)"
status=0
run_tsc() { (cd "$work/app" && ./node_modules/.bin/tsc --noEmit) || status=1; }
run_jest() { (cd "$work/app" && ./node_modules/.bin/jest --watchAll=false --cacheDirectory "$work/.jest-cache" "$@") || status=1; }
case "$suite" in
  tsc) run_tsc ;;
  jest) run_jest "$@" ;;
  app) run_tsc; run_jest "$@" ;;
  *) echo "cs-test: unsupported isolated suite '$suite'"; exit 2 ;;
esac
echo "== cs-test result: $([ "$status" -eq 0 ] && echo PASS || echo FAIL)"
exit "$status"
'@
$runner = $runner -replace "`r", ''
$remoteArgs = @($ref, $Suite) + $Filter
Write-Host "cs-test: $ref @ $($commit.Substring(0, 8)) suite=$Suite on $Codespace"
$start = [System.Diagnostics.ProcessStartInfo]::new((Get-Command gh).Source)
$start.UseShellExecute = $false
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.StandardInputEncoding = [System.Text.UTF8Encoding]::new($false)
@('codespace', 'ssh', '-c', $Codespace, '--', 'env', "CS_EXPECT=$commit", "GH_GIT_BASIC=$env:GH_GIT_BASIC", 'bash', '-s', '--') + $remoteArgs |
  ForEach-Object { [void]$start.ArgumentList.Add([string]$_) }
$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $start
[void]$process.Start()
$stdout = $process.StandardOutput.ReadToEndAsync()
$stderr = $process.StandardError.ReadToEndAsync()
$process.StandardInput.Write($runner)
$process.StandardInput.Close()
$process.WaitForExit()
$output = $stdout.GetAwaiter().GetResult()
$errors = $stderr.GetAwaiter().GetResult()
if ($output) { Write-Output $output }
if ($errors) { [Console]::Error.WriteLine($errors) }
exit $process.ExitCode
