#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const planPath = path.join(repoRoot, 'docs', 'design', 'oorva', 'execution-plan.json');

function fail(message) {
  throw new Error(message);
}

function stageById(plan) {
  const stages = new Map();
  for (const stage of plan.stages ?? []) {
    if (!stage?.id || stages.has(stage.id)) fail(`duplicate or missing stage id: ${stage?.id ?? '<missing>'}`);
    stages.set(stage.id, stage);
  }
  return stages;
}

function dependencyReachable(stages, ancestorId, stageId, seen = new Set()) {
  if (ancestorId === stageId) return true;
  if (seen.has(stageId)) return false;
  seen.add(stageId);
  const stage = stages.get(stageId);
  return (stage?.dependsOn ?? []).some((dependency) => (
    dependency === ancestorId || dependencyReachable(stages, ancestorId, dependency, seen)
  ));
}

function canonicalResource(resource) {
  return String(resource).toLowerCase();
}

function hasOrderedSequence(orderedPairs, resource, first, second) {
  const key = canonicalResource(resource);
  return orderedPairs.has(`${key}\u0000${first}\u0000${second}`)
    || orderedPairs.has(`${key}\u0000${second}\u0000${first}`);
}

export function validatePlan(plan, coverage) {
  const problems = [];
  const check = (condition, message) => {
    if (!condition) problems.push(message);
  };
  const stages = new Map();

  if (!Array.isArray(plan?.stages) || !Array.isArray(coverage?.sourceTasks)) {
    return ['execution plan stages and coverage sourceTasks must be arrays'];
  }
  for (const stage of plan.stages) {
    if (!stage?.id || stages.has(stage.id)) {
      problems.push(`duplicate or missing stage id: ${stage?.id ?? '<missing>'}`);
      continue;
    }
    stages.set(stage.id, stage);
  }

  check(plan.sourceSha === coverage.sourceSha, 'execution plan and coverage sourceSha differ');
  check(
    plan.sourceCoverage?.sourceTasks === coverage.sourceTasks.length,
    'execution plan sourceCoverage.sourceTasks does not match coverage',
  );

  const sourceTasks = new Map();
  const findingIds = new Set();
  for (const task of coverage.sourceTasks) {
    if (!task?.id || sourceTasks.has(task.id)) problems.push(`duplicate or missing source task id: ${task?.id ?? '<missing>'}`);
    else sourceTasks.set(task.id, task);
    for (const findingId of task?.findingIds ?? []) {
      if (typeof findingId === 'string' && findingId.length > 0) findingIds.add(findingId);
    }
  }

  const sourceTaskToStage = plan.sourceTaskToStage;
  check(sourceTaskToStage && typeof sourceTaskToStage === 'object' && !Array.isArray(sourceTaskToStage), 'sourceTaskToStage must be an object');
  if (sourceTaskToStage && typeof sourceTaskToStage === 'object') {
    const mappedIds = Object.keys(sourceTaskToStage);
    for (const taskId of sourceTasks.keys()) {
      check(Object.hasOwn(sourceTaskToStage, taskId), `source task ${taskId} has no stage mapping`);
    }
    for (const taskId of mappedIds) {
      check(sourceTasks.has(taskId), `stage map references unknown source task ${taskId}`);
      check(stages.has(sourceTaskToStage[taskId]), `source task ${taskId} maps to unknown stage ${sourceTaskToStage[taskId]}`);
    }
    check(mappedIds.length === sourceTasks.size, 'sourceTaskToStage has extra or missing task mappings');
  }

  const taskOwners = new Map();
  const lockOwners = new Map();
  const claimsById = new Map();
  for (const claim of plan.migrationClaims ?? []) {
    if (!claim?.id || claimsById.has(claim.id)) {
      problems.push(`duplicate or missing migration claim id: ${claim?.id ?? '<missing>'}`);
      continue;
    }
    claimsById.set(claim.id, claim);
    check(stages.has(claim.stageId), `migration claim ${claim.id} references unknown stage ${claim.stageId}`);
    if (claim.numericVersion === 'UNASSIGNED') {
      check(
        claim.state === 'PROPOSED_NOT_RESERVED' && String(claim.filenameTemplate).includes('UNASSIGNED'),
        `unassigned migration claim ${claim.id} has inconsistent reservation metadata`,
      );
    } else {
      check(
        /^\d{4,5}[a-z]?$/.test(String(claim.numericVersion ?? '')),
        `migration claim ${claim.id} has a guessed or invalid numeric version`,
      );
      check(claim.state !== 'PROPOSED_NOT_RESERVED', `migration claim ${claim.id} uses an unreserved guessed version`);
    }
  }

  for (const stage of plan.stages) {
    for (const dependency of stage.dependsOn ?? []) {
      check(stages.has(dependency), `stage ${stage.id} depends on unknown stage ${dependency}`);
      check(dependency !== stage.id, `stage ${stage.id} depends on itself`);
    }

    const localTasks = new Set();
    for (const taskId of stage.sourceTaskIds ?? []) {
      if (localTasks.has(taskId)) problems.push(`stage ${stage.id} repeats source task ${taskId}`);
      localTasks.add(taskId);
      if (!sourceTasks.has(taskId)) problems.push(`stage ${stage.id} references unknown source task ${taskId}`);
      const owners = taskOwners.get(taskId) ?? [];
      owners.push(stage.id);
      taskOwners.set(taskId, owners);
      check(
        sourceTaskToStage?.[taskId] === stage.id,
        `source task ${taskId} is not mapped to its owning stage ${stage.id}`,
      );
    }
    for (const findingId of stage.sourceFindingIds ?? []) {
      check(findingIds.has(findingId), `stage ${stage.id} references unknown source finding ${findingId}`);
    }
    const knownFeatureKeys = new Set((plan.featureRegistry ?? []).map((feature) => feature.key));
    for (const featureKey of stage.featureKeys ?? []) {
      if (/^[a-z][a-z0-9_]*$/.test(featureKey)) {
        check(knownFeatureKeys.has(featureKey), `stage ${stage.id} references unknown feature key ${featureKey}`);
      } else {
        check(typeof featureKey === 'string' && featureKey.trim().length > 0, `stage ${stage.id} has an invalid feature reference`);
      }
    }
    for (const [taskId, mappedStage] of Object.entries(sourceTaskToStage ?? {})) {
      if (mappedStage === stage.id) {
        check(localTasks.has(taskId), `source task map assigns ${taskId} to ${stage.id}, but the stage omits it`);
      }
    }

    for (const claimId of stage.migrationClaims ?? []) {
      const claim = claimsById.get(claimId);
      check(Boolean(claim), `stage ${stage.id} references unknown migration claim ${claimId}`);
      if (claim) check(claim.stageId === stage.id, `migration claim ${claimId} is owned by ${claim.stageId}, not ${stage.id}`);
    }

    const localLocks = new Set();
    for (const resource of stage.locks ?? []) {
      const key = canonicalResource(resource);
      if (localLocks.has(key)) problems.push(`stage ${stage.id} repeats lock ${resource}`);
      localLocks.add(key);
      const owners = lockOwners.get(key) ?? [];
      owners.push(stage.id);
      lockOwners.set(key, owners);
    }
  }

  for (const [taskId, owners] of taskOwners) {
    check(owners.length === 1, `source task ${taskId} has duplicate stage ownership: ${owners.join(', ')}`);
  }
  for (const [taskId, task] of sourceTasks) {
    check(taskOwners.has(taskId), `source task ${taskId} is not assigned to a stage`);
    for (const findingId of task.findingIds ?? []) {
      check(typeof findingId === 'string' && findingId.length > 0, `source task ${taskId} has an invalid finding reference`);
    }
  }
  for (const claim of claimsById.values()) {
    const stage = stages.get(claim.stageId);
    check(stage?.migrationClaims?.includes(claim.id), `migration claim ${claim.id} is missing from its stage`);
  }

  const visited = new Set();
  const active = new Set();
  function visit(stageId) {
    if (active.has(stageId)) {
      problems.push(`dependency cycle includes stage ${stageId}`);
      return;
    }
    if (visited.has(stageId)) return;
    active.add(stageId);
    for (const dependency of stages.get(stageId)?.dependsOn ?? []) {
      if (stages.has(dependency)) visit(dependency);
    }
    active.delete(stageId);
    visited.add(stageId);
  }
  for (const stageId of stages.keys()) visit(stageId);

  const orderedPairs = new Set();
  const writerOrder = new Map();
  const addWriterOrder = (resource, before, after) => {
    const key = canonicalResource(resource);
    const edges = writerOrder.get(key) ?? new Map();
    const successors = edges.get(before) ?? new Set();
    successors.add(after);
    edges.set(before, successors);
    writerOrder.set(key, edges);
  };
  for (const sequence of plan.sharedWriterSequences ?? []) {
    const { resource, stageIds } = sequence ?? {};
    const key = canonicalResource(resource);
    check(typeof resource === 'string' && resource.length > 0, 'shared writer sequence has no resource');
    check(Array.isArray(stageIds) && stageIds.length > 1, `shared writer sequence for ${resource} needs at least two stages`);
    if (!Array.isArray(stageIds)) continue;
    check(new Set(stageIds).size === stageIds.length, `shared writer sequence for ${resource} repeats a stage`);
    for (let index = 0; index < stageIds.length; index += 1) {
      const stageId = stageIds[index];
      check(stages.has(stageId), `shared writer sequence for ${resource} references unknown stage ${stageId}`);
      check(
        stages.get(stageId)?.locks?.some((lock) => canonicalResource(lock) === key),
        `shared writer sequence lists ${stageId}, which does not hold ${resource}`,
      );
      for (const laterStageId of stageIds.slice(index + 1)) {
        orderedPairs.add(`${key}\u0000${stageId}\u0000${laterStageId}`);
        addWriterOrder(resource, stageId, laterStageId);
      }
    }
  }

  for (const [resource, owners] of lockOwners) {
    for (let index = 0; index < owners.length; index += 1) {
      for (const otherId of owners.slice(index + 1)) {
        const stageId = owners[index];
        if (dependencyReachable(stages, stageId, otherId)) addWriterOrder(resource, stageId, otherId);
        if (dependencyReachable(stages, otherId, stageId)) addWriterOrder(resource, otherId, stageId);
        check(
          dependencyReachable(stages, stageId, otherId)
            || dependencyReachable(stages, otherId, stageId)
            || hasOrderedSequence(orderedPairs, resource, stageId, otherId),
          `shared-writer race on ${resource}: ${stageId} and ${otherId} are unordered`,
        );
      }
    }
  }

  for (const edge of plan.fileAndFunctionLockEdges ?? []) {
    check(stages.has(edge.before), `lock edge references unknown stage ${edge.before}`);
    check(stages.has(edge.after), `lock edge references unknown stage ${edge.after}`);
    check(edge.before !== edge.after, `lock edge for ${edge.resource} loops through ${edge.before}`);
    check(
      typeof edge.reason === 'string' && edge.reason.trim().length > 0,
      `lock edge ${edge.before} -> ${edge.after} has no reason`,
    );
    if (stages.has(edge.before) && stages.has(edge.after)) {
      check(
        stages.get(edge.before)?.locks?.some((lock) => canonicalResource(lock) === canonicalResource(edge.resource))
          && stages.get(edge.after)?.locks?.some((lock) => canonicalResource(lock) === canonicalResource(edge.resource)),
        `lock edge ${edge.before} -> ${edge.after} does not match ${edge.resource} locks`,
      );
      check(
        dependencyReachable(stages, edge.before, edge.after)
          || orderedPairs.has(`${canonicalResource(edge.resource)}\u0000${edge.before}\u0000${edge.after}`),
        `lock edge ${edge.before} -> ${edge.after} has no matching execution order`,
      );
      if (typeof edge.resource === 'string') addWriterOrder(edge.resource, edge.before, edge.after);
    }
  }

  for (const [resource, edges] of writerOrder) {
    const activeWriters = new Set();
    const visitedWriters = new Set();
    const visitWriter = (stageId) => {
      if (activeWriters.has(stageId)) {
        problems.push(`shared-writer ordering cycle on ${resource} includes ${stageId}`);
        return;
      }
      if (visitedWriters.has(stageId)) return;
      activeWriters.add(stageId);
      for (const next of edges.get(stageId) ?? []) visitWriter(next);
      activeWriters.delete(stageId);
      visitedWriters.add(stageId);
    };
    for (const stageId of edges.keys()) visitWriter(stageId);
  }

  const o37a = stages.get('O37A');
  if (o37a) {
    check((o37a.sourceTaskIds ?? []).length === 0, 'O37A must not claim source task IDs');
    check((o37a.sourceFindingIds ?? []).length === 0, 'O37A must not claim source finding IDs');
    check((o37a.migrationClaims ?? []).length === 0, 'O37A must not claim migrations');
    check((o37a.sqlFunctions ?? []).length === 0, 'O37A must not claim SQL functions');
    check((o37a.sqlObjects ?? []).length === 0, 'O37A must not claim SQL objects');
  }

  return problems;
}

export function selectStages(plan, requestedIds) {
  if (!Array.isArray(requestedIds) || requestedIds.length === 0) fail('zero stage selection is not allowed');
  const stages = stageById(plan);
  const selected = new Set();
  const active = new Set();
  const visit = (stageId) => {
    const stage = stages.get(stageId);
    if (!stage) fail(`unknown selected stage: ${stageId}`);
    if (selected.has(stageId)) return;
    if (active.has(stageId)) fail(`dependency cycle includes stage ${stageId}`);
    active.add(stageId);
    for (const dependency of stage.dependsOn ?? []) visit(dependency);
    active.delete(stageId);
    selected.add(stageId);
  };
  for (const stageId of requestedIds) visit(stageId);
  return [...selected];
}

function syntheticPlan() {
  const stages = [
    { id: 'A', dependsOn: [], sourceTaskIds: ['T1'], sourceFindingIds: [], migrationClaims: [], locks: ['file:shared'] },
    { id: 'B', dependsOn: ['A'], sourceTaskIds: [], sourceFindingIds: [], migrationClaims: [], locks: ['file:shared'] },
  ];
  return {
    sourceSha: 'fixture',
    sourceCoverage: { sourceTasks: 1 },
    stages,
    sourceTaskToStage: { T1: 'A' },
    migrationClaims: [],
    sharedWriterSequences: [{ resource: 'file:shared', stageIds: ['A', 'B'] }],
    fileAndFunctionLockEdges: [{ before: 'A', after: 'B', resource: 'file:shared', reason: 'fixture order' }],
  };
}

function expectInvalid(plan, coverage, expression, label) {
  assert.match(validatePlan(plan, coverage).join('\n'), expression, label);
}

export function runSelftest() {
  const coverage = { sourceSha: 'fixture', sourceTasks: [{ id: 'T1', findingIds: [] }] };
  const validPlan = syntheticPlan();
  assert.deepEqual(validatePlan(validPlan, coverage), []);
  assert.throws(() => selectStages(validPlan, []), /zero stage selection/);
  assert.deepEqual(selectStages(validPlan, ['B']), ['A', 'B']);

  const invalidRef = structuredClone(validPlan);
  invalidRef.stages[0].dependsOn = ['MISSING'];
  expectInvalid(invalidRef, coverage, /unknown stage MISSING/);

  const cycle = structuredClone(validPlan);
  cycle.stages[0].dependsOn = ['B'];
  expectInvalid(cycle, coverage, /dependency cycle/);

  const writerRace = structuredClone(validPlan);
  writerRace.stages[1].dependsOn = [];
  writerRace.sharedWriterSequences = [];
  writerRace.fileAndFunctionLockEdges = [];
  expectInvalid(writerRace, coverage, /shared-writer race/);

  const writerCycle = structuredClone(validPlan);
  writerCycle.sharedWriterSequences.push({ resource: 'file:shared', stageIds: ['B', 'A'] });
  expectInvalid(writerCycle, coverage, /shared-writer ordering cycle/);

  const duplicateTask = structuredClone(validPlan);
  duplicateTask.stages[1].sourceTaskIds = ['T1'];
  expectInvalid(duplicateTask, coverage, /duplicate stage ownership/);

  const guessedClaim = structuredClone(validPlan);
  guessedClaim.stages[0].migrationClaims = ['MIG-A'];
  guessedClaim.migrationClaims = [{
    id: 'MIG-A',
    stageId: 'A',
    filenameTemplate: 'supabase/migrations/0099_guessed.sql',
    numericVersion: '0099',
    state: 'PROPOSED_NOT_RESERVED',
  }];
  expectInvalid(guessedClaim, coverage, /unreserved guessed version/);
  return { cases: 9, passed: true };
}

async function loadPlan() {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const coverageParts = String(plan.coveragePath).split(/[\\/]/);
  const coveragePath = path.join(repoRoot, ...coverageParts);
  const coverage = JSON.parse(await readFile(coveragePath, 'utf8'));
  return { plan, coverage };
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === '--selftest') return { selftest: true };
  if (argv.length === 1 && argv[0] === '--all') return { all: true };

  const stageIds = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--stage' || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      fail('use --all, --selftest, or one or more --stage <id> selectors');
    }
    stageIds.push(argv[index + 1]);
    index += 1;
  }
  if (stageIds.length === 0) fail('zero stage selection is not allowed; choose --all or --stage <id>');
  return { stageIds };
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.selftest) {
    console.log(JSON.stringify(runSelftest()));
    return;
  }

  const { plan, coverage } = await loadPlan();
  const problems = validatePlan(plan, coverage);
  if (problems.length) fail(problems.map((problem) => `- ${problem}`).join('\n'));

  const requested = options.all ? plan.stages.map((stage) => stage.id) : options.stageIds;
  const selected = selectStages(plan, requested);
  console.log(`SELECTION PASS: ${selected.length} stage(s): ${selected.join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`execution plan: ${error.message}`);
    process.exitCode = 1;
  });
}
