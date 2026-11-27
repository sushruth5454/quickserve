import { isProposalComposeReady } from '../../serviceScreens/ProposalComposeDetailScreen';
import { isProposalRequestReady } from '../../serviceScreens/RequestNewScreen';

const composeBase = {
  controlsHydrated: true,
  freshness: 'live' as const,
  proposalEnabled: true,
  requestResolved: true,
  configResolved: true,
};

const requestBase = {
  controlsHydrated: true,
  freshness: 'live' as const,
  proposalEnabled: true,
  categoryResolved: true,
  categoryValid: true,
  packageResolved: true,
};

function assertReadiness(actual: boolean, expected: boolean, input: unknown): void {
  if (actual !== expected) {
    throw new Error(`expected readiness=${expected}; actual=${JSON.stringify({ actual, input })}`);
  }
}

describe('new proposal readiness', () => {
  it('resolvedConfigRequired', () => {
    const input = { ...composeBase, configResolved: false };
    assertReadiness(isProposalComposeReady(input), false, input);
    assertReadiness(isProposalComposeReady({ ...input, configResolved: true }), true, { ...input, configResolved: true });
  });

  it('parentOff', () => {
    const compose = { ...composeBase, proposalEnabled: false };
    const request = { ...requestBase, proposalEnabled: false };
    assertReadiness(isProposalComposeReady(compose), false, compose);
    assertReadiness(isProposalRequestReady(request), false, request);
  });

  it('unresolved or failed parent state fails closed before request controls render', () => {
    const composeFallback = { ...composeBase, freshness: 'fallback' as const };
    const requestFallback = { ...requestBase, freshness: 'fallback' as const };
    const composeError = { ...composeBase, freshness: 'error' as const };
    const requestError = { ...requestBase, freshness: 'error' as const };
    assertReadiness(isProposalComposeReady(composeFallback), false, composeFallback);
    assertReadiness(isProposalRequestReady(requestFallback), false, requestFallback);
    assertReadiness(isProposalComposeReady(composeError), false, composeError);
    assertReadiness(isProposalRequestReady(requestError), false, requestError);
  });

  it('request category schema must resolve before request controls render', () => {
    const input = { ...requestBase, categoryResolved: false };
    assertReadiness(isProposalRequestReady(input), false, input);
  });
});
