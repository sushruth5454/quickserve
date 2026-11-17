import { isFeatureOn } from '../featureFlagModel';

describe('feature flags', () => {
  it('keeps unknown flags off', () => {
    expect(isFeatureOn({ ai_assistant: true, archetypes: { fixed: true } }, 'future_feature')).toBe(false);
  });
});
