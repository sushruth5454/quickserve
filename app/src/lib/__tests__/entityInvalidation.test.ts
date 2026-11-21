import { createRequestEpoch, type RequestToken } from '../entityInvalidation';

describe('request epochs', () => {
  it('makes a new context token current and supersedes the earlier request', () => {
    const epoch = createRequestEpoch();

    const first = epoch.begin('project-a:actor-a:entity-1');
    expect(epoch.isCurrent(first)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.keys(first)).toEqual([]);
    expect(epoch.isCurrent({} as RequestToken)).toBe(false);

    const second = epoch.begin('project-a:actor-b:entity-1');
    expect(epoch.isCurrent(first)).toBe(false);
    expect(epoch.isCurrent(second)).toBe(true);
  });

  it('invalidates every pending token, including one for the same context', () => {
    const epoch = createRequestEpoch();
    const first = epoch.begin('project-a:actor-a:entity-1');
    const second = epoch.begin('project-a:actor-a:entity-1');

    epoch.invalidate();

    expect(epoch.isCurrent(first)).toBe(false);
    expect(epoch.isCurrent(second)).toBe(false);
    const next = epoch.begin('project-a:actor-a:entity-1');
    expect(epoch.isCurrent(next)).toBe(true);
    expect(next).not.toBe(second);
  });
});
