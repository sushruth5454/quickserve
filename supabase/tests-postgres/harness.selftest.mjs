import assert from 'node:assert/strict';
import { runGuardSelftest, verifyTwoConnections } from './helpers.mjs';

export async function runSelftest({ guardsOnly = false } = {}) {
  const guards = runGuardSelftest();
  if (guardsOnly) return { guards, liveConnections: 'not-requested' };

  const connections = await verifyTwoConnections();
  assert.notEqual(connections.firstPid, connections.secondPid);
  assert.equal(connections.barrier, 'blocked-then-released');
  assert.equal(connections.cleanup, 'verified');
  return { guards, liveConnections: connections };
}
