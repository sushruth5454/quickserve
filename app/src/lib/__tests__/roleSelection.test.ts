import { roleProfilePatch } from '../roleSelection';

describe('role profile persistence', () => {
  it('updates only the authorized full_name field', () => {
    const actual = roleProfilePatch('  Priya Sharma  ');
    expect(JSON.stringify(actual)).toBe(JSON.stringify({ full_name: 'Priya Sharma' }));
  });

  it('skips profile updates when the name is blank', () => {
    expect(roleProfilePatch(' \t ')).toBeNull();
  });
});
