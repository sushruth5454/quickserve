import { getVenueReviewPresentation, hasSportsVenueReviewChanges } from '../venueReviewPresentation';

const statuses = ['draft', 'submitted', 'verified', 'rejected', 'suspended'] as const;

describe('SP-REVIEW-UI-ALL-STATES', () => {
  const expected: Record<(typeof statuses)[number], { owner: string[]; admin: string[] }> = {
    draft: { owner: ['submit'], admin: [] },
    submitted: { owner: [], admin: ['verified', 'rejected', 'suspended'] },
    verified: { owner: [], admin: ['rejected', 'suspended'] },
    rejected: { owner: ['submit'], admin: ['verified', 'suspended'] },
    suspended: { owner: [], admin: ['verified', 'rejected'] },
  };

  it.each(statuses)('%s exposes only permitted owner and admin actions', (status) => {
    const owner = getVenueReviewPresentation(status, 'owner');
    const admin = getVenueReviewPresentation(status, 'admin');

    expect(owner.actions.map((action) => action.kind)).toEqual(expected[status].owner);
    expect(admin.actions.map((action) => action.target)).toEqual(expected[status].admin);
    expect(owner.statusLabel).toBe(status === 'submitted' ? 'UNDER REVIEW' : status.toUpperCase());
  });

  it('never gives verified venues a Verify or Submit action', () => {
    for (const actor of ['owner', 'admin']) {
      const actions = getVenueReviewPresentation('verified', actor).actions;
      expect(actions.map((action) => action.label)).not.toContain('Verify venue');
      expect(actions.map((action) => action.label)).not.toContain('Submit for verification');
    }
  });

  it.each(['manager', 'staff', 'member', 'business_manager'])(
    'keeps owner-only actions absent for actor %s across all venue states',
    (actor) => {
      for (const status of statuses) {
        const presentation = getVenueReviewPresentation(status, actor);
        expect(presentation.actions).toEqual([]);
        expect(presentation.canEditDetails).toBe(false);
      }
    },
  );

  it('does not make suspended details editable for an owner', () => {
    expect(getVenueReviewPresentation('suspended', 'owner').canEditDetails).toBe(false);
    expect(getVenueReviewPresentation('rejected', 'owner').canEditDetails).toBe(true);
  });
});

describe('SP-REVIEW-DIRTY-FIELDS', () => {
  const saved = {
    name: 'North Court',
    description: 'Indoor court',
    address_line: '12 Main Road',
    city: 'Pune',
    area: 'Shivaji Nagar',
    lat: 18.52,
    lng: 73.85,
    amenities: ['Parking', 'Changing room'],
    photos: ['https://example.test/one.jpg'],
  };

  it('matches every detail field that save_sports_venue uses to reset review', () => {
    const changes = [
      { name: 'New Court' },
      { description: 'Outdoor court' },
      { address_line: '14 Main Road' },
      { city: 'Mumbai' },
      { area: 'Camp' },
      { lat: 18.53 },
      { lng: 73.86 },
      { amenities: ['Parking'] },
      { photos: ['https://example.test/two.jpg'] },
    ];

    for (const change of changes) {
      expect(hasSportsVenueReviewChanges(saved, { ...saved, ...change })).toBe(true);
    }
  });

  it('ignores unchanged details and payment-only changes', () => {
    expect(hasSportsVenueReviewChanges(saved, { ...saved })).toBe(false);
    expect(hasSportsVenueReviewChanges(saved, { ...saved, payment_modes: ['online'] } as typeof saved)).toBe(false);
  });
});
