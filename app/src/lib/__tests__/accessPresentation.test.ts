import {
  accessError,
  accessForActor,
  adminAccessResult,
  loadingAccess,
  resolvedAccess,
  retryAccess,
} from '../accessPresentation';

function assertState(actual: unknown, expected: unknown, label: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: actual=${actualJson} expected=${expectedJson}`);
  }
}

describe('access presentation', () => {
  it('keeps loading and transport failure distinct', () => {
    const loading = loadingAccess('admin-a');
    const failure = accessError('admin-a', new Error('RPC unavailable'), 'Unable to verify admin access.');

    assertState(loading, { status: 'loading', actorId: 'admin-a' }, 'loading state');
    assertState(
      failure,
      { status: 'error', actorId: 'admin-a', message: 'RPC unavailable' },
      'transport error state',
    );
    assertState(accessForActor(failure, 'admin-a'), failure, 'current actor error');
  });

  it('retries a failed lookup as loading for the same actor', () => {
    const failure = accessError('admin-a', new Error('RPC unavailable'));

    assertState(
      retryAccess(failure, 'admin-a'),
      { status: 'loading', actorId: 'admin-a' },
      'retry state',
    );
  });

  it('keeps a known false result as denial and true as allow', () => {
    assertState(
      adminAccessResult('admin-a', false),
      { status: 'denied', actorId: 'admin-a' },
      'known denial',
    );
    assertState(
      adminAccessResult('admin-a', true),
      { status: 'allowed', actorId: 'admin-a' },
      'known allow',
    );
  });

  it('does not present a prior actor result as the new actor result', () => {
    const priorAllow = adminAccessResult('admin-a', true);
    const switchedActor = accessForActor(priorAllow, 'admin-b');
    const currentDenial = adminAccessResult('admin-b', false);

    assertState(switchedActor, { status: 'loading', actorId: 'admin-b' }, 'actor switch');
    assertState(currentDenial, { status: 'denied', actorId: 'admin-b' }, 'new actor result');
    assertState(accessForActor(priorAllow, 'admin-a'), priorAllow, 'prior actor result remains actor-bound');
  });

  it('preserves the backend provider role result without promoting staff to owner', () => {
    const owner = resolvedAccess('provider-a', 'owner');
    const staff = resolvedAccess('provider-b', 'staff');

    assertState(owner, { status: 'resolved', actorId: 'provider-a', value: 'owner' }, 'owner membership');
    assertState(staff, { status: 'resolved', actorId: 'provider-b', value: 'staff' }, 'staff membership');
  });
});
