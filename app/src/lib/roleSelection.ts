import type { Profile } from './types';

export function roleProfilePatch(name: string): Pick<Profile, 'full_name'> | null {
  const fullName = name.trim();
  return fullName ? { full_name: fullName } : null;
}
