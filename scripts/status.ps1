<#
  QuickServe / Nearo status: no AI needed.
  Usage (from the repo root, or inside a Copilot session prefix with !):
      pwsh scripts/status.ps1            # uses origin/main
      pwsh scripts/status.ps1 -NoCI      # skip GitHub API calls
  Shows: main CI health, task progress for docs 14 and 17, the features you can test now, and free disk space.
  "Merged" = the task's lane appears in main's commit history (merge commits name the lane).
#>
param([switch]$NoCI)
$ErrorActionPreference = 'SilentlyContinue'
$root = git rev-parse --show-toplevel
Set-Location $root
git fetch -q origin main
$log = (git log origin/main --format=%s) -join "`n"

function IsMerged([string]$id) {
  $e = [regex]::Escape($id)
  return [regex]::IsMatch($log, "(lane[/ ]$e(?![0-9A-Za-z-])|integrate $e(?![0-9A-Za-z-])|\($e\)|: $e(?![0-9A-Za-z-]) )", 'IgnoreCase')
}

function Board([string]$doc, [int]$col) {
  $d = git show "origin/main:$doc"
  $i = ($d | Select-String '^## 7\.').LineNumber
  if (-not $i) { return @() }
  $d[($i + 3)..($i + 60)] | Where-Object { $_ -match '^\| [A-Z]' } | ForEach-Object {
    $c = $_ -split '\|'
    $id = ($c[1].Trim() -split ' ')[0]
    [pscustomobject]@{ Id = $id; Status = $c[$col].Trim() }
  }
}

Write-Host "`n=== MAIN ===" -ForegroundColor Cyan
Write-Host ("main @ " + (git log -1 --format='%h %s (%cr)' origin/main))
if (-not $NoCI) {
  gh run list --branch main --limit 12 --json workflowName,status,conclusion,headSha 2>$null | ConvertFrom-Json |
    Group-Object workflowName | ForEach-Object {
      $r = $_.Group[0]
      $state = if ($r.status -ne 'completed') { $r.status } else { $r.conclusion }
      $color = if ($state -eq 'success') { 'Green' } elseif ($state -eq 'failure') { 'Red' } else { 'Yellow' }
      Write-Host ("  {0,-38} {1,-12} {2}" -f $r.workflowName, $state, $r.headSha.Substring(0,7)) -ForegroundColor $color
    }
}

$allMerged = @()
foreach ($p in @(
  @{ Name = 'Doc 17 - functional / payment fixes'; Doc = 'docs/17-Nearo-Audit-Remediation-Implementation-Plan.md'; Col = 3 },
  @{ Name = 'Doc 14 - UI redesign';                Doc = 'docs/14-UI-Redesign-AI-Execution-Plan.md';                Col = 2 })) {
  $rows = Board $p.Doc $p.Col
  $merged = @(); $deferred = @(); $open = @()
  foreach ($r in $rows) {
    if ($r.Status -match '^(DEFERRED|deferred)') { $deferred += $r }
    elseif ((IsMerged $r.Id) -or $r.Status -match '^merged|merged to main|merged with|is on main|merged on main|; merged') { $merged += $r }
    else { $open += $r }
  }
  Write-Host ("`n=== {0}: {1} merged, {2} open, {3} deferred (of {4}) ===" -f $p.Name, $merged.Count, $open.Count, $deferred.Count, $rows.Count) -ForegroundColor Cyan
  $allMerged += $merged.Id
  Write-Host ("  merged:   " + (($merged.Id) -join ', '))
  Write-Host ("  deferred: " + (($deferred.Id) -join ', '))
  Write-Host "  open:"
  $open | ForEach-Object { Write-Host ("    {0,-7} {1}" -f $_.Id, $_.Status.Substring(0, [Math]::Min(95, $_.Status.Length))) }
}

# Task -> testable feature. Flag = switch to turn on in Admin -> Features ('' = always on).
$features = @(
  @('U1','Home services','Book / Book again open the right checkout for package and session services',''),
  @('U2','Home services','Cancel a booking: refund preview shown before you confirm',''),
  @('B1','Home services','Price before paying matches the charge (e.g. Rs999 package + Rs29 fee = Rs1,028)',''),
  @('HS-01','Home services','New provider listing cards in category results',''),
  @('HS-02','Home services','Step-by-step booking (type -> time -> address -> review)','booking_steps'),
  @('HS-03','Home services','"Book again" on completed bookings','book_again'),
  @('H2a','Recurring','Accepting a plan keeps paid visits confirmed; prices locked at acceptance','recurring_bookings'),
  @('H2b','Recurring','Plan screen: per-visit amount + Pay, pause/skip/cancel (web too), date-time pickers','recurring_bookings'),
  @('F3','Coins','Approve a quote with coins on/off; "To pay now" correct with coins',''),
  @('F4','Payments','Cancel/dispute bookings paid partly with coins (refund works)',''),
  @('F2','Provider','Commission on fixed packages and proposals in provider earnings',''),
  @('B4','Provider','Provider earnings statement',''),
  @('B2','Customer','Payment receipt from booking / activity',''),
  @('U3','Account','Account: saved addresses edit/delete, honest deletion request, help, clearer OTP errors',''),
  @('H-01','Home','Home v2: 4 marketplace tiles, search entry, trust strip, popular chips','home_v2'),
  @('H-02','Search','Search tab (services, shops, sports, creators)','unified_search'),
  @('A-01','AI','AI assistant shows "busy, try again" instead of an error','ai_assistant'),
  @('CR-01','Creators','Creators landing page','creators_landing'),
  @('G-01','Guest','Browse without signing in; sign-in asked only when booking','guest_browse'),
  @('P1a','Shops','Shop edits keep it live; units with prices; better product search','products'),
  @('SH-01','Shops','New shop and product screens','products'),
  @('P1b','RFQ','RFQ: cancel request, honest quote comparison flags','product_rfq'),
  @('SH-02','RFQ','RFQ quote comparison table','product_rfq'),
  @('S1','Sports','Sports bookings show correct payment status/deadline','sports'),
  @('S2','Sports','Venue owner booking list, edit/delete price rules, refund preview','sports'),
  @('SP-01','Sports','New sports activity and venue list screens','sports'),
  @('SP-02','Sports','New slot grid, checkout and booking screens','sports'),
  @('O1','Notifications','Correct person notified on cancellations',''),
  @('O2','Admin','Admin: provider approval separate from payout KYC; document review',''),
  @('O3','Admin','Admin money view: refunds/payouts with retry',''),
  @('F7','Admin','Admin-configurable platform fees',''),
  @('M-01','Provider','Refreshed provider dashboard styling',''),
  @('C2','Creators','Brief/proposal: revisions, deliver-by date, structured brief',''),
  @('C1','Creators','Delivery visible to customer; 72h acceptance; unpaid-balance path','')
)
Write-Host "`n=== FEATURES YOU CAN TEST NOW (merged to main) ===" -ForegroundColor Cyan
Write-Host "  Log in as admin 9000000902 (OTP 123456). Turn on the listed switch in Admin -> Features. Restart Expo Go to load the latest update."
function Done([string]$id) { return ($allMerged -contains $id) -or (IsMerged $id) }
$b01 = Done 'B-01'
$newFlags = 'home_v2','unified_search','guest_browse','creators_landing','booking_steps','book_again'
if (-not $b01) { Write-Host '  NOTE: switches home_v2, unified_search, guest_browse, creators_landing, booking_steps, book_again are created by B-01 (not merged yet), so those features are listed under Not testable yet.' -ForegroundColor Yellow }
$features | Where-Object { (Done $_[0]) -and ($b01 -or $newFlags -notcontains $_[3]) } | Group-Object { $_[1] } | ForEach-Object {
  Write-Host ("  [{0}]" -f $_.Name) -ForegroundColor Yellow
  $_.Group | ForEach-Object {
    $flag = if ($_[3]) { "  (switch: $($_[3]))" } else { '' }
    Write-Host ("    - {0}{1}   <{2}>" -f $_[2], $flag, $_[0])
  }
}
$pending = $features | Where-Object { -not (Done $_[0]) -or (-not $b01 -and $newFlags -contains $_[3]) } | ForEach-Object { $_[0] }
Write-Host ("`n  Not testable yet: " + ($pending -join ', '))

Write-Host "`n=== DISK ===" -ForegroundColor Cyan
Get-PSDrive C | ForEach-Object {
  $gb = $_.Free / 1GB
  $color = if ($gb -lt 10) { 'Red' } elseif ($gb -lt 20) { 'Yellow' } else { 'Green' }
  Write-Host ("  C: free {0:N1} GB   (worktrees: {1})" -f $gb, (git worktree list).Count) -ForegroundColor $color
}
Write-Host ""