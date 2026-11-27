jest.doMock('expo-router', () => ({ useFocusEffect: jest.fn() }));

const { useEntityRefresh } = require('../../../lib/useEntityRefresh') as typeof import('../../../lib/useEntityRefresh');
const { useFocusedServiceRefresh } = require('../useFocusedServiceRefresh') as typeof import('../useFocusedServiceRefresh');

describe('service lifecycle refresh', () => {
  it('delegates focus, foreground, bounded active polling, blur cleanup and stale-load cancellation to the shared hook', () => {
    expect(useFocusedServiceRefresh).toBe(useEntityRefresh);
  });
});
