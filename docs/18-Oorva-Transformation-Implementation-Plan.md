# Oorva — Final implementation execution plan (doc 18)

| Field | Authoritative value |
|---|---|
| Status | **Documentation ready; implementation NOT STARTED; app/release readiness NOT VERIFIED.** This documentation request authorizes no app/SQL/CI/runtime edits, test run, commit, push, deployment, production query, data repair or public identity activation. |
| Frozen source evidence | `2f1e4638b145185b9e58c4c62e58f5c6dd491fa1`, audited November 20, 2026. **88 screens + 5 layouts, 503 placement rows, 136 findings, 131 source tasks, 29 entity definitions, 12 required card families with domain variants.** `productOrder` is source-proven N/A, not missing implementation scope. |
| Entry point / allocation authority | This document defines execution, architecture and approval boundaries. [execution-plan.json](design/oorva/execution-plan.json) is the **sole machine-readable dispatch/dependency/file/function/migration-claim authority**. It contains 140 concrete stages and 38 unique, still-UNASSIGNED forward migration claims. |
| Completed source inputs | [Critical audit](audit/18-Critical-Audit.md), its seven linked reports and [coverage.json](design/oorva/audit/coverage.json). Source references mean repository-relative path + exact lines **at the frozen SHA**, not this historical checkout and not machine-specific snapshots. No new full source audit is a future prerequisite. |
| Visual evidence | Historical 162-name index remains in appendix D. Fresh archived run **44696642603**, head `229995fe3194de39684f12ef348d3e37930ae5f2`, has application code equal to frozen source (only doc14 differs), **failed three Home flag-coverage assertions**. All nine contact sheets were reviewed in the completed audit. Captures/filenames do not prove route/state or runtime PASS. The ended-booking/payment contradiction is image **89**, not 87/88. |
| Scope retained | Complete original brand/UX/logo/launch briefs, Critical requirements and **21 review fixes + 3 suggestions** remain binding. Exact accessible palette, native asset handoff and bounded launch choreography are preserved in appendix A; review ledger in G. |
| Safety / existing work | Preserve existing routes, technical/history identifiers, Supabase contracts, actual actor permissions, backend money arithmetic/records and working integrations. Doc14/17 functional repairs and current owners take precedence over presentation. |
| Owner decisions | **D colour direction approved November 23, 2026**: teal/white/sand and exact doc 19 values. Ready logo/native-source artwork is supplied; no drawing task remains. E0/E1, public rights, native cutover and historical money/status repair retain their existing separate scope. [Approval](design/oorva/colours/approval.json). |

---

## 0. Execution protocol — for the lower-model worker AND integrator

### 0.1 Roles, state meanings and immutable inputs

- **Coordinator:** readiness, exact metadata, exclusive locks, migration allocation, serialized shared registrations, tested integration batches and human gates. It does **not** implement/rewrite a worker's feature code or guess a conflict resolution.
- **Stage author:** one stage, one fresh background agent, one isolated worktree, one `lane/oorva-<lowercase-stage>` branch. Use configured model defaults, **no automatic Opus**. Required focused money/auth/concurrency implementation reviews are the only review gate; no new audit or optional review program.
- **Owner:** explicit scoped approvals. Pending public trademark/native resources never block unrelated Class-A repairs. Supplied-master integrity is a mechanical check, not another creative-selection request.

| State | Exact meaning / prerequisite use |
|---|---|
| `PENDING` | Not launched. A READY calculation may select it; this is built-in todo `pending`. |
| `RUNNING` | Worker or coordinator registration roundtrip active; built-in `in_progress`. |
| `CODE_GREEN` | Exact lane head has required Codespace result, green lane CI, required focused review and supplied evidence. Still built-in `in_progress`; **not integrated, deployed or released**. |
| `DONE` | Included in a named **tested integration target SHA**, combined required checks green, scope accepted. Built-in `done`; main promotion/deployment are separate metadata and may remain unapproved. |
| `BLOCKED` | Exact gate/dependency/lock/base/tool/owner answer prevents progress; built-in `blocked` with concrete next action. No unverified completion. |

Native exception: O33 is `CODE_GREEN` on an isolated candidate branch. Record explicit O34 stacked-start approval at that exact SHA while D07b is pending; O34 creates the evidence for D07b. Neither becomes main/native delivered merely by candidate green. Do not create a circular requirement for an O33 production merge before O34 evidence.

**Evidence precedence:** this plan's explicit architecture/overrides + execution JSON allocation > completed audit facts/task requirements > source narrative proposal filenames. Audit `UNASSIGNED` combined drafts are **not files/reservations**. A worker never chooses a migration number, new status policy, public-data boundary or feature metadata.

### 0.2 Copy-ready bounded-context reads

These are JSON/document projections only, not app tests. Set one real stage ID; do not dump megabytes of source reports into a worker's context.

```powershell
$PlanPath = 'docs\design\oorva\execution-plan.json'
$StageId = 'O16-CAP'
$Plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
$Matches = @($Plan.stages | Where-Object id -eq $StageId)
if ($Matches.Count -ne 1) { throw "Expected one stage: $StageId; actual=$($Matches.Count)" }
$Stage = $Matches[0]
$Stage | Select-Object id,wp,title,sourceTaskIds,sourceFindingIds,dependsOn,ownedFiles,
  coordinatorOwnedFiles,sqlFunctions,migrationClaims,flagClass,featureKeys,gates,
  implementationOverrides,routeHostBindings,steps,acceptance,tests |
  ConvertTo-Json -Depth 40
```

Read **one referenced task** and only its findings; repeat for each `sourceTaskIds` entry, never another stream:

```powershell
$TaskId = 'ID-T04'
$Card = @($Stage.sourceCards | Where-Object id -eq $TaskId)
if ($Card.Count -ne 1) { throw "$TaskId is not owned exactly once by $StageId" }
$Report = Get-Content -LiteralPath $Card[0].jsonPath -Raw | ConvertFrom-Json
$Task = @($Report.tasks | Where-Object id -eq $TaskId)
if ($Task.Count -ne 1) { throw "Missing/duplicate task $TaskId" }
$Task[0] | Select-Object id,findingIds,steps,acceptance,testFilesAndCases,
  featureOffBehavior,reviewRequired | ConvertTo-Json -Depth 30
$Report.findings | Where-Object { $_.id -in $Task[0].findingIds } |
  Select-Object id,title,classification,actual,target,sourceRefs |
  ConvertTo-Json -Depth 20
```

The stage's canonical owned files, unique migration claim, host bindings and overrides **replace** proposal paths/duplicate helper designs in that source task. Original source citations remain unchanged for provenance. For one screen, project its existing audit `placement` array by `screens.id`; bind those completed rows to before/after evidence, do not redo placement discovery.

### 0.3 Coordinator preflight and ledger initialization

**Only after a future explicit E0 request:**

Use PowerShell 7 (`pwsh`) for these snippets (`if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Use the available pwsh 7 session; do not install packages locally' }`); set `$ErrorActionPreference='Stop'`. This also keeps generated JSON UTF-8 without a legacy BOM.

1. Read active repository/session instructions and current owner handoffs. Record `git --no-pager status --short`, `git worktree list --porcelain`, `git remote -v`, `git fetch origin main`, and actual `origin/main` SHA. Never checkout/reset/stash/clean the existing dirty or detached planning checkout.
2. Record current doc12/doc14/doc17 live owners, especially Q-02/Q-03/P2-01 and money/recurring/native locks. An old status/reservation is not permission. Ask only the exact affected owner for transfer/acknowledgment; leave unrelated stages ready.
3. Freeze approved portable inputs on planning commit **P** based on current main in a **new clean planning worktree**. Explicitly allowlist doc18, execution JSON, published audit/coverage/before-manifest files and existing approved exploration inputs; verify hashes before copying/adding. Never `git add -A` someone else's dirty tree. Push only a planning branch if authorized by E0; do not use detached `8ef...` as an implementation base.
4. Record E0/D01 development approval, every human gate as `APPROVED/PENDING/NOT_AVAILABLE`, its exact affected stages/platform/context and evidence. O00 does not wait for native/public release decisions. D03a/b use the supplied-kit verification rule in A.4.1, not another drawing/selection round.
5. Reconcile and allocate only ready SQL claims by section 3; fill exact filenames. Record planning SHA P, tested integration target ref/SHA and approved stacked bases. Each worker base must contain P **and every dependency SHA**, even when those changes are only on an integration branch.
6. Initialize stage/todo metadata below from the JSON, without recreating or changing built-in `todos`/`todo_deps`. Mark only O00 `DONE` after its documentary acceptance. No completed-audit lane or WP aggregate is a dependency.

Use the session SQL tool with this schema for extra metadata:

```sql
CREATE TABLE IF NOT EXISTS oorva_stages (
  id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'PENDING',
  wp TEXT NOT NULL, agent_id TEXT, worktree TEXT, branch TEXT,
  plan_base_sha TEXT, base_sha TEXT, head_sha TEXT,
  dependency_shas_json TEXT, gate_evidence_json TEXT, claims_json TEXT,
  locks_json TEXT, validation_commands_json TEXT, evidence_path TEXT,
  codespace_result TEXT, lane_run_id TEXT, lane_head_sha TEXT,
  review_result TEXT, integration_ref TEXT, integration_sha TEXT,
  batch_run_ids_json TEXT, main_sha TEXT, deploy_run_ids_json TEXT,
  blocker TEXT, next_action TEXT
);
CREATE TABLE IF NOT EXISTS oorva_stage_deps (
  stage_id TEXT NOT NULL, depends_on TEXT NOT NULL,
  PRIMARY KEY(stage_id,depends_on)
);
CREATE TABLE IF NOT EXISTS oorva_gates (
  gate_id TEXT PRIMARY KEY, state TEXT NOT NULL, evidence TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oorva_locks (
  resource TEXT PRIMARY KEY, stage_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oorva_claims (
  id TEXT PRIMARY KEY, stage_id TEXT NOT NULL,
  numeric_version TEXT NOT NULL DEFAULT 'UNASSIGNED',
  filename_template TEXT NOT NULL, filename TEXT,
  acknowledged INTEGER NOT NULL DEFAULT 0, evidence TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS oorva_stacks (
  stage_id TEXT PRIMARY KEY, approved INTEGER NOT NULL DEFAULT 0,
  dependency_ids_json TEXT NOT NULL DEFAULT '[]',
  transfer_locks_json TEXT NOT NULL DEFAULT '[]',
  base_sha TEXT, evidence TEXT NOT NULL DEFAULT ''
);
```

Generate bounded insertion batches (document/JSON processing only); run their output through the SQL tool. `INSERT OR IGNORE` preserves existing progress; do not overwrite active statuses:

```powershell
$Plan = Get-Content 'docs\design\oorva\execution-plan.json' -Raw | ConvertFrom-Json
function SqlQuote([string]$Value) { "'" + $Value.Replace("'","''") + "'" }
foreach ($S in $Plan.stages) {
  $TodoId = 'oorva-' + $S.id.ToLowerInvariant()
  "INSERT OR IGNORE INTO todos(id,title,description,status) VALUES(" +
    "$(SqlQuote $TodoId),$(SqlQuote ('Implementing '+$S.id))," +
    "$(SqlQuote ('Exact stage '+$S.id+' in execution-plan.json')),'pending');"
  "INSERT OR IGNORE INTO oorva_stages(id,wp,state,evidence_path) VALUES(" +
    "$(SqlQuote $S.id),$(SqlQuote $S.wp),'PENDING',$(SqlQuote $S.evidenceFile));"
}
foreach ($S in $Plan.stages) {
  foreach ($D in $S.dependsOn) {
    "INSERT OR IGNORE INTO todo_deps(todo_id,depends_on) VALUES(" +
      "$(SqlQuote ('oorva-'+$S.id.ToLowerInvariant()))," +
      "$(SqlQuote ('oorva-'+$D.ToLowerInvariant())));"
    "INSERT OR IGNORE INTO oorva_stage_deps(stage_id,depends_on) VALUES(" +
      "$(SqlQuote $S.id),$(SqlQuote $D));"
  }
}
foreach ($G in $Plan.gateDefinitions) {
  "INSERT OR IGNORE INTO oorva_gates(gate_id,state,evidence) VALUES(" +
    "$(SqlQuote $G.id),'PENDING',$(SqlQuote $G.meaning));"
}
foreach ($C in $Plan.migrationClaims) {
  "INSERT OR IGNORE INTO oorva_claims(id,stage_id,filename_template) VALUES(" +
    "$(SqlQuote $C.id),$(SqlQuote $C.stageId),$(SqlQuote $C.filenameTemplate));"
}
```

State updates always change `oorva_stages.state` and the mapped built-in todo status in one SQL transaction. `CODE_GREEN` stays `in_progress`. Gate evidence, exact claims, worktree/base/head/run/merge SHA, blockers and next action live **only in extra metadata**, never imaginary columns in `todos`. Parent WPs O00–O38 are labels; do not add aggregate prerequisite todos.

### 0.4 READY, locks, worktrees, worker packet and handoff

#### 0.4.1 Deterministic readiness

Export the extra metadata to one session `ledger.json` with `stages:[{id,state,headSha,integrationSha,...}]`, `gates:[{id,state,evidence}]`, `locks:[{resource,stageId}]`, `claims:[{id,numericVersion,filename,acknowledged}]`, `stacks:[{stageId,approved,dependencyIds,transferLocks,baseSha,evidence}]`. Each explicit transferable lock is `{resource,fromStageId,pausedHeadSha,ownerPausedEvidence}`; only a paused CODE_GREEN predecessor at that exact SHA may transfer it atomically during child acquisition. Fill genuine values; the execution JSON is not a fabricated live status board.

Use this exact session-SQL projection after every metadata change; write the returned `ledger_json` verbatim to `$LedgerPath` in the active session files directory. It is an export of the SQL source of truth, never an independently hand-maintained second ledger:

```sql
SELECT json_object(
 'stages',json(COALESCE((SELECT json_group_array(json_object(
   'id',id,'state',state,'headSha',head_sha,'integrationSha',integration_sha,
   'baseSha',base_sha,'branch',branch,'worktree',worktree)) FROM oorva_stages),'[]')),
 'gates',json(COALESCE((SELECT json_group_array(json_object(
   'id',gate_id,'state',state,'evidence',evidence)) FROM oorva_gates),'[]')),
 'locks',json(COALESCE((SELECT json_group_array(json_object(
   'resource',resource,'stageId',stage_id)) FROM oorva_locks),'[]')),
 'claims',json(COALESCE((SELECT json_group_array(json_object(
   'id',id,'numericVersion',numeric_version,'filename',filename,
   'acknowledged',acknowledged)) FROM oorva_claims),'[]')),
 'stacks',json(COALESCE((SELECT json_group_array(json_object(
   'stageId',stage_id,'approved',approved,
   'dependencyIds',json(dependency_ids_json),
   'transferLocks',json(transfer_locks_json),'baseSha',base_sha,
   'evidence',evidence)) FROM oorva_stacks),'[]'))
) AS ledger_json;
```

Copy-ready frontier computation; the output is **all eligible candidates**, followed by atomic lock acquisition. O00 and E0 are checked explicitly. A missing gate/claim fails closed:

```powershell
$P = Get-Content 'docs\design\oorva\execution-plan.json' -Raw | ConvertFrom-Json
$L = Get-Content -LiteralPath $LedgerPath -Raw | ConvertFrom-Json
$States = @{}; foreach ($X in $L.stages) { $States[$X.id] = $X }
$Gates = @{}; foreach ($X in $L.gates) { $Gates[$X.id] = $X.state }
$Claims = @{}; foreach ($X in $L.claims) { $Claims[$X.id] = $X }
if ($Gates['E0'] -ne 'APPROVED' -or $States['O00'].state -ne 'DONE') {
  throw 'No implementation READY before E0 and O00 DONE'
}
$Ready = @()
foreach ($S in ($P.stages | Sort-Object dispatchOrder)) {
  if ($S.id -eq 'O00' -or $States[$S.id].state -ne 'PENDING') { continue }
  $Stack = @($L.stacks | Where-Object { $_.stageId -eq $S.id -and $_.approved })
  $DepsOK = $true
  foreach ($D in $S.dependsOn) {
    $AllowedGreen = $Stack.Count -eq 1 -and $D -in $Stack[0].dependencyIds -and
      $States[$D].state -eq 'CODE_GREEN'
    if ($States[$D].state -ne 'DONE' -and -not $AllowedGreen) { $DepsOK = $false }
  }
  $GateOK = @($S.gates | Where-Object { $Gates[$_] -ne 'APPROVED' }).Count -eq 0
  $ClaimOK = $true
  foreach ($C in $S.migrationClaims) {
    if (-not $Claims.ContainsKey($C) -or -not $Claims[$C].acknowledged -or
        $Claims[$C].numericVersion -notmatch '^\d{4,}[a-z]?$' -or -not $Claims[$C].filename) {
      $ClaimOK = $false
    } else {
      $Template = @($P.migrationClaims | Where-Object id -eq $C)[0].filenameTemplate
      $Expected = $Template.Replace('UNASSIGNED__',($Claims[$C].numericVersion + '_'))
      if ($Claims[$C].filename -cne $Expected) { $ClaimOK = $false }
    }
  }
  $EffectiveLocks = @($S.locks)
  if ($ClaimOK) {
    foreach ($C in $S.migrationClaims) {
      $Template = @($P.migrationClaims | Where-Object id -eq $C)[0].filenameTemplate
      $EffectiveLocks = @($EffectiveLocks | ForEach-Object {
        $_.Replace($Template,$Claims[$C].filename)
      })
      $EffectiveLocks += 'migration-version:' + $Claims[$C].numericVersion
    }
  }
  $NormalizedLocks = @($EffectiveLocks | ForEach-Object { $_.ToLowerInvariant() })
  $Busy = $false
  foreach ($Held in $L.locks) {
    if ($Held.resource.ToLowerInvariant() -notin $NormalizedLocks -or $Held.stageId -eq $S.id) { continue }
    $Transfer = @()
    if ($Stack.Count -eq 1) {
      $Transfer = @($Stack[0].transferLocks | Where-Object {
        $_.resource.ToLowerInvariant() -eq $Held.resource.ToLowerInvariant() -and
        $_.fromStageId -eq $Held.stageId -and $_.ownerPausedEvidence -and
        $_.pausedHeadSha -eq $States[$Held.stageId].headSha -and
        $Held.stageId -in $Stack[0].dependencyIds -and
        $States[$Held.stageId].state -eq 'CODE_GREEN'
      })
    }
    if ($Transfer.Count -ne 1) { $Busy = $true }
  }
  if ($DepsOK -and $GateOK -and $ClaimOK -and -not $Busy) { $Ready += $S }
}
$Ready | Select-Object id,wp,title,dependsOn,gates
```

Before creating workers, replace claim templates in **all** file locks/commands/packet fields with the acknowledged numeric filenames. Acquire all sorted, case-normalized file/function/migration locks for one stage atomically under `BEGIN IMMEDIATE`; insert into `oorva_locks` (PK resource), set `RUNNING`, commit. If any lock is held, **ROLLBACK the whole acquisition**, record exact holder and leave the stage pending/blocked. Never partially acquire/wait while holding another stage's locks. All shared-writer edges already exist in JSON; locks additionally protect active other-plan owners and registration roundtrips.

Copy-ready acquisition SQL generator after one stage has passed readiness and its locks are substituted. Execute as one transaction through the SQL tool. If it reports any error/constraint failure, issue **`ROLLBACK;` immediately**, do not run the next stage query with an open transaction. Only successful COMMIT authorizes dispatch:

```powershell
# $EffectiveLocks is the selected stage's fully substituted list, not the last loop iteration.
$Lines = @('BEGIN IMMEDIATE;')
foreach ($Transfer in $ApprovedTransfersForThisStage) {
  $Lines += "UPDATE oorva_locks SET stage_id=$(SqlQuote $Stage.id) " +
    "WHERE resource=$(SqlQuote $Transfer.resource.ToLowerInvariant()) " +
    "AND stage_id=$(SqlQuote $Transfer.fromStageId) " +
    "AND EXISTS(SELECT 1 FROM oorva_stages WHERE id=$(SqlQuote $Transfer.fromStageId) " +
    "AND state='CODE_GREEN' AND head_sha=$(SqlQuote $Transfer.pausedHeadSha)) " +
    "AND EXISTS(SELECT 1 FROM oorva_stacks WHERE stage_id=$(SqlQuote $Stage.id) AND approved=1);"
}
foreach ($Resource in ($EffectiveLocks | ForEach-Object {
    $_.ToLowerInvariant()
  } | Sort-Object -Unique)) {
  $Lines += "INSERT INTO oorva_locks(resource,stage_id,acquired_at) " +
    "SELECT $(SqlQuote $Resource),$(SqlQuote $Stage.id),CURRENT_TIMESTAMP " +
    "WHERE NOT EXISTS(SELECT 1 FROM oorva_locks WHERE resource=$(SqlQuote $Resource) " +
    "AND stage_id=$(SqlQuote $Stage.id));"
}
$Lines += "UPDATE oorva_stages SET state='RUNNING' WHERE id=$(SqlQuote $Stage.id);"
$Lines += "UPDATE todos SET status='in_progress',updated_at=CURRENT_TIMESTAMP " +
  "WHERE id=$(SqlQuote ('oorva-'+$Stage.id.ToLowerInvariant()));"
$Lines += 'COMMIT;'
$Lines -join "`n"
```

`$ApprovedTransfersForThisStage` is exactly the validated approved stack's `transferLocks` intersected with this stage's normalized locks, or an empty array. Never supply arbitrary transfers. A still-other-held resource causes a PK failure and the **whole transaction rolls back**; self-held transferred resources are idempotent.

Locks remain held for RUNNING/CODE_GREEN work and registration handoffs until tested integration or explicit paused ownership transfer; do not unlock an unintegrated file just to increase concurrency. On DONE, release only `DELETE FROM oorva_locks WHERE stage_id='<that exact stage>'` in the same metadata transaction. Failed/changed predecessors invalidate their approved stacks and return descendants to BLOCKED for owner rebase/revalidation.

#### 0.4.2 Base and worktree algorithm

1. Choose the ledger's latest **tested integration target** containing P and every DONE dependency SHA. If none contains them, stage is `BLOCKED:BASE_MISSING_DEPENDENCY`; integrate predecessors first. Do not substitute current main that lacks private dependencies.
2. A GREEN unmerged base is allowed only with an explicit stage-specific stack approval and exact green dependency SHA(s). O33→O34 uses this rule while D07b is pending. No worker selects its own stack.
3. Test ancestry and refuse a dirty/nonexistent/reused branch/path:

```powershell
git merge-base --is-ancestor $PlanBaseSha $BaseSha
if ($LASTEXITCODE) { throw 'Base does not contain approved plan P' }
foreach ($DependencySha in $DependencyShas) {
  git merge-base --is-ancestor $DependencySha $BaseSha
  if ($LASTEXITCODE) { throw "Base missing dependency $DependencySha" }
}
$Branch = 'lane/oorva-' + $Stage.id.ToLowerInvariant()
$Worktree = Join-Path (Split-Path (Get-Location).Path -Parent) ('qs-' + $Stage.id.ToLowerInvariant())
if (Test-Path -LiteralPath $Worktree) { throw "Existing worktree path: $Worktree" }
git show-ref --verify --quiet "refs/heads/$Branch"
if ($LASTEXITCODE -eq 0) { throw "Existing local branch: $Branch" }
if ($LASTEXITCODE -ne 1) { throw 'Cannot verify local branch absence' }
git ls-remote --exit-code --heads origin "refs/heads/$Branch"
if ($LASTEXITCODE -eq 0) { throw "Existing remote branch: $Branch" }
if ($LASTEXITCODE -ne 2) { throw 'Cannot verify remote branch absence; no worktree reuse' }
git worktree add -b $Branch $Worktree $BaseSha
if ($LASTEXITCODE) { throw 'Worktree creation failed; do not reuse/reset another path' }
```

4. In that worktree, perform **affected-source drift only**: compare exact owned/read defining files at frozen SHA versus chosen base, find latest definitions of owned SQL symbols, preserve every intervening repair and record source/function hashes. A changed citation is not permission to redesign; a satisfied finding is recorded with exact current proof/tests and coordinator-approved no-op disposition. A conflicting policy/contract returns to its existing owner. Never rerun all 88-screen discovery.
5. Fill the entire packet below, then launch **all READY disjoint stages concurrently**, one background agent+worktree each, in one parallel batch. No artificial headcount and no serialization behind the already completed audit.

Preallocate the worker **name**, branch/path/base/gates/claims/commands before launch. The runtime-generated `agent_id` cannot be known beforehand: record it from the launch result immediately, before another coordinator operation; never fabricate one or make an unknowable ID a readiness prerequisite.

```text
Stage / WP / exact source task IDs:
Worktree / branch / active session:
Planning P / implementation base SHA:
DONE dependency SHAs; explicitly approved GREEN stack SHAs/run IDs:
One stage JSON projection + referenced source task/finding/placement projections:
Exact worker-owned files; exact coordinator-owned shared additions:
Exact SQL functions/views + latest defining source; acquired locks:
Actual substituted numeric migration filename(s), or NONE:
Approved gate evidence; still-pending main/public/native/context gates:
Exact tests[].selector/commands; selected expected files; registration roundtrip:
Exact routeHostBindings (if any), single shared refresh/identity APIs:
Evidence path / flags / OFF behavior / required focused review:
Stop after this stage. No production query, data repair, main promotion or flag/store/live-money action.
```

#### 0.4.3 No registration/green deadlock — exact in-progress roundtrip

This applies to **all** shared manifests/workflows/locale/barrel/E2E registrations, especially ID-T01..04. **ID-T19/O37B is final verification, never their validation prerequisite.**

1. Author creates its exact new code/test/migration files and a local **worker-files-only checkpoint commit**. No lane push yet. It sends `HEAD SHA`, clean index/status, exact existing files, exact shared-file additions, unique test selectors and allocated migration name.
2. Author sets `PAUSED_FOR_REGISTRATION` metadata and performs **no git add/commit/merge or shared-file writes** until returned. It may read its files. The coordinator never edits that author's index/worktree.
3. Coordinator acquires serialized shared-file locks, creates a **separate registration worktree** at that exact checkpoint SHA and branch `reg/oorva-<stage>-<sha8>`. Require every requested test/migration file to exist at the checkpoint. Missing file → return `BLOCKED:REGISTRATION_FILE_ABSENT`; do not register future imports.
4. Coordinator applies **only** the exact shared registration additions. For SQL, append new `node <unique-test>.test.mjs` to `scripts.test` and each allocated `node parse.cjs <migration>` to `scripts.pretest` in numeric migration order; preserve all existing entries/full-chain loaders/deploy guards. Real-PG files go only to O37A's private job/discovery, never PGlite. Shared runtime/config code conflicts return to the owning author.
5. Coordinator verifies the exact selector selects the intended existing commands without running the app; `git diff --check`; commits only shared files with active trailers; returns registration commit SHA plus `SELECTION PASS: <actual filenames/commands>` and locks released. This is **selection proof, not a test PASS**.
6. Author checks no own-file change/index activity occurred, then `git merge --ff-only <registration-sha>`; failure → stop/return, never auto-resolve. It runs the required current-main Codespace checks and verifies actual selected files/cases plus `cs-test result: PASS`, then commits/pushes its lane and obtains lane green.
7. Final O37B/ID-T19 verifies those already-applied registrations and actual main deploy list at the permitted integration/promotion point. **No edge waits for final ID-T19 DONE before author tests.**

Exact E2E timing: additions not selected by lane CI are applied by the single coordinator in the combined batch **before its private E2E validation**, avoiding independent lane edits to the same smoke file. If an author requests the optional private lane run, apply its additions through this roundtrip **before that run** instead. Never register after the validation whose PASS is required. O37A generic private-job discovery requires no per-feature workflow edit merely to find a new PG file.

Copy-ready SQL selector proof, matching the current `run-all.mjs` substring algorithm:

```powershell
$Pkg = Get-Content 'supabase\tests\package.json' -Raw | ConvertFrom-Json
$Commands = @((($Pkg.scripts.pretest + '&&' + $Pkg.scripts.test) -split '&&') |
  ForEach-Object Trim | Where-Object { $_ } | Select-Object -Unique)
$Filter = 'oorva_o16_cap'
$Selected = @($Commands | Where-Object { $_.Contains($Filter) })
if ($Selected.Count -eq 0) { throw "Zero SQL commands selected: $Filter" }
$Selected
# Compare the printed commands to this stage's exact SQL files, then return SELECTION PASS.
```

Each SQL stage also requests its allocated migration parser selector separately; a test-filename substring does **not** select a differently named migration parser. No zero-selection run counts as validation.

#### 0.4.4 Worker validation, active trailers and handoff

1. Read only the bounded packet and completed source rows. Apply exact host extraction if assigned, then focused failing tests. No Expo route imports in Jest. Do not install/run app builds, npm/npx/Jest/tsc/Deno locally on the owner's Windows machine.
2. Use the actual **current-main** helper, saved under an existing session artifact directory, not an obsolete lane copy:

```powershell
git fetch origin main
if ($LASTEXITCODE) { throw 'Cannot refresh main for Codespace helper' }
$Helper = Join-Path $ArtifactDir 'cs-test-current-main.ps1'
$HelperText = git show origin/main:scripts/cs-test.ps1
if ($LASTEXITCODE) { throw 'Cannot read current-main Codespace helper' }
$HelperText | Set-Content -LiteralPath $Helper -Encoding utf8
# Run every exact tests[].command/commands Codespace entry projected for this stage.
git diff --check
```

3. Every new SQL scenario uses `createHarness()/scenario()`, full current migration chain, explicit `$1::uuid`/time/int casts, qualified joins, independent fixtures and a unique fixed future working-hour slot. Every assertion prints actual rows/state with `JSON.stringify`. Test clock/fixtures must not drift outside configured booking horizon. No local or sequential PGlite concurrency claim.
4. Verify actual selected files/cases and `cs-test result: PASS` **before every lane push or review request**. A Codespace outage is explicitly recorded and permits lane-CI fallback only, no Windows installs. Asset suite is unavailable until O37A is actually in current main with E1 tooling approval; no fabricated `-Suite assets` success.
5. Stage self-review: diff-check, exact files/functions, complete-chain/parser requests, no new hardcoded UI colors/font sizes, exact-paise preservation, class/parent/role tests. Compare actual git paths with the packet after normalizing git's separators; only the assigned stage and its returned coordinator registration paths are allowed:

```powershell
$Allowed = @($Stage.ownedFiles + $Stage.requestedSharedEdits.path |
  ForEach-Object { $_.ToLowerInvariant() } | Sort-Object -Unique)
$Changed = @(git diff --name-only $BaseSha HEAD) +
  @(git diff --name-only HEAD) + @(git ls-files --others --exclude-standard)
$Unexpected = @($Changed | ForEach-Object {
  $_.Replace([char]47,[char]92).ToLowerInvariant()
} | Where-Object { $_ -notin $Allowed } | Sort-Object -Unique)
if ($Unexpected.Count) { throw "Out-of-scope paths: $($Unexpected -join ',')" }
git diff --check
```

The actual migration template must already be substituted in `$Stage.ownedFiles`. The worker still never edits coordinator-only files; those changes must be attributable to the returned registration commit. Required focused money/auth/concurrency review uses configured defaults/lower model; no automatic Opus.
6. Commit with **active-session** trailers; do not copy this planning session's ID into a future session:

```powershell
$Trailer = "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`nCopilot-Session: $ActiveSessionId"
git commit -m "fix(oorva): $StageId <exact completed change>" -m $Trailer
git push origin HEAD:refs/heads/$Branch
```

7. Find exact-head CI once, then **one async watcher at 60 seconds**. The worker watches only its lane; integrator alone watches E2E. No polling loops, sync waits, repeated run-list calls or second watcher for the same run:

```powershell
gh run list --repo sushruth5454/quickserve --workflow lane-ci.yml --branch $Branch --limit 5 `
  --json databaseId,headSha,status,conclusion
# Select only the row whose headSha equals the pushed HEAD. Record it.
gh run watch $RunId --repo sushruth5454/quickserve --exit-status --interval 60
```

Launch the watcher through the asynchronous shell tool; continue independent work. On red:

```powershell
gh run view $RunId --repo sushruth5454/quickserve --log-failed |
  Tee-Object -FilePath (Join-Path $ArtifactDir "run-$RunId-failed.log")
```

Read **the whole failed log**, enumerate every `FAIL:` and uncaught error, fix every known cause in one coherent commit, rerun targeted Codespace checks and push once. No diagnostic-only push, hidden assertion weakening or unrelated fixture changes. If GitHub `core.remaining <500`, stop known watchers by their exact shell IDs, wait until recorded reset and do only git work; no API polling.

8. Handoff contains stage/task/finding IDs, exact head/base, files/functions/migration, flags/OFF behavior, actual selected tests/Codespace result/lane run/review, route-state-before-after evidence, registration commits, integration requests, exact blockers and next action. `CODE_GREEN` is asserted only for that exact head. Do not terminate an author context before its own red CI is fixed.

### 0.5 Sole Oorva feature-registry authority

All **25** keys default **OFF**, inserted `on conflict(key) do nothing`. Every row's description includes its exact OFF behavior. Labels/groups/sort below (200+i) override audit ad-hoc group/order proposals. Preserve existing independent capability flags and `get_app_features().archetypes`; public unknown boolean keys remain forward-compatible, unknown new keys evaluate OFF.

| Key / exact label | Group / sort | Parents (effective) | Exact OFF description |
|---|---|---|---|
| `oorva_brand` / Oorva identity | Branding / 200 | None | Existing bundled identity/palettes remain; native installed assets cannot remotely revert |
| `branding_runtime` / Published appearance | Branding / 201 | `oorva_brand` | Use bundled Oorva design when brand is ON, not a half-applied remote config |
| `branding_editor` / Branding editor | Branding / 202 | `branding_runtime` | No new drafts/uploads/ordinary publishes; current version and admin recovery remain readable |
| `oorva_launch_animation` / Oorva launch motion | Branding / 203 | `oorva_brand` | No in-app reveal animation; never disable native startup |
| `oorva_home_ux` / Oorva home and search | Oorva experience / 204 | `oorva_brand` | Existing home/search layout and routing retained |
| `oorva_auth_ux` / Oorva authentication and location | Oorva experience / 205 | `oorva_brand` | Existing OTP/location layouts retained |
| `oorva_catalogue_ux` / Oorva service discovery | Oorva experience / 206 | `oorva_brand` | Existing category/provider layouts retained |
| `oorva_booking_ux` / Oorva booking presentation | Oorva experience / 207 | `oorva_brand` | Existing booking/activity/receipt presentation retained |
| `oorva_recurring_ux` / Oorva recurring presentation | Oorva experience / 208 | `oorva_brand` | Existing plan/calendar presentation retained |
| `oorva_shops_ux` / Oorva shops presentation | Oorva experience / 209 | `oorva_brand` | Existing shops/products presentation retained |
| `oorva_rfq_ux` / Oorva enquiry and RFQ presentation | Oorva experience / 210 | `oorva_brand` | Existing RFQ/enquiry presentation retained |
| `oorva_sports_ux` / Oorva sports presentation | Oorva experience / 211 | `oorva_brand` | Existing sports presentation retained |
| `oorva_creators_ux` / Oorva creator presentation | Oorva experience / 212 | `oorva_brand` | Existing creator/proposal presentation retained |
| `oorva_account_ux` / Oorva account and rewards | Oorva experience / 213 | `oorva_brand` | Existing account/legal/rewards layouts retained |
| `oorva_comms_ux` / Oorva notifications and support | Oorva experience / 214 | `oorva_brand` | Existing notification/chat/support layouts retained |
| `oorva_provider_ux` / Oorva provider workspace | Oorva experience / 215 | `oorva_brand` | Existing owner/staff dashboard/job presentation retained |
| `oorva_onboarding_ux` / Oorva provider onboarding | Oorva experience / 216 | `oorva_brand` | Existing onboarding/edit presentation retained |
| `oorva_merchant_shop_ux` / Oorva shop workspace | Oorva experience / 217 | `oorva_brand` | Existing shop editor/enquiry presentation retained |
| `oorva_business_staff_ux` / Oorva business tools | Oorva experience / 218 | `oorva_brand` | Existing membership/invite/supplier workspace retained |
| `oorva_venue_ops_ux` / Oorva venue workspace | Oorva experience / 219 | `oorva_brand` | Existing venue-management presentation retained |
| `oorva_admin_ops_ux` / Oorva admin operations | Oorva experience / 220 | `oorva_brand` | Existing overview/review/support queue presentation retained |
| `oorva_admin_config_ux` / Oorva admin configuration | Oorva experience / 221 | `oorva_brand` | Existing configuration/catalogue presentation retained |
| `oorva_admin_money_ux` / Oorva admin financial views | Oorva experience / 222 | `oorva_brand` | Existing financial views/controls retained |
| `oorva_ai_ux` / Oorva AI presentation | Oorva experience / 223 | `oorva_brand` | Existing AI presentation retained; `ai_assistant` still controls capability |
| `oorva_external_brand` / Oorva outbound display identity | Branding / 224 | `oorva_brand` | Existing outbound display identity; historical records never rewritten |

`FEATURE_PARENTS` is exported once by `app\src\lib\featureFlagModel.ts`; admin presentation imports it. Parent evaluation is recursive/effective, never raw intermediate booleans. Test root OFF/intermediate ON/child ON, child OFF under parent OFF, dynamic registry discovery, admin/non-admin and server rejection. New admin/write capabilities check parent+leaf server-side; UI hiding never authorizes.

| Class | Effective behavior |
|---|---|
| **A — existing correctness/accessibility/actor/state/money safety** | Always applies with **all Oorva OFF**. Genuine legacy changes are allowed only for the exact audited repair: truthful errors/status/actions, current permission/privacy, readable full labels/amounts/contrast, safe keyboard/obstruction and guarded refresh. No final logo/backend-branding dependency. |
| **B — identity** | Effective `oorva_brand`; runtime appearance additionally uses its actual parents. OFF selects exact per-context legacy identity, not global QuickServe normalization. Installed native assets cannot remotely revert. |
| **C — family composition** | Effective brand **and that consumer's family leaf** plus existing capability parents. Shared components default to legacy presentation; no unconditional section/card/dashboard redesign disguised as A. |

Never gate payment recording, refunds, settlement/payout release, expiry cleanup, valid existing customer cancellation, authorized history or other established in-flight resolution on appearance/assets/UX flags. New-work OFF does not erase existing obligations; only the exact audited compatibility exceptions apply, not new policy.

---

## 1. Decisions and acceptance gates

| Gate | Exact scope / evidence | Does NOT block |
|---|---|---|
| **E0** | Future explicit request to implement this approved contract; reversible private development/testing only. D01 development approval references fixed design/architecture. | This documentation integration; no implied deployment/data repair. |
| **E1** | Explicit ordinary flag-OFF main delivery permission acknowledging automatic backend/Expo publication. May be scoped to tooling/foundations. | Private lane/batch implementation/testing. |
| **D02** | Approval of independent controls, bounded startup/fallback/late-ON behavior before public identity activation. | Private O05F/O05A/launch model work. |
| **D03a** | Coordinator verifies supplied-master hashes/provenance, records evidence and marks this input gate APPROVED; no new artwork or owner-selection request. Public rights remain D03c. | Fonts, unrelated A repairs, schema/tooling. |
| **D03b** | Coordinator verifies supplied D manifest/binding hashes against the recorded D approval and marks this input gate APPROVED. O05B/O33/O34 consume ready files; public/native gates remain separate. | Unrelated UI/safety code, fonts, schema/tooling. |
| **D03c** | Public brand/trademark/store/asset rights clearance. | Internal candidate/source implementation. |
| **D04** | Fixed eligible-cold-process motion contract, never resume/login replay, web/Expo Go reveal OFF. | Private development follows A.4.4; public motion waits approval. |
| **D05-policy-scope** | Approve exact scope-qualified public safety/agreement/deletion copy; no new fee/refund/guarantee/domain/issuer policy. | Unrelated actor/state/money safety fixes. ID-Q01's exact deactivation-duty clarification is already resolved. |
| **D05-outbound** | Per-context future outward/legal copy decisions. Nonlegal Oorva display may change only as approved; working support contact, legal issuer and payout narration retained otherwise. | In-app foundations or data-preserving runtime repairs. |
| **D06** | Seva Coins rename/denomination/policy remains unapproved; keep existing name and arithmetic. | Existing rewards truth/layout work. |
| **D07a-platform** | Actual supported device, signing/build access and device-reachable owner-approved isolated non-production backend on exact branch server revision, synthetic actors. Loopback CI backend is not automatically device reachable. | Other-platform/private code; unavailable platform explicitly NOT VERIFIED. |
| **STACK-O34** | Explicit O34 candidate stacked start at exact O33 CODE_GREEN SHA/run. | Does not grant D07b or main merge. |
| **D07b** | Native production/runtime/channel cutover, reinstall/legacy maintenance and distribution approval **after candidate evidence**. | Creating the O33→O34 evidence stack. |
| **TOOL-ASSETS-MAIN** | O37A assets runner really exists in current main under E1 tooling authorization; refreshed helper accepts it. | O01F/supplied-SVG import/A fixes; no guessed suite command. |
| **MIG-\*** | One unique claim reconciled/acknowledged/substituted under section 3 before SQL writer launch. | Disjoint non-SQL work. |
| **DATA-CASE-\*** | Separate explicit per-PK preview/approval for any historical money/status correction beyond defined runtime behavior. | Never implied by E0/E1 or flag-OFF deployment. No such operation is executed by this plan/task. |

Phase exits: evidence/metadata → foundations → guarded shared UI → each customer/business/admin family → actual native/outbound candidate evidence → combined integration/release scope. These are acceptance summaries, **not additional aggregate prerequisites**. Stage JSON alone defines graph edges.

Rollback: family leaf OFF restores corrected legacy composition; runtime OFF selects bundled approved identity; brand OFF selects contextual legacy identity. Control OFF always applies despite bad appearance/assets. Recovery chooses supported previously published hard-safe non-revoked content without new soft-policy veto and never re-enables switches. Native installed-name/icon/splash repair requires an approved corrected binary, not a JSON rollback.

---

## 2. Concrete executable catalogue and shared contracts

### 2.1 Authoritative dispatch stages

Each row is one real writer. Every source task maps **exactly once**. Full exact `ownedFiles/sqlFunctions/steps/acceptance/testFilesAndCases/tests` are in the bounded JSON projection; source anchors supply completed frozen evidence. No O38 future-audit lanes, repeated discovery prerequisite, duplicate aggregate dispatch or hidden parent-family readiness condition remains.

| Dispatch stage | Class | Completed source tasks | Concrete output / exact scope in JSON | Dependencies (all) |
|---|---|---|---|---|
| `O00` | A | Retained core contract | Freeze implementation inputs, reconcile owners and allocate launch metadata | E0 |
| `O38R` | A | Retained core contract | One request-epoch and focused-active entity refresh core | O00 |
| `O37A` | A | Retained core contract | Independent export, capture and private PostgreSQL verification infrastructure | O00 |
| `O02` | A | [PF-T07](audit/18-WS1-Platform-Auth-AI-Native.md#pf-t07) | Semantic danger repair and strict appearance contract | O00 |
| `O05F` | A | [PF-T01](audit/18-WS1-Platform-Auth-AI-Native.md#pf-t01) | One independent flag control plane and truthful auth restoration | O00, O38R |
| `O06A` | A | [PF-T08](audit/18-WS1-Platform-Auth-AI-Native.md#pf-t08) | Always-on readable primitives and essential-text reflow | O00, O02 |
| `O07A` | A | [PF-T09](audit/18-WS1-Platform-Auth-AI-Native.md#pf-t09) | Always-on obstruction, keyboard and safe crash-shell repair | O00 |
| `O08-MK20` | A | [MK-T20](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t20) | Narrow home pillar truncates a primary family title | O00 |
| `O09-SP01` | A | [SP-T01](audit/18-WS5-Sports-Operations.md#sp-t01) | Admin repeats Verify on verified venues and cannot invoke already-authorized restoration | O00 |
| `O09-SP02` | A | [SP-T02](audit/18-WS5-Sports-Operations.md#sp-t02) | Admin repeats Verify on verified venues and cannot invoke already-authorized restoration | O00, O09-SP01 |
| `O11-ACCESS` | A | [PF-T04](audit/18-WS1-Platform-Auth-AI-Native.md#pf-t04) | Distinct access loading, error, denial and retry | O00, O38R |
| `O12-MK08` | A | [MK-T08](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t08) | Unified search discards valid server product matches and exposes grouping categories as services | O00 |
| `O12-MK09` | A | [MK-T09](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t09) | Unified product result strips indicative unit-price and stock truth | O00, O38R |
| `O12-MK10` | A | [MK-T10](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t10) | Marketplace entry points ignore effective parent capabilities | O00, O38R, O12-MK09 |
| `O13-AUTH` | A | [PF-T02](audit/18-WS1-Platform-Auth-AI-Native.md#pf-t02) | Recoverable OTP continuation without losing destination | O00, O38R |
| `O13-BYO` | A | [PF-T05](audit/18-WS1-Platform-Auth-AI-Native.md#pf-t05) | Recoverable protected-invite claim/payment continuation | O00, O38R |
| `O13-LOCATION` | A | [PF-T03](audit/18-WS1-Platform-Auth-AI-Native.md#pf-t03) | Actor-scoped private location and address state | O00, O38R |
| `O14-MK12` | A | [MK-T12](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t12) | Top-rated public card projection loses archetype pricing and current leave | O00, O05F, O08-MK20 |
| `O14-MK13` | A | [MK-T13](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t13) | Package catalogue ignores selected service city | O00 |
| `O12-MK16` | A | [MK-T16](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t16) | Discovery/profile response scope and refresh can preserve stale truth | O00, O38R, O12-MK10, O14-MK12, O14-MK13 |
| `O14-MK14` | A | [MK-T14](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t14) | Provider-specific package action silently restarts at all-provider category | O00, O12-MK16 |
| `O15-SV10` | A | [SV-T10](audit/18-WS3-Services-Creators-Recurring.md#sv-t10) | Checkout route/quantity/duration differs from the selected server booking contract | O00, O14-MK13 |
| `O16-MN06` | A | [MN-T06](audit/18-WS6-Money-Receipts.md#mn-t06) | Receipt snapshot is mistaken for current refund/due state and refunded receipts lose their entry point | O00, O14-MK12 |
| `O16-SV03` | A | [SV-T03](audit/18-WS3-Services-Creators-Recurring.md#sv-t03) | Readback depends on remount/status changes that several real mutations do not produce | O00, O38R, O16-MN06 |
| `O17-SV07` | A | [SV-T07](audit/18-WS3-Services-Creators-Recurring.md#sv-t07) | Counterparty can accept a pending recurring reschedule after the visit is no longer reschedulable | O00, O37A |
| `O17-PLAN` | A | [SV-T08](audit/18-WS3-Services-Creators-Recurring.md#sv-t08), [SV-T09](audit/18-WS3-Services-Creators-Recurring.md#sv-t09) | Canonical recurring deadline, capabilities and exhaustive history | O00, O17-SV07 |
| `O17-SV18` | A | [SV-T18](audit/18-WS3-Services-Creators-Recurring.md#sv-t18) | Recurring creation trusts navigation hints and preserves a quote across changed address eligibility | O00, O17-PLAN |
| `O18-MK04` | A | [MK-T04](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t04) | Capability OFF currently erases authorized history and blocks owner RFQ cancellation | O00, O12-MK10, O17-PLAN |
| `O18-MK15` | A | [MK-T15](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t15) | Marketplace load failures can claim empty supply, setup or endless loading | O00, O38R, O12-MK16, O18-MK04 |
| `O19-MK05` | A | [MK-T05](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t05) | Supplier selection bypasses current verified-shop requirement | O00, O37A, O18-MK04 |
| `O19-MK25` | A | [MK-T25](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t25) | RFQ cancel confirmation promises supplier notification not queued by current command | O00, O18-MK04, O18-MK15 |
| `O19-MK26` | A | [MK-T26](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t26) | Hard product deletion can violate the open-enquiry key and cannot preserve all valid histories | O00, O37A, O18-MK04, O19-MK05 |
| `O18-MK11` | A | [MK-T11](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t11) | Guest and own-shop enquiry/AI commits do not use existing authentication handoff | O00, O18-MK04, O18-MK15, O19-MK05, O19-MK26 |
| `O19-MK17` | A | [MK-T17](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t17) | Enquiry closed/reopen/refresh controls do not match every participant state | O00, O18-MK04, O18-MK15, O19-MK26, O18-MK11 |
| `O20-SP05` | A | [SP-T05](audit/18-WS5-Sports-Operations.md#sp-t05) | Detail and checkout action predicates omit actual actor/time/payment eligibility | O00 |
| `O20-SP06` | A | [SP-T06](audit/18-WS5-Sports-Operations.md#sp-t06) | Latest public venue RPC dropped the cancellation-policy disclosure contract | O00, O09-SP01 |
| `O20-SP07` | A | [SP-T07](audit/18-WS5-Sports-Operations.md#sp-t07) | Real payment Edge Function strands live sports obligations after feature shutdown | O00 |
| `O20-SP11` | A | [SP-T11](audit/18-WS5-Sports-Operations.md#sp-t11) | Legacy multi-slot request still overcounts adjacent per-slot occupancy | O00, O37A, O20-SP06 |
| `O21-MK24` | A | [MK-T24](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t24) | Creator landing has no successful-empty category state | O00 |
| `O21-READ` | A | [ID-T02](audit/18-WS4-Identity-Provider-Workspaces.md#id-t02), [SV-T05](audit/18-WS3-Services-Creators-Recurring.md#sv-t05) | Single proposal read state and delegated-view guard | O00, O38R |
| `O21-SV04` | A | [SV-T04](audit/18-WS3-Services-Creators-Recurring.md#sv-t04) | Readback depends on remount/status changes that several real mutations do not produce | O00, O38R, O17-PLAN, O21-READ |
| `O21-SV06` | A | [SV-T06](audit/18-WS3-Services-Creators-Recurring.md#sv-t06) | Request-message errors are discarded and closed conversations still look writable | O00, O16-SV03, O21-READ, O21-SV04 |
| `O21-SV16` | A | [SV-T16](audit/18-WS3-Services-Creators-Recurring.md#sv-t16) | Request comparison ranks unavailable proposal versions as the lowest actionable offer | O00, O21-READ, O21-SV04 |
| `O21-SV19` | A | [SV-T19](audit/18-WS3-Services-Creators-Recurring.md#sv-t19) | New proposal intake/send/routing does not consistently enforce current parent and readiness contracts | O00, O21-READ |
| `O21-SV20` | A | [SV-T20](audit/18-WS3-Services-Creators-Recurring.md#sv-t20) | Cancel request can contradict an active accepted proposal payment hold | O00, O37A, O21-READ, O21-SV16 |
| `O22-DELIVERY` | A | [SV-T01](audit/18-WS3-Services-Creators-Recurring.md#sv-t01), [SV-T24](audit/18-WS3-Services-Creators-Recurring.md#sv-t24) | Proposal delivery detection and generic-completion guards | O00, O21-SV19 |
| `O22-SV02` | A | [SV-T02](audit/18-WS3-Services-Creators-Recurring.md#sv-t02) | Generic quote editing/approval crosses fixed, session and proposal contracts | O00, O15-SV10, O16-SV03, O21-READ |
| `O22-SV17` | A | [SV-T17](audit/18-WS3-Services-Creators-Recurring.md#sv-t17) | Composer rejects valid administrator revision defaults and boundary advance policies | O00, O21-SV19, O21-SV20, O22-DELIVERY |
| `O23-ID13` | A | [ID-T13](audit/18-WS4-Identity-Provider-Workspaces.md#id-t13) | All-family legal/safety presentation must qualify home-service workflow claims | O00 |
| `O24-CM03` | A | [CM-T03](audit/18-WS7-Communications-Admin.md#cm-t03) | Communication/admin load paths misrepresent failure or cannot recover correctly | O00, O38R |
| `O24-CM04` | A | [CM-T04](audit/18-WS7-Communications-Admin.md#cm-t04) | Shared support detail has stale/missing-context actions and no focused incoming refresh | O00, O38R, O24-CM03 |
| `O24-CM05` | A | [CM-T05](audit/18-WS7-Communications-Admin.md#cm-t05) | Chat state and message readback depend on incomplete mount/realtime paths | O00, O38R |
| `O24-NOTIFICATIONS` | A | [CM-T01](audit/18-WS7-Communications-Admin.md#cm-t01), [CM-T02](audit/18-WS7-Communications-Admin.md#cm-t02), [CM-T06](audit/18-WS7-Communications-Admin.md#cm-t06) | Persistent acknowledgement, timestamp provenance and member unread | O00, O37A |
| `O27-MK02` | A | [MK-T02](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t02) | submit_shop permits direct resets that the owner UI explicitly forbids | O00 |
| `O27-MK03` | A | [MK-T03](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t03) | Suspended owner shop still offers product editing that SQL rejects | O00, O12-MK10, O18-MK15 |
| `O28-ID03` | A | [ID-T03](audit/18-WS4-Identity-Provider-Workspaces.md#id-t03) | Selected-business PK/context read with OFF-history compatibility | O00, O19-MK17 |
| `O16-CAP` | A | [ID-T04](audit/18-WS4-Identity-Provider-Workspaces.md#id-t04), [SV-T14](audit/18-WS3-Services-Creators-Recurring.md#sv-t14), [SV-T25](audit/18-WS3-Services-Creators-Recurring.md#sv-t25) | Booking capabilities, no-show read and ended-payment safety | O00, O37A, O22-DELIVERY, O22-SV02, O28-ID03 |
| `O16-SV13` | A | [SV-T13](audit/18-WS3-Services-Creators-Recurring.md#sv-t13) | Review controls advertise writes that the current review contract rejects | O00, O17-PLAN, O16-CAP |
| `O25-ID09` | A | [ID-T09](audit/18-WS4-Identity-Provider-Workspaces.md#id-t09) | Assigned-job screen has stale action state, incomplete no-show eligibility and incorrect multi-actor chat attribution | O00, O38R, O21-SV06, O24-CM05, O16-CAP |
| `O28-ID10` | A | [ID-T10](audit/18-WS4-Identity-Provider-Workspaces.md#id-t10) | Business identity entry points omit real memberships, stable business IDs and effective feature parents | O00, O38R, O28-ID03 |
| `O28-MK07` | A | [MK-T07](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t07) | Supplier detail loses saved quote terms/outcomes and reuses wrong-context drafts | O00, O18-MK04, O18-MK15, O19-MK05 |
| `O19-MK06` | A | [MK-T06](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t06) | RFQ actions/outcomes ignore temporal eligibility and conflate parent/quote state | O00, O18-MK15, O19-MK05, O19-MK25, O19-MK26, O28-MK07 |
| `O28-MK18` | A | [MK-T18](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t18) | Business work lists lose business identity for multi-business members | O00, O18-MK04, O18-MK15, O28-MK07, O19-MK06 |
| `O29-STATE` | A | [SP-T03](audit/18-WS5-Sports-Operations.md#sp-t03), [SP-T04](audit/18-WS5-Sports-Operations.md#sp-t04), [SP-T17](audit/18-WS5-Sports-Operations.md#sp-t17) | Venue resource hydration, business selection and safe schedule actions | O00, O09-SP02 |
| `O09-SP09` | A | [SP-T09](audit/18-WS5-Sports-Operations.md#sp-t09) | Focused cross-role venue/booking views have inconsistent refresh guarantees | O00, O38R, O09-SP02, O20-SP05, O29-STATE |
| `O20-SLOTS` | A | [SP-T10](audit/18-WS5-Sports-Operations.md#sp-t10), [SP-T12](audit/18-WS5-Sports-Operations.md#sp-t12) | Slot request epochs, idempotent selection and subtotal disclosure | O00, O20-SP05, O09-SP09 |
| `O20-SP08` | A | [SP-T08](audit/18-WS5-Sports-Operations.md#sp-t08) | Activity and business cards contradict canonical sports payment/status truth | O00, O19-MK05, O20-SP05, O29-STATE, O09-SP09 |
| `O30-CM07` | A | [CM-T07](audit/18-WS7-Communications-Admin.md#cm-t07) | Admin overview still counts KYC work as provider admin review and labels gross collections Revenue | O00, O24-NOTIFICATIONS |
| `O31-CM08` | A | [CM-T08](audit/18-WS7-Communications-Admin.md#cm-t08) | Category views locally synthesize canonical state, including wrong reorder positions | O00 |
| `O31-CM09` | A | [CM-T09](audit/18-WS7-Communications-Admin.md#cm-t09) | Feature switches allow out-of-order full-state responses | O00, O38R, O05F |
| `O31-CM10` | A | [CM-T10](audit/18-WS7-Communications-Admin.md#cm-t10) | Communication/admin load paths misrepresent failure or cannot recover correctly | O00, O38R |
| `O31-CM11` | A | [CM-T11](audit/18-WS7-Communications-Admin.md#cm-t11) | Rules focus refresh discards unsaved edits; disabled direct route is blank | O00, O38R |
| `O31-MK01` | A | [MK-T01](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t01) | Admin shop card advertises Verify and other completed actions independently of current state | O00, O18-MK15 |
| `O32-MN01` | A | [MN-T01](audit/18-WS6-Money-Receipts.md#mn-t01) | Refund submission/parent resolution can be presented as completed reimbursement | O00, O16-CAP, O16-SV13 |
| `O32-MN02` | A | [MN-T02](audit/18-WS6-Money-Receipts.md#mn-t02) | Time-based demo completion creates a financial pending payout instead of demo | O00 |
| `O32-MN04` | A | [MN-T04](audit/18-WS6-Money-Receipts.md#mn-t04) | Failed refund retry does not recheck capacity reserved by other refund rows | O00, O37A |
| `O32-MN07` | A | [MN-T07](audit/18-WS6-Money-Receipts.md#mn-t07) | Partial dispute form does not mirror payout cap and its note rule is UI-only | O00 |
| `O32-MN08` | A | [MN-T08](audit/18-WS6-Money-Receipts.md#mn-t08) | Admin money read projections collapse funding/refund context and omit supported problem parents | O00, O24-CM03, O32-MN04, O32-MN07 |
| `O32-MN09` | A | [MN-T09](audit/18-WS6-Money-Receipts.md#mn-t09) | Money views lack reliable identity-keyed readback and some suppress real read failures | O00, O38R, O16-MN06, O32-MN01, O32-MN08 |
| `O32-MN16` | A | [MN-T16](audit/18-WS6-Money-Receipts.md#mn-t16) | Daily gateway reconciliation compares gross tranches and synthetic offsets as real gateway money | O00 |
| `O32-PAYOUT` | A | [MN-T03](audit/18-WS6-Money-Receipts.md#mn-t03), [MN-T10](audit/18-WS6-Money-Receipts.md#mn-t10), [MN-T11](audit/18-WS6-Money-Receipts.md#mn-t11), [MN-T15](audit/18-WS6-Money-Receipts.md#mn-t15) | Truthful payout/readiness/statement text and full references | O00, O32-MN09 |
| `O32-SV11` | A | [SV-T11](audit/18-WS3-Services-Creators-Recurring.md#sv-t11) | Server preview endpoints and package UI retain obsolete fee sources after configured-fee writers changed | O00, O15-SV10, O21-SV04, O22-SV17 |
| `O35-MN05` | A | [MN-T05](audit/18-WS6-Money-Receipts.md#mn-t05) | Hosted checkout turns verification failure or uncertainty into success copy | O00 |
| `O36-SAFETY` | A | [PF-T06](audit/18-WS1-Platform-Auth-AI-Native.md#pf-t06) | AI capability guards and conversation request epochs | O00, O38R, O15-SV10 |
| `O38-ID01` | A | [ID-T01](audit/18-WS4-Identity-Provider-Workspaces.md#id-t01) | Canonical document/readiness and safe owner/admin/job projections | O00, O22-SV02, O32-MN08 |
| `O14-ID20` | A | [ID-T20](audit/18-WS4-Identity-Provider-Workspaces.md#id-t20) | Truthful public payout/certificate badges without independent ID claim | O00, O14-MK14, O38-ID01 |
| `O25-SV12` | A | [SV-T12](audit/18-WS3-Services-Creators-Recurring.md#sv-t12) | Provider request/next-job cards use the wrong deadline and omit actual family context | O00, O37A, O38-ID01 |
| `O26-ID05` | A | [ID-T05](audit/18-WS4-Identity-Provider-Workspaces.md#id-t05) | Per-document readiness is misclassified and owner credential rendering ignores scope/expiry | O00, O38R, O38-ID01 |
| `O23-ID07` | A | [ID-T07](audit/18-WS4-Identity-Provider-Workspaces.md#id-t07) | Account/service/online presentation uses incompatible meanings of verified or live | O00, O28-ID03, O26-ID05 |
| `O23-ID12` | A | [ID-T12](audit/18-WS4-Identity-Provider-Workspaces.md#id-t12) | Several owned reads convert unavailable/stale data into empty, zero, pending or silently current state | O00, O23-ID07 |
| `O25-ID08` | A | [ID-T08](audit/18-WS4-Identity-Provider-Workspaces.md#id-t08) | Account/service/online presentation uses incompatible meanings of verified or live | O00, O38R, O38-ID01, O25-SV12, O26-ID05 |
| `O26-ID06` | A | [ID-T06](audit/18-WS4-Identity-Provider-Workspaces.md#id-t06) | Provider identity and hours drafts are shared across accounts on the same device | O00, O38R, O26-ID05 |
| `O30-ID11` | A | [ID-T11](audit/18-WS4-Identity-Provider-Workspaces.md#id-t11) | Admin provider cards retain completed review actions and collapse independent state axes | O00, O38-ID01 |
| `O01F` | B | Retained core contract | Licensed bundled heading fonts independent of final logo | O00 |
| `O01L` | B | Retained core contract | Verify and import supplied approved-D vector masters; do not redraw | O00 |
| `O01X` | B | Retained core contract | Verify and import supplied approved-D PNG exports and metadata | O00, O37A, O01L |
| `O03` | B | Retained core contract | Secure registry, versioned branding storage and atomic publication | O00, O37A, O02 |
| `O03-ASSET-REG` | B | Owner-approved 2026-11-23 scope delta | Service-role-only registration of Edge-validated immutable asset metadata | O00, O03, O37A |
| `O04` | B | Retained core contract | Constrained immutable PNG upload, public serving and private preview | O00, O37A, O03, O03-ASSET-REG |
| `O05A` | B | Retained core contract | Atomic appearance integration into the existing theme, without final logo dependency | O00, O02, O05F, O07A, O01F |
| `O05I` | B | Retained core contract | Single contextual identity hook and resolver for all display consumers | O00, O05A |
| `O05B` | B | [PF-T10](audit/18-WS1-Platform-Auth-AI-Native.md#pf-t10) | Selected identity asset binding with contextual legacy fallback | O00, O01X, O05A, O05I |
| `O06B` | B | Retained core contract | Identity typography and token-driven primitive styling | O00, O06A, O05A |
| `O11` | B | Retained core contract | Contextual navigation identity without route or role changes | O00, O11-ACCESS, O05I, O06B |
| `O16-MN14` | B | [MN-T14](audit/18-WS6-Money-Receipts.md#mn-t14) | Receipt display brand must be separated from original receipt/issuer identity | O00, O16-MN06, O32-MN09, O05I |
| `O08` | C | Retained core contract | Reusable entity-specific card presentation APIs, not a universal card engine | O00, O07A, O08-MK20, O03, O05I, O06B |
| `O10` | C | Retained core contract | Admin Settings and isolated Branding & Appearance editor | O00, O07A, O31-CM09, O03, O04, O05A, O05I, O06B |
| `O12-MK19` | C | [MK-T19](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t19) | Home discovery needs one deliberate urgent-work and search/AI hierarchy | O00, O08-MK20, O12-MK16, O16-CAP, O25-SV12, O03, O05I, O06B, O08 |
| `O13C` | C | Retained core contract | Flagged auth, location and protected-invite composition | O00, O13-AUTH, O13-BYO, O13-LOCATION, O03, O05I, O06B, O11, O08 |
| `O33` | B | [PF-T11](audit/18-WS1-Platform-Auth-AI-Native.md#pf-t11) | Isolated, compatible native identity candidate | O00, O37A, O01X, O05B, O11, O13C |
| `O14-MK21` | C | [MK-T21](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t21) | Provider decision controls follow secondary biography/hours | O00, O12-MK16, O14-MK14, O14-ID20, O03, O05I, O06B, O08 |
| `O14C` | C | Retained core contract | Flagged catalogue and ranked-provider composition | O00, O14-MK12, O14-MK13, O12-MK16, O14-ID20, O03, O05I, O06B, O11, O08 |
| `O15-SV15` | C | [SV-T15](audit/18-WS3-Services-Creators-Recurring.md#sv-t15) | Fixed entry hides essential address and forces a mount-time schedule | O00, O15-SV10, O32-SV11, O03, O05I, O06B, O08 |
| `O16-SV21` | C | [SV-T21](audit/18-WS3-Services-Creators-Recurring.md#sv-t21) | Service family hierarchy needs concrete composition changes, not a second booking engine | O00, O17-PLAN, O18-MK04, O21-SV04, O16-CAP, O16-SV13, O03, O05I, O06B, O08 |
| `O17-SV23` | C | [SV-T23](audit/18-WS3-Services-Creators-Recurring.md#sv-t23) | Service family hierarchy needs concrete composition changes, not a second booking engine | O00, O17-SV07, O17-PLAN, O17-SV18, O21-SV04, O03, O05I, O06B, O08 |
| `O18-MK23` | C | [MK-T23](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t23) | Product/shop discovery gives optional forms priority over browsing and buries enquiry action | O00, O12-MK10, O18-MK04, O18-MK15, O18-MK11, O03, O05I, O06B, O08, O16-SV21 |
| `O19C` | C | Retained core contract | Flagged RFQ, supplier comparison and enquiry composition | O00, O18-MK15, O19-MK25, O19-MK26, O19-MK17, O19-MK06, O28-MK18, O03, O05I, O06B, O08 |
| `O20-SP13` | C | [SP-T13](audit/18-WS5-Sports-Operations.md#sp-t13) | Sports home ties existing-work navigation to discovery success and provider navigation role | O00, O29-STATE, O03, O05I, O06B, O08 |
| `O20-SP14` | C | [SP-T14](audit/18-WS5-Sports-Operations.md#sp-t14) | Sports family needs concrete review/discovery/selection/card hierarchy, not another style-only pass | O00, O20-SP06, O09-SP09, O20-SLOTS, O20-SP08, O03, O05I, O06B, O08, O20-SP13 |
| `O21-SV22` | C | [SV-T22](audit/18-WS3-Services-Creators-Recurring.md#sv-t22) | Service family hierarchy needs concrete composition changes, not a second booking engine | O00, O21-READ, O21-SV04, O21-SV06, O21-SV16, O21-SV19, O21-SV20, O22-DELIVERY, O22-SV02, O22-SV17, O16-CAP, O32-MN09, O32-SV11, O03, O05I, O06B, O08 |
| `O16C` | C | Retained core contract | Flagged booking-detail hierarchy after all safety/readback repairs | O00, O16-MN06, O16-SV03, O16-CAP, O16-SV13, O32-MN01, O03, O05I, O06B, O08, O21-SV22 |
| `O21C` | C | Retained core contract | Flagged creator discovery composition with real portfolio/category facts | O00, O21-MK24, O03, O05I, O06B, O08 |
| `O23-ID14` | C | [ID-T14](audit/18-WS4-Identity-Provider-Workspaces.md#id-t14) | Oorva account/reward/help composition needs deliberate personal-versus-business hierarchy | O00, O21-SV06, O23-ID13, O23-ID07, O23-ID12, O03, O05I, O06B, O08 |
| `O24-CM12` | C | [CM-T12](audit/18-WS7-Communications-Admin.md#cm-t12) | Communications composition needs dated context and independent status/unread cues, not a speculative top-gap patch | O00, O24-CM03, O24-CM04, O24-CM05, O24-NOTIFICATIONS, O03, O05I, O06B, O08 |
| `O25-ID15` | C | [ID-T15](audit/18-WS4-Identity-Provider-Workspaces.md#id-t15) | Oorva provider workspace should promote urgent and scheduled work over metrics/secondary history | O00, O21-READ, O25-ID09, O25-SV12, O25-ID08, O03, O05I, O06B, O08 |
| `O26-ID17` | C | [ID-T17](audit/18-WS4-Identity-Provider-Workspaces.md#id-t17) | Oorva onboarding/profile hierarchy should promote required repair over optional portfolio strength | O00, O23-ID13, O26-ID05, O26-ID06, O03, O05I, O06B, O08 |
| `O27-MK22` | C | [MK-T22](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t22) | Existing-shop catalogue and inbox work are subordinate to management forms | O00, O27-MK03, O28-MK18, O03, O05I, O06B, O08 |
| `O28-ID16` | C | [ID-T16](audit/18-WS4-Identity-Provider-Workspaces.md#id-t16) | Oorva business tools should preserve selected context and promote current create/share/member actions | O00, O28-ID03, O28-ID10, O28-MK18, O29-STATE, O09-SP09, O03, O05I, O06B, O08, O27-MK22 |
| `O29-SP15` | C | [SP-T15](audit/18-WS5-Sports-Operations.md#sp-t15) | Owner requests are below every editor and enabled owner view omits existing started/history rows | O00, O29-STATE, O09-SP09, O20-SP08, O03, O05I, O06B, O08 |
| `O30-CM13` | C | [CM-T13](audit/18-WS7-Communications-Admin.md#cm-t13) | Admin operations should put actionable queues before reporting | O00, O24-CM03, O30-CM07, O03, O05I, O06B, O08, O10 |
| `O24-CM15` | B | [CM-T15](audit/18-WS7-Communications-Admin.md#cm-t15) | Local communications/operations display copy is hardcoded to QuickServe | O00, O05I, O24-CM12, O30-CM13 |
| `O30-ID18` | C | [ID-T18](audit/18-WS4-Identity-Provider-Workspaces.md#id-t18) | Oorva admin people/documents should be queue-first with explicit scoped actions | O00, O30-ID11, O03, O05I, O06B, O08 |
| `O31-CM14` | C | [CM-T14](audit/18-WS7-Communications-Admin.md#cm-t14) | Six admin configuration screens need deliberate find/edit/save hierarchy | O00, O31-CM08, O31-CM09, O31-CM10, O31-CM11, O03, O05I, O06B, O08, O10 |
| `O31-SP16` | C | [SP-T16](audit/18-WS5-Sports-Operations.md#sp-t16) | Sports family needs concrete review/discovery/selection/card hierarchy, not another style-only pass | O00, O09-SP02, O09-SP09, O03, O05I, O06B, O08 |
| `O32-MN12` | C | [MN-T12](audit/18-WS6-Money-Receipts.md#mn-t12) | Financial family needs contextual transaction hierarchy and deliberate admin setting review | O00, O16-MN06, O32-MN01, O32-MN02, O32-MN08, O32-MN09, O32-PAYOUT, O03, O05I, O06B, O16-MN14, O08 |
| `O32-MN13` | C | [MN-T13](audit/18-WS6-Money-Receipts.md#mn-t13) | Financial family needs contextual transaction hierarchy and deliberate admin setting review | O00, O32-MN09, O38-ID01, O03, O05I, O06B, O08 |
| `O34` | C | [PF-T12](audit/18-WS1-Platform-Auth-AI-Native.md#pf-t12) | Bounded native-identical, destination-aware launch reveal | O00, O05F, O07A, O13-AUTH, O05A, O05B, O11, O33 |
| `O36C` | C | Retained core contract | Flagged AI conversation/history composition and contextual identity | O00, O15-SV10, O36-SAFETY, O03, O05I, O06B, O08, O12-MK19 |
| `O35D` | B | Retained core contract | Approved future outbound/web display identity, with technical/legal retention | O00, O20-SP07, O35-MN05, O03, O05I, O36C |
| `O35SQL` | B | Retained core contract | Future SQL message identity after every defining-function repair | O00, O16-MN06, O17-SV07, O17-PLAN, O21-READ, O21-SV19, O21-SV20, O22-DELIVERY, O22-SV02, O22-SV17, O24-NOTIFICATIONS, O16-CAP, O30-CM07, O32-MN01, O32-MN02, O32-MN04, O32-MN07, O32-MN08, O32-PAYOUT, O32-SV11, O25-SV12, O03, O35D |
| `O37B` | A | [ID-T19](audit/18-WS4-Identity-Provider-Workspaces.md#id-t19) | Final registration, combined acceptance and explicit release disposition | O00, O38R, O37A, O02, O05F, O06A, O07A, O08-MK20, O09-SP01, O09-SP02, O11-ACCESS, O12-MK08, O12-MK09, O12-MK10, O13-AUTH, O13-BYO, O13-LOCATION, O14-MK12, O14-MK13, O12-MK16, O14-MK14, O15-SV10, O16-MN06, O16-SV03, O17-SV07, O17-PLAN, O17-SV18, O18-MK04, O18-MK15, O19-MK05, O19-MK25, O19-MK26, O18-MK11, O19-MK17, O20-SP05, O20-SP06, O20-SP07, O20-SP11, O21-MK24, O21-READ, O21-SV04, O21-SV06, O21-SV16, O21-SV19, O21-SV20, O22-DELIVERY, O22-SV02, O22-SV17, O23-ID13, O24-CM03, O24-CM04, O24-CM05, O24-NOTIFICATIONS, O27-MK02, O27-MK03, O28-ID03, O16-CAP, O16-SV13, O25-ID09, O28-ID10, O28-MK07, O19-MK06, O28-MK18, O29-STATE, O09-SP09, O20-SLOTS, O20-SP08, O30-CM07, O31-CM08, O31-CM09, O31-CM10, O31-CM11, O31-MK01, O32-MN01, O32-MN02, O32-MN04, O32-MN07, O32-MN08, O32-MN09, O32-MN16, O32-PAYOUT, O32-SV11, O35-MN05, O36-SAFETY, O38-ID01, O14-ID20, O25-SV12, O26-ID05, O23-ID07, O23-ID12, O25-ID08, O26-ID06, O30-ID11, O01F, O01L, O01X, O03, O04, O05A, O05I, O05B, O06B, O11, O16-MN14, O08, O10, O12-MK19, O13C, O33, O14-MK21, O14C, O15-SV15, O16-SV21, O17-SV23, O18-MK23, O19C, O20-SP13, O20-SP14, O21-SV22, O16C, O21C, O23-ID14, O24-CM12, O25-ID15, O26-ID17, O27-MK22, O28-ID16, O29-SP15, O30-CM13, O24-CM15, O30-ID18, O31-CM14, O31-SP16, O32-MN12, O32-MN13, O34, O36C, O35D, O35SQL |

### 2.2 Retained non-audit core cards and reviewed foundation/native cards

These specify actual files/steps/tests, not vague IDs. Source-only stages use the exact source cards plus JSON's binding overrides/allocated test files/host map. All code authors supply actual before/after/role evidence; the source audit already supplies the current placement/status analysis.

#### O00 — Freeze implementation inputs, reconcile owners and allocate launch metadata

**Depends:** E0. **Gates:** E0.

**Exact owned files:** `docs\18-Oorva-Transformation-Implementation-Plan.md`; `docs\design\oorva\execution-plan.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Execute section 0 preflight literally; preserve dirty work and do not use the historical detached checkout as an implementation base.
3. Freeze approved portable plan/audit/assets on planning base P, record hashes, E0 and scoped human gates, integration target and cross-plan file/function owners.
4. Allocate only acknowledged unique UNASSIGNED claims; fill complete worker metadata, stage ledger, exact selectors and shared registrations before dispatch.
5. Compute the graph frontier, then launch every READY disjoint stage together; completed audit inputs are not executable prerequisites.

**Acceptance:** Every source task maps once, all dependencies/locks resolve, and no unspecified migration filename/gate/model/policy reaches a worker. E0 is distinct from E1, D03 and D07; no app/runtime test or production action is performed by preflight. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- document-only: `git diff --check`. Plan/coverage/DAG/locks/metadata validation only, not app test PASS.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o00`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O38R — One request-epoch and focused-active entity refresh core

**Depends:** O00. **Gates:** E0.

**Exact owned files:** `app\src\lib\entityInvalidation.ts`; `app\src\lib\useEntityRefresh.ts`; `app\src\lib\__tests__\entityInvalidation.test.ts`; `app\src\lib\__tests__\useEntityRefresh.test.tsx`; `docs\design\oorva\evidence\o38r.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Implement exactly createRequestEpoch().begin(contextKey)->token/isCurrent(token)/invalidate(), and the section-2.3 useEntityRefresh signature.
3. One owner per mounted entity controller; reuse booking/message subscriptions and existing focus/AppState hooks first. Focus+active+web-visible only, immediate resume read, one nullable interval, invalidate on blur/background/context change/unmount.
4. Callers check guard after every awaited read before success/error writes; keys include project+actor+entity PK+selected scope. Clear sensitive state on actor/permission loss.
5. No global data store, duplicate timer, per-domain publication or policy engine. Mutation owners request the same refresh and preserve dirty form fields separately.

**Acceptance:** Out-of-order A/B actor/entity reads, rejected stale loads, double refresh, blur/background/hidden cleanup, focused resume and dirty-draft preservation pass under all flags OFF. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.lib.__tests__.entityInvalidation[.]test[.]ts$'`; `pwsh -NoProfile -File $Helper -Suite jest -Filter 'src.lib.__tests__.useEntityRefresh[.]test[.]tsx$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o38r`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O37A — Independent export, capture and private PostgreSQL verification infrastructure

**Depends:** O00. **Gates:** E0.

**Exact owned files:** `scripts\brand\package.json`; `scripts\brand\package-lock.json`; `scripts\brand\export.mjs`; `scripts\brand\validate.mjs`; `scripts\brand\asset-tests.mjs`; `scripts\brand\validate-execution-plan.mjs`; `scripts\brand\capture-manifest.mjs`; `scripts\brand\fixtures\export-selftest.svg`; `supabase\tests-postgres\package.json`; `supabase\tests-postgres\package-lock.json`; `supabase\tests-postgres\run.mjs`; `supabase\tests-postgres\helpers.mjs`; `supabase\tests-postgres\harness.selftest.mjs`; `app\src\branding\__tests__\executionInfrastructure.test.ts`; `scripts\cs-test.ps1`; `scripts\cs\run.sh`; `scripts\ci\local-supabase.sh`; `.github\workflows\lane-ci.yml`; `.github\workflows\e2e-local.yml`; `.github\workflows\e2e-web.yml`; `e2e\e2e-flags.json`; `e2e\web-smoke.mjs`; `docs\design\oorva\evidence\o37a.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Author only new isolated tooling directly; coordinator applies exact requested existing workflow/Codespace/E2E registrations under current Q-02/Q-03 ownership.
3. Pinned Node22/resvg manifest+remote-created lock; exporter --write --output and --check, loadSystemFonts=false. Self-test with its own outlined fixture, not missing future app artwork/fonts.
4. Add dependency-free validate-execution-plan.mjs against this JSON/coverage/source task map; reject zero selection, invalid refs/cycles/shared-writer races/duplicate task ownership/guessed claims.
5. Implement separate real-pg run.mjs/helpers/selftest, two independent pg.Client connections and distinct PIDs; private-stack loopback guard PRIVATE_TEST_STACK=true. Discover only existing *.pg.test.mjs plus explicit HTTP integration tests, fail requested zero matches.
6. Private job uses current local-supabase.sh LOCAL_DB_URL and synthetic fixtures, optional local-only service role for Edge/Storage. Do not register any real-pg file in PGlite package/scripts/run-all.
7. Register future assets helper/job only when its files exist. Before E1 tooling-main approval, O37A uses narrow existing Codespace app selftests and its actual branch CI tooling/PG jobs; do not call unknown -Suite assets.
8. E2E pins every section-0.5 key OFF in hosted legacy passes with snapshot/restore; positive family/brand pass is private only. Capture manifest asserts route/state/actor/flags and no blanket console filters.
9. O37A alone updates its owned exporter/validator/asset-test palette/profile assertions for the supplied approved-D files. Keep generated resvg and supplied Chromium/Pillow provenance truthful and retain all source/hash/PNG/safe-zone/security checks. Hand the tested tooling SHA to O01X; O01X never edits these tooling files.

**Acceptance:** Runner/export/capture selftests are green without future feature imports; actual real-PG selftest proves two connections and safety guards. New Codespace assets capability is UNAVAILABLE until code really reaches current main with E1 approval; tooling green alone does not satisfy TOOL-ASSETS-MAIN. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.branding.__tests__.executionInfrastructure[.]test[.]ts$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- private-tooling-ci: `node asset-tests.mjs --selftest (working directory scripts\brand)`; `node validate-execution-plan.mjs --all (working directory scripts\brand)`; `node run.mjs --selftest (working directory supabase\tests-postgres)`. Existing-file-only selftests, pinned remote lock, private guard and two connections; no -Suite assets claim before TOOL-ASSETS-MAIN.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o37a`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O02 — Semantic danger repair and strict appearance contract

**Depends:** O00. **Gates:** E0.

**Exact owned files:** `app\src\theme\tokens.ts`; `app\src\branding\colorContract.ts`; `app\src\branding\defaults.ts`; `app\src\branding\__tests__\validation.test.ts`; `app\src\branding\types.ts`; `app\src\branding\validation.ts`; `app\src\branding\fixtures\appearance-valid.json`; `app\src\branding\fixtures\appearance-invalid.json`; `docs\design\oorva\evidence\o02.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. PF-T07: Add onDanger and dangerPressed to strict planned color/default contracts; legacy onDanger=#FFFFFF and dangerPressed=#B42318 both themes.
3. PF-T07: Include destructive default/pressed, unread numeric, selected counts and assistant send controls in actual-used-pair validation.
4. PF-T07: Keep ordinary onPrimary/segmentThumb and unrelated legacy colors; new Oorva colors remain class B.
5. Implement strict A.3 V1 types/validation/defaults and shared fixed good/bad fixtures, separately from forward-compatible public feature parsing.
6. Legacy dangerPressed is #B42318 and onDanger is #FFFFFF in both themes; keep current correct primary/onPrimary and segmentThumb roles.
7. Unread backgrounds use dangerStrong/onDanger; actual-used-pair tests reject 3.7574/2.7861 unread and 1.9412 dark pressed-destructive fixtures, not already-correct pairs.
8. Preserve the exact A.1 palette/metrics/typography/category role contract and >32KiB/unknown-field/unsafe URL/font/contrast failure rules.

**Binding overrides:** Primary/onPrimary and segmentThumb were already correct at the frozen source. Preserve them; test actual used pairs rather than calling these broken.

**Acceptance:** PF-T07: Every normal text foreground/fill pair passes4.5, including dark pressed. PF-T07: Unknown/malformed contrast-breaking runtime overrides reject appearance, not valid flags. All existing and Oorva actually used foreground/background pairs pass thresholds; unsafe fixtures independently fail; no unconditional Oorva styling. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.branding.__tests__.validation[.]test[.]ts$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o02`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O05F — One independent flag control plane and truthful auth restoration

**Depends:** O00, O38R. **Gates:** E0.

**Exact owned files:** `app\app\_layout.tsx`; `app\src\lib\auth.tsx`; `app\src\lib\supabaseApi.ts`; `app\src\lib\featureFlags.ts`; `app\src\branding\FeatureFlagsProvider.tsx`; `app\src\lib\authRestoreModel.ts`; `app\src\lib\__tests__\authRestoreModel.test.ts`; `app\src\branding\__tests__\featureControl.test.tsx`; `docs\design\oorva\evidence\o05f.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. PF-T01: Implement A.3.4's one control provider without losing get_app_features.archetypes or legacy defaults.
3. PF-T01: Propagate SDK session errors and distinguish restore pending/error/known null/session; add retry and latest-event-wins initialization.
4. PF-T01: Replace only the root duplicate fetch/loading-to-false state, keeping merged G-01 allowlists/protected tree/return intent.
5. PF-T01: Render restore error without exposing protected children; a valid later auth event settles loading and invalidates late initial results.
6. Create the sole shared cache-first FeatureFlagsProvider above auth-dependent UI. Preserve useAppFeatureFlags().isOn and the complete get_app_features result, including archetypes.
7. Expose internal useFeatureControlState(): {features:AppFeatures,freshness:'cache'|'live'|'fallback'|'error',appearanceCandidate:unknown,refresh:()=>Promise<void>}; only O05A consumes raw appearanceCandidate.
8. This provider alone fetches snapshot/legacy fallback and schedules one foreground/active timer. O05A must not create another request/timer/control store. Flags are accepted independently of raw appearance validity/asset success.
9. Remove the merged G-01 root's extra flags request/loading-to-false behavior, preserving guards, protected tabs, returnTo and intent. Use shared request epochs and bounded cache hydration.

**Acceptance:** PF-T01: Offline foreground preserves last valid guest controls. PF-T01: Invalid appearance plus valid brand/UX OFF applies OFF immediately. PF-T01: getSession rejection has retry, not permanent spinner or invented sign-out. PF-T01: Sign-out/sign-in events outrank a stale initial promise. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.lib.__tests__.authRestoreModel[.]test[.]ts$'`; `pwsh -NoProfile -File $Helper -Suite jest -Filter 'src.branding.__tests__.featureControl[.]test[.]tsx$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o05f`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O06A — Always-on readable primitives and essential-text reflow

**Depends:** O00, O02. **Gates:** E0.

**Exact owned files:** `app\src\components\ui\Button.tsx`; `app\src\components\ui\Badge.tsx`; `app\src\components\ui\CountBadge.tsx`; `app\src\components\ui\IconButton.tsx`; `app\src\components\ui\Text.tsx`; `app\src\components\ui\Input.tsx`; `app\src\components\ui\OTPInput.tsx`; `app\src\components\ui\SegmentedControl.tsx`; `app\src\components\ui\Stepper.tsx`; `app\src\components\ui\__tests__\oorvaPrimitives.test.tsx`; `docs\design\oorva\evidence\o06a.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. PF-T08: Use onDanger/dangerPressed for destructive and dangerStrong/onDanger for unread counts; reuse CountBadge for IconButton numeric overlays.
3. PF-T08: Replace literal white on theme primary with onPrimary for chip/step/segment counts; O36 applies the same stable roles to assistant mic/send.
4. PF-T08: Remove one-line/tight-scaling constraints on decisive labels/actions/amounts; auto-height containers and critical type variants support200%.
5. PF-T08: Adapt step progress to width/count; reduced-motion rail updates are static. Keep native value/submit/quantity semantics.
6. Retain the already-correct primary/onPrimary and segmentThumb usage. Fix only actual failing unread/destructive pressed pairs and essential label/amount reflow.
7. Use dangerPressed/onDanger, growable controls and full 320px/200% labels; no new family composition under all flags OFF.

**Binding overrides:** Primary/onPrimary and segmentThumb were already correct at the frozen source. Preserve them; test actual used pairs rather than calling these broken.

**Acceptance:** PF-T08: Actual rendered used-pair checks pass both themes and all Oorva OFF. PF-T08: 320width/200% critical labels, counts and amounts remain complete and tappable. PF-T08: Seven-step/long-label progress never overflows available width; selection/value behavior unchanged. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.components.ui.__tests__.oorvaPrimitives[.]test[.]tsx$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o06a`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O07A — Always-on obstruction, keyboard and safe crash-shell repair

**Depends:** O00. **Gates:** E0.

**Exact owned files:** `app\src\components\DemoDataIndicator.tsx`; `app\src\components\ui\Screen.tsx`; `app\src\components\ui\Toast.tsx`; `app\src\components\ui\BottomSheet.tsx`; `app\src\components\ui\Confirm.tsx`; `app\src\components\RouteErrorBoundary.tsx`; `app\src\theme\fallback.ts`; `app\src\components\ui\__tests__\layoutSafety.test.tsx`; `docs\design\oorva\evidence\o07a.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. PF-T09: Place demo disclosure in one reserved shell slot, leaving primary footer/tab/toast regions free; keep actual demo detection/disclosure.
3. PF-T09: Retain Screen's measured footer/toast offsets and single header top inset; do not add arbitrary per-screen spacers.
4. PF-T09: Keep provider-independent crash fallback free of Reanimated/theme context imports; add native release hook only in O34.
5. PF-T09: Use semantic toast text/action/accent roles and explicit keyboard/reduced-motion acceptance for modal footers; preserve confirmation policy.
6. Reserve measured space for the demo disclosure rather than covering tab labels, footers or toasts. Keep the disclosure.
7. Preserve existing once-only safe area, scroll/keyboard/modal focus behavior; bundled crash fallback imports neither theme context nor Reanimated. No global section reorder.
8. Hand only the later idempotent splash-release extension to O34 after this stage.

**Acceptance:** PF-T09: Demo marker is visible but intersects no CTA/tab/toast bounds. PF-T09: Footer moves with keyboard without double safe area; native tests required before platform PASS. PF-T09: Crash-before-provider stays readable; destructive confirmation keeps real backend reason/policy. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.components.ui.__tests__.layoutSafety[.]test[.]tsx$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o07a`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O01F — Licensed bundled heading fonts independent of final logo

**Depends:** O00. **Gates:** E0.

**Exact owned files:** `app\assets\fonts\Manrope-SemiBold.ttf`; `app\assets\fonts\Manrope-Bold.ttf`; `app\assets\fonts\Manrope-OFL.txt`; `app\assets\fonts\manrope-manifest.json`; `app\src\branding\__tests__\fontManifest.test.ts`; `docs\design\oorva\evidence\o01f.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Supply original licensed static Manrope 600/700 bytes, source/license/hash manifest and OFL; preserve Inter and system/script fallback.
3. Do not touch root font registration or native assets; O05A consumes these exact filenames. No runtime font fetch.

**Acceptance:** Actual font bytes, declared weight and recorded hashes agree; Telugu fallback remains explicit; no final-mark/trademark dependency. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.branding.__tests__.fontManifest[.]test[.]ts$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o01f`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o01f`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O01L — Verify and import supplied approved-D vector masters; do not redraw

**Depends:** O00. **Gates:** E0, D03a.

**Exact owned files:** `app\assets\brand\oorva-symbol.svg`; `app\assets\brand\oorva-wordmark-light.svg`; `app\assets\brand\oorva-wordmark-dark.svg`; `app\assets\brand\logo-horizontal-light.svg`; `app\assets\brand\logo-horizontal-dark.svg`; `app\assets\brand\logo-stacked-light.svg`; `app\assets\brand\logo-stacked-dark.svg`; `app\assets\brand\logo-horizontal-mono-black.svg`; `app\assets\brand\logo-horizontal-mono-ivory.svg`; `app\assets\brand\source-manifest.json`; `app\src\branding\__tests__\svgMasters.test.ts`; `docs\design\oorva\evidence\o01l.json`.

1. Read the approved-D colour/asset input record and ready brand-kit manifest; perform affected-file drift/owner-lock checks only.
2. Verify the nine existing SVG master paths flagged requiredForExistingAppContract. Copy those supplied outlined files exactly; no drawing, tracing, live text, image embedding or substitute wordmark.
3. Use handoff/vector-provenance.json to update the current source-manifest schema truthfully, retaining supplied path/transform geometry and approved D colours.
4. Update existing svgMasters expectations to approved D colours while preserving self-containment, path, viewBox/safe-zone checks and existing file ownership.
5. If already completed, deliver only the current-owner D asset delta; do not reset task progress or ask for another creative choice. Public rights remain D03c.

**Acceptance:** All nine required existing master files exactly match the supplied approved-D hashes and contain real self-contained outlined paths. No artwork generation step, new app capability, public-rights assertion or native destination copy.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.branding.__tests__.svgMasters[.]test[.]ts$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o01l`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o01l`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O01X — Verify and import supplied approved-D PNG exports and metadata

**Depends:** O00, O37A, O01L. **Gates:** E0, D03a, TOOL-ASSETS-MAIN.

**Exact owned files:** `app\assets\brand\logo-horizontal-light.png`; `app\assets\brand\logo-horizontal-light@2x.png`; `app\assets\brand\logo-horizontal-light@3x.png`; `app\assets\brand\logo-horizontal-dark.png`; `app\assets\brand\logo-horizontal-dark@2x.png`; `app\assets\brand\logo-horizontal-dark@3x.png`; `app\assets\brand\oorva-wordmark-light.png`; `app\assets\brand\oorva-wordmark-light@2x.png`; `app\assets\brand\oorva-wordmark-light@3x.png`; `app\assets\brand\oorva-wordmark-dark.png`; `app\assets\brand\oorva-wordmark-dark@2x.png`; `app\assets\brand\oorva-wordmark-dark@3x.png`; `app\assets\brand\logo-compact-light.png`; `app\assets\brand\logo-compact-light@2x.png`; `app\assets\brand\logo-compact-light@3x.png`; `app\assets\brand\logo-compact-dark.png`; `app\assets\brand\logo-compact-dark@2x.png`; `app\assets\brand\logo-compact-dark@3x.png`; `app\assets\brand\native\icon.png`; `app\assets\brand\native\android-icon-foreground.png`; `app\assets\brand\native\android-icon-background.png`; `app\assets\brand\native\android-icon-monochrome.png`; `app\assets\brand\native\splash-icon.png`; `app\assets\brand\native\splash-icon-dark.png`; `app\assets\brand\native\notification-icon.png`; `app\assets\brand\native\favicon.png`; `app\assets\brand\manifest.json`; `docs\design\oorva\evidence\o01x.json`.

1. Read brand-kit/README.md and the sealed manifest. The nine SVG / 26 PNG existing-path input set is already supplied; do not ask a model to render or draw missing artwork.
2. Verify supplied file hashes, PNG decode/canvas/alpha/sRGB, monochrome white and native safe-zone evidence; import only existing-contract exports under the assigned app-assets locks.
3. Consume the tested D-tooling handoff from O37A, the sole owner of exporter/validator/asset-test files. O01X updates only its owned export manifest with truthful renderer/source/export metadata. Handoff JSON is evidence, not a blind schema replacement.
4. Do not label supplied Chromium/Pillow bytes as pinned resvg output, disable safety checks or claim old forest-only --check passes. If encoding is mechanically regenerated, use supplied SVG only and atomically update hashes/manifests/bindings.
5. Run the actual available targeted assets/CI checks with documented Codespace fallback; native installed destinations remain O33-owned. For completed stages apply a narrow D delta.

**Acceptance:** Every required existing-path export is present/valid with correct D colours; source/renderer/hash/alpha/canvas/safe-zone evidence is truthful. Tooling adoption preserves security/safety validation; no redrawing, false CI claim, runtime activation or native destination copy.

**Exact validation selectors/commands:**
- codespace-tsc: `pwsh -NoProfile -File $Helper -Suite tsc`. cs-test result: PASS; additional tool/device tests remain separate.
- codespace-assets-after-gate: `pwsh -NoProfile -File $Helper -Suite assets -Filter oorva`. O37A assets runner really exists in current main with E1 approval; deterministic export/check and actual dimensions/alpha/safe-zone report PASS.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o01x`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o01x`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O03 — Secure registry, versioned branding storage and atomic publication

**Depends:** O00, O37A, O02. **Gates:** E0, MIG-O03.

**Exact owned files:** `app\src\lib\featureFlagModel.ts`; `app\src\lib\adminFeaturePresentation.ts`; `app\src\lib\__tests__\featureFlagModel.test.ts`; `app\src\lib\__tests__\adminFeaturePresentation.test.ts`; `supabase\tests-postgres\branding_publish.pg.test.mjs`; `supabase\migrations\UNASSIGNED__o03_oorva.sql`; `supabase\tests\oorva_branding.test.mjs`; `docs\design\oorva\evidence\o03.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Register exactly section 0.5's 25 keys with default false, label, explicit OFF description, group and sort 200+i; on conflict(key) do nothing. Ignore audit-proposed group/order metadata.
3. Export FEATURE_PARENTS from featureFlagModel; adminFeaturePresentation imports it and traverses effective ancestors. Preserve existing legacy defaults/archetypes and ability to turn an ON child OFF under an OFF ancestor.
4. Implement A.3.2's exact immutable tables/singleton/history/private asset metadata and RPCs. Deny direct writes/private helper EXECUTE, use qualified objects and existing _is_admin membership.
5. Public snapshot returns the complete get_app_features output unchanged, including archetypes; flags parse separately from appearance.
6. Ordinary draft/publish/policy require effective brand/runtime/editor; audited history/recovery/revocation remain admin-safe with editor/runtime OFF. Recovery uses hard safety/non-revocation, not newly tightened soft limits.
7. Use expected-generation CAS transaction and all shared fixtures; own the actual two-connection branding publish test, not only runner setup.

**Binding overrides:** Only supabase\migrations\UNASSIGNED__o03_oorva.sql is this stage's proposed migration claim path; every report draft filename is superseded. Coordinator supplies its actual acknowledged numeric filename before launch; no guessed 0089/0090/0091.

**Acceptance:** SQL-B01..B14/SQL-B09a and parent-OFF/intermediate-ON/child-ON/child-OFF tests pass. One CAS winner, one stale failure, coherent public reads; no private fields and no branding dependency on existing money resolution. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.lib.__tests__.featureFlagModel[.]test[.]ts$'`; `pwsh -NoProfile -File $Helper -Suite jest -Filter 'src.lib.__tests__.adminFeaturePresentation[.]test[.]ts$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- codespace-sql: `pwsh -NoProfile -File $Helper -Suite sql -Filter 'oorva_branding'`. Each unique registered filename selected by full current-chain run-all; all scenario assertions with actual JSON; cs-test result: PASS.
- codespace-sql-parse: `pwsh -NoProfile -File $Helper -Suite sql -Filter 'o03_oorva.sql'`. Coordinator has substituted and registered the actual numeric filename; this unique suffix selects its exact parse.cjs command, not zero checks.
- private-postgres-lane-job: `node run.mjs --filter branding_publish.pg.test.mjs`. Two actual independent backend PIDs and overlapping barrier assertions; whole required private job green.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o03`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o03`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O03-ASSET-REG — Service-role-only registration of validated asset metadata

**Owner-approved scope delta (2026-11-23):** O03 remains DONE. This is one new forward migration and one new registration function; never edit or append to `0097_o03_oorva.sql`.

**Depends:** O00, O03, O37A. **Gates:** E0, O03-ASSET-REG-SCOPE, the launch-allocated `MIG-O03-ASSET-REG`.

**Exact worker-owned files:** `supabase\migrations\UNASSIGNED__o03_asset_registration.sql`; `supabase\tests-postgres\branding_asset_registration.pg.test.mjs`; `docs\design\oorva\evidence\o03-asset-registration.json`. The coordinator owns the private-postgres `lane-ci.yml` registration and adds the migration to the deploy list only at E1 promotion.

1. Implement only `public.admin_register_branding_asset` as a fixed-search-path `SECURITY DEFINER` function. Grant execution only to `service_role`; keep direct table writes and execution from `public`, `anon`, and `authenticated` revoked.
2. Require the O04 Edge Function to verify the caller JWT/admin/effective flags and the complete PNG bytes before Storage upload and RPC invocation. The RPC rechecks `oorva_brand`, `branding_runtime`, and `branding_editor`, derives `branding/<uuid>.png`, checks PNG metadata bounds and the private Storage object, and records the verified actor in the audit log.
3. Make identical registration retries idempotent and immutable. Reject mismatched duplicate metadata, revoked IDs, missing objects, invalid hash/MIME/path/dimensions, and disabled parent/child flags.
4. Test service-role-only execution, flag-off rejection, object existence, metadata constraints, idempotency/conflict, and actor/audit behavior against the disposable private PostgreSQL stack. No feature activation, public/native cutover, or production data repair.
5. Use the paused-author §0.4.3 roundtrip for the exact existing lane-CI test registration before author validation. Require the current-main Codespace migration parser selector and exact-head Lane CI. The stage requires focused auth review.

#### O04 — Constrained immutable PNG upload, public serving and private preview

**Depends:** O00, O37A, O03, O03-ASSET-REG. **Gates:** E0.

**Exact owned files:** `supabase\functions\branding-assets\index.ts`; `supabase\functions\branding-assets\logic.ts`; `supabase\functions\branding-assets\logic_test.ts`; `supabase\functions\branding-assets\png.ts`; `supabase\functions\branding-assets\png_test.ts`; `supabase\tests-postgres\branding_assets.http.test.mjs`; `docs\design\oorva\evidence\o04.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Implement A.3.3 exactly: published non-revoked UUID GET; every admin POST verifies JWT/user/admin before a service-role Storage read/write.
3. Validate complete PNG structure/CRC/dimensions/ceilings, reject animation/truncation/unsafe MIME/path and strip metadata; no arbitrary URL fetcher or remote SVG.
4. After the Edge authenticates the admin and validates complete PNG bytes, register immutable metadata through the O03-ASSET-REG service-role-only RPC. Never write `app_branding_assets` directly.
5. Preview returns configured-origin signed URL expiring <=300s, no-store, without putting bearer tokens in images/config/cache.
6. Immutable upload failure cleans only its known orphan; bounded public cache <=300s and audited revocation have honest propagation/offline limits.

**Acceptance:** Draft assets remain private; preview works on web/native; publication cannot reference incomplete/revoked bytes; bad assets cannot veto independent OFF flags. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-deno: `pwsh -NoProfile -File $Helper -Suite deno`. Current helper runs shared Deno checks (no path filter support); every listed *_test.ts is selected; cs-test result: PASS.
- private-edge-storage: `node run.mjs --filter branding_assets.http.test.mjs`. Disposable Edge/Storage policy HTTP tests; local-only credentials, no hosted production access.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o04`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O05A — Atomic appearance integration into the existing theme, without final logo dependency

**Depends:** O00, O02, O05F, O07A, O01F. **Gates:** E0.

**Exact owned files:** `app\src\theme\tokens.ts`; `app\src\theme\ThemeProvider.tsx`; `app\src\theme\index.ts`; `app\src\theme\fallback.ts`; `app\src\branding\AppearanceProvider.tsx`; `app\src\branding\api.ts`; `app\src\branding\cache.ts`; `app\src\branding\defaults.ts`; `app\src\branding\__tests__\appearance.test.tsx`; `app\app\_layout.tsx`; `docs\design\oorva\evidence\o05a.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Consume only O05F's appearanceCandidate/refresh; no second fetch/timer/cache framework for flags. Implement strict appearance validation/preload and one atomic immutable theme swap.
3. Preserve useTheme/makeStyles, OS-first light/dark/default precedence, all existing variant names, stable theme identity and provider-independent fallback.
4. Register bundled Manrope headings with 1000ms readiness fallback; preserve Inter/script fallback and do not import new native modules here.
5. Use project-namespaced separate appearance/flag caches. Missing RPC/invalid schema/bad logo never blocks valid OFF controls or remounts dirty forms.

**Acceptance:** UI-CACHE cases hold across real compatibility fallback and strict appearance; brand OFF retains context-specific legacy palette/copy; no final SVG/trademark dependency for foundations. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.branding.__tests__.appearance[.]test[.]tsx$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o05a`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o05a`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O05I — Single contextual identity hook and resolver for all display consumers

**Depends:** O00, O05A. **Gates:** E0.

**Exact owned files:** `app\src\branding\identity.ts`; `app\src\branding\useBrandIdentity.ts`; `app\src\branding\BrandLogo.tsx`; `app\src\branding\__tests__\identity.test.ts`; `docs\design\oorva\evidence\o05i.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Implement the exact signatures/context map in section 2.3.3; no aliases or per-feature competing brand hooks.
3. Brand OFF selects each exact legacy context; brand ON/runtime OFF or invalid appearance uses approved bundled Oorva only when selected identity is available; public activation remains gated.
4. Use existing legacy assets until selected binding O05B; do not fabricate a production symbol or normalize historical/user/technical text.

**Acceptance:** All mixed QuickServe/Nearo contexts, null assets, invalid config, approved runtime display name and issuer/technical retention cases are tested. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.branding.__tests__.identity[.]test[.]ts$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o05i`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o05i`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O05B — Selected identity asset binding with contextual legacy fallback

**Depends:** O00, O01X, O05A, O05I. **Gates:** E0, D03b.

**Exact owned files:** `app\src\branding\BrandLogo.tsx`; `app\src\branding\identity.ts`; `app\src\branding\defaults.ts`; `app\src\branding\__tests__\identity.test.ts`; `docs\design\oorva\evidence\o05b.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. PF-T10: Implement pure context-keyed identity selection for legacy/Oorva/published supported display fields.
3. PF-T10: Supply explicit legacy labels for login, AI, support, BYO and the separately owned Nearo receipt/checkout contexts.
4. PF-T10: Bind only selected genuine vector/export assets; expose stable identity API for screen owners, not a global string replacement.
5. Bind only D03b's actual selected real SVG/PNG manifest in defaults/BrandLogo; retain useBrandIdentity/resolveBrandIdentity as the sole API.
6. No new public identity until D02/D03c/relevant D05 release gates, and no native destination copy in this stage.
7. Use the supplied D images and `handoff/binding-data.json` / `selected-brand-exports.ts.txt`; replace all four image hashes atomically. Do not retain forest-image hashes or redraw artwork.

**Acceptance:** PF-T10: Brand OFF keeps each legacy context; unsupported appearance cannot freeze OFF. PF-T10: Historical financial snapshots, references, IDs and scheme unchanged. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.branding.__tests__.identity[.]test[.]ts$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o05b`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o05b`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O06B — Identity typography and token-driven primitive styling

**Depends:** O00, O06A, O05A. **Gates:** E0.

**Exact owned files:** `app\src\components\ui\Text.tsx`; `app\src\components\ui\Button.tsx`; `app\src\components\ui\Input.tsx`; `app\src\components\ui\OTPInput.tsx`; `app\src\components\ui\IconButton.tsx`; `app\src\components\ui\Badge.tsx`; `app\src\components\ui\CountBadge.tsx`; `app\src\components\ui\SegmentedControl.tsx`; `app\src\components\ui\Stepper.tsx`; `app\src\components\ui\__tests__\brandingPrimitives.test.tsx`; `docs\design\oorva\evidence\o06b.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Apply A.1 identity typography/metrics through existing theme APIs only when effective brand selects them.
3. Preserve all O06A always-on repairs, submitting/loading/disabled/error/haptics/quantity semantics and existing body variants.

**Acceptance:** Brand OFF has only documented A deltas; branded light/dark/custom palettes pass actual component-used contrast and 320px/200% reflow. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.components.ui.__tests__.brandingPrimitives[.]test[.]tsx$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o06b`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o06b`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O11 — Contextual navigation identity without route or role changes

**Depends:** O00, O11-ACCESS, O05I, O06B. **Gates:** E0.

**Exact owned files:** `app\app\(auth)\_layout.tsx`; `app\app\(customer)\_layout.tsx`; `app\app\(provider)\_layout.tsx`; `app\app\admin\_layout.tsx`; `app\src\components\tabOptions.tsx`; `app\src\lib\__tests__\oorvaNavigation.test.ts`; `docs\design\oorva\evidence\o11.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Apply shared identity/semantic count/label tokens to current layouts without changing route names or tab guards.
3. Preserve merged G-01 guest/history/commit-action return paths, existing unified_search and owner-versus-staff destinations. No dependency on editor UI.
4. Use source-backed unread counts, not a new local count store; no extra RootNavigator fetch.

**Acceptance:** All actor/deep-link/back/guest/parent-OFF paths retain current authorization and destination; counts remain readable. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.lib.__tests__.oorvaNavigation[.]test[.]ts$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o11`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o11`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O08 — Reusable entity-specific card presentation APIs, not a universal card engine

**Depends:** O00, O07A, O08-MK20, O03, O05I, O06B. **Gates:** E0.

**Exact owned files:** `app\src\components\market\PillarCard.tsx`; `app\src\components\market\pillars.ts`; `app\src\components\market\ListingCard.tsx`; `app\src\components\market\listingModel.ts`; `app\src\components\market\MediaImage.tsx`; `app\src\components\market\PriceFooter.tsx`; `app\src\components\market\QuoteCompareTable.tsx`; `app\src\components\market\TrustStrip.tsx`; `app\src\components\market\VerifiedBadge.tsx`; `app\src\components\market\__tests__\presentationContract.test.tsx`; `docs\design\oorva\evidence\o08.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Consume coverage.json's completed 12-family map and domain variants. Keep existing APIs/controller inputs; add only optional presentation:'legacy'|'oorva' with legacy default where composition differs.
3. Always-on readability remains separate from C orientation/order/density. Family callers alone opt in using effective brand+leaf and existing capability parents.
4. Use A.1/H.4 exact media/information/price/action hierarchy, no invented attributes and no mega-card or universal status engine.
5. Retain MK-T20's genuine Class-A narrow/large-text pillar repair even OFF; Oorva-only composition follows A.1.4 intrinsic-size metrics.

**Acceptance:** All twelve templates/variants retain decisive full labels/amounts, real status/role actions, media fallback and loading/error/empty states; legacy default is corrected but not unconditionally recomposed. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.components.market.__tests__.presentationContract[.]test[.]tsx$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o08`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o08`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O10 — Admin Settings and isolated Branding & Appearance editor

**Depends:** O00, O07A, O31-CM09, O03, O04, O05A, O05I, O06B. **Gates:** E0.

**Exact owned files:** `app\app\admin\settings\index.tsx`; `app\app\admin\settings\branding.tsx`; `app\src\features\adminBranding\SettingsScreen.tsx`; `app\src\features\adminBranding\BrandingScreen.tsx`; `app\src\features\adminBranding\BrandingForm.tsx`; `app\src\features\adminBranding\BrandingPreview.tsx`; `app\src\features\adminBranding\BrandingHistory.tsx`; `app\src\features\adminBranding\model.ts`; `app\src\features\adminBranding\useBrandingController.ts`; `app\src\features\adminBranding\__tests__\editor.test.tsx`; `app\src\features\communicationScreens\AdminFeaturesScreen.tsx`; `docs\design\oorva\evidence\o10.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Apply the exact routeHostBindings extraction/ownership table before test imports. Keep one controller, preserve existing router/param/return intent behavior and test the feature host or named pure models.
3. Existing admin stack plus two exact thin routes; Settings links existing config pages and Branding.
4. Add admin-only Branding history & recovery entry in the existing Features host so rollback/history remains discoverable with brand/runtime/editor OFF. Ordinary Settings -> Branding entry uses branding capability parents, never oorva_admin_ops_ux; that leaf controls dashboard composition only.
5. One controller loads draft/history/freshness; strict fields, isolated nested preview, authenticated short-lived asset preview URL, immutable save and expected-generation publish.
6. Keep history/current version/admin recovery reachable with editor/runtime OFF; disable only new drafts/uploads/ordinary publishes. Explain native limits and stale conflicts.
7. No arbitrary JSON/style/code editor, no secret/private data and no fabricated public logo before selection.

**Binding overrides:** app\app\admin\features.tsx changes target app\src\features\communicationScreens\AdminFeaturesScreen.tsx; first extraction owner O31-CM09. Existing URL stays unchanged; no Jest import of app/app routes.

**Acceptance:** ADMIN-B01..B08, role/ON/OFF/parent-OFF/recovery/conflict/dirty draft cases pass; preview never changes global cache/flags/theme. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.features.adminBranding.__tests__.editor[.]test[.]tsx$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o10`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o10`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O13C — Flagged auth, location and protected-invite composition

**Depends:** O00, O13-AUTH, O13-BYO, O13-LOCATION, O03, O05I, O06B, O11, O08. **Gates:** E0.

**Exact owned files:** `app\app\(auth)\login.tsx`; `app\src\components\AddressEditor.tsx`; `app\src\features\auth\__tests__\composition.test.tsx`; `app\src\features\platformScreens\AuthLoginScreen.tsx`; `app\src\features\platformScreens\AuthRoleScreen.tsx`; `app\src\features\platformScreens\AuthVerifyScreen.tsx`; `app\src\features\platformScreens\ByoDetailScreen.tsx`; `app\src\features\platformScreens\LocationScreen.tsx`; `docs\design\oorva\evidence\o13c.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Apply the exact routeHostBindings extraction/ownership table before test imports. Keep one controller, preserve existing router/param/return intent behavior and test the feature host or named pure models.
3. Under oorva_brand+oorva_auth_ux, implement S01/S02/S03/S39/S48's exact top-to-bottom hierarchy with contextual identity and keyboard-safe actions.
4. Reuse the one current controller per screen and preserve every OTP cooldown/validation/claim/amount/return target/private-address guard.
5. Theme/flag refresh cannot reset phone/name/OTP/address/invite draft or re-run a committed claim/payment.
6. Display-only identity consumers use useBrandIdentity(context) for auth, protectedInvite OUTSIDE the composition branch: identity depends on oorva_brand, not the family leaf. Preserve exact OFF/history/technical/legal contexts. No alternate hook/resolver.

**Binding overrides:** app\app\(auth)\login.tsx changes target app\src\features\platformScreens\AuthLoginScreen.tsx; first extraction owner O13C. Existing URL stays unchanged; no Jest import of app/app routes. app\app\(auth)\role.tsx changes target app\src\features\platformScreens\AuthRoleScreen.tsx; first extraction owner O13-AUTH. Existing URL stays unchanged; no Jest import of app/app routes. app\app\(auth)\verify.tsx changes target app\src\features\platformScreens\AuthVerifyScreen.tsx; first extraction owner O13-AUTH. Existing URL stays unchanged; no Jest import of app/app routes. app\app\byo\[token].tsx changes target app\src\features\platformScreens\ByoDetailScreen.tsx; first extraction owner O13-BYO. Existing URL stays unchanged; no Jest import of app/app routes. app\app\location.tsx changes target app\src\features\platformScreens\LocationScreen.tsx; first extraction owner O13-LOCATION. Existing URL stays unchanged; no Jest import of app/app routes.

**Acceptance:** Flag OFF keeps corrected legacy composition; enabled/parent-OFF/role/private E2E paths preserve all real auth and money semantics. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.features.auth.__tests__.composition[.]test[.]tsx$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o13c`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o13c`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O33 — Isolated, compatible native identity candidate

**Depends:** O00, O37A, O01X, O05B, O11, O13C. **Gates:** E0, D03b, D07a-platform.

**Exact owned files:** `app\app.json`; `app\eas.json`; `app\native-release.json`; `.github\workflows\publish-app.yml`; `.github\workflows\build-apk.yml`; `app\package.json`; `app\assets\icon.png`; `app\assets\android-icon-foreground.png`; `app\assets\android-icon-background.png`; `app\assets\android-icon-monochrome.png`; `app\assets\splash-icon.png`; `app\assets\splash-icon-dark.png`; `app\assets\notification-icon.png`; `app\assets\favicon.png`; `app\assets\brand\launch-geometry.json`; `app\src\branding\__tests__\nativeIdentity.test.ts`; `docs\design\oorva\evidence\o33.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. PF-T11: Follow exact A.4.1 assets and A.4.5 canonical runtime/channel/capability manifest.
3. PF-T11: Coordinator applies shared workflow/profile edits after active owner locks; old apk-1 does not receive new native imports.
4. PF-T11: Use a reviewed candidate branch/runtime/channel and approved device-reachable non-production backend; record all running/native source identities.
5. PF-T11: Keep final public rights/native cutover/signing/iOS limitations as explicit real gates, not future source-audit questions.
6. Implement all A.4.1/A.4.4/A.4.5 native/config/geometry/update isolation requirements; compatible direct expo-splash-screen dependency is candidate-only.
7. Use one app/native-release.json for reviewed runtime/capability/channel identities, consumed by build/publish. Coordinator applies existing workflow edits, never a worker race.
8. Become GREEN on isolated candidate branch. Explicitly approve O34 stack on that exact green SHA while D07b is PENDING; do not require production merge to create approval evidence.

**Acceptance:** PF-T11: Three cold starts after unrelated main publish retain reviewed code. PF-T11: Correct old-runtime/Expo-Go/web behavior; installed name/icon/splash/notification actual evidence. PF-T11: No iOS/public/native completion claim without its real build/device/gate. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.branding.__tests__.nativeIdentity[.]test[.]ts$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- native-device-candidate: `eas build --profile oorva-review-android --platform android`; `eas build --profile oorva-review-ios --platform ios`. Only after O33 adds these exact isolated profiles and approved devices/signing/backend. Record actual build/runtime/channel/update/source identities and three cold starts. iOS unavailable => NOT VERIFIED, not Expo Go substitution.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o33`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o33`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O14C — Flagged catalogue and ranked-provider composition

**Depends:** O00, O14-MK12, O14-MK13, O12-MK16, O14-ID20, O03, O05I, O06B, O11, O08. **Gates:** E0.

**Exact owned files:** `app\src\features\catalogue\ArchetypeCategory.tsx`; `app\src\components\ProviderCard.tsx`; `app\src\components\TopRatedCard.tsx`; `app\src\components\CategoryIcon.tsx`; `app\src\components\categoryIconMap.ts`; `app\src\features\catalogue\__tests__\composition.test.tsx`; `app\src\features\marketplaceScreens\CategoryDetailScreen.tsx`; `app\src\features\marketplaceScreens\TopRatedScreen.tsx`; `docs\design\oorva\evidence\o14c.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Apply the exact routeHostBindings extraction/ownership table before test imports. Keep one controller, preserve existing router/param/return intent behavior and test the feature host or named pure models.
3. Under effective catalogue leaf, use S40/S87 order and H.4 service/provider variants; retain all learning/beauty and archetype-specific destinations.
4. Keep real price/unit/ranking/city/availability/public-trust semantics from audit repairs; no fictional portfolio/rating/stock.

**Binding overrides:** app\app\category\[slug].tsx changes target app\src\features\marketplaceScreens\CategoryDetailScreen.tsx; first extraction owner O12-MK16. Existing URL stays unchanged; no Jest import of app/app routes. app\app\top-rated.tsx changes target app\src\features\marketplaceScreens\TopRatedScreen.tsx; first extraction owner O14-MK12. Existing URL stays unchanged; no Jest import of app/app routes.

**Acceptance:** Full names/units/amounts and state-specific next action are visible at 320px/200%; no C layout when brand/leaf OFF. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.features.catalogue.__tests__.composition[.]test[.]tsx$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o14c`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o14c`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O19C — Flagged RFQ, supplier comparison and enquiry composition

**Depends:** O00, O18-MK15, O19-MK25, O19-MK26, O19-MK17, O19-MK06, O28-MK18, O03, O05I, O06B, O08. **Gates:** E0.

**Exact owned files:** `app\src\features\rfq\components.tsx`; `app\src\features\rfq\__tests__\composition.test.tsx`; `app\src\features\marketplaceScreens\EnquiryDetailScreen.tsx`; `app\src\features\marketplaceScreens\RfqDetailScreen.tsx`; `app\src\features\marketplaceScreens\RfqMerchantDetailScreen.tsx`; `app\src\features\marketplaceScreens\RfqNewScreen.tsx`; `docs\design\oorva\evidence\o19c.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Apply the exact routeHostBindings extraction/ownership table before test imports. Keep one controller, preserve existing router/param/return intent behavior and test the feature host or named pure models.
3. Under the RFQ leaf, implement S45/S73/S74/S75 order and H.4 RFQ/supplier quotation variants; mobile stacked comparison, wide columns.
4. Keep actual quantity/coverage/spec/tax/delivery/validity warnings before selection, one dominant action and exact persisted draft/role/business context.
5. Selection still opens enquiry, not product checkout; preserve existing-history and owner cancellation when acquisition OFF.

**Binding overrides:** app\app\enquiry\[id].tsx changes target app\src\features\marketplaceScreens\EnquiryDetailScreen.tsx; first extraction owner O18-MK04. Existing URL stays unchanged; no Jest import of app/app routes. app\app\rfq\[id].tsx changes target app\src\features\marketplaceScreens\RfqDetailScreen.tsx; first extraction owner O18-MK04. Existing URL stays unchanged; no Jest import of app/app routes. app\app\rfq\merchant\[id].tsx changes target app\src\features\marketplaceScreens\RfqMerchantDetailScreen.tsx; first extraction owner O18-MK04. Existing URL stays unchanged; no Jest import of app/app routes. app\app\rfq\new.tsx changes target app\src\features\marketplaceScreens\RfqNewScreen.tsx; first extraction owner O18-MK15. Existing URL stays unchanged; no Jest import of app/app routes.

**Acceptance:** Corrected legacy remains OFF; enabled composition preserves actual totals/states and safe selection/reopen/cancel predicates. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.features.rfq.__tests__.composition[.]test[.]tsx$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o19c`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o19c`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O16C — Flagged booking-detail hierarchy after all safety/readback repairs

**Depends:** O00, O16-MN06, O16-SV03, O16-CAP, O16-SV13, O32-MN01, O03, O05I, O06B, O08, O21-SV22. **Gates:** E0.

**Exact owned files:** `app\src\features\bookingDetail\BookingDetailScreen.tsx`; `app\src\features\bookingDetail\StatusHeader.tsx`; `app\src\features\bookingDetail\ActionsRow.tsx`; `app\src\features\bookingDetail\CancelSection.tsx`; `app\src\features\bookingDetail\DeliverySection.tsx`; `app\src\features\bookingDetail\PaymentsSection.tsx`; `app\src\features\bookingDetail\__tests__\composition.test.tsx`; `app\src\lib\payments.tsx`; `app\src\components\StatusTimeline.tsx`; `app\src\components\QuoteView.tsx`; `docs\design\oorva\evidence\o16c.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Under effective booking leaf, render canonical status/next action -> current due/delivery -> important current code -> details/quote -> payment/refund/history/help.
3. Use one parent authoritative load and existing sections, not a new controller or local payable/verified/completed state.
4. Apply reduced-motion rules to actual entering transitions. Preserve all family/actor/time guards and complete financial references.
5. Display-only identity consumers use useBrandIdentity(context) for paymentOverlay, statusTimeline, quoteFunding OUTSIDE the composition branch: identity depends on oorva_brand, not the family leaf. Preserve exact OFF/history/technical/legal contexts. No alternate hook/resolver.

**Acceptance:** All A safety fixes remain OFF; no duplicate due/hero/footer state, no hidden closed dispute or eligible review; actual same-PK actor views converge. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.features.bookingDetail.__tests__.composition[.]test[.]tsx$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o16c`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o16c`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O21C — Flagged creator discovery composition with real portfolio/category facts

**Depends:** O00, O21-MK24, O03, O05I, O06B, O08. **Gates:** E0.

**Exact owned files:** `app\src\features\creators\CreatorsScreen.tsx`; `app\src\features\creators\__tests__\composition.test.tsx`; `docs\design\oorva\evidence\o21c.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Under effective creators leaf, apply S43's existing-category/real-portfolio/how-it-works/brief hierarchy and the completed creator card contract.
3. Keep current creator/provider role model, capability parents and truthful empty/error city recovery; no invented work samples.

**Acceptance:** OFF preserves repaired current discovery; enabled view has contextual brief CTA and no unsupported rating/portfolio facts. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.features.creators.__tests__.composition[.]test[.]tsx$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o21c`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o21c`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O34 — Bounded native-identical, destination-aware launch reveal

**Depends:** O00, O05F, O07A, O13-AUTH, O05A, O05B, O11, O33. **Gates:** E0, D03b, D07a-platform, STACK-O34.

**Exact owned files:** `app\app\_layout.tsx`; `app\src\branding\launchBootstrap.ts`; `app\src\branding\LaunchExperience.tsx`; `app\src\branding\launchModel.ts`; `app\assets\brand\launch-geometry.json`; `app\src\components\RouteErrorBoundary.tsx`; `app\src\branding\__tests__\launchModel.test.ts`; `docs\design\oorva\evidence\o34.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. PF-T12: Implement A.4.4 exactly: binary eligibility before native adapter,250ms cache/800ms first-live-controls/1000ms font bound and2500ms native watchdog.
3. PF-T12: Use native-identical bundled OS-themed frame0 with symbol already visible; freeze supported cached/bundled duration and scale phases, zero/reduced static path.
4. PF-T12: Settle protected auth/URL/notification intent; never route home as an animation side effect. OFF cancels without asset/schema dependency.
5. PF-T12: Use the required O33 GREEN candidate stack before D07b; record real geometry/routes/errors and delivery identities.
6. Implement A.4.4 exactly, including binary versus reveal eligibility, module-scope release/watchdog, 250/800/1000/2500ms bounds, D frozen once in 0..1800, already-present symbol and actual guarded destination.
7. No native-changing main promotion before D07b; no local-notification or Expo Go substitute for real remote push/iOS native evidence.

**Acceptance:** PF-T12: No symbol disappearance, unbounded native splash, unwanted resume replay or home-first deep-link flash. PF-T12: Web/Expo-Go/old binaries never evaluate missing module. PF-T12: All15 launch cases have truthful platform evidence or explicit resource gate, not a made-up success. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.branding.__tests__.launchModel[.]test[.]ts$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- native-device-candidate: `eas build --profile oorva-review-android --platform android`; `eas build --profile oorva-review-ios --platform ios`. Only after O33 adds these exact isolated profiles and approved devices/signing/backend. Record actual build/runtime/channel/update/source identities and three cold starts. iOS unavailable => NOT VERIFIED, not Expo Go substitution.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o34`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o34`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O36C — Flagged AI conversation/history composition and contextual identity

**Depends:** O00, O15-SV10, O36-SAFETY, O03, O05I, O06B, O08, O12-MK19. **Gates:** E0.

**Exact owned files:** `app\src\components\assistant\AssistantCards.tsx`; `app\src\components\assistant\ChatBits.tsx`; `app\src\components\assistant\Composer.tsx`; `app\src\components\assistant\Composer.web.tsx`; `app\src\components\assistant\ProgressSteps.tsx`; `app\src\components\assistant\TextComposer.tsx`; `app\src\components\assistant\VoicePreview.tsx`; `app\src\lib\assistant\parse.ts`; `app\src\features\assistant\__tests__\composition.test.tsx`; `app\src\features\platformScreens\AssistantHistoryScreen.tsx`; `app\src\features\platformScreens\AssistantScreen.tsx`; `docs\design\oorva\evidence\o36c.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Apply the exact routeHostBindings extraction/ownership table before test imports. Keep one controller, preserve existing router/param/return intent behavior and test the feature host or named pure models.
3. Under effective AI leaf and existing ai_assistant, apply S34/S35 header/location/history, structured results, stop/progress and keyboard-safe text/voice/photo composer.
4. Use useBrandIdentity('assistant') for future display/accessibility/fallback copy; preserve actual policy/model/privacy/tool authority and review-before-book.
5. Retain PF epochs/OFF aborts and entered text across theme changes; no auto-book, fake live-model response or duplicate home AI entry.
6. Display-only identity consumers use useBrandIdentity(context) for assistant OUTSIDE the composition branch: identity depends on oorva_brand, not the family leaf. Preserve exact OFF/history/technical/legal contexts. No alternate hook/resolver.

**Binding overrides:** app\app\assistant-history.tsx changes target app\src\features\platformScreens\AssistantHistoryScreen.tsx; first extraction owner O36-SAFETY. Existing URL stays unchanged; no Jest import of app/app routes. app\app\assistant.tsx changes target app\src\features\platformScreens\AssistantScreen.tsx; first extraction owner O15-SV10. Existing URL stays unchanged; no Jest import of app/app routes.

**Acceptance:** Actual disabled/429/timeout/denied/stop/retry/history cases remain truthful; no new composition or request when parents OFF. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.features.assistant.__tests__.composition[.]test[.]tsx$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- private-e2e: `gh workflow run e2e-local.yml --repo sushruth5454/quickserve --ref lane/oorva-o36c`. Optional once per UI/migration lane when it adds wiring/state signal; mandatory on integration batch. Integrator alone watches E2E; no e2e-web dispatch on lane/batch.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o36c`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O35D — Approved future outbound/web display identity, with technical/legal retention

**Depends:** O00, O20-SP07, O35-MN05, O03, O05I, O36C. **Gates:** E0, D05-outbound.

**Exact owned files:** `web\checkout\index.html`; `web\checkout\brand-display.js`; `supabase\functions\verify-payment\brand-display_test.ts`; `supabase\functions\create-payment\index.ts`; `supabase\functions\create-payment\logic.ts`; `supabase\functions\create-payment\logic_test.ts`; `supabase\functions\_shared\outbound-brand.ts`; `supabase\functions\_shared\outbound-brand_test.ts`; `supabase\functions\ai-assistant\index.ts`; `supabase\functions\ai-assistant\logic.ts`; `supabase\functions\ai-assistant\brief.ts`; `supabase\functions\ai-assistant\outbound-brand_test.ts`; `supabase\functions\ai-assistant\policies\booking.ts`; `supabase\functions\ai-assistant\policies\role.ts`; `supabase\functions\ai-assistant\policies\security.ts`; `supabase\functions\ai-assistant\policies\safety.ts`; `supabase\functions\ai-assistant\policies\tools.ts`; `supabase\functions\ai-assistant\policies\output.ts`; `supabase\functions\ai-assistant\policies\language.ts`; `supabase\functions\ai-assistant\policies\transcription.ts`; `supabase\functions\ai-assistant\policies\conduct.ts`; `supabase\functions\ai-assistant\policies\diagnosis.ts`; `supabase\functions\ai-assistant\policies\handoff.ts`; `supabase\functions\ai-assistant\policies\intake.ts`; `supabase\functions\ai-assistant\policies\version.ts`; `supabase\functions\ai-assistant\policies\index.ts`; `docs\design\oorva\evidence\o35d.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. Consume the completed A.4.3 context inventory; only check drift in these affected display strings, not another app-wide audit.
3. Use D05's per-context approved future Oorva nonlegal display text only with effective brand+external. Keep exact legacy checkout/description contexts when OFF.
4. Preserve policy version/authority/tool schemas/model, HMAC/order/capture verification, payout narration, legal issuer, working domains/URLs and user history.
5. Separate web checkout display skin from MN-T05's verification truth; no gateway readiness claim without approved F8 evidence.

**Acceptance:** Future display ON/OFF/parent-OFF tests pass with exact technical payload/money/policy parity; all retain exceptions remain enumerated. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-deno: `pwsh -NoProfile -File $Helper -Suite deno`. Current helper runs shared Deno checks (no path filter support); every listed *_test.ts is selected; cs-test result: PASS.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o35d`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O35SQL — Future SQL message identity after every defining-function repair

**Depends:** O00, O16-MN06, O17-SV07, O17-PLAN, O21-READ, O21-SV19, O21-SV20, O22-DELIVERY, O22-SV02, O22-SV17, O24-NOTIFICATIONS, O16-CAP, O30-CM07, O32-MN01, O32-MN02, O32-MN04, O32-MN07, O32-MN08, O32-PAYOUT, O32-SV11, O25-SV12, O03, O35D. **Gates:** E0, D05-outbound, MIG-O35SQL.

**Exact owned files:** `supabase\migrations\UNASSIGNED__o35sql_oorva.sql`; `supabase\tests\oorva_outbound_sql.test.mjs`; `docs\design\oorva\evidence\o35sql.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. From the latest definitions after every listed predecessor, change future approved nonlegal text only in the exact function allowlist.
3. Private _outbound_brand(p_legacy text) returns compiled Oorva only for brand+external ON, otherwise that exact context's legacy string. No network/assets/appearance validity in money paths.
4. Preserve complete patched guards, lock order, contact masking, recipients, routes, dedupe, fee/amount/record/notification semantics; never copy an old function wholesale.
5. No historical message/ledger/receipt rewrite, legal issuer or payout-narration change. Get focused money/auth review and exact-paise/notification regression.

**Binding overrides:** Only supabase\migrations\UNASSIGNED__o35sql_oorva.sql is this stage's proposed migration claim path; every report draft filename is superseded. Coordinator supplies its actual acknowledged numeric filename before launch; no guessed 0089/0090/0091.

**Acceptance:** New future text respects ON/OFF/parent-OFF; every prior service/payment/support repair remains proven by its latest-chain tests. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-sql: `pwsh -NoProfile -File $Helper -Suite sql -Filter 'oorva_outbound_sql'`. Each unique registered filename selected by full current-chain run-all; all scenario assertions with actual JSON; cs-test result: PASS.
- codespace-sql-parse: `pwsh -NoProfile -File $Helper -Suite sql -Filter 'o35sql_oorva.sql'`. Coordinator has substituted and registered the actual numeric filename; this unique suffix selects its exact parse.cjs command, not zero checks.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o35sql`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.

#### O37B — Final registration, combined acceptance and explicit release disposition

**Depends:** O00, O38R, O37A, O02, O05F, O06A, O07A, O08-MK20, O09-SP01, O09-SP02, O11-ACCESS, O12-MK08, O12-MK09, O12-MK10, O13-AUTH, O13-BYO, O13-LOCATION, O14-MK12, O14-MK13, O12-MK16, O14-MK14, O15-SV10, O16-MN06, O16-SV03, O17-SV07, O17-PLAN, O17-SV18, O18-MK04, O18-MK15, O19-MK05, O19-MK25, O19-MK26, O18-MK11, O19-MK17, O20-SP05, O20-SP06, O20-SP07, O20-SP11, O21-MK24, O21-READ, O21-SV04, O21-SV06, O21-SV16, O21-SV19, O21-SV20, O22-DELIVERY, O22-SV02, O22-SV17, O23-ID13, O24-CM03, O24-CM04, O24-CM05, O24-NOTIFICATIONS, O27-MK02, O27-MK03, O28-ID03, O16-CAP, O16-SV13, O25-ID09, O28-ID10, O28-MK07, O19-MK06, O28-MK18, O29-STATE, O09-SP09, O20-SLOTS, O20-SP08, O30-CM07, O31-CM08, O31-CM09, O31-CM10, O31-CM11, O31-MK01, O32-MN01, O32-MN02, O32-MN04, O32-MN07, O32-MN08, O32-MN09, O32-MN16, O32-PAYOUT, O32-SV11, O35-MN05, O36-SAFETY, O38-ID01, O14-ID20, O25-SV12, O26-ID05, O23-ID07, O23-ID12, O25-ID08, O26-ID06, O30-ID11, O01F, O01L, O01X, O03, O04, O05A, O05I, O05B, O06B, O11, O16-MN14, O08, O10, O12-MK19, O13C, O33, O14-MK21, O14C, O15-SV15, O16-SV21, O17-SV23, O18-MK23, O19C, O20-SP13, O20-SP14, O21-SV22, O16C, O21C, O23-ID14, O24-CM12, O25-ID15, O26-ID17, O27-MK22, O28-ID16, O29-SP15, O30-CM13, O24-CM15, O30-ID18, O31-CM14, O31-SP16, O32-MN12, O32-MN13, O34, O36C, O35D, O35SQL. **Gates:** E0.

**Exact owned files:** `supabase\tests\package.json`; `.github\workflows\deploy-backend.yml`; `docs\design\oorva\evidence\final-implementation.json`; `docs\design\oorva\evidence\o37b.json`.

1. Read this exact stage and linked completed source task/finding/placement rows; perform affected-file/function drift check only. No repeat full audit, invented policy or scope expansion.
2. ID-T19: Coordinator resolves the four explicit UNASSIGNED-ID migration claim tokens against other streams and existing function locks, then assigns and registers actual filenames for parse/full-chain/deploy lists in order. Claim-token paths are not executable migration versions; never edit historical migrations or guess a numeric version.
3. ID-T19: Add the four named SQL tests to package scripts consumed by run-all; use r1-test-harness's full-chain regex that includes letter-suffix migrations, not only old partial o2_admin_status/merchant_staff fixtures.
4. ID-T19: Each new file imports createHarness and wraps independent scenarios so one crash cannot stop remaining checks; all assertion failures include JSON.stringify(actual rows/state) and every SQL parameter is explicitly cast.
5. ID-T19: Use isolated provider/business/customer/slot fixtures for distinct scenarios. Within one workflow compare the same entity PK across authorized actors; never merge identity by names or copy returned deterministic output as an expected value.
6. ID-T19: Run targeted app/SQL checks in the shared Codespace before lane push; lane CI confirms them. This is a future implementation verification requirement, not work performed by this read-only audit.
7. ID-T19: After integration, capture same-entity paired-role before/after evidence for these 15 screens. Screenshots require explicit scenario/flags/viewport and no phones/personal test-account details; the supplied failed hosted run is not an app PASS/failure diagnosis.
8. ID-T19 is final verification of already-applied per-file registrations, not an aggregate prerequisite blocking feature authors. Coordinator performs each requested early registration as a serial duty as soon as the exact file exists.
9. Verify every allocated migration is in parser/full-chain/deploy lists, every unique SQL test selected, real-PG tests only in the separate private job, all source IDs/cases and 88 screens+5layouts accounted for.
10. Perform section 8 combined acceptance with real native/large-text/keyboard/actor/state evidence; explicitly distinguish tested integration target, authorized main promotion/deploy, and still-pending public/native/legal/gateway gates.

**Acceptance:** ID-T19: All four forward migrations and test files are actually registered, in allocated order, and full-chain uses latest 0088b functions before the new changes. ID-T19: Enabled/OFF/parent-OFF and authorized/unauthorized role assertions cover every affected capability; cosmetic OFF does not weaken class-A fixes or gate money safety. ID-T19: All reported defects have a named failing-before/passing-after assertion, no diagnostic-only or audit-later task. ID-T19: No new package needed solely to execute these tests; existing Jest/PGlite infrastructure reused. ID-T19: Focused auth/money implementation reviews occur only for listed tasks and no automatic Opus review is required. No source task/finding/screen silently omitted; final report is NOT RELEASE READY while any applicable human/device/gateway gate is pending; no fabricated test evidence. No existing money-safety resolution depends on appearance/asset/leaf availability; any new capability has enabled/OFF/ancestor-OFF/authorized/unauthorized tests. Missing runtime/device evidence is NOT VERIFIED, not PASS.

**Exact validation selectors/commands:**
- codespace-app: `pwsh -NoProfile -File $Helper -Suite app -Filter 'src.branding.__tests__.featureControl[.]test[.]tsx$'`. First command runs tsc+one exact Jest path; remaining commands run only each other exact Jest path. All listed files/cases selected, each cs-test result: PASS; no zero selection.
- lane-ci: `git push origin HEAD:refs/heads/lane/oorva-o37b`. After Codespace PASS (or explicitly documented outage fallback), own exact-head lane-ci run green; no main/native/public permission inferred.


### 2.3 Fixed cross-stage APIs — no worker design choices

#### 2.3.1 Flags and appearance

Keep `useAppFeatureFlags().isOn(key)` and its complete existing result/default behavior. `get_app_features()` remains usable without branding deployment and returns **all current booleans plus every archetypes entry**. `FeatureFlagsProvider` is the sole shared control-plane fetch/cache/timer owner; O05A consumes its `appearanceCandidate`, does not create another fetcher. A valid same-generation flag update applies. Latest live request wins over older fallback/cache; malformed appearance or failed logo never vetoes flags. Separate flags and strict appearance caches; stable immutable theme identity; dirty forms never remount. A.3 is the complete backend/schema/privacy/publication/failure contract.

`FEATURE_PARENTS` in `featureFlagModel.ts` is the one exported client map. Admin effective disabled explanations use it; raw child state remains visible and switch-OFF available. Server private `_oorva_feature_enabled(p_key text) returns boolean` evaluates these exact Oorva ancestors against existing registry booleans; shared parity fixtures verify the server and exported map. Existing capability relationships/defaults are preserved, not redefined by Oorva.

Private O03 helper signatures are fixed: `_branding_validate_config(p_config jsonb,p_recovery boolean) returns jsonb` returns validated canonical V1 or raises field-specific error; `_branding_validate_policy(p_policy jsonb) returns jsonb` validates policy within hard ceilings; `_branding_assets_publishable(p_config jsonb,p_recovery boolean) returns void` raises on unsupported/missing/unvalidated/revoked references. `p_recovery=true` is callable only through authorized recovery, skips current soft new-write limits but never hard schema/contrast/integrity/revocation. Revoke public/anon/authenticated direct execution; no client-supplied recovery bypass.

#### 2.3.2 One request-generation and focused-active refresh core

```ts
// app\src\lib\entityInvalidation.ts
export function createRequestEpoch(): {
  begin(contextKey: string): RequestToken;
  isCurrent(token: RequestToken): boolean;
  invalidate(): void;
};
// RequestToken is opaque, readonly; caller cannot manufacture a current generation.

// app\src\lib\useEntityRefresh.ts
export function useEntityRefresh(
  load: (guard: { isCurrent: () => boolean }) => Promise<void>,
  options: { contextKey: string; enabled: boolean; intervalMs: number | null }
): { refresh: () => Promise<void>; refreshing: boolean };
```

`begin` supersedes prior token/context; invalidate rejects every pending token. The hook owns focus+AppState+web visibility, immediate focused resume, one interval only while enabled/focused/active/visible, coalesced refresh and cleanup. Context key includes project, actor, actual entity PK and selected business/resource/date/filter scope. Every awaited success **and error** checks the guard. On actor/permission loss clear sensitive data immediately; permitted stale data needs explicit stale/error context.

Exact scheduling rules: disabled/unfocused/inactive/hidden manual refresh resolves without a load. Coalesce same-turn refresh triggers into one microtask using the latest context/load callback; periodic ticks skip while the current read is running. A later explicit refresh (especially after mutation) or context change invalidates the old epoch immediately and starts a new logical read without waiting for an obsolete actor/context request; physical stale promises may finish but cannot write. Only the latest run may clear `refreshing`; an old finally cannot clear a newer spinner. Keep the latest load callback in a ref so a render-created function identity does not resubscribe/reset the controller. No extra timer, queue/store framework or cancellation policy is introduced.

`useFocusedServiceRefresh`, `useSportsReadRefresh`, `useMoneyReadback` use this **same signature/core**, no own counter/timer/store/publication. Sports retains 30000ms slots/checkout and 60000ms reviews; other missing focused reads use 60000ms, unless an existing subscription fully provides them. Keep booking/message subscriptions first; SV-T03 alone owns required existing-publication membership. No per-domain publication framework. A screen already owning parent readback (booking detail/receipt) uses that parent's refresh callback and pure money adapter, **not another nested money timer**.

Success triggers canonical refetch/affected-list invalidation through existing controllers/list registrations; other actors load their own authorized projection. Never share private rows or set local paid/verified/completed truth. Dirty draft fields are separate from truth snapshots: hydrate on context change/clean state, otherwise show newer-data notice without overwriting input.

#### 2.3.3 One contextual identity API

```ts
type BrandContext =
  | 'auth' | 'home' | 'account' | 'providerShare' | 'protectedInvite'
  | 'assistant' | 'support' | 'recurring' | 'rfq' | 'receiptChrome'
  | 'quoteFunding' | 'paymentOverlay' | 'statusTimeline'
  | 'checkoutPage' | 'gatewayDescription' | 'onboardingAgreement';
type BrandIdentityState = {
  brandOn: boolean; runtimeOn: boolean; bundledIdentityReady: boolean;
  published: { displayName: string; tagline: string; logoLight: string | null;
    logoDark: string | null; compactLight: string | null; compactDark: string | null } | null;
};
type ResolvedBrandIdentity = {
  displayName: string; tagline: string | null;
  logoLight: string | null; logoDark: string | null;
  compactLight: string | null; compactDark: string | null;
  source: 'legacy' | 'bundled' | 'published';
};
// branding\identity.ts — pure resolver, imports no Expo routes/native modules
export function resolveBrandIdentity(
  context: BrandContext, state: BrandIdentityState
): ResolvedBrandIdentity;
// branding\useBrandIdentity.ts — sole contextual hook
export function useBrandIdentity(context: BrandContext): ResolvedBrandIdentity;
```

Legacy context map: **Nearo** for `recurring`, `rfq`, `receiptChrome`, `quoteFunding`, `gatewayDescription`; **QuickServe** for all other listed contexts. Existing legacy logo/null/tagline choices remain context-specific; no invented tagline appears on legacy surfaces. Brand OFF → that legacy context; selected brand ON/runtime OFF or rejected appearance → bundled approved Oorva; runtime ON + valid candidate → published identity. Until O05B, absent bundled approval fails safely to real legacy; public brand activation is prohibited. Legal issuer, account identifier, receipt snapshot, contact URL, historical user text and payout narration never go through this hook.

Consumers are explicit in each stage (`O13C`, home MK-T19, account ID-T14, business ID-T16, onboarding ID-T17, recurring SV-T23, receipt MN-T14, communications CM-T15, AI O36C, booking O16C). Edge/SQL future outbound uses approved compiled `Oorva` versus exact supplied legacy context under both brand+external, not arbitrary remote displayName or a network dependency. No global Nearo/QuickServe/history/technical-ID replacement.

#### 2.3.4 Canonical booking/public trust and compatibility decisions

- **ID-T04 + SV-T14 + SV-T25 → O16-CAP**, one `get_service_booking_ui_state(uuid)`, no competing eligibility RPC. It includes canonical action booleans/reasons, `server_now`, `can_report_no_show`, `no_show_opens_at`, `no_show_report_party`, `actual_party`, current closure/payable/review/delivery/dispute context. No-show strict `server_now > scheduled_at + configured grace`, actual customer/provider only; team read/chat access is not owner authority. No private config/doc/payout/secret-code projection.
- **ID-T20:** retain `get_provider_public_profile` unchanged. `id_verified` is KYC plus `acc_` identifier shape, **not independent ID-document approval**. `providerPublicTrust` uses existing safe DTO only: “Payout account verified”, “Police certificate approved”, unchanged server-projected credential labels. Test visible/accessibility wording, both payout rails, unavailable/OFF and no private read.
- **ID-Q01:** retain exact existing deactivation guard; qualify that existing work/payment duties remain. No additional blocked state, SQL change or invented policy.
- **ID-T03 + MK-T04:** selected-business private existing-history reads retain actual owner/active member scope and `merchant_staff` delegation guard, but do not newly require products ON. New catalogue/create/edit/send/upload/public discovery still fail closed. `ID-SHOP-FLAG-PARENTS` verifies this exact existing-history/new-work split; no private-field or business-authorization expansion.
- **SV-T25:** runtime compatibility only—ended quote is historical/nonpayable; future cleanup retires stale attempts under existing locking, late captures use existing not-owed/refund/idempotency behavior. No historical normalizing migration/sweep. Separate per-case preview/approval for any additional live record write.
- **MK-T26:** nullable stable context with `coalesce(product_context_id,product_id,zero UUID)` compatibility and server trigger preserving exact OLD pointer when touched/deleted. **No bulk backfill/inferred already-NULL provenance**, merge, close or rekey. Preserve hard-delete/image-cascade semantics and enquiry PK/history.

#### 2.3.5 Testing inline routes without Expo route imports

Appendix I and `routeHostBindings` give 75 exact host/first-writer assignments. First writer mechanically moves the current inline screen/controller body to that host; existing route becomes a thin export with unchanged URL/params/intent. **One controller only** (the named hook inside the host); later stages edit host, not original route. Existing already-extracted feature screens are reused, never duplicated.

Jest imports only the named feature host, domain pure helper or core hook. Existing `Screen.test.tsx` names do not authorize an `app\app\...` import. Hosts use existing mocks/element traversal and mock router hooks; private E2E verifies thin-route wiring. No new test package just for these tasks. The frozen source refs still point to original inline files; that is provenance, not permission to bypass host ownership.

---

## 3. Shared-resource locks and forward-migration coordination

### 3.1 Machine-readable exclusive ownership

JSON `ownedFiles` includes exact source/test/new host/evidence files and claim templates. `workerOwnedFiles` excludes coordinator-owned shared registrations. Every pair of shared writers is explicitly ordered by `fileAndFunctionLockEdges`/`sharedWriterSequences`; adjacent edges imply the complete lock handoff. **Even distinct SQL functions cannot be edited concurrently in one file.** Different forward files redefining the same function/view are still function-conflicting.

`coordinatorSharedWriter` is the one explicitly grouped, serialized writer for existing package/CI/full-chain/deploy/locale/shared-barrel/E2E registrations. It is an in-progress coordinator duty, **not an aggregate task or green prerequisite**. Authors send exact keys/values/patches; only already-present files are registered through 0.4.3. No concurrent worker/index/global-locale writer is allowed.

| Actual overlap | Binding disposition |
|---|---|
| ID-T02 / SV-T05 `service_request_provider_view` | Grouped single O21-READ writer, one forward migration, no duplicate staff guard. |
| ID-T01 / SV-T12 `get_provider_jobs/get_my_business_provider_jobs`, shared types/dashboard | ID-T01 projection first → SV-T12 latest request/deadline repair → ID-T08 truth → ID-T15 composition. Preserve safe scope/archetype and address masking. |
| ID-T04 / SV-T14 / SV-T25 | One O16-CAP writer/DTO. No duplicate policy API; full no-show tests/callers plus ended-payment runtime guard. |
| ID-T03 selected shop / MK-T04 OFF history | Preserve the same existing private-read compatibility for both explicit and no-arg business context; new-work/public capability gates and merchant_staff actor checks remain intact. |
| MN/SV payment/refund/receipt/complete_transfer and booking-detail files | Unique SQL/test claims; explicit file/function predecessor chains in JSON. MN-T01 refund processing, SV completion/recording, MN-T06 receipt overlay and MN payout text stay separate facts. |
| CM notification queue/support masking / O35SQL | O24-NOTIFICATIONS completes first; O35SQL reads latest `_support_post` and all repaired money/service functions; preserve masking/queue/dedupe/routes. CM-T07 has its own later migration. |
| MK-T05 / MK-T26 `start_product_enquiry/select_supplier_quote`, then MK-T06/T11/T17 | Separate unique forward files with explicit order; later definitions retain eligibility + lock-order + stable-context repairs. |
| Shared APIs, types, host UI and tests | JSON exact case-normalized file edges, not just function locks. Shared repeated draft SQL tests are remapped to unique stage test files. |
| O33/O34 root/native/geometry and build/publish files | O07A/O05F/O05A/root owners first; O33 isolated canonical identity/geometry, then approved O34 stack; native main stays D07b gated. |

Before a new batch or rebase, detect **both** file and function overlap, not just textual merge conflicts:

```powershell
# $A and $B are the two exact projected stages, using allocated filenames.
$FileOverlap = @($A.ownedFiles | Where-Object { $_.ToLowerInvariant() -in
  @($B.ownedFiles | ForEach-Object { $_.ToLowerInvariant() }) })
$FunctionOverlap = @($A.sqlFunctions | Where-Object { $_.ToLowerInvariant() -in
  @($B.sqlFunctions | ForEach-Object { $_.ToLowerInvariant() }) })
if ($FileOverlap.Count -or $FunctionOverlap.Count) {
  throw "Not independent: files=$($FileOverlap -join ','); functions=$($FunctionOverlap -join ',')"
}
# Actual incoming changes must also be compared with the lane's own old-base diff.
$Incoming = @(git diff --name-only $OldBaseSha $NewBaseSha)
$Own = @(git diff --name-only $OldBaseSha $LaneHeadSha)
$ActualOverlap = @($Incoming | Where-Object { $_ -in $Own })
```

At the chosen base/worktree, find the **latest actual definition**, including view/function overloads, then open its full body and preserve all prior repairs:

```powershell
foreach ($Qualified in $Stage.sqlFunctions) {
  $Name = ($Qualified -split '\.')[-1]
  $Pattern = '(?i)create\s+(or\s+replace\s+)?(function|view)\s+(public\.)?"?' +
    [regex]::Escape($Name) + '"?\s*(\(|as\b)'
  $Definitions = @(Get-ChildItem 'supabase\migrations' -Filter '*.sql' |
    Sort-Object Name | Select-String -Pattern $Pattern)
  $Definitions | Select-Object Path,LineNumber,Line
  # New symbols have no old definition; existing symbols require a recorded last defining file/body hash.
}
```

Parse all added `CREATE [OR REPLACE] FUNCTION/VIEW` headers from incoming forward SQL and intersect names with **every live stage's sqlFunctions**. Also inspect the existing-owner function list in docs17 §3.1. A header outside the assigned allowlist, changed historical migration, unexpected shared file, unknown definition or source policy conflict → **BLOCKED, send exact file/function/base/diff to that owner**. Coordinator makes no speculative feature-code merge.

Copy-ready conservative incoming-symbol check (read-only git diff, no database calls). A name outside the packet is blocked rather than silently ignored:

```powershell
function Get-AddedSqlSymbols([string]$FromSha,[string]$ToSha) {
  $Added = @(git diff --unified=0 $FromSha $ToSha -- 'supabase\migrations' |
    Where-Object { $_ -match '^\+(?!\+\+)' } |
    ForEach-Object { $_.Substring(1) })
  if ($LASTEXITCODE) { throw 'Cannot read incoming SQL diff' }
  $Pattern = '(?is)\bcreate\s+(?:or\s+replace\s+)?(?:function|view)\s+' +
    '(?:(?<schema>[A-Za-z_]\w*)\.)?"?(?<name>[A-Za-z_]\w*)"?'
  @([regex]::Matches(($Added -join "`n"),$Pattern) | ForEach-Object {
    $Schema = $_.Groups['schema'].Value
    if (-not $Schema) { $Schema = 'public' }
    ($Schema + '.' + $_.Groups['name'].Value).ToLowerInvariant()
  } | Sort-Object -Unique)
}
$IncomingSymbols = @(Get-AddedSqlSymbols $OldBaseSha $NewBaseSha)
$OwnSymbols = @($Stage.sqlFunctions | ForEach-Object { $_.ToLowerInvariant() })
$SqlOverlap = @($IncomingSymbols | Where-Object { $_ -in $OwnSymbols })
if ($ActualOverlap.Count -or $SqlOverlap.Count) {
  throw "Owner rebase required: files=$($ActualOverlap -join ','); SQL=$($SqlOverlap -join ',')"
}
```

For the lane's own forward SQL, run the same extraction from its base/head and require every parsed function/view name to belong to its allocated `sqlFunctions`. Any unparsed quoted/dynamic definition is BLOCKED for exact owner resolution; never assume it is nonconflicting.

### 3.2 Unique UNASSIGNED coordinator claims

There are **38 independent writer claims** below. These are templates, not existing files or numerical reservations. No source draft `0089/0090/0091` assumption and no reuse of historical/stale `0059/0070/0087` claims.

| Unique claim | Sole writer | Proposed path, NOT a file/reservation | Exact function write scope |
|---|---|---|---|
| `MIG-O09-SP01` | `O09-SP01` | `supabase\migrations\UNASSIGNED__o09_sp01_oorva.sql`; numericVersion=`UNASSIGNED` | `public.submit_sports_venue`, `public.admin_set_venue_status` |
| `MIG-O14-MK12` | `O14-MK12` | `supabase\migrations\UNASSIGNED__o14_mk12_oorva.sql`; numericVersion=`UNASSIGNED` | `public.list_top_rated_public` |
| `MIG-O16-MN06` | `O16-MN06` | `supabase\migrations\UNASSIGNED__o16_mn06_oorva.sql`; numericVersion=`UNASSIGNED` | `public.get_receipt` |
| `MIG-O16-SV03` | `O16-SV03` | `supabase\migrations\UNASSIGNED__o16_sv03_oorva.sql`; numericVersion=`UNASSIGNED` | supabase_realtime publication membership for the exact existing RLS-protected booking child tables |
| `MIG-O17-SV07` | `O17-SV07` | `supabase\migrations\UNASSIGNED__o17_sv07_oorva.sql`; numericVersion=`UNASSIGNED` | `public.respond_visit_reschedule` |
| `MIG-O17-PLAN` | `O17-PLAN` | `supabase\migrations\UNASSIGNED__o17_plan_oorva.sql`; numericVersion=`UNASSIGNED` | `public._recurring_plan_payload`, `public.quote_recurring_plan` |
| `MIG-O18-MK04` | `O18-MK04` | `supabase\migrations\UNASSIGNED__o18_mk04_oorva.sql`; numericVersion=`UNASSIGNED` | `public._product_enquiry_participant`, `public._rfq_is_customer`, `public._rfq_shop_recipient`, `public._rfq_can_read`, `public._rfq_quote_can_read`, `public.get_product_enquiry`, `public.list_product_enquiry_messages`, `public.list_my_product_enquiries`, `public.list_shop_product_enquiries`, `public.mark_enquiry_read`, `public.get_my_business_shop`, `public.list_my_products`, `public.get_rfq`, `public.list_my_customer_rfqs`, `public.get_supplier_rfq_for_business`, `public.list_my_supplier_rfqs`, `public.compare_rfq_quotes`, `public.cancel_rfq`, `public.get_my_activity_unread_counts`, `public.mark_my_activity_notification_read`, `public._product_image_access` |
| `MIG-O19-MK05` | `O19-MK05` | `supabase\migrations\UNASSIGNED__o19_mk05_oorva.sql`; numericVersion=`UNASSIGNED` | `public.select_supplier_quote`, `public.send_supplier_quote_for_business`, `public.compare_rfq_quotes`, `public.start_product_enquiry`, `public._can_start_product_enquiry` |
| `MIG-O19-MK26` | `O19-MK26` | `supabase\migrations\UNASSIGNED__o19_mk26_oorva.sql`; numericVersion=`UNASSIGNED` | `public._preserve_enquiry_product_context`, `public.start_product_enquiry`, `public.select_supplier_quote`, `public.get_product_enquiry`, `public.set_product_enquiry_status` |
| `MIG-O18-MK11` | `O18-MK11` | `supabase\migrations\UNASSIGNED__o18_mk11_oorva.sql`; numericVersion=`UNASSIGNED` | `public.get_product`, `public.get_shop` |
| `MIG-O19-MK17` | `O19-MK17` | `supabase\migrations\UNASSIGNED__o19_mk17_oorva.sql`; numericVersion=`UNASSIGNED` | `public.get_product_enquiry`, `public.set_product_enquiry_status` |
| `MIG-O20-SP06` | `O20-SP06` | `supabase\migrations\UNASSIGNED__o20_sp06_oorva.sql`; numericVersion=`UNASSIGNED` | `public.get_sports_venue`, `public.get_sports_slots` |
| `MIG-O20-SP11` | `O20-SP11` | `supabase\migrations\UNASSIGNED__o20_sp11_oorva.sql`; numericVersion=`UNASSIGNED` | `public.request_sports_slot` |
| `MIG-O21-READ` | `O21-READ` | `supabase\migrations\UNASSIGNED__o21_read_oorva.sql`; numericVersion=`UNASSIGNED` | `public.service_request_provider_view`, `public.get_proposal_view_state` |
| `MIG-O21-SV19` | `O21-SV19` | `supabase\migrations\UNASSIGNED__o21_sv19_oorva.sql`; numericVersion=`UNASSIGNED` | `public.create_service_request`, `public.send_proposal`, `public.route_service_request`, `public._validate_service_request_intake` |
| `MIG-O21-SV20` | `O21-SV20` | `supabase\migrations\UNASSIGNED__o21_sv20_oorva.sql`; numericVersion=`UNASSIGNED` | `public.cancel_service_request` |
| `MIG-O22-DELIVERY` | `O22-DELIVERY` | `supabase\migrations\UNASSIGNED__o22_delivery_oorva.sql`; numericVersion=`UNASSIGNED` | `public._proposal_has_delivery`, `public.accept_proposal`, `public.confirm_completion`, `public.complete_booking` |
| `MIG-O22-SV02` | `O22-SV02` | `supabase\migrations\UNASSIGNED__o22_sv02_oorva.sql`; numericVersion=`UNASSIGNED` | `public.send_quote`, `public.approve_quote`, `public.approve_quote_with_coins`, `public.reject_quote`, `public.send_fixed_addons`, `public.approve_fixed_change_order` |
| `MIG-O22-SV17` | `O22-SV17` | `supabase\migrations\UNASSIGNED__o22_sv17_oorva.sql`; numericVersion=`UNASSIGNED` | `public.get_creator_proposal_config` |
| `MIG-O24-NOTIFICATIONS` | `O24-NOTIFICATIONS` | `supabase\migrations\UNASSIGNED__o24_notifications_oorva.sql`; numericVersion=`UNASSIGNED` | `public._queue_notification`, `public.list_my_notifications`, `public._support_post`, `public.get_unread_counts`, `public.get_chat_read_state`, `public.get_chat_heading` |
| `MIG-O27-MK02` | `O27-MK02` | `supabase\migrations\UNASSIGNED__o27_mk02_oorva.sql`; numericVersion=`UNASSIGNED` | `public.submit_shop` |
| `MIG-O28-ID03` | `O28-ID03` | `supabase\migrations\UNASSIGNED__o28_id03_oorva.sql`; numericVersion=`UNASSIGNED` | `public.list_my_business_memberships`, `public.get_business_shop_context` |
| `MIG-O16-CAP` | `O16-CAP` | `supabase\migrations\UNASSIGNED__o16_cap_oorva.sql`; numericVersion=`UNASSIGNED` | `public.get_service_booking_ui_state`, `public.expire_stalled_bookings`, `public.record_payment_paid` |
| `MIG-O28-MK07` | `O28-MK07` | `supabase\migrations\UNASSIGNED__o28_mk07_oorva.sql`; numericVersion=`UNASSIGNED` | `public.get_supplier_rfq_for_business` |
| `MIG-O19-MK06` | `O19-MK06` | `supabase\migrations\UNASSIGNED__o19_mk06_oorva.sql`; numericVersion=`UNASSIGNED` | `public.admin_rfq_dashboard`, `public.compare_rfq_quotes` |
| `MIG-O28-MK18` | `O28-MK18` | `supabase\migrations\UNASSIGNED__o28_mk18_oorva.sql`; numericVersion=`UNASSIGNED` | `public.list_my_supplier_rfqs` |
| `MIG-O30-CM07` | `O30-CM07` | `supabase\migrations\UNASSIGNED__o30_cm07_oorva.sql`; numericVersion=`UNASSIGNED` | `public.admin_dashboard` |
| `MIG-O32-MN01` | `O32-MN01` | `supabase\migrations\UNASSIGNED__o32_mn01_oorva.sql`; numericVersion=`UNASSIGNED` | `public.record_refund_submission`, `public.record_refund_status` |
| `MIG-O32-MN02` | `O32-MN02` | `supabase\migrations\UNASSIGNED__o32_mn02_oorva.sql`; numericVersion=`UNASSIGNED` | `public._finalize_session_completion` |
| `MIG-O32-MN04` | `O32-MN04` | `supabase\migrations\UNASSIGNED__o32_mn04_oorva.sql`; numericVersion=`UNASSIGNED` | `public.admin_retry_refund` |
| `MIG-O32-MN07` | `O32-MN07` | `supabase\migrations\UNASSIGNED__o32_mn07_oorva.sql`; numericVersion=`UNASSIGNED` | `public.resolve_dispute` |
| `MIG-O32-MN08` | `O32-MN08` | `supabase\migrations\UNASSIGNED__o32_mn08_oorva.sql`; numericVersion=`UNASSIGNED` | `public.admin_list_bookings`, `public.admin_list_stuck_money`, `public.admin_list_problem_payouts` |
| `MIG-O32-PAYOUT` | `O32-PAYOUT` | `supabase\migrations\UNASSIGNED__o32_payout_oorva.sql`; numericVersion=`UNASSIGNED` | `public.complete_transfer` |
| `MIG-O32-SV11` | `O32-SV11` | `supabase\migrations\UNASSIGNED__o32_sv11_oorva.sql`; numericVersion=`UNASSIGNED` | `public.get_booking_price_preview`, `public.get_session_pack_fee`, `public._recurring_plan_quote` |
| `MIG-O38-ID01` | `O38-ID01` | `supabase\migrations\UNASSIGNED__o38_id01_oorva.sql`; numericVersion=`UNASSIGNED` | `public._provider_document_requirement`, `public._provider_go_live`, `public._provider_onboarding_checks`, `public.get_my_provider_onboarding`, `public.admin_list_providers`, `public.admin_list_document_queue`, `public.get_provider_jobs`, `public.get_my_business_provider_jobs` |
| `MIG-O25-SV12` | `O25-SV12` | `supabase\migrations\UNASSIGNED__o25_sv12_oorva.sql`; numericVersion=`UNASSIGNED` | `public.get_my_business_provider_jobs`, `public.accept_booking` |
| `MIG-O03` | `O03` | `supabase\migrations\UNASSIGNED__o03_oorva.sql`; numericVersion=`UNASSIGNED` | `public.get_app_branding_snapshot`, `public.admin_list_branding_versions`, `public.admin_get_branding_version`, `public.admin_save_branding_draft`, `public.admin_publish_branding`, `public.admin_set_branding_policy`, `public.admin_rollback_branding`, `public.admin_revoke_branding_asset`, `public._branding_validate_config`, `public._branding_validate_policy`, `public._branding_assets_publishable`, `public._oorva_feature_enabled` |
| `MIG-O03-ASSET-REG` | `O03-ASSET-REG` | `supabase\migrations\UNASSIGNED__o03_asset_registration.sql`; numericVersion=`UNASSIGNED` | `public.admin_register_branding_asset` |
| `MIG-O35SQL` | `O35SQL` | `supabase\migrations\UNASSIGNED__o35sql_oorva.sql`; numericVersion=`UNASSIGNED` | `public._outbound_brand`, `public._support_post`, `public.request_completion`, `public.submit_delivery`, `public._apply_quote_coins`, `public.accept_proposal` |

Allocation algorithm:

1. Form the union of **actual current-main versions + active lane versions + explicitly acknowledged unpublished claims**. Reconcile with each existing owner; absence of acknowledgment is an affected-claim blocker, not “free”.
2. In READY/topological order, coordinator assigns each independent claim the next unused forward numeric version strictly after the acknowledged union, records owner/ack/time/base, and substitutes `UNASSIGNED__` with that exact version prefix. No worker computes `max(main)+1`. If enums must be used after commit, coordinator explicitly splits enum/use claims first; do not invent suffix migrations in a worker.
3. One stage is the **only writer** of its allocated file until it finishes. Once merged/applied, never append later tasks to it. Later repair/branding owns a new forward claim and copies the **latest** exact defining body with all prior fixes.
4. Author owns unique new SQL case files; coordinator registers exact existing files/parser commands/full-chain lists before author validation through section 0.4.3. Real-PG cases reside under `supabase\tests-postgres`, never `supabase\tests` or PGlite scripts.
5. Deployment list changes only at authorized E1 promotion, all migrations present/in numeric order and old live guards retained. Applied versions never renamed/reused/reverted. Any unmerged renumber requires owner-returned file/reference/registration updates and affected revalidation; never silently rename another live lane.

Before promoting a target containing version N, every acknowledged lower allocated claim must already be in that target/main or have an explicit owner-acknowledged release/renumber recorded. A lower pending claim blocks **higher migration promotion**, not unrelated private implementation/non-SQL work. Never deploy N then later append a smaller reserved version; return the exact ordering blocker to that claim's owner.

No migration in this plan performs bulk historical money/status repair. Additive columns/indexes/compatibility reads preserve unknown history as unknown; explicit per-case DATA-CASE approval is a separate operation.

---

## 4. READY frontiers, deterministic batching, merge and rollback

### 4.1 Exact initial parallel frontier

After **E0 + O00 DONE**, with each stage's listed gate/claim/other-plan lock approved and metadata filled, the exact dependency-free candidate frontier is:

`O38R`, `O37A`, `O02`, `O07A`, `O08-MK20`, `O09-SP01`, `O12-MK08`, `O14-MK13`, `O20-SP05`, `O20-SP07`, `O21-MK24`, `O23-ID13`, `O27-MK02`, `O31-CM08`, `O32-MN02`, `O32-MN07`, `O32-MN16`, `O35-MN05`, `O01F`, `O01L`.

Launch its genuinely READY, mutually disjoint subset **together**. A pending D03a/D05/SQL allocation blocks only its listed stage. Recompute after each registration handoff, green result, integration or owner answer, not after a whole “wave”. JSON dependencies and actual locks—not arbitrary worker count—determine parallelism.

Subsequent frontiers follow the exact DAG: shared epochs/flags and independent A repairs first; core strict schema/tooling/fonts can overlap; B/C consume only their real foundation + repaired function/file predecessors; O35SQL follows all relevant SQL repairs; O37B is final verification. Audit completion is input, not future work.

### 4.2 Integration algorithm — no implicit decisions

1. Select at most **four CODE_GREEN exact heads** whose required predecessor SHA is already in the current tested target (or explicitly approved compatible stack), whose owned files/functions do **not** overlap each other, and whose migration versions can be applied in ascending order. If overlap exists, select only the earlier dependency; queue its successor. Do not include an unrelated fifth lane to fill capacity.
2. Save `BatchBaseSha`, source stage/head/run IDs and actual allocated migration order in ledger. Use a new clean integration worktree/branch from the recorded tested target: `integrate/ui-batch-<N>` for no migrations, otherwise `integrate/db-batch-<N>`. Never modify a shared batch already being tested.
3. Merge **exact green head SHAs**, in dependency then numeric migration order:

The only automatic conflict repair allowed is this exact package-script union, owned by the coordinator. It preserves ours, appends only missing theirs commands, rejects non-script metadata changes and requires every referenced file already present. No feature-code or arbitrary YAML/TS/JS merge:

```powershell
function Merge-RegisteredSqlCommands {
  $GitPath = 'supabase' + [char]47 + 'tests' + [char]47 + 'package.json'
  $Ours = (git show ":2:$GitPath" | Out-String) | ConvertFrom-Json
  if ($LASTEXITCODE) { throw 'Missing ours package merge stage' }
  $Theirs = (git show ":3:$GitPath" | Out-String) | ConvertFrom-Json
  if ($LASTEXITCODE) { throw 'Missing theirs package merge stage' }
  $OMeta = [ordered]@{}; $TMeta = [ordered]@{}
  foreach ($P in $Ours.PSObject.Properties) { if ($P.Name -ne 'scripts') { $OMeta[$P.Name] = $P.Value } }
  foreach ($P in $Theirs.PSObject.Properties) { if ($P.Name -ne 'scripts') { $TMeta[$P.Name] = $P.Value } }
  if (($OMeta | ConvertTo-Json -Depth 30 -Compress) -cne
      ($TMeta | ConvertTo-Json -Depth 30 -Compress)) { throw 'Non-script package conflict: return to owner' }
  $OScripts = [ordered]@{}; $TScripts = [ordered]@{}
  foreach ($P in $Ours.scripts.PSObject.Properties) {
    if ($P.Name -notin @('pretest','test')) { $OScripts[$P.Name] = $P.Value }
  }
  foreach ($P in $Theirs.scripts.PSObject.Properties) {
    if ($P.Name -notin @('pretest','test')) { $TScripts[$P.Name] = $P.Value }
  }
  if (($OScripts | ConvertTo-Json -Compress) -cne
      ($TScripts | ConvertTo-Json -Compress)) { throw 'Other script conflict: return to owner' }
  $Pre = @($Ours.scripts.pretest -split '&&' | ForEach-Object Trim | Where-Object { $_ })
  $Test = @($Ours.scripts.test -split '&&' | ForEach-Object Trim | Where-Object { $_ })
  foreach ($Command in ($Theirs.scripts.pretest -split '&&' | ForEach-Object Trim | Where-Object { $_ })) {
    if ($Command -notin @($Pre + $Test)) { $Pre += $Command }
  }
  foreach ($Command in ($Theirs.scripts.test -split '&&' | ForEach-Object Trim | Where-Object { $_ })) {
    if ($Command -notin @($Pre + $Test)) { $Test += $Command }
  }
  foreach ($Command in @($Pre + $Test)) {
    $Parts = @($Command -split '\s+')
    if ($Parts.Count -lt 2 -or $Parts[0] -ne 'node') { throw "Unsupported command: $Command" }
    $Relative = if ($Parts[1] -eq 'parse.cjs' -and $Parts.Count -eq 3) { $Parts[2] } else { $Parts[1] }
    $File = Join-Path 'supabase\tests' $Relative.Replace([char]47,[char]92)
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw "Missing registered file: $File" }
  }
  $Ours.scripts.pretest = $Pre -join ' && '
  $Ours.scripts.test = $Test -join ' && '
  $Ours | ConvertTo-Json -Depth 40 | Set-Content 'supabase\tests\package.json' -Encoding utf8
  git add -- 'supabase\tests\package.json'
  if ($LASTEXITCODE) { throw 'Cannot stage coordinator registration union' }
}
```

```powershell
git worktree add -b $BatchBranch $BatchWorktree $BatchBaseSha
Set-Location -LiteralPath $BatchWorktree
foreach ($LaneSha in $OrderedGreenHeads) {
  git merge-base --is-ancestor $LaneSha HEAD
  if ($LASTEXITCODE -eq 0) { continue } # Already contained; combined validation still required.
  if ($LASTEXITCODE -ne 1) { throw 'Cannot verify exact green head ancestry' }
  git merge --no-ff --no-commit $LaneSha
  if ($LASTEXITCODE) {
    $Conflicts = @(git diff --name-only --diff-filter=U | ForEach-Object {
      $_.Replace([char]47,[char]92)
    })
    if ($Conflicts.Count -eq 1 -and $Conflicts[0] -eq 'supabase\tests\package.json') {
      try {
        Merge-RegisteredSqlCommands
        git diff --check
        if ($LASTEXITCODE) { throw 'Registration union diff-check failed' }
      } catch {
        git merge --abort
        throw "STOP: registration conflict returned to owner: $_"
      }
    } else {
      $Conflicts
      git merge --abort
      throw "STOP: return conflicting stage/files/functions to owner; no coordinator code edits"
    }
  }
  git diff --check
  if ($LASTEXITCODE) { git merge --abort; throw 'Batch merge diff-check failed' }
  git commit -m "merge(oorva): exact green stage head $LaneSha" -m $Trailer
  if ($LASTEXITCODE) { throw 'Cannot complete merge with active-session trailers' }
}
git diff --check
git push origin HEAD:refs/heads/$BatchBranch
```

4. Serial coordinator registrations may be a separate explicit shared-files-only commit under their lock; never repair feature code. For package union, ordered green-head selection already puts new migrations in numeric order; recheck printed actual parser list before validation. Every other textual conflict—including unexpected package metadata, workflow, locale or E2E conflicts—aborts and returns an exact rebased registration/code patch to its owner via the paused roundtrip, not an ours/theirs choice. A function conflict in different migration files is still a conflict even when git merges cleanly. The successor owner must rebase/read latest definition, preserve fixes, rerun targeted checks and return a green head.
5. Every integration branch requires exact-head **lane CI + private `e2e-local` green**. Private stack applies the full branch chain, demo seeds and `seed-e2e-settings.sql`; fixture namespaces/flags/state are asserted. The coordinator alone starts one async 60s watcher per run and keeps dispatching/integrating other independent work. No sync CI wait or hosted `e2e-web` dispatch.
6. On a red batch, read the whole failed log once; map actual failing file/function/test to the owning stage via JSON. Return all failures to those owners. If ambiguous, send the full reproduction to affected owners; **do not guess**. Drop only the culprit from a **new** batch branch based on the saved base or accept its owner-fixed green head, then repeat combined checks. No force-push/rewrite of main or already tested shared branch.
7. Record `DONE` only after exact combined target SHA/check IDs pass and stage scope is accepted; record main SHA/deployment separately. A tested private target can seed later stages before E1. Native O33/O34 remain on their approved candidate stack pending D07b; no native-changing code leaks to ordinary main.

### 4.3 Main promotion — separate authorization and evidence

1. Require explicit **E1** covering every proposed main change and its automatic deployment. If batch contains native module/assets/runtime/channel changes, additionally require **D07b**, D03b/c, applicable D07a evidence and approved legacy/reinstall policy. D07b names the **combined tested O33+O34 candidate target**; do not promote an intermediate O33-only subset as if it were that reviewed target. Conflicting native stages may integrate through sequential private batches, then only the final combined target is promoted. Pending public switches remain OFF.
2. Refresh origin/main and compare it to `BatchBaseSha`. If unchanged, require `git merge-base --is-ancestor origin/main <tested-batch-sha>` then fast-forward **exact tested SHA**:

```powershell
git fetch origin main
if ($LASTEXITCODE) { throw 'Cannot refresh main; promotion blocked' }
if ((git rev-parse origin/main).Trim() -ne $BatchBaseSha) {
  throw 'Main moved: rebuild/test a new batch; do not promote an untested recombination'
}
git merge-base --is-ancestor origin/main $TestedBatchSha
if ($LASTEXITCODE) { throw 'Not a fast-forward target' }
# Only after E1 and, for native, D07b evidence is recorded:
git push origin "${TestedBatchSha}:refs/heads/main"
```

3. If main moved, build a **new** batch from latest main, compare actual files **and SQL symbols** against lane diffs. No-overlap main merge into a lane preserves its prior lane green per repo rule13; the **new combined batch always reruns lane CI/private E2E**. Any overlap → owner rebases/fixes and returns fresh required validation before batching. A lane promoted outside a batch always reruns lane CI first.
4. Main's automatic deploy and hosted `e2e-web` are a **separate final result**, not implied by batch green. Only integrator watches E2E. If private batch passed but hosted main fails, inspect full logs and settings/seed drift first; do not erase code or edit hosted values without authorization. Actual deployment/hosted run IDs and outcomes are recorded separately.

### 4.4 Rollback, blocked and no-ready algorithms

- **Unmerged lane red:** leave it RUNNING/BLOCKED, send exact full log/inputs to its author, keep other READY stages running. Never mark green by disabling a required test.
- **Merge conflict:** abort only the coordinator's current merge; record conflicting files/functions/base/heads and return to owner. No reset/clean of another tree, no “handle appropriately”.
- **Untested/red batch:** do not promote. Preserve its evidence, create a fresh branch from saved tested base excluding/fixing only implicated lane(s), rerun combined tests. Do not rewrite an in-use branch.
- **After main/applied migration:** do not revert/drop/rename applied SQL or bulk-repair records. Freeze further promotion, use only explicitly approved runtime OFF/admin recovery for affected capability, and request a new owner-authored fix-forward migration/binary as applicable. Money-resolution safety remains active. Existing financial data repair needs separate DATA-CASE preview/approval/readback.
- **Native rollback:** remote appearance cannot undo installed assets/modules; require approved corrected binary/channel/reinstall action. Never claim JSON rollback fixed native identity.
- **No READY but work running:** print exact `stage | state | agent/worktree | gate/lock/dependency`, end turn and wait for automatic completion. Do not poll known agents/runs.
- **No READY and nothing running:** print every blocked stage and its exact unmet dependency/gate/claim/owner/tool/base, with one required next action. Stop, preserve all work; no invented policy, phantom approval, headcount filler, app test or repeat source audit.

---

## 5. Acceptance criteria and validation commands

### 5.1 Per-stage executable validation

Each stage JSON has **exact files/cases, Codespace selectors and commands**. Project only that stage per section 0.2. `$Helper` is refreshed from current main per 0.4.4; no local installs/build/tests. Execute every applicable Codespace entry, not only the first one. Check selected filenames and case counts; zero selected tests is failure.

| Kind | Exact execution boundary |
|---|---|
| App | Execute the literal stage `command/commands`: first `-Suite app` runs tsc plus one exact host/model path regex; additional `-Suite jest` entries select the other exact files without repeating tsc. One pattern per call avoids an unverified remote-shell `|` interpretation. No Expo route imports. |
| SQL | Each unique test filter from the stage; separately run its **actual allocated migration filename** filter so the registered parser is selected. Complete current chain and createHarness/scenario; no early-only suite as current proof. |
| Deno | Existing helper `-Suite deno` runs the shared checks; it does not support a narrow function-path filter. Listed `*_test.ts` must appear. |
| Real PostgreSQL | O37A private lane job only: separate manifest/runner under `supabase\tests-postgres`; actual two connections/PIDs/barriers for exact feature-authored case file. No PGlite or ordinary SQL-runner registration. |
| Assets | O01X only after TOOL-ASSETS-MAIN; actual refreshed helper `-Suite assets -Filter oorva`. Before integration this command is **not available**. O37A CI selftests do not fabricate current-main support. |
| Native | Only actual approved O33/O34 isolated profiles/builds/devices/backend/signing and candidate IDs; no Expo Go/native claim or local-notification/remote-push equivalence. |
| E2E | Lanes request at most one private run when useful; integration batches always private. Hosted E2E is automatic main-only after permitted deploy. |

Required shared suites: SQL-B01..B14 and B09a; ADMIN-B01..B08; UI-CACHE-01..04; exact existing feature/default/archetype parity; all 25 parent/role/OFF tests; actual-used-pair UI-PRIMITIVES; STATE/PLACE/CARD actor/same-PK cases from completed source; LAUNCH-01..15/NATIVE-IDENTITY; exact-paise regression. A PGlite pass is not concurrency/Storage/device/gateway evidence.

**Ten real-PG writer groups** own their actual feature tests, not O37A: branding CAS; refund retry reservation; RFQ send/select/suspend; enquiry context/delete/start; recurring reschedule; request accept/cancel hold; ended-payment cleanup/webhook; requested-booking accept/expiry; legacy sports capacity; notification collapse/ack/transport. Their unique exact filenames/scenarios are in `postgresTestFile/twoConnectionScenarios`. HTTP asset integration is separate, not falsely two-connection proof.

### 5.2 Visual/state/role acceptance

For each affected screen/default and highest-risk state: source placement row IDs, actual before route/state/actor/flags and rendered after, plus interaction and other authorized-role same-PK readback. Historical filename alone never establishes state. Missing before state may be recaptured on isolated pre-change code; this is visual test evidence, **not a deferred source audit**.

Cover 320/360/390/430 mobile, 768/1280 web; default/130%/**200%** text; English/Telugu/mixed-script/long names/addresses/full money; light/dark/custom/invalid/rollback; loading/empty/error/denied/stale/expired; keyboard/safe area/focus/reduced motion; every real actor. Essential labels/amounts reflow, no ellipsis or money arithmetic change.

Manifest per capture: `screenId,routeTemplate,subview,scenarioId,actualBackendState,entityKind,entityPrimaryKey,actorPermissionContext,commitSha,backendMigrationBaseline,fixtureNamespace,flagSnapshot,brandingGeneration,theme,viewport,fontScale,platform,captureTime,beforeOrAfter,imageFilename,placementIds,sourceFindingIds,assertionResult,visualReviewerResult,blocker`. Native adds build ID, embedded/running SHA, runtime, channel, updateId, isEmbeddedLaunch and frame timing.

No secrets/real customer data; independent synthetic fixtures per scenario. One cross-role workflow compares the **same PK**, but different scenarios never share provider/venue/resource/slot. A screen is not complete on typecheck alone. Unopened state/device/gateway is `NOT VERIFIED`, not PASS.

### 5.3 Required invariants and retains

- Current primary/onPrimary and segmentThumb are correct. Repair actual unread 3.7574 light / 2.7861 dark and dark destructive pressed 1.9412; legacy pressed white on `#B42318`. Test actual used pairs, not just a theoretical palette.
- Preserve auth restore/return intent/guest guards, exact actor/business IDs, private public-profile/document/payout boundaries and signed previews.
- No invented universal order/status engine, provider-wide independent-ID claim, customer “paid” from browser success, gateway refund completion from submission, bank settlement from local transfer/netting, or fake empty from a failed read.
- Preserve booking/message subscriptions, all legitimate cancellation/refund/settlement/expiry paths with appearance/new-work OFF, receipt snapshots/reference formats, exact paise and backend accounting.
- O35SQL must preserve every earlier guard/masking/queue/acceptance/delivery/payment repair in its latest definitions.
- Account deactivation keeps existing guard and work/payment duties; products have enquiry/RFQ, not a newly invented checkout.

---

## 6. Sequence with existing plans and current source

| Existing surface | Deterministic treatment |
|---|---|
| Doc14 extracted features/HomeV2/search/components | Reuse exact completed-audit bodies and tests. Preserve home_v2/unified_search/guest_browse/other existing capability behavior; no second controller or lost legacy branch. |
| G-01/root/auth | Already included in frozen source; O05F consumes guards and removes duplicate flag fetch only. Do not schedule another guest audit/implementation. |
| Q-02/Q-03/P2-01/E2E/lint/cleanup | O00 records actual current owner and explicit handoff. Existing shared files are coordinator serialized; no claim that an old status is current. |
| Doc17 money/auth/notifications | Latest repaired definitions, current role/privacy/amount/dedupe/locking semantics survive all visual/outbound edits. Actual overlapping source/function change returns to owner. |
| Doc12 recurring/D1/D2/G2 and unpublished claims | Reconcile exact active ownership at execution; historical `0059` released/stale text grants nothing. Do not silently duplicate policy or reservations. |
| F8 isolated gateway evidence | Mocked checkout/brand tests do not close real test-gateway readiness; no live/shared-demo money action. |
| X2/push/iOS/signing | Credentials/platform resources remain explicit; local notification tests route intent only. No real remote push or iOS claim without corresponding actual evidence. |
| U4/Seva Coins/legal/issuer/business payout identity | No parallel global Nearo rename, coin policy change, unsupported bank/entity/PAN mapping, issuer/domain invention or tax/live-payment approval. |
| Frozen source vs execution base | Preflight checks only affected files/functions for drift and preserves newer repairs. Completed 88-screen audit remains input; do not replace implementation with future discovery. |

---

## 7. Status board and evidence truth

| Item | Current state |
|---|---|
| Source audit/package | COMPLETE: 88 screens +5 layouts /503 placements /136 findings /131 tasks /29 entities /12 families. |
| Dispatch allocation | 140 concrete stages, every source task exactly once; unique ownership/dependency graph and 38 UNASSIGNED migration claims. |
| Implementation / lanes / current-main tool integration | NOT STARTED by this documentation task; no Codespace/app/SQL/CI test run or push claimed. |
| Logo/assets | Approved D ready kit supplies real SVG masters, 56 PNG exports and exact copy/binding data using the existing selected geometry. No drawing task remains. Actual application/native integration and public-rights clearance stay separately verified. |
| Fresh archived before run | 44696642603 /229995fe…; failure with three Home flag-coverage assertions, not a blanket UX/app PASS. Actual route/state coverage remains field-specific. |
| Historical evidence | All 162 original names retained in D; not relabeled current runtime PASS. |
| Native/large-text/gateway | NOT RUN / NOT VERIFIED. Signed native candidate, real devices/backends, keyboard/large-text/remote-push/gateway evidence still required where applicable. |
| Human activation/deployment/data repair | E0/E1/D03/D05/D07b and any DATA-CASE approval are not fabricated; explicit scope/evidence needed. |

At execution, maintain **individual stages**, not only WP summaries. Live board prints READY/RUNNING/CODE_GREEN/DONE/BLOCKED with agent/worktree/base/head/locks/gates/claim, targeted selection+PASS, review, lane run, tested integration ref/SHA, main SHA/deploy runs, visual evidence and next action. `DONE` private integration ≠ main deployed ≠ public/native/release approved.

---

## 8. Definition of done

1. All 131 source tasks and retained core contracts have one accepted exact stage, valid acquired/released locks, acknowledged forward filenames, required tests/review, real head/run/integration metadata and no duplicate aggregate dispatch.
2. All 88 screens +5 layouts and dynamic modes have actual layout/typography/responsive/functionality/state/role/visual evidence; every one of 503 completed placement rows is retained or corrected with linked proof. No source audit is deferred.
3. All 29 entity definitions, source-proven productOrder N/A, 12 card families/domain variants and same-PK actor workflows remain canonical/private-safe; invalid transitions fail server-side.
4. A repairs work all-Oorva-OFF; B uses contextual identity parent; C uses each consumer's parent+leaf. All 25 registry rows/admin controls/server checks/ON/OFF/ancestor-OFF/roles pass. Existing money safety is never gated.
5. Exact reviewed colors/typography/assets, original selected/licensed SVG/exports, isolated admin preview/secure publishing/cache/recovery and bounded launch/native update contracts are implemented/tested where in release scope.
6. No applied migration appended/reverted, historical money/status/notification/receipt rewritten or new production data repair inferred from E0/E1. Technical IDs/routes/issuer/history and exact backend money preserved.
7. Combined lane CI/private E2E passes at named target; authorized main deploy/hosted E2E are separately verified; owner gates control promotion/activation. Native code stays off main until D07b.
8. All 21 review fixes +3 suggestions in G and nine Critical groups in H have implemented/tested evidence, not merely this document's resolution wording.
9. O37B/ID-T19 verifies already-applied registrations/parser/full-chain/deploy lists and final implementation matrix. Every missing device/gateway/legal/public approval is explicitly NOT VERIFIED/blocked, never substituted by mocks, source analysis, PNG exploration or code green.
10. Completion is scoped honestly: **this document is implementation-ready, not an implemented app or release-ready product.**

---


## Appendix A. Design, navigation and runtime contracts

### A.1 Oorva design contract

#### A.1.1 Brand and copy

| Item | Contract |
|---|---|
| Display brand | `Oorva`; custom wordmark may be lowercase `oorva` |
| Tagline | `Your world, closer.` |
| Secondary brand statement | `DISCOVER · CONNECT · EXPERIENCE`; restrained promotional use, never a replacement for the exact primary tagline or mandatory clutter in every header |
| Personality | Warm, trustworthy, restrained, premium, locally relevant; not ornamental or shopping-template-heavy |
| Primary action | Approved D deep teal `#006D77`; never warm sand by default |
| Warm accent | Sand `#E8B772` with `#3D2B0D` text; small brand highlight, not a second CTA or a status signal |
| Category identity | Four accents within one common interface; not four independent themes |
| AI label | `Ask Oorva AI`; state actual capability. Home-service assistance is not permission to promise every marketplace is supported. |
| Existing program | `Seva Coins` retained until separately approved |
| Terminology | Customer-facing: booking, request, quote, proposal, enquiry, venue, creator, refund. Do not merge distinct backend states into misleading labels. |
| Trust copy | Verified badges say what was verified. Do not imply escrow, guarantees, insurance or legal protections beyond approved current policy. |
| Promotional content | No invented discounts, ratings, stock, availability, photographs, or empty promotional blocks |

#### A.1.2 Color tokens


**Owner-approved D contract.** Read [doc 19](19-Oorva-Colour-Exploration-and-Design-Tokens.md), [the exact tokens](design/oorva/colours/design-tokens.json) and [approval record](design/oorva/colours/approval.json). No worker chooses replacement colours. Approval selects design values; it does not activate runtime flags, deploy application code or clear public/native rights.

| Existing colour key | Light | Dark | Rule |
|---|---|---|---|
| `bg` | `#FFFFFF` | `#0C1B21` | White light page; retain OS-selected dark companion |
| `surface` | `#FFFFFF` | `#14262D` | Neutral cards/forms |
| `surfaceAlt` | `#F4F7F8` | `#1B3138` | Secondary/disabled/grouped containers |
| `surfaceRaised` | `#FFFFFF` | `#20383F` | Raised containers |
| `surfaceOverlay` | `#FFFFFF` | `#20383F` | Sheets |
| `text` | `#18282E` | `#EAF4F6` | Primary content text |
| `textSecondary` | `#465C64` | `#C0D3D7` | Secondary content text |
| `muted` | `#5F7077` | `#A0B7BE` | Readable supporting text |
| `subtle` | `#849197` | `#728B94` | Inactive/decorative only |
| `border` | `#DEE5E7` | `#2E4850` | Decorative separation only |
| `borderStrong` | `#C9D3D7` | `#48656D` | Container grouping, not sole input boundary |
| `outline` | `#74848B` | `#76939D` | Meaningful input/control boundary >=3:1 |
| `success` | `#1C7B4B` | `#88DAB0` | Semantic role; use the documented foreground/container pair |
| `successStrong` | `#15613B` | `#88DAB0` | Semantic role; use the documented foreground/container pair |
| `successText` | `#15613B` | `#B2EACB` | Semantic role; use the documented foreground/container pair |
| `successSoft` | `#E9F6EE` | `#18392A` | Semantic role; use the documented foreground/container pair |
| `warning` | `#A96111` | `#F4C56F` | Semantic role; use the documented foreground/container pair |
| `warningText` | `#87500A` | `#F8D593` | Semantic role; use the documented foreground/container pair |
| `warningSoft` | `#FFF4E1` | `#3C301C` | Semantic role; use the documented foreground/container pair |
| `danger` | `#BA3F3F` | `#FFB3B7` | Semantic role; use the documented foreground/container pair |
| `dangerStrong` | `#B4232D` | `#B4232D` | Destructive/unread fill |
| `dangerPressed` | `#8F1D27` | `#8F1D27` | Pressed destructive fill |
| `onDanger` | `#FFFFFF` | `#FFFFFF` | Destructive/unread foreground |
| `dangerText` | `#A51D27` | `#FFB3B7` | Semantic role; use the documented foreground/container pair |
| `dangerSoft` | `#FDEDEE` | `#402128` | Semantic role; use the documented foreground/container pair |
| `info` | `#2D6596` | `#8BC3EE` | Semantic role; use the documented foreground/container pair |
| `infoText` | `#245A85` | `#B0D7F6` | Semantic role; use the documented foreground/container pair |
| `infoSoft` | `#EDF4FA` | `#1C354A` | Semantic role; use the documented foreground/container pair |
| `star` | `#865514` | `#F4C56F` | Semantic role; use the documented foreground/container pair |
| `skeleton` | `#E7EDEF` | `#29434C` | Semantic role; use the documented foreground/container pair |
| `onInverse` | `#FFFFFF` | `#FFFFFF` | Inverse foreground |
| `onHero` | `#FFFFFF` | `#FFFFFF` | Hero foreground |
| `toastBg` | `#18282E` | `#18282E` | Inverse notification container |
| `toastBorder` | `#18282E` | `#48656D` | Inverse boundary |
| `segmentThumb` | `#FFFFFF` | `#20383F` | Selected segment container |
| `primary` | `#006D77` | `#80D4D4` | Primary action fill |
| `primaryPressed` | `#00515B` | `#A0E4E2` | Pressed action |
| `primarySoft` | `#E4F2F1` | `#163D44` | Selected container |
| `primaryText` | `#005B63` | `#9BE1E0` | Brand links/selected text; NOT primary body text |
| `onPrimary` | `#FFFFFF` | `#003B42` | Text/icons on primary |
| `secondary` | `#526983` | `#B7C9E0` | Restrained secondary identity |
| `accent` | `#E8B772` | `#F1C482` | Small warm recognition accent |
| `onAccent` | `#3D2B0D` | `#3D2B0D` | Readable accent label |
| `heroFrom` | `#006D77` | `#006D77` | Occasional brand hero only |
| `heroTo` | `#00515B` | `#00515B` | Occasional brand hero only |
| `bubbleMine` | `#006D77` | `#80D4D4` | Semantic role; use the documented foreground/container pair |
| `bubbleTheirs` | `#E4F2F1` | `#1B3138` | Semantic role; use the documented foreground/container pair |

All 59 existing colour-role keys are provided. `components`, `badges` and `charts` in the token file are bundled design mappings, **not new fields to upload into strict BrandingV1**. Remote colour inputs remain six-digit hex only. Derived overlay stays code-owned: light `rgba(24,40,46,0.48)`, dark `rgba(0,0,0,0.60)`; never arbitrary remote CSS.

| Category | Accent light | Soft light | Text light | Accent dark | Soft dark | Text dark |
|---|---|---|---|---|---|---|
| Home services | `#006D77` | `#E4F2F1` | `#005B63` | `#80D4D4` | `#163D44` | `#A5E6E4` |
| Shops/products | `#315CA4` | `#EBF1FA` | `#264C8B` | `#A0C2FF` | `#1B3155` | `#BDD4FF` |
| Sports | `#865514` | `#FCF1DF` | `#795014` | `#EBC482` | `#3C301C` | `#F2D59E` |
| Creators | `#754185` | `#F5ECF8` | `#663674` | `#D5ADE2` | `#382340` | `#E3C5ED` |

Use category colours only in small labelled icon/metadata areas, not full cards/screens. Keep status meaning separate and backed by canonical data; pair it with text/icons. Use `outline` for actual input boundaries, not decorative `border`. Focus uses `primaryText`, 3 px ring and 2 px surface-colour gap.

Measured D light pairs: white/teal 6.08:1; white/pressed teal 9.02:1; supporting text/white 5.16:1; selected text/container 6.83:1; white/destructive 6.52:1. The supplied 312-pair specification and 1279 actual static browser text checks pass; this is not full accessibility/native/runtime proof. O02/O06/O05A must validate actual application usage, 320-width/200% text and ON/OFF/parent-OFF behaviour.

**Legacy Class-A semantic defaults stay unchanged:** `dangerPressed=#B42318`, `onDanger=#FFFFFF`, unread `dangerStrong/onDanger`; preserve the existing correct legacy primary/onPrimary and segmentThumb. D styling remains behind effective Oorva brand/UX controls, never a dependency of existing money resolution.

#### A.1.3 Typography, spacing and shape

| Role | Token / size / line height | Family and rule |
|---|---|---|
| Display | `display` 32/40 | Manrope 700, Latin headings |
| Large page title | `largeTitle` 30/36 | Manrope 700 |
| Page title | `title1` 24/30 | Manrope 700 |
| Section title | `title2` 20/26 | Manrope 600 |
| Card/compact heading | `title3` 17/22 | Manrope 600 |
| Body | `body`, `bodyStrong` 16/24 | Existing Inter 400/600 |
| Callout/button | Existing 15/20 and 16/20 variants | Inter 400/600 |
| Supporting text | Existing 14/20 and 13/18 variants | Inter 500/400 |
| Caption | Existing 12/16 | Inter 500/600; not decisive price/policy text |
| Numeric/price hero | `numeric` 28/34 | Inter 700, tabular numerals |

- Keep all existing variant names, body metrics, and fallback behavior; no route-level `fontSize` literals.
- Bundle approved, licensed static Manrope 600/700 assets with the OFL notice. Do not fetch fonts at runtime.
- Manrope is a Latin-heading choice, not a verified Telugu font solution. Preserve working system/script fallback; test Telugu/mixed-script titles on both platforms. Font failure must not block authentication.
- Keep the existing spacing scale: 4, 8, 12, 16, 20, 24, 28, 32, 40, 48. A 2-point optical exception is allowed in the token system, not arbitrary per-screen spacing.
- Gutter: 16 on compact mobile, 24 on wider content; section gap 24-28; card padding 16.
- Card radius 16; button/input 12; sheet 24. Minimum ordinary interactive target 48. Small button visual size may be 40 only with a non-overlapping 48-point hit area.
- Retain Ionicons for app controls. Do not add a competing icon pack. The Oorva symbol is a brand asset, not another icon family.
- Preserve existing restrained elevation. Dark mode primarily uses surface differences and boundaries.

Add a typed `metrics` export to the existing token module and Theme interface, rather than scattering these values across screens:

| Metric | Proposed value / invariant |
|---|---|
| Button min heights | sm 40 with 48 hit target; md 48; lg 52; grow when text wraps |
| Input min heights | md 52; lg 56; multiline starts at 96 and remains scroll/keyboard-safe |
| Header row | 52 minimum, large variant 56 minimum; may grow for title wrapping |
| Icon sizes | Retain 14/16/20/24/28 token scale; touch target independent from glyph size |
| Avatar/list media | Avatar 48 baseline; row image width 96 at normal mobile size, stack when it cannot fit |
| Responsive metrics | Mobile gutter 16; wide gutter 24; form max 640; discovery/admin max 1200; breakpoints 600/960 |
| Pillar/grid | Gap 12; 288 content-width threshold; no fixed maximum card height |
| Obstruction spacing | Measured safe-area/tab/footer/composer heights; no fixed "looks right" bottom offsets |

These are bundled design metrics, not admin-editable business rules or arbitrary remote style fields.

#### A.1.4 Responsive component rules

| Component | Deterministic layout |
|---|---|
| Screen | Safe area once, scrollable content, measured footer, correct tab inset; no independent screen-specific absolute CTA |
| Content widths | <600: mobile. 600-959: centered forms/details max 640, discovery up to 2 columns. >=960 web: discovery/admin max 1200, forms max 640. Do not enable iPad distribution as part of this. |
| Pillar tiles | Two intrinsic-height columns if content width >=288 and font scale <=1.3; otherwise one column. Icon above title in two-column mode. No fixed maximum height or critical text clamp. |
| Pillar copy | Home services / Repairs and local help; Shops & products / Nearby shops and bulk quotes; Sports & activities / Courts, turfs and more; Creators / Freelancers and events |
| Listing rows | Full title, trust/rating metadata, then price/action. Wrap price below at narrow widths. Grid image square; row image 16:9; stable placeholders. |
| Prices | Always full amount and unit; no ellipsis, lossy rounding, or display-time alteration of server totals |
| Count badges | Use `dangerStrong` with `onDanger`, not white on the lighter danger accent; full accessible count label |
| Header | Back once; title grows to two or more lines where necessary; long subtitle moves below instead of silently disappearing |
| Buttons | Min-height rather than fixed height; permit two-line labels; price-bearing CTA uses a full-width stack if the row cannot fit |
| Quote comparison | Compact stacked supplier/proposal cards on mobile; comparison columns on wide web. Show quantity, delivery, validity, exclusions and totals. |
| Forms | One column on small screens; related short fields may pair only if readable. Inline errors plus focus/scroll to first invalid field. Keyboard cannot cover submit. |
| Sheets | Safe-area-aware, keyboard-aware, max usable window height, accessible dismissal and focus return; no nested scrolling traps |
| States | Consistent loading skeleton, true empty state, retryable error, submission progress, success confirmation, permission denied and feature-off states |
| Motion | Respect reduced motion everywhere, including entering transitions; no decorative motion delaying work |

**Pillar class split:** MK-T20's audited Class-A legacy repair stacks the icon above the title at viewport width <600 logical pixels and uses one legacy HomeV2 column below360 while retaining full wrapping/intrinsic height. Oorva C composition uses the table's content-width288/font-scale1.3 rule. O08 keeps these explicit presentation branches; at320/200% both must retain full readable names, not silently clamp. The C table never authorizes unconditional legacy composition changes.

#### A.1.5 Shared change classes and flag-OFF contract

| Class | Applies when | Exact permitted change / owner |
|---|---|---|
| A - correctness/accessibility | Always, including all Oorva flags OFF | Semantic foreground/count/progress contrast; full critical labels/amounts and growable controls; valid hit/focus/keyboard/safe-area behavior; no demo/toast/CTA obstruction; reduced-motion support; no false empty/verified/paid state; canonical actor/action validity and bounded refresh. O06A/O07A/SP-T01–SP-T12/O38R plus the exact source-task owner. |
| B - identity styling | Effective oorva_brand and approved bundled identity readiness | Oorva name/logo/fonts/palette/category colors via the existing theme; OFF uses existing per-context legacy identity, not a globally normalized QuickServe name. |
| C - new composition | Effective family UX leaf + required existing capability parents | Tile orientation, section ordering, card density/metadata/action layout, new home/AI hub or dashboards. Shared market components get an explicit `presentation: legacy|oorva` (legacy default) where needed; callers opt in. |

O06/O07 may not globally reorder screens or retheme legacy color with a class-A excuse. O08's readability correction is A, palette is B, but new pillar/card/footer/comparison composition is C. Case-by-case baseline deltas must cite a class-A item and test/evidence; all other OFF differences fail. This replaces any earlier shorthand promise of byte/pixel-identical legacy UI.

Critical's true status/permissions and existing money resolution are never gated by cosmetic flags. Reuse typed canonical backend fields and shared presenters; labels are translations/presentation, not locally maintained entity state.

### A.2 Navigation, reuse and roles

#### A.2.1 Navigation

Keep all existing URLs and route parameter names.

```text
Root Stack: existing auth, guards, providers, deep links
  Customer tabs: Home | Search [existing unified_search] | Bookings | Account
  Provider tabs: Jobs | Earnings [owner only] | Account [owner only]
  Business staff: existing assigned-work navigation; no earnings/owner privileges
  Admin: Overview | review/operations links | Settings
    Settings [NEW planned route]
      Branding & Appearance [NEW planned route]
      Existing features, rules, fees, commission, geography, coins links

Service: category -> provider/packages -> existing book variant -> booking
Recurring: existing creation -> plan -> visit booking; provider calendar retained
Shops: shop/products -> product/shop -> enquiry; RFQ -> compare -> enquiry
Sports: activity -> venue -> slot -> checkout if owed -> booking
Creators: creators/category -> profile/brief -> proposals -> booking/delivery
```

AI entry: one identifiable action in the home search/AI hub; no duplicate lower home promo. Search help/category AI is contextual and passes the relevant category/query, using the existing assistant when effective. No overlapping FAB/fifth tab or broader AI authority. Urgent existing work remains above discovery when action is required.

Guest navigation now consumes merged doc14 G-01: preserve return intent, commit-action gates, signed-out push restrictions and server enforcement. O05F reconciles its direct root flag read with the single shared cache-first provider; no second authorization mechanism.

#### A.2.2 Existing architecture and ownership boundaries

| Existing source | Keep / extend |
|---|---|
| `app\src\theme\{tokens.ts,ThemeProvider.tsx,index.ts,contrast.ts}` | Single theme engine; immutable runtime theme objects; preserve `useTheme` and `makeStyles` |
| `app\src\components\ui\` | Existing Text, Button, Input, Screen/Header/Footer, Card, Badge, sheets, loaders, errors, toasts |
| `app\src\components\market\` | Existing marketplace components, not another shared component directory |
| `features\home\{HomeV2,LegacyHome,homeModel}` | Existing home branches; do not delete legacy/off behavior |
| `features\search\{SearchScreen,api,searchModel}` | Existing grouped search; preserve category/data limits |
| `features\booking\book\` | ScreenContent and existing controller separated; skin does not rewrite controller |
| `features\bookingDetail\` | StatusHeader, ActionsRow, CancelSection, DeliverySection, PaymentsSection |
| `features\activity\segments\` | Services, Requests, Shop, Sports; retain existing refresh and unread semantics |
| `features\providerProfile\` | Hero, overview, services, portfolio, reviews and callouts |
| `features\providerDashboard\` | Existing owner and business-member view split |
| `features\providerOnboarding\` | Existing wizard/edit sections and service editor modules |
| `features\sports\manage\` | Existing state hook/actions and venue/resource/schedule/booking sections |
| `features\shops`, `features\rfq`, `features\proposals` | Existing domain APIs, schemas, presentation helpers and tests |
| NEW `app\src\branding\` | Small configuration/identity/asset/runtime layer only; not a replacement design system |
| NEW `app\src\features\adminBranding\` | Admin draft, preview, publication and history UI |

New generic components require proof that an existing primitive cannot be extended compatibly. Do not create a universal mega-card with dozens of unrelated props.

#### A.2.3 Role and status rules

| Role | Target experience / invariant |
|---|---|
| Customer | Discover, resume active work, understand price/status, book/enquire, review, get support |
| Service provider owner | Urgent requests and next job first; availability, readiness, profile and earnings clearly separated |
| Shop owner | Catalogue health, verification state, enquiries and supplier RFQs; no invented product checkout |
| Venue owner | Venue state, resources/hours/prices/blocks and booking actions; accepted payment modes from existing backend |
| Creator | Portfolio/category discovery, brief, fixed proposal, milestones, deadline, delivery and revisions as already implemented |
| Manager/staff | Existing business membership permissions only. Manager/staff are not providers with owner earnings or payout access. |
| Admin | Pending review and operational problems first; dangerous actions require context, confirmation, reason and backend authorization |

Do not conflate payout verification, document approval, admin provider review, online status, or venue/shop verification. Preserve their separate backend sources.

For booking presentation, reuse the existing service/proposal status maps and sports-specific helpers. Sports `accepted` means Confirmed in its customer presentation; do not transplant service-booking meaning blindly.

For refresh, the completed source reports retain these mechanisms first: booking subscription in `app\src\features\bookingDetail\BookingDetailScreen.tsx:149-153`; sports focus/30-second slot refresh in `app\src\features\sports\SportsVenueBookingScreen.tsx:155-166`; sports admin load-after-mutation in `admin\sports.tsx:72`; venue owner focus reload in `app\src\features\sports\manage\useSportsVenueManagementState.ts:105`. Implement the completed SV-T03/SV-T04/SP-T09/MN-T09/CM-T04/CM-T05 repairs through O38R's single core, with the exact affected-case assertions; do not create competing schedulers.

### A.3 Runtime branding architecture and backend contract

All names in this section are **planned new interfaces**, not claims that they already exist.

#### A.3.1 Configuration envelope

These are proposed new interfaces. Flags use the existing complete public contract; appearance is independently versioned and strict.

```ts
type ThemeMode = 'system' | 'light' | 'dark';
interface PublicFeatures {
  [key: string]: boolean | Record<string, boolean>;
  archetypes: Record<string, boolean>;
}
interface BrandingV1 {
  schemaVersion: 1;
  displayName: string;                  // 2-32 plain characters
  tagline: string;                      // 0-80 plain characters
  defaultTheme: ThemeMode;
  headingFont: 'manrope' | 'inter';
  assets: {
    logoLight: string | null; logoDark: string | null;
    compactLight: string | null; compactDark: string | null;
    promotional: string[];              // <= hard ceiling 6 validated PNG asset UUIDs
  };
  light: Record<string, string>;         // exact allowed hex override keys
  dark: Record<string, string>;
  motion: { launchDurationMs: number }; // integer 0..1800; scaled phases, 0 = no reveal
}
interface BrandingSnapshot {
  generation: string;                   // decimal bigint appearance publication generation
  publishedVersionId: string | null;
  config: BrandingV1 | null;
  flags: PublicFeatures;                // EXACT get_app_features() result, including archetypes
}
```

Parse a response object enough to validate/apply `flags` first, independently. Unknown appearance-envelope fields/schema, malformed config or failed assets must not reject valid flags. Public flag keys are forward-compatible registry keys with boolean values; `archetypes` is required and all its boolean entries are preserved. It is already public feature configuration, not private commission/rule data.

Appearance V1 rejects unknown fields, wrong types, >32 KiB JSON, unsafe text, invalid IDs/colors/fonts, unbundled faces and failing hard contrast combinations. Six-digit hex inputs only; no arbitrary URLs/CSS/native permissions/money/roles/code. Soft policy governs new drafts/uploads; hard server ceilings and supported schema/integrity govern all publication/recovery.

`defaultTheme` is a default, not an OS override: use the OS light/dark preference when present; only with no OS preference use published default (system -> light). Native/first-JS frame always uses bundled OS-native colors (light if no OS preference); any different valid destination default appears by the defined handoff, not a white flash. Forced themes require a separate approved requirement.

#### A.3.2 Data model and RPCs

Use existing public schema/admins/app_config/admin_audit_log. All names below are new proposed objects, not currently implemented.

| Object | Invariant |
|---|---|
| app_branding_versions | Immutable UUID/content/schema/version/actor/time; record validation version and soft-policy revision used at acceptance |
| app_branding_state | Constrained singleton pointer + monotonically increasing appearance generation; publication/recovery writes only |
| app_branding_publications | Append-only publish/rollback/recovery audit with previous target, reason and generation |
| app_branding_assets | Immutable path/hash/MIME/bytes/dimensions/uploader/validation; published_once; revoked_at/by/reason tombstone; no overwrites |
| app_config branding_policy | Validated soft limits for new uploads/config and hard implementation ceilings; policy revision |
| branding-assets bucket | Private; only constrained server operation reads/writes; no arbitrary user-supplied path |

| RPC | Permission / exact behavior |
|---|---|
| get_app_branding_snapshot() | anon/authenticated safe appearance + EXACT get_app_features output; no drafts/private rule values/actor PII/path/secrets |
| get_app_features() | Existing public compatibility endpoint remains unchanged/available; do not require branding deployment/assets to read controls |
| admin_list_branding_versions(), admin_get_branding_version(uuid) | Existing _is_admin membership; safe metadata/history and authorized preview; readable for recovery even editor OFF |
| admin_save_branding_draft(jsonb,uuid), admin_publish_branding(uuid,bigint,text), admin_set_branding_policy(jsonb) | Admin + effective editor/runtime/brand parents; strict current new-write policy; publish CAS lock, assets/integrity validation, one coherent pointer/history/audit transaction |
| admin_rollback_branding(uuid,bigint,text) | Admin recovery even editor/runtime OFF; target previously published, supported/hard-safe/non-revoked; new generation, current soft limits NOT reapplied; never re-enables flags |
| admin_revoke_branding_asset(uuid,text) | Audited admin maintenance even editor OFF; only registered asset; current pointer must first recover to a safe version or runtime OFF; tombstone prevents new serve/publish/rollback |
| Private validation/asset/outbound helpers | Revoke PUBLIC/anon/authenticated EXECUTE; narrowly grant constrained server/owner paths only |

Soft limits may tighten from six promotions to two or 2 MiB to 1 MiB. That must not prevent recovery to a formerly valid published version inside hard ceilings. Hard schema/contrast/integrity/revocation failures still reject; recover to another supported version or bundled defaults. Keep old supported bundled fonts needed by recoverable versions.

Use safe search_path, qualified objects, actor authentication, RLS and deny direct table/sequence writes. SQL/Edge/TypeScript fixtures must prove the same strict appearance contract. Client/admin presentation share one exported parent map. New UI fields never replace server role/transition authorization.

#### A.3.3 Asset validation and publication

1. Untrusted runtime uploads are PNG only, default <=2 MiB, 32..4096 per side, <=16,777,216 pixels, <=6 promotions; soft limits are admin-managed within hard ceilings. Trusted source SVG masters are bundled/code-reviewed, never arbitrary remote SVG uploads.
2. Edge `branding-assets` permits anonymous published GET at gateway. Every admin POST independently verifies JWT/user/admin before a service-role Storage client or private helper. GET accepts only an asset UUID; server resolves its fixed bucket/path.
3. Validate real bytes/container/completeness/CRC structure/dimensions, reject animated/truncated/wrong-type/oversized inputs and strip metadata. No client "validated" field, Content-Type-only trust, external URL fetching, user path/bucket or permissive JPEG repair.
4. Store immutable bytes, then validated metadata; surface failures and clean only the known orphan. Never point a published config at incomplete/unvalidated/revoked data.
5. Admin `POST action=preview` resolves only an authorized asset and returns a same-project short-lived signed URL (max 300 s) plus expiry. Web Image cannot be assumed to send auth headers. Refresh expired preview through the authenticated call; no URLs/tokens in published config, analytics or persistent cache. Admin JSON/private responses are no-store.
6. Publish validates all references, atomically marks publication visibility and updates pointer/history/audit in SQL. Storage upload itself is outside that transaction; incomplete objects stay private/unreferenced.
7. Public GET checks published_once AND not revoked before Storage read. Use content-hash ETags and bounded public max-age <=300 s if revocation is offered, not an unbounded immutable cache promise.
8. Revocation stops new authorized fetch/publication after propagation/TTL; it cannot erase previously public copies or offline caches. Assets contain no secrets. A revoked current image causes a safe bundled fallback upon validation/refetch; independent OFF flags must still work.

#### A.3.4 Client integration

```text
get_app_branding_snapshot -- flags validated independently --> FeatureFlagsProvider
             |                  fallback get_app_features --> same complete flags API
             v
strict appearance validation + asset preload --> atomic appearance-only swap
             |
existing ThemeProvider/useTheme/makeStyles + nested isolated admin preview
```

1. One shared control provider above auth-dependent UI. Preserve `useAppFeatureFlags()` API, all valid registry values and `archetypes`; new unknown features default OFF, while existing legacy defaults remain the current defaults. Never reset business flags merely because a new branding RPC is missing.
2. Each logical refresh has a request sequence. Validate/apply flags first, independently of appearance generation/config/asset success. The newest accepted live request wins; fallback for an older request cannot overwrite a newer response. A same-generation flag update is applied.
3. On snapshot 404/network/invalid flag envelope, call existing get_app_features. If that also fails, retain separately cached last valid flags, else existing DEFAULT_FEATURES plus all new keys OFF. Show bounded diagnostic/admin freshness state, not a false successful refresh. Server-side checks remain authoritative.
4. Keep separate project-namespaced flag and appearance caches. Cache hydration only seeds before a newer live response; late cached OFF cannot overwrite fresh live ON. Valid live OFF overrides stale appearance immediately even when config is rejected or image preload fails.
5. Appearance is strict supported V1 and asset integrity/preload, committed once as a coherent immutable object. Unknown schema/invalid payload/asset failure keeps last valid appearance or bundled safe identity; this does not veto flags.
6. Effective identity selector: brand OFF -> context-specific legacy; brand ON + runtime OFF/invalid -> approved bundled Oorva; runtime ON + valid appearance -> published candidate. Before O05B exists/selection is approved, public brand activation is prohibited; development uses real legacy fallback/private fixtures.
7. Refresh on startup/foreground and at most one active-only 60 s timer; admin publish requests local refresh. Stable Theme identity until relevant appearance changes; no per-screen fetch or remount of dirty state.
8. O05F consumes merged G-01 and removes its separate RootNavigator flag fetch/loading-to-false state. Root/GuestGate/screens use the same hydrated controls. Before the first permission-dependent redirect, wait only for the bounded local hydration decision (not a network round trip), including web/Expo Go/no-reveal paths. Offline resume never invents guest_browse=false; with no cache use existing default-OFF guest behavior, preserve return intent and server denial.
9. Local cache read is bounded (250 ms) and eligible native first-install online flag bootstrap capped (800 ms); A.4.4 owns frame/readiness decisions. Nonessential remote images/appearance never extend the splash. A timeout is a recorded fallback, not proof the desired brand loaded.
10. Private admin preview is a nested context only, no global publish/cache/control mutation. Crash UI uses a pure bundled fallback independent of this provider. Legacy labels remain per context; no global QuickServe substitution for old Nearo receipt/checkout contexts.

### A.4 Logo, native assets and launch

#### A.4.1 Asset handoff


**Ready supplied input — no drawing task:** [approved-D brand kit](design/oorva/brand-kit/README.md),
[download ZIP](design/oorva/brand-kit/oorva-approved-D-brand-kit.zip),
[preview](design/oorva/brand-kit/previews/brand-kit-board.png),
[exact file/destination/hash manifest](design/oorva/brand-kit/manifest.json).
The kit contains actual outlined SVG masters and 56 ready PNG exports, preserving existing selected Connected O/custom
wordmark path geometry. No worker should draw, trace, raster-wrap, typeset a substitute wordmark or request image generation.

| Input | Exact delivery / use |
|---|---|
| Existing app contract | 9 existing SVG master paths + 26 existing PNG export paths are flagged `requiredForExistingAppContract` in the kit manifest. Import only those under existing owners/locks. |
| Logo variants | Symbol, wordmark-only, horizontal/stacked; light teal, dark-placement light teal, black/white; PNG @1x/@2x/@3x. Extra variants are optional, not new runtime dependencies. |
| Light / dark placement | `#006D77` on white; `#80D4D4` on `#0C1B21`. Monochrome white is `#FFFFFF`. The legacy `mono-ivory.svg` filename is a compatibility alias for pure white; no ivory colour decision remains. |
| Native sources | Opaque 1024 app icon; separate adaptive foreground/background/monochrome; 1024 transparent splash light/dark; 96 white-alpha notification icon; 48 favicon and optional ICO. |
| Native safe zone | Actual adaptive critical ink is verified inside the centred 624 px diameter circle, not merely a 624 square. Opaque icon has no prepainted corner mask. |
| Canvas/densities | Horizontal 360×100/720×200/1080×300; wordmark 256×64/512×128/768×192; compact 32/64/96; stacked 240/480/720 square. Exact canvases/alpha/sRGB/hashes are in the manifest. |
| Binding | `handoff/binding-data.json` and `selected-brand-exports.ts.txt` give the four exact paths/hashes. O05B applies these atomically with the asset import, not an old forest hash. |
| Native config | Merge-only `handoff/native-config-fragment.json`; `bundle/app/assets/brand/launch-geometry.json`. Do not replace app IDs/scheme/unrelated plugins. Native copies remain O33-owned. |
| Motion reference | Light/dark 1800 ms GIF references use the supplied layers; **do not ship them as a splash movie**. O34 still owns guarded destination, OFF/reduced-motion/watchdog/native-frame behaviour. |
| Provenance/rights | Existing selected vector contours retained and D colours explicitly approved. Public/trademark clearance remains D03c; native/device/release evidence remains D07a/D07b. |

**Owner workflow:** O01L now verifies/imports supplied masters; O01X imports/verifies supplied PNGs/manifests; O05B binds;
O33 alone copies native destinations. If a stage already landed, apply only the narrow D delta on its current owner lane;
do not reopen unrelated completed tasks or repeat design discovery.

**Coordinator gate evidence:** verify the actual supplied master/export hashes against the kit manifest and all four
binding records against their PNGs; record the approval JSON plus checked manifest/ZIP hashes in the session ledger.
Then mark input gates D03a and D03b APPROVED without asking for another colour/logo decision. A mismatch blocks only
the affected import/binding lane. This does not satisfy D03c, E0/E1 or D07. Keep completed stage status/SHAs intact
and track any D adoption as a narrow follow-up under its existing owner/file locks.

**Actual tooling limitation:** the current exporter/asset tests contain forest/ivory-only assertions and a pinned resvg
byte-reproduction profile. The supplied D files truthfully record Chromium/Pillow rasterization; **no current resvg,
Codespace or lane-CI PASS is claimed**. O37A alone adopts its tooling palette/profile before the O01X export-manifest handoff;
preserve all safety checks. Do not falsify renderer metadata or disable validation. If maintainers normalize encoding
through pinned resvg, the supplied SVGs are the complete input: mechanical export/hash regeneration only, never drawing.
The kit's handoff JSON is evidence, not an unchecked replacement for the application's current manifest schema.

The art files are ready now; application/native integration is not performed by this documentation change.

#### A.4.2 Native versus runtime

| Surface | Runtime configurable? | Plan |
|---|---|---|
| In-app name/tagline/logo/colors | Yes, validated published configuration | O02-O05/O10 |
| Installed app display name | Not by the app's branding JSON | O33 native rebuild/distribution |
| Installed icon/adaptive/monochrome icon | No | O33 |
| Native splash and system permission text | No ordinary runtime branding update | O33 |
| Bundle/package IDs, scheme, EAS project/update channels | Not ordinary branding fields | Preserve existing values unless a separately approved migration requires change |
| Store listing name/screenshots/legal identity | Store/release process | Owner approval and release checklist |
| Existing receipt/reference IDs | No cosmetic rewrite | Preserve `NR-`, `QS-`, UUIDs and snapshots |
| Support email/domain and gateway merchant identity | Separate operational/legal configuration | Keep working values until owner supplies verified replacements |

Do not rename `com.quickserve.app`, `quickserve` scheme, repo name, storage keys, database objects, Expo project slug/ID, URLs or API paths simply to remove old-looking text.

#### A.4.3 Contextual brand migration inventory

These are source-confirmed examples and explicit preservation rules. The completed audit fixes this inventory; O00 checks only drift in affected owned paths at the implementation base. Each screen owner changes display references in its own files; O35 does not race those owners.

| Previous value / context | Proposed value / handling | Exact source location | Code / backend / native build |
|---|---|---|---|
| QuickServe login wordmark | Resolved Oorva wordmark when identity is ON | `app\app\(auth)\login.tsx:89-90` | App / no / no |
| Welcome to QuickServe / role question | Resolved display brand, existing role semantics | `app\app\(auth)\role.tsx:86,95` | App / no / no |
| QuickServe AI, history and accessibility copy | Ask Oorva AI / resolved brand; existing capability scope | `assistant.tsx:423-446`; `assistant-history.tsx:33-39`; `components\assistant\TextComposer.tsx:61` | App / outward errors also need backend / no |
| Home Ask QuickServe AI entries | Resolved brand in both home variants | `features\home\HomeV2.tsx:351-373`; `features\home\LegacyHome.tsx:320-342` | App / no / no |
| QuickServe support/user/profile/footer copy | Resolved brand; preserve actual contact addresses | `components\AccountScreen.tsx:309`; `components\SupportConversation.tsx:67,97`; locale files | App / new future server copy only / no |
| Protected by QuickServe / invite sharing | Resolved brand; keep token and URL behavior | `byo\[token].tsx:122`; `(provider)\business-tools.tsx:71-72` | App / no domain-policy change / no |
| Book me on QuickServe / public profile share | Resolved brand; preserve existing generated link | `provider-profile\index.tsx:67`; `features\providerProfile\ProviderProfileScreen.tsx:131` | App / no / no |
| Paused by Nearo | Paused by resolved display brand; preserve existing visits | `recurring\[id].tsx:249` | App / no / no |
| Nearo does not take product-selection payment | Resolved brand; still no product checkout | `rfq\[id].tsx:207`; `rfq\merchant\[id].tsx:261` | App / no / no |
| Nearo payment receipt / funded-by copy | Oorva display chrome only; preserve financial snapshot, original IDs and legal fields | `receipt\[paymentId].tsx:80,117,158`; `components\QuoteView.tsx:151` | App / snapshot rules preserved / no |
| QuickServe payment overlay/timeline copy | Resolved brand; unchanged payment and timeline behavior | `lib\payments.tsx:42,215`; `components\StatusTimeline.tsx:22-47`; `features\bookingDetail\PaymentsSection.tsx:94` | App / no money change / no |
| QuickServe AI system/policy/brief/output/error wording | Validated approved brand for future display, same policy authority and tools | `ai-assistant\policies\*.ts`; `ai-assistant\brief.ts:132`; `ai-assistant\logic.ts:323,372`; `ai-assistant\index.ts:616,1231-1248` | No app-only shortcut / backend / no |
| Nearo checkout description | Approved outbound display identity; preserve booking reference/purpose | `supabase\functions\create-payment\logic.ts:32` | Backend / yes / no |
| QuickServe secure checkout/Razorpay display name/blue theme | Approved display skin; gateway/legal merchant identity separately approved | `web\checkout\index.html:7-31,81-85` | Web / no amount verification change / no |
| QuickServe payout narration | Preserve unless gateway/legal owner approves a future narration change | `_shared\payout-rail.ts:442` | Backend if approved / yes / no |
| QuickServe installed name and permission copy | Oorva name and approved permission strings | `app\app.json:3,14-16,43,49-56` | Config / no DB / yes |
| Current icon/splash/adaptive/favicon paths | Approved Oorva bytes at existing destinations | `app\app.json:7,22-27,36`; `app\assets\*` | Config/assets / no DB / yes for native, web deploy for favicon |
| `com.quickserve.app`, `quickserve` scheme/slug | Preserve technical identity | `app\app.json:4,8,11,21` | No cosmetic rename |
| `quickserve.lang.v1`, `quickserve.draft.*` | Preserve storage compatibility | `src\i18n\index.tsx:14`; `features\providerOnboarding\useOnboardingData.ts:47` | No cosmetic rename |
| `NR-` receipt numbers, `QS-` booking refs, database IDs | Preserve all existing and planned numbering unless a separate migration is approved | `0084_b2_receipts.sql:174-185` | No historical data rewrite |
| Existing user-entered messages, business names and issued content | Preserve verbatim business data | Existing tables/snapshots; no bulk replacement | No historical data rewrite |
| `support@quickserve.app` and deployed origins/URLs | Keep working values until verified replacements are supplied | `src\lib\config.ts:34`; `info\[topic].tsx:40`; existing environment configuration | Operational approval, not find-and-replace |
| README/history/old plan titles/technical comments | Historical/internal references may remain; documented allowlist | Existing docs/tests/comments | Not customer-facing brand migration |

Additional confirmed current occurrences, with explicit ownership:

| Future source text | Exact current source | Owner / decision |
|---|---|---|
| QuickServe support replied | _support_post, 0041_admin_support.sql:461-480 | O35SQL / SQL-C, future nonlegal title under external+brand flags |
| Ready to pay in QuickServe | request_completion and submit_delivery, 0082_c1_creator_delivery_safety.sql:59-89,453-500 | O35SQL, future notifications only; preserve financial state/amount logic |
| Seva Coins redeemed on a QuickServe booking | _apply_quote_coins, 0062_coins_hardening.sql:50-120 | O35SQL, future ledger description only; no historical update or program rename |
| QuickServe platform fee | accept_proposal, 0081_c2_creator_delivery.sql:547-728 | O35SQL, future label only; no fee/policy change |
| AI disabled/unavailable fallback | lib\assistant\parse.ts:319-321 | O36, fallback display text only |
| Delete my QuickServe account | lib\supabaseApi.ts:100 | O23, email subject only, preserve deletion behavior |
| Provider agreement/admin message copy | lib\onboarding\copy.ts:50,111 | O26; D05 for agreement/legal text, no agreement-version rewrite |

O35D consumes this completed context inventory and checks only affected-file/latest-definition drift; it does not rerun an app-wide discovery audit. Old migration text is not necessarily current behavior. A private `_outbound_brand(p_legacy text)` may choose compiled `Oorva` only when both brand/external switches are ON, otherwise returns the exact legacy context; it performs no network, image or appearance validation. Legal issuer/gateway/support-domain changes are separate D05 decisions. Existing Nearo/QuickServe strings deliberately remain in their original OFF/history contexts until their approved future-copy path is active.

#### A.4.4 Launch state machine

**Binary eligibility:** native Android/iOS, not Expo Go, and the installed reviewed runtime is in the O33 Oorva-native capability set. Only this permits evaluating the native adapter/holding the native splash before flags are known. **Reveal eligibility:** binary eligible AND valid effective brand/launch flags ON AND D03b assets bundled. Known OFF skips the reveal and releases normally; it does not prevent the early bounded bootstrap/watchdog. Web/Expo Go/legacy binaries never evaluate a new missing native module merely because a global flag is ON. New native-module code is delivered only under the compatible Oorva runtime/channel policy in A.4.5.

**Shared immutable geometry:** planned app\assets\brand\launch-geometry.json is consumed by the native config generator and launchModel.ts. It names the exact light/dark splash PNG, imageWidth 160 logical units, resizeMode contain, OS-native-window centering and bundled backgrounds (light white `#FFFFFF`, dark `#0C1B21`). Add real expo-splash-screen plugin config, including dark image/background; the existing unreferenced splash-icon file is not configuration. First JS frame draws the SAME PNG at the SAME canvas size/center outside screen-specific padding. If OS scaling differs, calibrate one documented platform constant shared by native+JS, never per-device magic offsets. Require pixel/frame comparison before approval.

**Bootstrap/controller (proposed fixed D02 contract):**
1. A minimal launchBootstrap module runs before provider/render work on binary-eligible runtimes, without waiting to learn the flags. It starts prevent-auto-hide and an independent 2500 ms watchdog; releaseNativeSplash(reason) is idempotent and available to the error boundary. Native code is behind the capability boundary, not a top-level missing-module import in the legacy-compatible path. Never rely solely on a component effect that may not mount.
2. Hydrate independent local control/appearance caches within 250 ms; simultaneously request live controls. Newer live controls always outrank late cache. Cached cold start has a coherent first frame, not an initial DEFAULT_FEATURES blue flash.
3. First install without cache may wait for initial live **flags only**, inside the already-visible native frame, up to 800 ms. Do not await recommendations, location, AI, remote appearance or images. If unresolved/error/offline, commit the documented bundled OFF fallback and suppress this reveal; a later ON does not replay mid-screen. Record fallback/freshness and apply a pending identity ON at the next cold start; OFF remains immediate. This exceptional cold-start deferral is explicit in the admin freshness UI.
4. Auth/URL/notification intent chooses navigation, not animation. Resolve initial URL plus a bounded last-notification lookup before revealing destination (max 250 ms after auth becomes usable); root guards still decide access/returnTo. Do not reveal home then navigate to booking as part of the animation. Late user-tapped intents navigate normally; unknown auth reveals a safe loading/error/auth surface, never a fabricated session.
5. Essential font readiness is bounded at 1000 ms from JS bootstrap, then uses existing Inter/system fallback. Release the native frame as soon as the identical JS frame is laid out; do not keep native splash up for the whole animation or an unbounded auth request. Pending auth/intent may keep that safe JS frame/loading surface, never reveal unguarded home. On render error, RouteErrorBoundary calls releaseNativeSplash immediately and shows bundled readable UI. The 2500 ms watchdog releases native splash even if reveal/asset logic fails; it cannot recover a native engine that never executes JS.

**Frame/motion contract:** use bundled selected symbol/wordmark and fixed bundled tagline for the reveal, never downloaded branding assets. Native first frame and JS frame 0 already contain the symbol at opacity 1; it must not disappear then re-enter.

Freeze D once at bootstrap: the supported cache hydrated within the deadline supplies its validated launchDurationMs; otherwise use bundled 1800 ms. Clamp to 0..1800 and do not change D/content mid-reveal when a live appearance arrives. Valid control-plane OFF still cancels immediately. Boundaries below are fractions of D; the whole reveal is at most D, with no added hold after the handoff. D=0 or reduced motion -> static native-identical frame then direct safe destination (optional opacity-only <=120 ms; no translation/scale). Resume/login/navigation never replays.

| Phase | Fraction / D=1800 example | Exact behavior |
|---|---|---|
| Frame hold | 0..1/6 / 0..300 ms | Native-matched background+symbol; no background-only frame |
| Symbol to lockup | 1/6..1/2 / 300..900 | Existing symbol eases from native center/canvas to final lockup position/scale; opacity stays 1; no bounce/spin |
| Wordmark/tagline | 1/2..7/9 / 900..1400 | Wordmark opacity 0->1 and y +8->0; tagline follows after 60 ms*(D/1800), Inter400 callout metrics; both custom assets/text legible |
| Destination handoff | 7/9..1 / 1400..1800 | Brand group fades out while actual guarded destination fades in; no navigation command; no extra minimum delay |

Use existing standard easing. Final lockup is centered as a whole with 24 logical-unit minimum gutter; its wordmark uses width min(240,windowWidth-48), scaled proportionally with separate symbol. Native phase remains OS-themed even if published default is different; destination uses A.3.1 theme precedence with a non-flashing opacity handoff. Remote admin logo changes do not replace the compiled native/reveal mark; that requires a native identity release.

**Native test matrix:**
LAUNCH-01 signed-out; 02 signed-in; 03 first install offline/timeout; 04 URL deep link; 05 killed-app local-notification intent; 06 resume no replay; 07 flag OFF/D=0; 08 reduced motion; 09 font/asset/watchdog failure; 10 root render error; 11 first install online with fast valid flags; 12 cached cold start with no legacy first frame; 13 OS light/dark/no-preference x defaultTheme x motion; 14 legacy APK/Expo Go/web no native reveal or missing-module crash; 15 isolated candidate remains same expected code over >=3 cold starts after an intervening main publish. Record frame-by-frame geometry and actual route.

iOS native evidence requires actual signing/profile/build/device availability; otherwise NOT VERIFIED, not Expo Go substitution. Real remote-push delivery remains X2-gated; local notification proves route intent only.

#### A.4.5 Native update/runtime delivery contract

Current publish-app.yml automatically sends main app changes to Expo Go and hard-coded apk-1/apk, while build-apk.yml uses APK_RUNTIME. They must not remain independently edited literals for the Oorva cutover.

1. O33 requests one canonical planned app\native-release.json for exact approved runtime/capability/channel identities. Integrator updates build/publish/profile consumers in one reviewed change. Values are allocated before candidate build; no guessed runtime or production switch.
2. Review/candidate channels are unique per reviewed lane/commit (`oorva-review-<sha12>` / `oorva-candidate-<sha12>`), never the shared `apk` channel. Main publish must not target those prefixes. An updates-disabled embedded-only review binary is also allowed only when that mode is explicitly recorded; production OTA behavior still needs separate testing.
3. Record platform/native build ID, embedded source SHA, running JS SHA, Updates.runtimeVersion, channel, updateId and isEmbeddedLaunch. A JS manifest string alone is not native capability proof. Test correct-runtime filtering and old-binary + latest compatible update behavior.
4. O33/O34 may build/test on release/candidate branches but do not merge native-changing code/runtime publishing to main before D07b. Existing doc14/17 apk-1 fixes continue beforehand. At cutover provide explicit reinstall instructions and owner-decided legacy maintenance; old binaries do not silently receive incompatible modules or remain falsely counted as tested.
5. The integrator owns iOS EAS profile/workflow/device/internal distribution or TestFlight setup after signing access is available. App/eas.json currently defines no iOS-specific build path. A public iOS completion claim cannot be made from Android or Expo Go evidence; unavailable scope is explicitly recorded for owner decision.
6. **Required candidate stack:** O33 becomes GREEN (not DONE) on its isolated release branch after its candidate checks. The coordinator records explicit O34 stacked-start approval on that exact SHA while D07b is pending. O34 then supplies tested motion/route evidence for the owner to decide D07b. Only afterward may both integrate/become DONE. Do not wait for an O33 production merge before creating the evidence required to authorize that same merge.
7. Native functional testing requires D07a's approved, device-reachable non-production backend and synthetic actor data on the reviewed server revision. Browser E2E's runner-local Supabase is not automatically available to a physical device. No silent production project, public port exposure, client-only permission/flag override or fabricated cached ON snapshot may substitute; record the exact resource blocker.

---

## Appendix B. Complete screen inventory and proposed layouts

All route paths below are relative to `app\app\`. **Every row is a proposed top-to-bottom layout, not a claim that the current screen is broken.** Use the completed 503 placement rows and source-task findings in docs\design\oorva\audit\coverage.json; retain rows marked correct. This table preserves the original proposed layout and historical before-image crosswalk, not a future audit assignment. Apply the common states, responsive rules and tests in appendix A.1 and section 5 to every row.

`B` means a historical related before-image exists in the catalogue; it does not prove all states or the exact proposed variant. `GAP` means the present artifact does not provide specific coverage. All after/native/large-text checks are pending. The WP column is an informational family label only; even the historical 'O09 first' annotation is not an executable prerequisite. Use only execution-plan.json's exact stage edges; completed audit targets refine this original hierarchy.

| Screen | Exact route source | Proposed hierarchy / behavior preserved | WP | Before |
|---|---|---|---|---|
| S01 | `(auth)\login.tsx` | Oorva logo/tagline; phone; OTP action; help; terms/privacy; real demo disclosure only in demo | O13 | B 01-02 |
| S02 | `(auth)\role.tsx` | Name; current customer/provider choice; concise benefit text; Continue; preserve return intent | O13 | B 151 |
| S03 | `(auth)\verify.tsx` | Back; full destination; OTP; error/resend countdown; verify footer | O13 | B 03 |
| S04 | `(customer)\account.tsx` | Shared AccountScreen: identity; personal settings; role/business group; support; legal/logout | O23 | B 102/104 |
| S05 | `(customer)\bookings.tsx` | Existing activity segments; within-segment filters; actionable cards; readable history | O16 | B 79-84 |
| S06 | `(customer)\index.tsx` | Location/bell; urgent active-work summary; one search/AI hub; four pillars; popular; rated; trust | O12 | B 20-22 legacy; HomeV2 GAP |
| S07 | `(customer)\search.tsx` | Search field; effective scopes; query/loading/error; grouped existing results; contextual AI help | O12 | GAP |
| S08 | `(provider)\business-tools.tsx` | Protected-invite explanation; existing amount/fee summary; client/scope; create/share; invite history | O28 | GAP |
| S09 | `(provider)\dashboard.tsx` | Role-aware header/readiness; urgent requests; next job; upcoming; compact secondary modules | O25 | B 116-118 |
| S10 | `(provider)\earnings.tsx` | Period; net/pending/hold/problem summaries; payout readiness; statement; transaction history | O32 | B 119-120 |
| S11 | `(provider)\pro-account.tsx` | Shared account owner variant; profile/work/business tools; personal settings; support | O23 | B 138-146 |
| S12 | `admin\ai.tsx` | Budget/cost/error summary; existing feature breakdown; loading/error/empty | O31 | GAP |
| S13 | `admin\audit.tsx` | Target filter; immutable action list; actor/time; useful empty/error states | O32 | GAP |
| S14 | `admin\booking\[id].tsx` | Booking/status/parties; critical issues; payments/refunds/payouts; history; guarded dispute panel | O32 | GAP |
| S15 | `admin\bookings.tsx` | Search; active/dispute/all filters; status/amount/identity rows; existing detail route | O32 | GAP |
| S16 | `admin\category\[id].tsx` | Basics; booking type; schemas; recurrence; required docs; cities; validated save | O31 | GAP |
| S17 | `admin\coins.tsx` | Liability summary; runtime switches; existing policy editor; units; save feedback | O32 | GAP |
| S18 | `admin\commission.tsx` | Default policy; tiers; time-based/repeat settings; category overrides; explicit save feedback | O32 | GAP |
| S19 | `admin\documents.tsx` | Review queue; provider/document context; preview; expiry/reason; approve/reject confirmation | O30 | GAP |
| S20 | `admin\features.tsx` | Search/grouping of registry rows; effective parent status; off-behavior description; pending save | O31 | B 162 |
| S21 | `admin\fees.tsx` | Existing fee units/policy; validated fields; preview of changes; save; no altered formulas | O32 | GAP |
| S22 | `admin\geography.tsx` | Hierarchical state/district/city/area; clear selection; search/add; guarded enable/disable | O31 | GAP |
| S23 | `admin\index.tsx` | Pending review/problems; operational shortcuts; summaries/trends; new Settings entry | O30 | GAP |
| S24 | `admin\payouts.tsx` | Failed/stale items; transfer context; error details; reason-required existing retry | O32 | GAP |
| S25 | `admin\people.tsx` | Search/filters; distinct review/payout/readiness badges; review reasons; guarded existing actions | O30 | GAP |
| S26 | `admin\refunds.tsx` | Refund problems; linked booking/payment; retry feedback; separate dispute-window setting | O32 | GAP |
| S27 | `admin\rfqs.tsx` | RFQ metrics; current requests/outcomes; readable status; no new sales/order model | O31 | GAP |
| S28 | `admin\rules.tsx` | Recurring and sports groups; existing units/constraints; dirty-state indication; save | O31 | GAP |
| S29 | `admin\services.tsx` | Search/archetype filters; active/live-city indicators; existing create/edit/order controls | O31 | GAP |
| S30 | `admin\shops.tsx` | Review queue/filter; shop identity/status/reason; valid actions; catalogue categories | O31 | B 161 |
| S31 | `admin\sports.tsx` | Review queue; venue status truth; only relevant review/restore/suspend actions; activity settings | O31 | GAP; O09 first |
| S32 | `admin\support\[id].tsx` | Shared support thread in admin mode; context/status; messages; composer; existing close/reopen | O24 | GAP |
| S33 | `admin\support\index.tsx` | Open/closed/all; unread-first conversations; identity/time; meaningful loading/error | O30 | GAP |
| S34 | `assistant-history.tsx` | Oorva AI header; privacy context; dated conversations; resume an existing conversation; no new delete action | O36 | GAP |
| S35 | `assistant.tsx` | Header/location/history; messages and structured cards; progress/stop; keyboard-safe text/voice/photo composer | O36 | B 75-78 |
| S36 | `book\[providerServiceId].tsx` | Existing BookScreenContent/controller; issue; schedule; address; server price; confirmation footer | O15 | B 72-74 |
| S37 | `book-fixed\[providerServiceId].tsx` | Package/inclusions; quantity; current booking type; schedule/address; exact total; pay footer | O15 | B 08-09 |
| S38 | `booking\[id].tsx` | Status/next action; due payment/delivery; important code; details; quote; payment/refund history; help | O16 | B 85-97 |
| S39 | `byo\[token].tsx` | Invite validity and scope; provider/client; server amount/fee; address; protected accept/sign-in | O13 | GAP |
| S40 | `category\[slug].tsx` | Category/title/location; existing filters; archetype-correct provider/package cards; truthful availability | O14 | B 28-68 |
| S41 | `chat\[bookingId].tsx` | Counterparty/booking header; message history/unread; protected payment notice; safe composer | O24 | B 98-101 |
| S42 | `coins.tsx` | Seva Coins balance/value; policy; eligibility; ledger; no misleading cash claim | O23 | B 103 |
| S43 | `creators.tsx` | Existing creator categories; actual portfolios only where available; how it works; brief entry | O21 | GAP |
| S44 | `earnings-statement.tsx` | Month; existing statement totals; reversal/demo exclusions; payout rows; full references | O32 | GAP |
| S45 | `enquiry\[id].tsx` | Shop/product/status header; enquiry thread; closed-state explanation; existing owner/customer reply controls | O19 | B 17 |
| S46 | `info\[topic].tsx` | Topic-specific legal/safety/privacy/help copy; accessible support actions; existing deletion confirmation | O23 | B 01/105 |
| S47 | `jobs.tsx` | Existing all/active/closed filters; date/status job rows; unread; correct booking links | O25 | B 128 |
| S48 | `location.tsx` | Search/current location; saved addresses; area hierarchy; editor; permission/offline feedback | O13 | B 24-27 |
| S49 | `merchant-calendar.tsx` | Business/date context; day/week; previous/next; grouped visits; plan/detail links | O17 | GAP |
| S50 | `merchant-enquiries.tsx` | Business context; unread/status enquiry list; empty/error; manage-shop link | O27 | GAP |
| S51 | `merchant-job\[id].tsx` | Assigned booking/status; permitted actions; private customer context; existing chat | O25 | GAP |
| S52 | `merchant-rfqs.tsx` | Business context; current/historical RFQs; needed-by/coverage/status; existing detail links | O28 | GAP |
| S53 | `merchant-shop.tsx` | Shop/readiness; shop details; product catalogue; editor/photo/specs; enquiries; explicit re-verification warning | O27 | B 60 attempted; actual state must be recaptured |
| S54 | `merchant-staff.tsx` | Owner/business context; current UUID-based member form; role explanations; member list/remove | O28 | GAP |
| S55 | `merchant-work.tsx` | Membership/business selection; role; permitted jobs/shop/RFQ/sports destinations | O28 | GAP |
| S56 | `notifications.tsx` | Compact header; mark-read; date groups; readable unread/context/time rows; valid deep links | O24 | GAP |
| S57 | `onboarding.tsx` | Existing seven-step provider wizard; progress; validation; persistent next/back; draft recovery | O26 | B 129/150-159 |
| S58 | `product\[id].tsx` | Product image/title/specs; indicative price and stock; verified shop; existing enquiry form | O18 | B 16 |
| S59 | `products.tsx` | Search/filter; existing optional AI search; bulk-RFQ entry; product grid/list; empty/error | O18 | GAP |
| S60 | `proposal\[id].tsx` | Status/provider; included scope; milestones; deadline/revisions; fees; existing accept/own-state controls | O21 | B 63 |
| S61 | `proposal\compose\[requestId].tsx` | Brief/package context; scope/total; deadline/revisions; existing milestones; deliverables; send footer | O22 | B 62 attempted; actual form GAP |
| S62 | `proposal-delivery\[id].tsx` | Existing HTTPS delivery links; add/remove; durability notice; send; server validation feedback | O22 | GAP |
| S63 | `provider\[id].tsx` | Compact identity/trust; service/package selection; portfolio; hours/coverage; reviews; correct sticky CTA | O14 | B 69-71 |
| S64 | `provider-profile\[section].tsx` | Existing section host, return target and error; six editable sections plus review | O26 | B 131-137 |
| S65 | `provider-profile\index.tsx` | Profile/readiness; prioritized missing work; section list; preview/share; guarded deactivate | O26 | B 130/139/160 |
| S66 | `quote\[bookingId].tsx` | Booking/change-order context; item editor; bill proof; existing settlement preview; readable total/send footer | O22 | B 125-127 |
| S67 | `receipt\[paymentId].tsx` | Display brand separate from issuer; original receipt/reference; item/payment/refund breakdown; booking link | O16 | GAP; existing flag OFF in smoke manifest |
| S68 | `recurring\[id].tsx` | Plan/status; next visit; due amounts; changes; upcoming/past; policy-valid skip/pause/resume/cancel | O17 | B 12/14 |
| S69 | `recurring\new\[providerServiceId].tsx` | Existing frequency/days; date/time; duration/package; end condition; address; server quote; request footer | O17 | B 14 attempted; creation form GAP |
| S70 | `recurring\provider\[id].tsx` | Plan/customer context; conflicts; next/upcoming; existing permitted reschedule/absence; history | O17 | GAP |
| S71 | `request\[id].tsx` | Brief/date/status; proposals and comparison; existing questions/cancel; outcome feedback | O21 | B 61/63 |
| S72 | `request\new.tsx` | Provider/category/package; brief; real schema fields; event/deadline; budget; privacy; submit | O21 | B 61 attempted; form GAP |
| S73 | `rfq\[id].tsx` | Request/status; requested items; exact comparable totals/coverage/differences; supplier selection -> enquiry | O19 | B 18 |
| S74 | `rfq\merchant\[id].tsx` | Customer item/spec needs; permitted quote fields; quantities/tax/delivery; total; send or read-only | O28 | GAP |
| S75 | `rfq\new.tsx` | Category/title; requested item/spec/qty units; needed-by; delivery/location; note; submit | O19 | B 18 attempted; form GAP |
| S76 | `shop\[id].tsx` | Shop identity/trust/location; offerings/contact routes already supported; catalogue; enquiry | O18 | B 16 related |
| S77 | `shop\index.tsx` | Product search; categories; enquiries where applicable; nearby shops; useful empty state | O18 | GAP |
| S78 | `sports\[activity].tsx` | Display activity name/location; radius chips; venue image/trust/distance/price cards | O20 | GAP |
| S79 | `sports\bookings.tsx` | Existing sports status/payment summary; date/location/resource; detail links | O20 | B 83 related activity segment |
| S80 | `sports\index.tsx` | Activity grid; my bookings; owner venues only when appropriate; payment-mode guidance | O20 | GAP |
| S81 | `sports\manage.tsx` | Business/venue selector; true review state; details/resources/hours/prices/blocks/bookings sections | O29 | GAP |
| S82 | `sports-booking\[id].tsx` | Venue/resource/time; actual booking and payment states; cancellation preview; role-valid actions | O20 | B 19 |
| S83 | `sports-checkout\[id].tsx` | Hold/deadline; venue/slot; full amount/fee; current payment state; pay or choose another slot | O20 | GAP |
| S84 | `support\[id].tsx` | Shared SupportConversation in participant mode; context; messages; composer; status | O24 | GAP |
| S85 | `support\index.tsx` | Conversation list/unread/status; support expectations; start-conversation footer | O24 | GAP |
| S86 | `support\new.tsx` | Booking context if present; subject/message; privacy guidance; send to Oorva support | O24 | GAP |
| S87 | `top-rated.tsx` | Location context; ranked real provider cards; empty/retry; correct profile links | O14 | B 23/114 |
| S88 | `venue\[id].tsx` | Venue/trust/facilities; resource/date/slot; actual payment choices and policy; price/action footer | O20 | B 19 related; selection form GAP |

Additional required surfaces, not counted as current routes:

- Five existing layouts: root, auth, customer, provider, admin.
- NEW planned `admin\settings\index.tsx` and `admin\settings\branding.tsx`.
- Existing provider-profile sections: basics, services, area, hours, portfolio, payouts, review. Both wizard and edit modes.
- Booking archetypes and payment/delivery/cancellation states, not just one generic Booking screenshot.
- Location/address sheets, sort/filter sheets, confirmation dialogs, quote comparison, payment overlay, errors, notifications/toasts.
- Separate `web\checkout\index.html`, native installed-app surfaces, system permission strings, remote push display and launch sequence.

---

## Appendix C. Completed source truth, findings and explicit retains

### C.1 Scope and evidence boundaries

| Evidence | Actual conclusion |
|---|---|
| Frozen source | All **88 screens +5 layouts** audited at `2f1e4638b145185b9e58c4c62e58f5c6dd491fa1`; all imported feature bodies/placement/status/actor/read-write paths are in the completed seven reports. |
| Structured audit | **503 placement rows /136 findings /131 task cards /29 entity definitions /323 referenced source files**; independent publisher validation reported no range/coverage/task-dependency errors. Source references are repo-relative path/ranges at frozen SHA. |
| Current allocation | 140 executable stages; all 131 source IDs exactly once. 38 unique UNASSIGNED coordinator claims; no current numeric reservation and no source-proposal combined-file writer. |
| Captures | Historical complete 162-name index retained; fresh archived run 44696642603 application parity is source-confirmed and nine contact sheets were reviewed. Neither image count nor source equality proves a route/state/interaction PASS. |
| Tests | **Source audit is not app/device testing.** This documentation integration runs only document/JSON validators and diff-check; no app/SQL/CI/native/large-text/keyboard/gateway/production run. |
| Approval boundaries | Final SVG selection, public rights/trademark, legal/issuer/bank identity, real devices/signing/reachable isolated backend and native cutover remain scoped gates, not “uncompleted source audit”. |

### C.2 Confirmed source-backed fixes, not speculative future discovery

Each linked source card contains the exact frozen file:line refs, actor/state reproduction, ordered edit and assertions. Table scope is deliberately concise; the published reports retain **all 136 findings and 503 placements**, not only these examples.

| Stream / count | Confirmed correction / required design work | Exact source tasks and implementation disposition |
|---|---|---|
| Platform —14 findings /12 tasks | Independent root/flags and auth failure/races; actor-private address state; OFF AI effects; failing actual unread/dark destructive pairs; obstruction; isolated native identity/reveal. | [PF-T01](audit/18-WS1-Platform-Auth-AI-Native.md#pf-t01) through [PF-T12](audit/18-WS1-Platform-Auth-AI-Native.md#pf-t12). A controls/auth/accessibility do not wait for final logo or branding SQL. Primary/onPrimary/segmentThumb retained. |
| Marketplace —28 /26 | Shop status/write/read-history guards; RFQ selection availability/locks; enquiry deletion key; product search/price/stock/city/public provider truth; deliberate home/profile/shop hierarchy. | [MK-T04](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t04), [MK-T05](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t05), [MK-T12](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t12), [MK-T20](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t20), [MK-T26](audit/18-WS2-Marketplace-Shops-RFQ.md#mk-t26). Unique SQL claims; lazy context compatibility, no production bulk backfill. |
| Services —22 /25 | Delivery detection/generic completion; actual quote family/fees/deadlines/action/readback; role-safe request/hold/recurring semantics; ended stale quote/payment guard. | [SV-T01](audit/18-WS3-Services-Creators-Recurring.md#sv-t01), [SV-T05](audit/18-WS3-Services-Creators-Recurring.md#sv-t05), [SV-T14](audit/18-WS3-Services-Creators-Recurring.md#sv-t14), [SV-T24](audit/18-WS3-Services-Creators-Recurring.md#sv-t24), [SV-T25](audit/18-WS3-Services-Creators-Recurring.md#sv-t25). O16-CAP absorbs ID-T04; image89 is the visible contradiction, no historical data repair authorization. |
| Identity —18 /20 | Document scope/expiry/replacement/readiness; actor-scoped drafts; exact business IDs; active provider work; truthful account/legal/coins/review; public safe trust wording. | [ID-T01](audit/18-WS4-Identity-Provider-Workspaces.md#id-t01), [ID-T04](audit/18-WS4-Identity-Provider-Workspaces.md#id-t04), [ID-T17](audit/18-WS4-Identity-Provider-Workspaces.md#id-t17), [ID-T20](audit/18-WS4-Identity-Provider-Workspaces.md#id-t20). ID-D01/ID-Q01 resolved: no public RPC change or deactivation policy expansion. |
| Sports —20 /17 | Verified-state review/downgrade; real resource payload hydration/business selector; actor/deadline/payment truth; current policy/lead projection; existing OFF payment obligation; slot race/legacy capacity; correct subtotal. | [SP-T01](audit/18-WS5-Sports-Operations.md#sp-t01), [SP-T06](audit/18-WS5-Sports-Operations.md#sp-t06), [SP-T07](audit/18-WS5-Sports-Operations.md#sp-t07), [SP-T09](audit/18-WS5-Sports-Operations.md#sp-t09), [SP-T11](audit/18-WS5-Sports-Operations.md#sp-t11). Wrapper uses O38R, no competing timers. |
| Money —15 /16 | Submission versus processed refund, session demo classification, local transfer/netting versus bank settlement, refund reservation cap, checkout uncertainty, immutable receipt/current overlay, readback and reconciliation. | [MN-T01](audit/18-WS6-Money-Receipts.md#mn-t01), [MN-T04](audit/18-WS6-Money-Receipts.md#mn-t04), [MN-T05](audit/18-WS6-Money-Receipts.md#mn-t05), [MN-T06](audit/18-WS6-Money-Receipts.md#mn-t06), [MN-T16](audit/18-WS6-Money-Receipts.md#mn-t16). Real-PG retry tests only under tests-postgres; never alter amounts/history for branding. |
| Communications/admin —19 /15 | Persistent read ack, real event-time provenance versus transport retries, member unread, masked support preview and correct personal scope, canonical admin counts/save/readback, gated composition. | [CM-T01](audit/18-WS7-Communications-Admin.md#cm-t01), [CM-T02](audit/18-WS7-Communications-Admin.md#cm-t02), [CM-T06](audit/18-WS7-Communications-Admin.md#cm-t06), [CM-T07](audit/18-WS7-Communications-Admin.md#cm-t07), [CM-T09](audit/18-WS7-Communications-Admin.md#cm-t09). ONE notification writer for T01/02/06; T07 independent forward file; O35SQL follows masking/queue repairs. |

### C.3 Source-proven retain boundaries

| Retain | Evidence / rule |
|---|---|
| Existing guest/auth guards and default feature/archetype output | PF-T01 and completed platform report. Fix duplicate controls/races, do not implement another guest flow or drop archetypes. |
| Current correct primary/onPrimary and segmentThumb | PF-T07/PF-T08; actual current active primary pairs pass. Dark destructive pressed and unread are the real failing pairs. |
| Backend independent provider/admin/KYC/document/live axes | Identity retained contracts ID-R01..R11. Existing `_provider_is_live`, document scope and signed private preview are not replaced with a universal verified flag. |
| Existing public RPC and safe DTO | ID-D01/ID-T20, `0087_ui_redesign_flags_guest_read.sql:542-591`, `app\src\lib\onboarding\types.ts:237-245`. No private documents/payout/admin inputs or independent ID approval claim. |
| Existing deactivation guard and duties | ID-Q01/ID-T17, `0009_provider_onboarding.sql:695-711`, `app\app\provider-profile\index.tsx:70-77`. Keep guard/payload and qualify duty copy, no new states. |
| Money records/arithmetic and reference formats | MN/SV source tasks; original receipt snapshots and `NR-`/`QS-` IDs, commission/fees/tax/coin records are not cosmetic strings. |
| Existing booking/message subscriptions and controller extractions | SV-T03/CM-T05 and complete screen bodyPaths. One controller/refetch owner, not a second store, route engine or universal status model. |
| Product enquiry/RFQ, not product order/checkout | Completed marketplace `productOrder.applicability=not-present`; selection opens enquiry. No source-discovery task or new order engine remains. |
| Working support/domain/gateway/legal identity and user history | A.4.3/D05. Future approved nonlegal text only; no global string normalization or legal/bank replacement. |

---

## Appendix D. Before-state capture catalogue — historical and fresh evidence separated

### D.1 Provenance, actual coverage and limits

| Set | Verified provenance / coverage | NOT VERIFIED |
|---|---|---|
| Historical original catalogue | Run `44659967833`, code `3aa8f0af86b704070c28648f08ad707c91a04192`, 162 PNG names, originally 1179×1977 web captures. Complete original index below is retained unchanged. | Not current backend/flags/state proof, not native, not an after-state PASS. Earlier zero-test-failure metadata is historical and does not override the newer failed run. |
| Fresh archived before set | [before-web-44696642603.json](design/oorva/audit/before-web-44696642603.json): run `44696642603`, head `229995fe3194de39684f12ef348d3e37930ae5f2`, 162 PNG dimensions/hashes. Source diff to audit baseline changes only doc14. Completed review covered all nine contact sheets and identified actual captures. | Run conclusion is **failure**: three Home flag-coverage assertions. Screenshot name is not actual route/state/actor/PK/flag proof. Not current runtime success. |
| Actual direct screen observations | Each source report/placement record identifies viewed captures and its explicit limits. For example identity reports 10 opened images, directly covering S04/S09/S11/S42/S47/S64/S65; other owned states remain source-only. | Do not union filenames into “88 visually verified screens”. Notifications whitespace/native/large-text/gateway/each status still needs actual implementation evidence. |
| Ended-work contradiction | Fresh **`89-booking-fc7-awaiting-payment.png`** visibly shows the contradictory ended/payable context, independently tied to SV-F22/SV-T25 source. | **87/88 are not this finding's proof.** Their scenario filenames do not certify current quote state, and relabeling/reseeding is not a runtime fix. |

Use the published before JSON/source placement fields rather than local absolute paths. All after/native/large-text/keyboard/actor-interaction results are **NOT RUN / NOT VERIFIED** until their owning stage supplies actual evidence.

### D.2 Complete captured-file index

All names below have `.png` extension. They are the complete **historical** 162-name before inventory from run 44659967833, preserved verbatim. They are NOT current route/state proof or runtime PASS; after evidence remains pending implementation.

```text
01-login-help-link
02-login
03-verify
04-returning-provider-switch-to-customer
05-demo-data-indicator
06-archetype-inspect-quote-browse-and-quote
07-demo-address-for-booking
08-archetype-fixed-package-browse
09-archetype-fixed-package-book-mocked-payment
10-archetype-proposal-deliverables-and-milestones
11-archetype-time-session-and-pack
12-recurring-plan-skip-pause-resume-web
13-home-inspect-book-pay-visit-fee
14-home-recurring-plan-request
15-home-booking-cancel-copy
16-phase-7a-shop-and-product-browse
17-phase-7a-product-enquiry
18-phase-7a-rfq-create-and-details
19-phase-6-sports-booking-request
20-home
21-home-family-drilldown-and-marketplace-entry-points
22-home-top-rated
23-top-rated-see-all
24-location-picker
25-location-search-providers
26-location-add-address-sheet
27-location-pick-saved-home
28-category-ac-repair
29-category-electrician
30-category-plumber
31-category-house-cleaning
32-category-water-tank-cleaning
33-category-car-mechanic
34-category-bike-mechanic
35-category-appliance-repair
36-category-pest-control
37-category-carpenter
38-category-painter
39-category-instagram-influencer
40-category-youtube-creator
41-category-ugc-creator
42-category-reel-maker
43-category-wedding-photographer
44-category-candid-photographer
45-category-pre-wedding-shoot
46-category-maternity-newborn
47-category-product-photographer
48-category-event-videographer
49-category-drone-operator
50-category-photo-booth
51-category-caterer
52-category-decorator
53-category-bridal-makeup
54-category-mehendi-artist
55-category-dj
56-category-live-band
57-category-wedding-planner
58-category-demo-home-tutor
59-proposal-flow-pro-offers-reel-maker
60-phase-7a-owner-submits-shop
61-proposal-flow-customer-sends-brief
62-proposal-flow-pro-sends-proposal
63-proposal-flow-customer-compares
64-proposal-flow-accept-and-checkout
65-category-sort-sheet
66-category-sort-top-rated
67-category-filter-sheet
68-category-filter-applied
69-provider-detail
70-provider-detail-scrolled
71-provider-detail-fixed-service-routes-to-packages
72-book-screen
73-book-screen-ready
74-book-screen-scrolled
75-assistant-open-from-home
76-assistant-draft-or-busy-fallback
77-assistant-draft-scrolled
78-assistant-review-prefills-book
79-bookings-active
80-bookings-past
81-my-activity-requests-segment
82-my-activity-shop-segment
83-my-activity-sports-segment
84-my-activity-services-segment
85-booking-fc1-pending-payment
86-booking-fc3-start-code
87-booking-fc6-quote
88-booking-fc6-quote-scrolled
89-booking-fc7-awaiting-payment
90-booking-fc8-change-order
91-booking-fc8-change-order-scrolled
92-booking-fc9-end-otp
93-booking-fc10-review-form
94-booking-fc10-review-form-scrolled
95-booking-fc11-closed
96-booking-fc16-disputed
97-booking-fc3-cancel-copy
98-booking-chat-send
99-unread-badge-on-booking
100-unread-chat-divider
101-unread-cleared-after-reading
102-me-customer
103-coins-wallet
104-me-customer-scrolled
105-info-safety
106-dark-home
107-dark-category
108-dark-provider-detail
109-dark-booking-quote
110-dark-bookings
111-dark-location-picker
112-dark-me-customer
113-dark-home-top-rated
114-dark-top-rated-see-all
115-me-customer-again
116-switch-to-provider
117-dashboard-next-job
118-dashboard-scrolled
119-earnings
120-earnings-scrolled
121-provider-booking-fb1-request
122-provider-booking-fb3-accepted
123-provider-booking-fb6-completion-code
124-provider-booking-fb4
125-quote-editor-fb4
126-quote-editor-rate-card-pick
127-quote-editor-scrolled
128-job-history
129-onboarding-resume-review
130-provider-profile-hub
131-provider-profile-basics
132-provider-profile-services
133-provider-profile-area
134-provider-profile-hours
135-provider-profile-portfolio
136-provider-profile-payouts
137-provider-profile-preview
138-me-provider
139-provider-profile-editor-back-to-hub
140-me-provider-scrolled
141-dark-dashboard
142-dark-earnings
143-dark-quote-editor-fb4
144-dark-me-provider
145-dark-provider-booking-fb4
146-me-provider-light
147-logout-confirm
148-logout-login-screen
149-after-logout-deep-link
150-new-pro-login
151-new-pro-role
152-new-pro-basics
153-new-pro-services
154-new-pro-area
155-new-pro-hours
156-new-pro-portfolio
157-new-pro-payouts
158-new-pro-submit
159-new-pro-dashboard-status
160-new-pro-hub
161-phase-7a-admin-approves-submitted-shop
162-admin-feature-registry
```

---



---

## Appendix E. Original briefs, complete requirement coverage and unverified items

### E.1 Original requirements retained without future discovery

Original Oorva complete text export fingerprint: `89F2301E6BF8C5D53AF16FE93A80254FF19016217652A3528C8DEEE8C3AD32BB`. Critical complete 289-line export: `4B9F61F4D8E5C3324E6C144C7B80FF9DCCF692B3FF7AF815DB9920ADA863D91F`. These requirements are integrated here; they are not instructions to implement during this documentation task.

| Requirement | Fixed implementation ownership / verification |
|---|---|
| Complete all-route/body/navigation/role/status audit, actual problem vs retain | Completed seven reports/coverage, 88 screens+5layouts and 503 placements. O00 checks drift only; no audit worker is dispatched. |
| Current/historical before images and truthful issue register | C/D plus published audit/before manifests; staged actual-state after evidence and O37B completion matrix. |
| Warm premium local-marketplace Oorva, approved D teal/white/sand identity, exact tagline and labelled category accents | Doc19approved choice + A.1/A.4; existing stage owners apply ready tokens/artwork, not a new design task. |
| Genuine original custom lowercase mark/symbol/horizontal/stacked/mono/light/dark/native assets | Exact A.4.1 canvases/safe zones/densities/provenance and split authorship/export/actual selection/public rights gates. PNG exploration is not an SVG master. |
| Manrope heading/Inter body, 4-point spacing, rounded common icon family, realistic media | O01F/O05A/O06A/O06B/O08; preserve Inter/script fallback/Ionicons and actual photo facts, no invented assets/stock/ratings. |
| Central semantic light/dark/category typography/shape/elevation/component system | Existing theme/primitives extended, one identity/refresh/control API; no competing UI framework or mega-card/status engine. |
| Admin name/tagline/logo/promotions/colors/category/default theme; draft/preview/publish/history/rollback/audit | O03/O04/O10, strict A.3 schema/backend/asset/auth/CAS/recovery and actual private-PG/Storage/Edge tests. |
| Cache/offline/unknown config/failure/atomic updates and effective runtime OFF | O05F/O05A/O03; complete get_app_features/archetypes; flags independent of appearance; actual failure/parent fixtures. |
| Customer app: all auth/home/search/services/booking/recurring/shop/RFQ/sports/creator/account/rewards/help | Exact source stages + O13C/O14C/O16C/O19C/O21C/O36C, 88-row inventory, no leaf OFF composition leakage. |
| Provider/shop/venue/creator/manager/staff/admin experiences and current work priority | ID/SV/SP/MK/CM source stages; same canonical PK/actor matrix, no inferred owner permissions or mixed business names as keys. |
| Prominent contextual AI without duplicate home promo/FAB | MK-T19/O36-SAFETY/O36C; one search/AI hub and contextual alternatives, existing capability/tool scope unchanged. |
| Every requested card family, not uniform cards | H.4/coverage canonical 12 map and domain variants; O08 plus concrete family/source stages, actual data/roles/states. |
| Responsive devices/200% critical text/long names/full prices/keyboard/safe area/focus/reduced motion | O06A/O07A/source A fixes and every family; actual before/after/interaction manifests, not compile-only. |
| Native icon/adaptive/notification/splash/display/permissions separate from remote config | A.4/O33; preserve technical IDs, actual isolated profiles/canonical runtime; D07a and D07b. |
| Restrained opening reveal/native-identical first frame/auth/URL/notification intent/no replay | O34/A.4.4: 250/800/1000/2500ms caps, freeze D=0..1800, OS light/dark, symbol already present, actual guarded destination and LAUNCH-01..15. |
| Outbound receipts/support/AI/checkout/SQL consistency | ID/MN/CM display tasks + O35D/O35SQL; D05 contexts, no issuer/history/technical normalization or financial dependency on assets. |
| Parallel lower-model roadmap and deterministic integration | Sections 0–4, one JSON stage projection/task read, live ledger/locks, unique forward claims, explicit registration roundtrip, ≤4 compatible lane batches, owner-returned conflicts. |
| Tests/final implementation report/before-after completion matrix | Exact per-stage tests/section5/O37B; no test/native/gateway PASS fabricated in planning. |

### E.2 Open scope boundaries / not verified

| Item | Exact remaining evidence/permission |
|---|---|
| Implementation authorization | Future E0, not this doc request. |
| Ordinary main delivery and proposed assets helper availability | E1 scoped permission, actual O37A current-main integration and refreshed helper; branch tooling green is not current-main support. |
| Ready assets / public-native proof | Actual D SVG/PNG kit is supplied and independently checked. Public rights and actual native candidate/device/release evidence remain separate; no model drawing remains. |
| Public legal/outbound/issuer/bank/contact replacements | Exact per-context D05 approvals; retain operational/legal values absent verified replacement. No invented policy. |
| Native devices/signing/reachable non-prod backend/iOS | Actual platform D07a resources and signed compatible candidate evidence; no Expo Go substitute. |
| Native production cutover | D07b after O33 GREEN → explicitly approved O34 candidate stack; legacy maintenance/reinstall/channels recorded. |
| Source versus runtime coverage | Source audit complete; new app/device/large-text/keyboard/gateway/source-behavior tests **NOT RUN** by this documentation integration. |
| Historical status/money repair | None authorized; exact runtime compatibility specified. Any additional one-time live write needs separate per-PK preview/approval/audit/readback. |
| Remote push / live gateway / tax / business payout activation | Separate existing plan/owner gates; local route notifications/mocks/synthetic values do not prove these services. |

---

## Appendix F. References

- [Authoritative completed Critical audit](audit/18-Critical-Audit.md)
- [Machine-readable execution graph](design/oorva/execution-plan.json)
- [Completed coverage and card-family map](design/oorva/audit/coverage.json)
- [Fresh archived before manifest](design/oorva/audit/before-web-44696642603.json)


- [Oorva source brief](https://docs.google.com/document/d/135aI__QNEzRMcRYt7KYETyDyilcUbXJyj9yr4AmEg6M/edit)
- [Critical placement/status/role addendum](https://docs.google.com/document/d/15-dBB5V7nb6SeSg1TarjboLFO8GV5Y4rCLAvkhYP6ao/edit)
- [Historical coordination source after G-01 merge](https://github.com/sushruth5454/quickserve/tree/48a9a827b5fbf9c3d3a02978216484b1b109ff9f)
- [Expo SDK58 update identity/runtime API](https://docs.expo.dev/versions/v58.0.0/sdk/updates/)
- [Expo SDK58 notification assets](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/)
- [Android adaptive icon safe zones](https://developer.android.com/develop/ui/views/launch/icon_design_adaptive)
- [resvg remote SVG rasterizer](https://github.com/thx/resvg-js)
- [Historical original planning checkout](https://github.com/sushruth5454/quickserve/tree/8efb6d63a783d477918cf32b5069b85b500f48a5)
- [Existing UX execution plan](https://github.com/sushruth5454/quickserve/blob/8efb6d63a783d477918cf32b5069b85b500f48a5/docs/14-UI-Redesign-AI-Execution-Plan.md)
- [Existing functional remediation plan](https://github.com/sushruth5454/quickserve/blob/8efb6d63a783d477918cf32b5069b85b500f48a5/docs/17-Nearo-Audit-Remediation-Implementation-Plan.md)
- [Existing hosted E2E evidence](https://github.com/sushruth5454/quickserve/actions/runs/44659967833)
- [W3C text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- [Apple tab-bar guidance](https://developer.apple.com/design/human-interface-guidelines/tab-bars)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase bucket upload restrictions](https://supabase.com/docs/guides/storage/buckets/creating-buckets)
- [Expo SDK 58 splash-screen reference](https://docs.expo.dev/versions/v58.0.0/sdk/splash-screen/)
- [Expo SDK 58 native app configuration](https://docs.expo.dev/versions/v58.0.0/config/app/)
- [Expo native splash/icon testing guidance](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon)
- [Official Manrope font metadata and license declaration](https://github.com/google/fonts/blob/main/ofl/manrope/METADATA.pb)


---


- [Frozen completed-audit source 2f1e4638](https://github.com/sushruth5454/quickserve/tree/2f1e4638b145185b9e58c4c62e58f5c6dd491fa1)



## Appendix G. Opus review resolution ledger

Both requested Claude Opus 5.5 agents reviewed the prior 1,984-line plan at SHA256 `524C8EE341AC2BB1964EEFA9021D30FFA01B5FAB83D1C793FC3F89CBE1B6E4CC`: review READY WITH CONDITIONS; rubber-duck EXECUTABLE WITH CONDITIONS. The rows below are **plan amendments, not runtime fixes or a second agent approval**. Their implementation/tests remain with the exact stages below; old O06/O07 map to O06A+O06B/O07A, control-plane O05A maps to O05F, and font/final-asset splits now include O01X. These are owner aliases, never dispatchable aggregate prerequisites.

| Source ID | Amended contract/owner | Resolution / required verification |
|---|---|---|
| REV-01 | O06 / A.1.5 / UI-PRIMITIVES | Assign all four primitive files, semantic fills/foregrounds and usage tests. |
| REV-02 | O34 / A.4.4 / LAUNCH-01..15 | Define frames, phases, dark/zero/web/Expo/crash/watchdog/geometry. |
| REV-03 | O33 / A.4.5 / D07a-b | Isolate native delivery, guard legacy binaries, own iOS availability and approved cutover. |
| REV-04 | O01F-L / O05A-B / D03a-c | Separate fonts/foundation from final mark and public rights. |
| REV-05 | O01L / O37A / A.4.1 | Specify exact SVG/PNG/safe-zone/density/export authorship and remote tooling. |
| REV-06 | O35D / O35SQL / A.4.3 | Own future SQL/client copy and retain historical/legal contexts. |
| REV-07 | O37A / O03 / PG-PUBLISH | Provide actual two-connection runner, private job and owned feature test. |
| REV-08 | O37A / E2E-BRAND / Q-02 lock | Pin all OO OFF hosted; private positive pass and context-aware assertions. |
| REV-09 | O03 / O05A / A.3 | Preserve archetypes and legacy endpoint; one client/admin parent map. |
| DUCK-01 | O05A / A.3.4 / UI-CACHE | Flags independent of schema/assets; compatibility fallback and OFF override. |
| DUCK-02 | A.1.5 / O06-O08 / UI-CLASS-OFF | Classify A correctness, B identity and C family composition. |
| DUCK-03 | O33 / A.4.5 / NATIVE-IDENTITY | Isolated candidate code identity and coordinated runtime/reinstall policy. |
| DUCK-04 | D02 / A.4.4 / LAUNCH-11,12 | Bounded hydration/first-install bootstrap and no surprise late reveal. |
| DUCK-05 | O05A / merged G-01 / A.3.4 | Remove second root flag/network wait; one cache-first source. |
| DUCK-06 | A.3.1 / A.4.1,4 | OS-first theme precedence plus dark native/first-JS frame. |
| DUCK-07 | A.4.1,4 / O34 | Wordmark assets, geometry, bundled content, scaled motion and route settlement. |
| DUCK-08 | O00 / O01F-L / O05A-B / gates | No downstream-approval preflight cycle; explicit SVG author/tool. |
| DUCK-09 | O33 / O37A / D07a / LAUNCH-05 | Own iOS candidate path or NOT VERIFIED; local-notification route test, X2 separate. |
| DUCK-10 | A.3.2 / SQL-B09a | Recovery excludes newer soft limits, enforces hard safety/non-revocation. |
| DUCK-11 | 0.4 / 3.1 / 6.1 | Coordinate actual Q-02/Q-03/P2-01 write/lint locks. |
| DUCK-12 | A.4.1 / O33 | Name white-transparent notification icon and native color configuration. |
| DUCK-S1 | A.3.4 / A.4.3 / class OFF tests | Preserve mixed legacy brand per context rather than normalize it. |
| DUCK-S2 | O04 / A.3.2,3 | Short-lived authorized preview URL, audited revocation and honest cache limits. |
| DUCK-S3 | O11 / stage graph | Remove unnecessary editor-UI prerequisite from navigation. |

All 21 findings plus three suggestions are mapped. Current logo PNG exploration remains an unapproved input; native/SVG/animation completion is not inferred.

---



## Appendix H. Completed Critical entity, placement, actor and card contracts

### H.1 Completed canonical entity register

The source audit is complete, not a starter matrix for future workers. All **29** definitions below link to exact canonical fields/statuses/composites/transitions/actor/readback/source ranges in the published JSON. Use those rows plus the concrete implementation task; do not invent customer/creator/order/review lifecycle enums.

| Entity key | Applicability / actual keys | Canonical current state definition | Frozen source definition |
|---|---|---|---|
| `byoInvite` | present; byo_invites.id PK; unique token_hash; booking_id unique relation | Stored: open,claimed,cancelled; expired is derived from open+expires_at<=now, not another stored CHECK value. | [audit/platform.json](design/oorva/audit/platform.json), entities.key=`byoInvite` |
| `shop` | present; shops.id UUID PK; shops.owner_id UNIQUE FK profiles.id: one shop per actual owner; shop_categories PK(shop_id,category_id); business_members PK(owner_id,member_id), not a globally unique business name | draft; submitted; under_review; verified; rejected; suspended | [audit/marketplace.json](design/oorva/audit/marketplace.json), entities.key=`shop` |
| `product` | present; products.id UUID PK; shop_id/category_id FKs; product_images.id PK, path UNIQUE, product_id FK ON DELETE CASCADE; image sort_order 0..5; Product name/brand/model are not unique identity; product_enquiries.product_id nullable FK ON DELETE SET NULL, which interacts with its open-thread unique key | active=true,in_stock=true; active=true,in_stock=false; active=false,in_stock=any; deleted row | [audit/marketplace.json](design/oorva/audit/marketplace.json), entities.key=`product` |
| `productOrder` | not-present;  | N/A — no product-order model, route, table or workflow; do not create an order engine. | [audit/marketplace.json](design/oorva/audit/marketplace.json), entities.key=`productOrder` |
| `rfq` | present; rfqs.id UUID PK; customer_id/category_id FKs; rfq_items.id UUID PK; UNIQUE(rfq_id,seq); rfq_recipients PK(rfq_id,shop_id); rfqs UNIQUE(customer_id,idempotency_key) WHERE key IS NOT NULL, added in 0070; current createRfq calls v1 without a key | open; closed; expired; cancelled | [audit/marketplace.json](design/oorva/audit/marketplace.json), entities.key=`rfq` |
| `supplierQuote` | present; supplier_quotes.id UUID PK; rfq_id/shop_id FKs; UNIQUE(rfq_id,shop_id,version); Unique one sent per(rfq_id,shop_id); unique one selected per rfq_id; supplier_quote_items.id PK; UNIQUE(quote_id,rfq_item_id); RFQ item identity is not a product_id, brand name or assumed product equivalence | sent; withdrawn; selected; rejected; expired | [audit/marketplace.json](design/oorva/audit/marketplace.json), entities.key=`supplierQuote` |
| `enquiry` | present; product_enquiries.id UUID PK; Current one-open UNIQUE(shop_id,customer_id,coalesce(product_id,zero UUID)) WHERE status=open; product_id FK ON DELETE SET NULL; shop_id/customer_id FKs; product_enquiry_messages.id PK; enquiry_id/sender_id FKs; display names and product names are not keys | open; closed | [audit/marketplace.json](design/oorva/audit/marketplace.json), entities.key=`enquiry` |
| `serviceOffering` | present; provider_services.id UUID PK; UNIQUE(provider_id,category_id), not provider name/category name; service_packages.id UUID PK; provider_service_id FK permits multiple packages; categories.id UUID PK; slug unique; category_cities PK(category_id,city) controls launch geography | No service-offering status enum exists: service and package each have an independent active boolean.; archetype check: fixed,inspect_quote,proposal,time_based,remote. A remote-only location category can still use archetype=proposal; do not invent a separate remote booking engine.; price_type check: fixed,range,from,quote. Fixed requires positive price=price_min=price_max; range requires positive increasing min/max and no price; from requires positive min/no max; quote has no numeric prices.; package units: job,hour,day,session,person,plate,sqft,bhk,seat,litre,event,month; qty_min>0,qty_max>=qty_min; nullable positive duration_min.; skill_level: beginner,skilled,expert,certified; rate_unit: hour,job; travel_fee_mode: none,flat,per_km. | [audit/services.json](design/oorva/audit/services.json), entities.key=`serviceOffering` |
| `serviceBooking` | present; bookings.id UUID PK is the entity identity across customer, provider, calendar, recurring occurrence and admin projections.; provider_service_id/category_id/provider_id/customer_id/address_id are distinct FKs, not identity substitutes.; service_request_id and proposal_id are nullable FKs. Only one ACTIVE booking per service_request_id is indexed; multiple historical bookings for a request or proposal are possible after hold expiry.; approved_quote_id points to the activated quote; do not choose current scope by latest created quote alone. | pending_payment; requested; accepted; confirmed; en_route; inspecting; quote_sent; awaiting_payment; in_progress; delivery_pending; completion_requested; completed; closed; closed_no_work; declined; expired; cancelled; disputed; refunded | [audit/services.json](design/oorva/audit/services.json), entities.key=`serviceBooking` |
| `serviceRequest` | present; service_requests.id UUID PK; request_private.request_id PK/FK; this private extension is not a second booking; request_recipients PK(request_id,provider_id), UNIQUE(request_id,provider_service_id); open routing can target up to eight distinct providers; request_messages.id PK; thread scope is (request_id,provider_id), not request_id alone | open: proposals can be sent while unexpired and lead-time checks pass; closed: normally a proposal has been accepted into an unpaid booking hold; not automatically terminal; booked: proposal advance/platform obligations accepted by payment recorder; expired: request expiry reached without protected active booked work; cancelled: customer cancelled request; existing active booking is currently not checked by this RPC | [audit/services.json](design/oorva/audit/services.json), entities.key=`serviceRequest` |
| `bookingRequest` | present; Derived service booking-request projection: bookings.id, exposed as ProviderJob.booking_id. There is no separate service booking_requests table in this model.; Do not equate it with service_requests.id, travel_requests.id, proposal.id, sports_bookings.id or recurring_schedules.id.; An individual recurring occurrence can become requested after payment even though its plan was created much earlier. | pending_payment is excluded from provider job query and is not an incoming provider request.; requested is the actionable service request projection; accepted/declined/expired/cancelled are booking lifecycle outcomes, not separate rows.; confirmed belongs to proposal booking; delivery_pending belongs to proposal fulfillment. Neither is included in provider dashboard ACTIVE_PRIORITY.; Recurring plan-request acceptance is a separate active+pending plan card, not the requested booking countdown.; Travel approval uses independent pending\|approved\|declined\|expired\|used with its own expiry and service/window/location binding. | [audit/services.json](design/oorva/audit/services.json), entities.key=`bookingRequest` |
| `serviceQuote` | present; quotes.id UUID PK; UNIQUE(booking_id,version); quote_items.id UUID PK and quote_id FK; current approved scope is bookings.approved_quote_id; quote_type=itemized\|package; source_package_id and package_snapshot identify fixed base agreement, not human title | sent: customer decision needed, not approved scope; approved_pending_payment: approved but remaining required money not yet activated; approved: activated current scope after applicable due settlement; rejected: customer declined this offered quote; superseded: replaced or closed offered/previous approved scope; remains history | [audit/services.json](design/oorva/audit/services.json), entities.key=`serviceQuote` |
| `proposal` | present; proposals.id UUID PK; UNIQUE(request_id,provider_id,version); Partial UNIQUE(request_id,provider_id) only WHERE status=sent; proposal_items UNIQUE(proposal_id,seq); proposal_schedule UNIQUE(proposal_id,seq); booking.proposal_id is a foreign key, NOT UNIQUE. Hold expiry can reuse the same proposal for a newer booking. | sent: offered current version, but actual acceptability also depends on request open/expiry, valid_until, provider bookability, actor and no conflicting active booking; withdrawn: provider manager withdrew/replaced sent proposal; cannot accept; accepted: customer selected into booking hold; NOT proof advance paid; rejected: customer cancelled request or another proposal booking was funded; read-only history; expired: proposal validity elapsed, or hold expired after validity; request expiry is separately represented | [audit/services.json](design/oorva/audit/services.json), entities.key=`proposal` |
| `review` | present; reviews.id UUID PK; reviews.booking_id UNIQUE FK: at most one review per booking, not a review per provider/customer pair; customer_id/provider_id set from locked booking by submit_review, never trusted from client | Absent + eligible: own completed/closed booking, nonnull total_amount, _paid_total(booking.id)>=total_amount and no existing review.; Absent + ineligible: every other actor/status/payment predicate; render reason/no submission action, not an invented Pending review state.; Present: submitted review is readable; repeat submit rejected by both guard and booking_id unique key. Existing provider_reply column is not evidence of a provider reply action in assigned UI. | [audit/services.json](design/oorva/audit/services.json), entities.key=`review` |
| `recurringPlan` | present; recurring_schedules.id UUID PK; client calls it plan.id.; customer_id/provider_id/provider_service_id/service_package_id and optional pack_purchase_id are separate FKs; a plan has many bookings and many change rows.; Plan does not have a one-to-one occurrence or payment relationship. | active+pending+plan: provider decision outstanding; no materialized v2 visits yet; expires after72h without response.; active+accepted+plan: provider accepted plan; paid fixed/session occurrences autoaccept after requested transition.; active+accepted+occurrence: per-visit acceptance; create/materialize can occur immediately without plan decision.; paused: accepted plan stopped for generation; eligible future unpaid pending_payment rows beyond skip cutoff cancelled, paid/in-progress visits retained.; cancelled: customer cancelled, provider declined or pending72h expired; actual remaining bookings retain their own terminal/payment state.; completed: generation/end/count condition satisfied without FUTURE open bookings under materializer predicate; it does not prove all historical work/refunds/payouts resolved. | [audit/services.json](design/oorva/audit/services.json), entities.key=`recurringPlan` |
| `recurringOccurrence` | present; A generated occurrence is bookings.id with recurring_schedule_id FK; there is no separate recurring_occurrences status table.; UNIQUE(recurring_schedule_id,scheduled_at) for nonnull schedule; rescheduling changes scheduled_at, preserves booking PK.; recurring_occurrence_changes.id UUID PK; schedule_id plus occurrence_date/kind is only partially unique for skipped/provider_unavailable; booking_id may be null for unavailable dates.; Pending reschedule outcome identity is (booking_id,occurrence_date,original_at,new_at), not a 1:1 request/date mapping. | No booking yet + provider_unavailable ledger row: generation skipped a date, not an expired/cancelled booking row.; pending_payment: reserved occurrence awaiting its actual payment window; generic15m requested expiry does not apply.; requested: paid per-occurrence acceptance work; accepted plan mode may immediately preaccept it.; accepted/en_route/in_progress/completion_requested: actual fixed/session booking flow, not new occurrence statuses.; completed/closed/cancelled/declined/expired/refunded/disputed: retain actual booking outcomes; time partition must not hide a past open or future ended row.; reschedule_requested/rescheduled/reschedule_declined are change-ledger kinds, NOT booking statuses. | [audit/services.json](design/oorva/audit/services.json), entities.key=`recurringOccurrence` |
| `customer` | present; profiles.id is the PK and FK to auth.users.id, not phone/full_name.; private_user_accounts.user_id holds private phone/push context separately.; account_deletion_requests.id is a separate request PK; one pending request per user_id is enforced by a partial unique index. | No universal customer status enum exists in the inspected model.; Guest versus authenticated session is an auth/session boundary, not a persisted customer status.; role_customer and role_provider can coexist; neither creates a creator/merchant/admin authorization role.; Deletion request lifecycle is pending\|done\|rejected, separate from the profile remaining present.; Wallet earning/redemption flags are independent policy capabilities, not account suspension. | [audit/identity.json](design/oorva/audit/identity.json), entities.key=`customer` |
| `businessMembership` | present; business_members PK is (owner_id, member_id), each FK to profiles.id; owner_id<>member_id.; The actual owner is implicit when p_owner_id=auth.uid; it is not represented by a self-membership row.; A read-projection business_type provider\|shop\|sports is not part of the membership PK.; Provider business uses providers.id, shop uses shops.id with unique owner_id, venue uses sports_venues.id and multiple rows may share owner_id. Current membership projection omits these business IDs (ID-F10). | Active or inactive membership is the persisted lifecycle.; role schema values owner\|manager\|staff; public add_business_member accepts manager\|staff only.; Owner identity is implicit; existing schema's owner role must not be silently removed or newly made selectable.; Disabled merchant_staff makes delegated _acts_for false and _business_role null, but does not stop actual owner's access.; No invitation acceptance, phone lookup, creator-role grant or per-venue membership state is present. | [audit/identity.json](design/oorva/audit/identity.json), entities.key=`businessMembership` |
| `serviceProvider` | present; providers.id PK/FK profiles.id; own user and provider share this PK.; provider_services.id PK with unique(provider_id,category_id); service label/category display name is not an identity.; provider_documents.id PK; scope is provider_id,doc_type,nullable category_id, with multiple historical submissions.; provider_payout_accounts.provider_id PK, now FK profiles.id after 0058; also used by verified venue owners. A payout row is not evidence that the user is a service provider.; provider_availability.id, provider_time_off.id, provider_portfolio.id and provider_links.id are separate records linked to provider_id. | Setup draft means submitted_at is null; create/save steps do not imply approved/live.; Readiness precedence is deactivated_at -> deactivated; suspended -> suspended; unsubmitted -> draft; _provider_is_live -> live; any action reason -> action_needed; otherwise under_review.; Live eligibility is independent of online and paused flags. A live provider may be paused; actual public search/booking imposes additional category/city/archetype/paused/time predicates.; Document status is raw submission state plus effective unexpired validity in provider-local date, not a provider-wide status.; Payout verified and admin approved are independent and both necessary for base live eligibility; document compliance is per service category.; Admin approval and gateway callback do not erase each other's result. Suspension/deactivation and holiday availability are separate dimensions. | [audit/identity.json](design/oorva/audit/identity.json), entities.key=`serviceProvider` |
| `creator` | present; Creator/freelancer is a provider persona: providers.id/profile ID, active provider_services.id and its categories.id/archetype.; Admin is_creator is exists(active provider service joined to category archetype='proposal'). It includes proposal-enabled professionals; it is not a new auth role or creator PK.; Portfolio/link/package/proposal/booking records keep their existing IDs; no identity alias may replace those IDs in cross-role comparisons. | Persona inferred from actual active proposal services, not a creator auth-state enum.; The same provider draft/under_review/action_needed/live/suspended/deactivated readiness applies.; A public portfolio link's approved/pending/rejected submission and verified_method none\|oauth\|dns\|manual are separate from account eligibility.; Confirmed and delivery_pending work must not disappear from the provider workspace just because the owner dashboard was authored for inspect-quote work. | [audit/identity.json](design/oorva/audit/identity.json), entities.key=`creator` |
| `sportsVenue` | present; sports_venues.id: UUID PK; owner_id references profiles.id and is not unique; sports_resources.id: UUID PK; venue_id is FK, not the resource name; sports_activities.id: UUID PK; slug has a unique constraint; business_members PK is (owner_id, member_id), not venue_id; one owner/membership may cover multiple venues | draft; submitted; verified; rejected; suspended | [audit/sports.json](design/oorva/audit/sports.json), entities.key=`sportsVenue` |
| `sportsBooking` | present; sports_bookings.id UUID PK; customer_id, venue_id and resource_id are FKs; venue/resource names are not identity; Partial unique index on (customer_id,idempotency_key) where key IS NOT NULL; payments.id UUID PK with sports_booking_id FK; at most one created attempt per sports booking by partial unique index; payouts.sports_booking_id is unique; not a new order entity | pending_payment; requested; awaiting_payment; accepted; declined; cancelled; completed; expired | [audit/sports.json](design/oorva/audit/sports.json), entities.key=`sportsBooking` |
| `sportsSlot` | present; There is no persisted sports_slots table in this lifecycle. A slot is generated from a resource id and an IST date/opening schedule; current client uses starts_at within the selected resource/date list as its cell key.; Resource PK is sports_resources.id; schedule PK is sports_hours(venue_id,weekday); price/block records use their own UUID PKs.; Booking periods may span several slots; resource/start is not a unique booking key for capacity>1. | free; taken; blocked; past | [audit/sports.json](design/oorva/audit/sports.json), entities.key=`sportsSlot` |
| `payment` | present; public.payments.id UUID primary key; razorpay_link_id and razorpay_payment_id are individually unique nullable gateway identifiers; neither the display QS reference nor a customer's name is a PK.; Exactly one parent is nonnull: booking_id, pack_purchase_id, sports_booking_id.; payment_obligations has composite PK (payment_id,schedule_id); a single captured payment may settle multiple due schedule rows. | created; paid; failed; refund_pending; refund_processing; refunded | [audit/money.json](design/oorva/audit/money.json), entities.key=`payment` |
| `refund` | present; public.refunds.id UUID primary key; payment_id references the actual payments.id; many refund PKs may belong to one payment.; razorpay_refund_id is individually unique nullable.; refund_gateway_status_events has composite PK (razorpay_refund_id,status), with status processed\|failed; this is event deduplication, not a universal monotonic state machine. | pending; processing; refunded; failed | [audit/money.json](design/oorva/audit/money.json), entities.key=`refund` |
| `payout` | present; public.payouts.id UUID primary key; booking_id is nullable unique; sports_booking_id is nullable unique; exactly one is nonnull.; provider_id and payee_id identify recipients, not payout PKs. CHECK coalesce(provider_id,payee_id) IS NOT NULL is not an XOR between the recipient fields.; A payout can have multiple payout_transfers; a source payment can fund multiple session payouts. | pending; frozen; transferred; failed; reversed; partially_reversed; demo | [audit/money.json](design/oorva/audit/money.json), entities.key=`payout` |
| `transfer` | present; Actual table is public.payout_transfers; id UUID primary key.; payout_id references payouts.id; source_payment_id references payments.id. Neither link is unique: multiple tranches and shared pack sources are supported.; razorpay_transfer_id text unique nullable stores a Route transfer or RazorpayX payout external ID; netted_ synthetic IDs are possible.; RazorpayX automatic retry idempotency key is transfer UUID + ':' + idempotency_seq; Route retry matching uses source payment and notes.transfer_id. | pending; processing; transferred; failed; reversal_pending; reversed; partially_reversed | [audit/money.json](design/oorva/audit/money.json), entities.key=`transfer` |
| `notification` | present; public.notifications.id UUID is the real primary key.; The partial unique key (user_id, collapse_key) applies only while status='pending' and collapse_key IS NOT NULL; collapse_key is not a permanent event identifier.; NotificationItem.key='chat:'+booking_id is a derived per-booking presentation key, not a notification PK.; public.booking_chat_reads has composite primary key (booking_id,user_id), independently of notification rows. | Delivery state: pending, sending, sent, failed, skipped. These are push/outbox lifecycle values, not booking/payment states.; Non-chat presentation read state: read_at IS NULL => unread; otherwise read.; Chat presentation read state: get_unread_counts/booking_chat_reads, irrespective of a chat notification's read_at or delivery status.; Navigability is separate: validated route or null. A read notification with no route is disabled; an unread no-route row can still be acknowledged.; Derived chat aggregate uses the latest event row per booking and authoritative chat unread, not the notification's count. | [audit/communications.json](design/oorva/audit/communications.json), entities.key=`notification` |
| `supportThread` | present; support_threads.id UUID is the real thread PK.; support_messages.id UUID is the message PK; thread_id is the FK, not the message identity.; user_id is the personal thread owner, not a provider/business id.; booking_id is optional context, ON DELETE SET NULL, not a uniqueness key. Multiple/historical threads may refer to a booking.; No database uniqueness of (user_id,booking_id,status) is defined; sequential open-thread reuse is not a concurrent uniqueness guarantee. | open; closed | [audit/communications.json](design/oorva/audit/communications.json), entities.key=`supportThread` |

`productOrder=not-present` is source-proven N/A. A gateway “order” is payment infrastructure, not authorization for a product cart/order engine. Creator is a provider service/archetype, not a new auth role. Human names are not unique business/entity keys.

Independent provider readiness/document/payout/admin/live facts stay distinct. Public customers consume safe existing projections; do not fetch private account/document/admin fields to recompute status. ID-D01/ID-T20 public badge wording and ID-Q01 deactivation preservation are resolved, not unanswered audit questions.

### H.2 Completed placement analysis, not a future audit deliverable

All **503** rows already record element/current/problem-or-retain/target/reason/source/test across all 88 screens. Published `coverage.json.placements` is the index; each report contains full screen hierarchy/bodyPaths/placements. Workers bind the existing placement IDs to actual before/after/interaction evidence and implement exact targets. Do not send “investigate actual states later”, write duplicate lifecycle/placement JSON or require O38I/B/P/S/M/C/X audit stages.

Retain correct current behavior and honest source-only visual limits. Important actions/requests precede secondary content; notifications show actual event provenance/context/next action rather than speculative whitespace; verified/reviewed actions disappear/change under current backend policy; safe full listings show only real relevant attributes.

### H.3 Completed same-PK actor/action matrix and concrete tests

| Workflow | Actual actor/read boundary | Required implementation evidence |
|---|---|---|
| Provider/document/readiness | Owner/admin/public use different permitted projections; KYC/account shape is not independent document/admin/live approval. | ID-T01/05/07/11/20 exact cases, same provider PK, existing safe public RPC unchanged. |
| Shop/venue review | Real owner/delegated member/admin/customer permissions and actual review states. | MK-T01/02/03 and SP-T01/02/03/04/16; actual same entity reads/confirmation/mutation/refetch, no redundant Verify/downgrade. |
| Request/proposal/booking/delivery | Customer/provider owner/manager/staff/admin are not inferred from isCustomer=false; family/hold/time/payment/delivery predicates remain domain-specific. | O21-READ/O22-DELIVERY/O16-CAP/SV quote/hold/recurring/request tests and named PG interleavings. |
| Sports hold/approval/payment/cancel | Actual customer payer/venue owner/authorized read-only staff, configured cutoff and current due state. | SP-T05/06/07/08/09/10/11/12; current existing obligation still safely resolves with acquisition OFF. |
| RFQ/supplier/enquiry | Customer/actual selected shop/active member scope; stable real PK/context, no commercial order transition. | MK-T04/05/06/07/17/18/25/26, full warnings before action, separate PG concurrency. |
| Money/review | Captured versus submitted/processed/refunded, recorded transfer versus bank settlement, original receipt versus current overlay, exact review eligibility. | MN all named current-chain/Edge/host tests; SV-T13; exact paise and actual child rows, no local success proxy. |
| Notification/support/chat | Event versus transport timestamp, recipient/member permissions, persistent read ack/private body/masked preview. | O24-NOTIFICATIONS/CM-T03/04/05/07; source provenance and cross-role readback without new remote staff-push claim. |

Mutation rejection shows the actual error and triggers canonical refresh; no success toast/local forced state. Unknown/missing/stale values never authorize. One workflow compares the same PK across actors; separate scenarios have independent fixtures.

### H.4 All twelve required card families plus domain variants

The canonical map is `coverage.json.canonicalCardFamilies`, not the raw count of stream-specific template records. Identity readiness/document/member/invite/wallet cards are additional domain variants, not substitutes for these twelve.

| Required family | Completed source template(s) | Information/action contract |
|---|---|---|
| service | marketplace `service` | Category/package title, inclusion/unit/duration, actual price/type/provider; current archetype-specific choose/book/request, detail secondary. |
| serviceProvider | marketplace `provider` | Full name/service, safe precise trust/rating/locality, fee/unit/current availability; correct Book/Schedule/Request route. |
| shop | marketplace `shop` | Stable media, name/category/location/current verification and supported fulfilment; catalogue/enquire, no checkout. |
| product | marketplace `product` | Square image/full name, indicative unit/date/price, true stock/shop/spec essentials; detail/enquire, RFQ secondary. |
| sportsVenue | sports `sportsVenue` | Actual image/activity/locality/venue review/facilities/price basis; availability and details. |
| creator | marketplace `creator` | Real portfolio/placeholder, speciality/trust/actual package; profile/brief, no invented samples. |
| booking | services `booking` **and sports `sportsBooking`** | Domain-specific status/party/schedule/location/actual due/next action; details, history/receipt contextual. Never translate every domain to universal confirmed/paid. |
| bookingRequest | services `bookingRequest` | Current request/customer/scope/deadline/area, server-supplied earning facts; eligible actual owner response, confirmed destructive secondary. |
| notification | communications `notification` | What/when/meaning/context/unread/valid destination; legacy creation-time provenance not invented latest event. Read state never mutates booking status. |
| rfq | marketplace `rfq` | Title/category/date/location/actual parent outcome/item and quote progress; compare/outcome/cancel only if current server permits. |
| supplierQuote | marketplace `supplierQuote` | Shop/current quote/validity/exact total/tax/delivery/coverage/spec warnings; choose only when current eligibility permits. |
| transaction | money `transaction` | Kind/reference/exact amount/current processing or recorded settlement facts/time; detail/receipt, separate authorized retry. |

Each exact source template includes image/title/status/price/metadata/action/loading/no-image/empty/error/responsive cases. O08 supplies compatible shared presentation props; domain authors implement these exact variants. Full decisive labels/terms/amounts reflow at320/200%; one dominant primary action, no fake attributes.

### H.5 Root-cause implementation and nine-group traceability

| Critical group | Completed input | Concrete execution |
|---|---|---|
| CA-01 hierarchy/placement | All screen purpose/order/503 element rows | Exact source stage targets; A safety vs C composition; before/after evidence binding, no rediscovery. |
| CA-02 status truth |29 entity definitions and latest read/write/actor matrices | Narrow SQL/DTO/typed presenter fixes and direct allow/deny tests, not CSS-only hiding. |
| CA-03 role consistency | Same-PK workflow/action/privacy cases | Actual authorized projections, server guards, common epochs/readback and shared truthful labels. |
| CA-04 twelve templates |Canonical 12-family map + domain variants | O08 + named family owners, no mega-card/status/order engine. |
| CA-05 screen analysis |88screen+5layout completed audit | Exact host/owned file scope; capture missing visual states, not future source audit. |
| CA-06 action priority |Concrete primary/secondary/destructive/current-state source rows | Correct actor/state/pending action placement, completed-action replacement and confirmations. |
| CA-07 root causes |Shared controls/status/helper/readback/privacy evidence | O05F/O38R/shared typed core and exact narrow SQL, no three competing refresh frameworks. |
| CA-08 evidence |Historical/fresh archived manifests and explicit source-only limits | Real implementation before→after→interaction→other-role proof; no filename-as-state or compile-only completion. |
| CA-09 acceptance |Named exact cases across all source task cards | Per-stage Codespace/CI/private PG/E2E/native tests, real gates and O37B matrix. |

---

## Appendix I. Exact thin-host extraction and test import allocation

Only inline route bodies listed here are moved. Existing BookScreen/BookingDetailScreen/ProviderProfile/Activity/Dashboard/SportsManagement/SupportConversation and other extracted components remain the one real feature body/controller. The first writer moves its existing inline implementation mechanically, preserving behavior, before applying its audited repair. Later writers use the same host. Tests import host/pure model, **never Expo route files**; private E2E validates route wiring.

| Screen | Existing thin route after extraction | Exact testable feature host / one controller | Sole first writer |
|---|---|---|---|
| S01 | `app\app\(auth)\login.tsx` | `app\src\features\platformScreens\AuthLoginScreen.tsx` / `useAuthLoginController (one function inside this host)` | `O13C` |
| S02 | `app\app\(auth)\role.tsx` | `app\src\features\platformScreens\AuthRoleScreen.tsx` / `useAuthRoleController (one function inside this host)` | `O13-AUTH` |
| S03 | `app\app\(auth)\verify.tsx` | `app\src\features\platformScreens\AuthVerifyScreen.tsx` / `useAuthVerifyController (one function inside this host)` | `O13-AUTH` |
| S08 | `app\app\(provider)\business-tools.tsx` | `app\src\features\identityScreens\ProviderBusinessToolsScreen.tsx` / `useProviderBusinessToolsController (one function inside this host)` | `O28-ID10` |
| S10 | `app\app\(provider)\earnings.tsx` | `app\src\features\moneyScreens\ProviderEarningsScreen.tsx` / `useProviderEarningsController (one function inside this host)` | `O32-MN09` |
| S12 | `app\app\admin\ai.tsx` | `app\src\features\communicationScreens\AdminAiScreen.tsx` / `useAdminAiController (one function inside this host)` | `O31-CM14` |
| S13 | `app\app\admin\audit.tsx` | `app\src\features\moneyScreens\AdminAuditScreen.tsx` / `useAdminAuditController (one function inside this host)` | `O32-MN09` |
| S14 | `app\app\admin\booking\[id].tsx` | `app\src\features\moneyScreens\AdminBookingDetailScreen.tsx` / `useAdminBookingDetailController (one function inside this host)` | `O32-MN07` |
| S15 | `app\app\admin\bookings.tsx` | `app\src\features\moneyScreens\AdminBookingsScreen.tsx` / `useAdminBookingsController (one function inside this host)` | `O32-MN08` |
| S16 | `app\app\admin\category\[id].tsx` | `app\src\features\communicationScreens\AdminCategoryDetailScreen.tsx` / `useAdminCategoryDetailController (one function inside this host)` | `O31-CM08` |
| S17 | `app\app\admin\coins.tsx` | `app\src\features\moneyScreens\AdminCoinsScreen.tsx` / `useAdminCoinsController (one function inside this host)` | `O32-MN09` |
| S18 | `app\app\admin\commission.tsx` | `app\src\features\moneyScreens\AdminCommissionScreen.tsx` / `useAdminCommissionController (one function inside this host)` | `O32-MN09` |
| S19 | `app\app\admin\documents.tsx` | `app\src\features\identityScreens\AdminDocumentsScreen.tsx` / `useAdminDocumentsController (one function inside this host)` | `O30-ID11` |
| S20 | `app\app\admin\features.tsx` | `app\src\features\communicationScreens\AdminFeaturesScreen.tsx` / `useAdminFeaturesController (one function inside this host)` | `O31-CM09` |
| S21 | `app\app\admin\fees.tsx` | `app\src\features\moneyScreens\AdminFeesScreen.tsx` / `useAdminFeesController (one function inside this host)` | `O32-MN09` |
| S22 | `app\app\admin\geography.tsx` | `app\src\features\communicationScreens\AdminGeographyScreen.tsx` / `useAdminGeographyController (one function inside this host)` | `O31-CM10` |
| S23 | `app\app\admin\index.tsx` | `app\src\features\communicationScreens\AdminIndexScreen.tsx` / `useAdminIndexController (one function inside this host)` | `O30-CM07` |
| S24 | `app\app\admin\payouts.tsx` | `app\src\features\moneyScreens\AdminPayoutsScreen.tsx` / `useAdminPayoutsController (one function inside this host)` | `O32-MN08` |
| S25 | `app\app\admin\people.tsx` | `app\src\features\identityScreens\AdminPeopleScreen.tsx` / `useAdminPeopleController (one function inside this host)` | `O30-ID11` |
| S26 | `app\app\admin\refunds.tsx` | `app\src\features\moneyScreens\AdminRefundsScreen.tsx` / `useAdminRefundsController (one function inside this host)` | `O32-MN04` |
| S27 | `app\app\admin\rfqs.tsx` | `app\src\features\marketplaceScreens\AdminRfqsScreen.tsx` / `useAdminRfqsController (one function inside this host)` | `O18-MK15` |
| S28 | `app\app\admin\rules.tsx` | `app\src\features\communicationScreens\AdminRulesScreen.tsx` / `useAdminRulesController (one function inside this host)` | `O31-CM11` |
| S29 | `app\app\admin\services.tsx` | `app\src\features\communicationScreens\AdminServicesScreen.tsx` / `useAdminServicesController (one function inside this host)` | `O31-CM08` |
| S30 | `app\app\admin\shops.tsx` | `app\src\features\marketplaceScreens\AdminShopsScreen.tsx` / `useAdminShopsController (one function inside this host)` | `O18-MK15` |
| S31 | `app\app\admin\sports.tsx` | `app\src\features\sportsScreens\AdminSportsScreen.tsx` / `useAdminSportsController (one function inside this host)` | `O09-SP02` |
| S33 | `app\app\admin\support\index.tsx` | `app\src\features\communicationScreens\AdminSupportIndexScreen.tsx` / `useAdminSupportIndexController (one function inside this host)` | `O24-CM03` |
| S34 | `app\app\assistant-history.tsx` | `app\src\features\platformScreens\AssistantHistoryScreen.tsx` / `useAssistantHistoryController (one function inside this host)` | `O36-SAFETY` |
| S35 | `app\app\assistant.tsx` | `app\src\features\platformScreens\AssistantScreen.tsx` / `useAssistantController (one function inside this host)` | `O15-SV10` |
| S37 | `app\app\book-fixed\[providerServiceId].tsx` | `app\src\features\serviceScreens\BookFixedDetailScreen.tsx` / `useBookFixedDetailController (one function inside this host)` | `O15-SV15` |
| S39 | `app\app\byo\[token].tsx` | `app\src\features\platformScreens\ByoDetailScreen.tsx` / `useByoDetailController (one function inside this host)` | `O13-BYO` |
| S40 | `app\app\category\[slug].tsx` | `app\src\features\marketplaceScreens\CategoryDetailScreen.tsx` / `useCategoryDetailController (one function inside this host)` | `O12-MK16` |
| S41 | `app\app\chat\[bookingId].tsx` | `app\src\features\communicationScreens\ChatDetailScreen.tsx` / `useChatDetailController (one function inside this host)` | `O24-CM05` |
| S42 | `app\app\coins.tsx` | `app\src\features\identityScreens\CoinsScreen.tsx` / `useCoinsController (one function inside this host)` | `O23-ID12` |
| S44 | `app\app\earnings-statement.tsx` | `app\src\features\moneyScreens\EarningsStatementScreen.tsx` / `useEarningsStatementController (one function inside this host)` | `O32-MN09` |
| S45 | `app\app\enquiry\[id].tsx` | `app\src\features\marketplaceScreens\EnquiryDetailScreen.tsx` / `useEnquiryDetailController (one function inside this host)` | `O18-MK04` |
| S46 | `app\app\info\[topic].tsx` | `app\src\features\identityScreens\InfoDetailScreen.tsx` / `useInfoDetailController (one function inside this host)` | `O23-ID13` |
| S47 | `app\app\jobs.tsx` | `app\src\features\identityScreens\JobsScreen.tsx` / `useJobsController (one function inside this host)` | `O25-ID08` |
| S48 | `app\app\location.tsx` | `app\src\features\platformScreens\LocationScreen.tsx` / `useLocationController (one function inside this host)` | `O13-LOCATION` |
| S49 | `app\app\merchant-calendar.tsx` | `app\src\features\serviceScreens\MerchantCalendarScreen.tsx` / `useMerchantCalendarController (one function inside this host)` | `O21-SV04` |
| S50 | `app\app\merchant-enquiries.tsx` | `app\src\features\marketplaceScreens\MerchantEnquiriesScreen.tsx` / `useMerchantEnquiriesController (one function inside this host)` | `O18-MK04` |
| S51 | `app\app\merchant-job\[id].tsx` | `app\src\features\identityScreens\MerchantJobDetailScreen.tsx` / `useMerchantJobDetailController (one function inside this host)` | `O25-ID09` |
| S52 | `app\app\merchant-rfqs.tsx` | `app\src\features\marketplaceScreens\MerchantRfqsScreen.tsx` / `useMerchantRfqsController (one function inside this host)` | `O18-MK04` |
| S53 | `app\app\merchant-shop.tsx` | `app\src\features\marketplaceScreens\MerchantShopScreen.tsx` / `useMerchantShopController (one function inside this host)` | `O12-MK10` |
| S54 | `app\app\merchant-staff.tsx` | `app\src\features\identityScreens\MerchantStaffScreen.tsx` / `useMerchantStaffController (one function inside this host)` | `O28-ID10` |
| S55 | `app\app\merchant-work.tsx` | `app\src\features\identityScreens\MerchantWorkScreen.tsx` / `useMerchantWorkController (one function inside this host)` | `O28-ID10` |
| S56 | `app\app\notifications.tsx` | `app\src\features\communicationScreens\NotificationsScreen.tsx` / `useNotificationsController (one function inside this host)` | `O24-NOTIFICATIONS` |
| S57 | `app\app\onboarding.tsx` | `app\src\features\identityScreens\OnboardingScreen.tsx` / `useOnboardingController (one function inside this host)` | `O26-ID05` |
| S58 | `app\app\product\[id].tsx` | `app\src\features\marketplaceScreens\ProductDetailScreen.tsx` / `useProductDetailController (one function inside this host)` | `O18-MK15` |
| S59 | `app\app\products.tsx` | `app\src\features\marketplaceScreens\ProductsScreen.tsx` / `useProductsController (one function inside this host)` | `O12-MK10` |
| S60 | `app\app\proposal\[id].tsx` | `app\src\features\serviceScreens\ProposalDetailScreen.tsx` / `useProposalDetailController (one function inside this host)` | `O21-READ` |
| S61 | `app\app\proposal\compose\[requestId].tsx` | `app\src\features\serviceScreens\ProposalComposeDetailScreen.tsx` / `useProposalComposeDetailController (one function inside this host)` | `O21-READ` |
| S62 | `app\app\proposal-delivery\[id].tsx` | `app\src\features\serviceScreens\ProposalDeliveryDetailScreen.tsx` / `useProposalDeliveryDetailController (one function inside this host)` | `O16-CAP` |
| S64 | `app\app\provider-profile\[section].tsx` | `app\src\features\identityScreens\ProviderProfileDetailScreen.tsx` / `useProviderProfileDetailController (one function inside this host)` | `O26-ID05` |
| S65 | `app\app\provider-profile\index.tsx` | `app\src\features\identityScreens\ProviderProfileIndexScreen.tsx` / `useProviderProfileIndexController (one function inside this host)` | `O26-ID05` |
| S66 | `app\app\quote\[bookingId].tsx` | `app\src\features\serviceScreens\QuoteDetailScreen.tsx` / `useQuoteDetailController (one function inside this host)` | `O22-SV02` |
| S67 | `app\app\receipt\[paymentId].tsx` | `app\src\features\moneyScreens\ReceiptDetailScreen.tsx` / `useReceiptDetailController (one function inside this host)` | `O16-MN06` |
| S68 | `app\app\recurring\[id].tsx` | `app\src\features\serviceScreens\RecurringDetailScreen.tsx` / `useRecurringDetailController (one function inside this host)` | `O17-PLAN` |
| S69 | `app\app\recurring\new\[providerServiceId].tsx` | `app\src\features\serviceScreens\RecurringNewDetailScreen.tsx` / `useRecurringNewDetailController (one function inside this host)` | `O17-PLAN` |
| S70 | `app\app\recurring\provider\[id].tsx` | `app\src\features\serviceScreens\RecurringProviderDetailScreen.tsx` / `useRecurringProviderDetailController (one function inside this host)` | `O17-PLAN` |
| S71 | `app\app\request\[id].tsx` | `app\src\features\serviceScreens\RequestDetailScreen.tsx` / `useRequestDetailController (one function inside this host)` | `O21-READ` |
| S72 | `app\app\request\new.tsx` | `app\src\features\serviceScreens\RequestNewScreen.tsx` / `useRequestNewController (one function inside this host)` | `O21-SV19` |
| S73 | `app\app\rfq\[id].tsx` | `app\src\features\marketplaceScreens\RfqDetailScreen.tsx` / `useRfqDetailController (one function inside this host)` | `O18-MK04` |
| S74 | `app\app\rfq\merchant\[id].tsx` | `app\src\features\marketplaceScreens\RfqMerchantDetailScreen.tsx` / `useRfqMerchantDetailController (one function inside this host)` | `O18-MK04` |
| S75 | `app\app\rfq\new.tsx` | `app\src\features\marketplaceScreens\RfqNewScreen.tsx` / `useRfqNewController (one function inside this host)` | `O18-MK15` |
| S76 | `app\app\shop\[id].tsx` | `app\src\features\marketplaceScreens\ShopDetailScreen.tsx` / `useShopDetailController (one function inside this host)` | `O18-MK15` |
| S77 | `app\app\shop\index.tsx` | `app\src\features\marketplaceScreens\ShopIndexScreen.tsx` / `useShopIndexController (one function inside this host)` | `O18-MK04` |
| S78 | `app\app\sports\[activity].tsx` | `app\src\features\sportsScreens\SportsDetailScreen.tsx` / `useSportsDetailController (one function inside this host)` | `O09-SP09` |
| S79 | `app\app\sports\bookings.tsx` | `app\src\features\sportsScreens\SportsBookingsScreen.tsx` / `useSportsBookingsController (one function inside this host)` | `O09-SP09` |
| S80 | `app\app\sports\index.tsx` | `app\src\features\sportsScreens\SportsIndexScreen.tsx` / `useSportsIndexController (one function inside this host)` | `O20-SP13` |
| S82 | `app\app\sports-booking\[id].tsx` | `app\src\features\sportsScreens\SportsBookingDetailScreen.tsx` / `useSportsBookingDetailController (one function inside this host)` | `O20-SP05` |
| S83 | `app\app\sports-checkout\[id].tsx` | `app\src\features\sportsScreens\SportsCheckoutDetailScreen.tsx` / `useSportsCheckoutDetailController (one function inside this host)` | `O20-SP05` |
| S84 | `app\app\support\[id].tsx` | `app\src\features\communicationScreens\SupportDetailScreen.tsx` / `useSupportDetailController (one function inside this host)` | `O24-CM03` |
| S85 | `app\app\support\index.tsx` | `app\src\features\communicationScreens\SupportIndexScreen.tsx` / `useSupportIndexController (one function inside this host)` | `O24-CM03` |
| S86 | `app\app\support\new.tsx` | `app\src\features\communicationScreens\SupportNewScreen.tsx` / `useSupportNewController (one function inside this host)` | `O24-CM12` |
| S87 | `app\app\top-rated.tsx` | `app\src\features\marketplaceScreens\TopRatedScreen.tsx` / `useTopRatedController (one function inside this host)` | `O14-MK12` |

---

## Appendix J. Portable allocation/readiness validation contract

Document/JSON validation must independently check:

1. `schemaVersion=1`, exact frozen source SHA, seven portable source paths/hashes; 88 screens/5 layouts/503 rows/136 findings/131 source tasks/29 entity definitions/12-family map.
2. Exact once-only sourceTaskToStage coverage, source task/finding membership and all source-task dependency edges satisfied transitively; no dispatched WP aggregate/child duplicate owner or missing task.
3. Every dependency resolves and graph is acyclic; every shared case-normalized file/function writer is ordered or grouped. Exact initial frontier equals dependency-ready candidates after O00, conditional on real gates/claims/locks.
4. Every SQL writer has one unique UNASSIGNED claim/template with correct sole stage/functions; no guessed numeric reservation, applied-file append, shared draft path as actual ownership, or PG file accidentally under PGlite.
5. Exact stage tests/selectors/commands/cases, parser selectors and registration roundtrip; no route-test import permission, no fixture/test count fabricated, no unknown assets-suite PASS.
6. Exact25 registry keys/groups/order200+i/labels/OFF/default/parents, complete features/archetypes contract and single exported parent map consumed by admin.
7. Preserve appendix A palette/asset handoff/native launch invariants, all21+3review ledger IDs, all162historical names, all88inventory rows and completed-source evidence limitations.
8. Main sections0–8 and context-sized stage/task/READY/ledger/base/branch/CI/batch/merge/rollback/blocked algorithms. No new full-audit/discovery lanes or implicit production data repair.

The audit publisher independently validates its frozen source package. Document validation proves allocation/coverage/contract consistency only; it is **not** application correctness, native/gateway evidence, deployment permission or production data repair authorization.
