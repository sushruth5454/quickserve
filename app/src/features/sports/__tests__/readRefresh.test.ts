jest.doMock('expo-router', () => ({ useFocusEffect: jest.fn() }));

const { useEntityRefresh } = require('../../../lib/useEntityRefresh') as typeof import('../../../lib/useEntityRefresh');
const { useSportsReadRefresh } = require('../useSportsReadRefresh') as typeof import('../useSportsReadRefresh');
const sportsRefresh: typeof useEntityRefresh = useSportsReadRefresh;

describe('SP-REFRESH-ALIAS', () => {
  it('uses the shared entity refresh hook without another scheduler', () => {
    expect(sportsRefresh).toBe(useEntityRefresh);
  });
});
