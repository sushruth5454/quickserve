export type SportsVenueReviewStatus = 'draft' | 'submitted' | 'verified' | 'rejected' | 'suspended';
export type SportsVenueReviewTarget = 'verified' | 'rejected' | 'suspended';

export interface SportsVenueReviewDetails {
  name: string;
  description: string;
  address_line: string;
  city: string;
  area: string;
  lat: number;
  lng: number;
  amenities: string[];
  photos: string[];
}

export interface VenueReviewAction {
  kind: 'submit' | 'admin';
  label: string;
  target?: SportsVenueReviewTarget;
  reasonRequired?: boolean;
  confirmation: {
    title: string;
    message: string;
    confirmLabel: string;
    destructive: boolean;
  };
}

export interface VenueReviewPresentation {
  statusLabel: string;
  canEditDetails: boolean;
  actions: VenueReviewAction[];
}

const reviewStatuses = new Set<SportsVenueReviewStatus>([
  'draft',
  'submitted',
  'verified',
  'rejected',
  'suspended',
]);

function isReviewStatus(status: string): status is SportsVenueReviewStatus {
  return reviewStatuses.has(status as SportsVenueReviewStatus);
}

function adminAction(status: SportsVenueReviewStatus, target: SportsVenueReviewTarget): VenueReviewAction {
  const restoring = target === 'verified' && (status === 'rejected' || status === 'suspended');
  const label = restoring ? 'Restore / Re-verify'
    : target === 'verified' ? 'Verify venue'
      : target === 'rejected' ? 'Reject' : 'Suspend';
  const confirmLabel = restoring ? 'Restore / Re-verify'
    : target === 'verified' ? 'Verify'
      : target === 'rejected' ? 'Reject' : 'Suspend';
  return {
    kind: 'admin',
    label,
    target,
    reasonRequired: target !== 'verified',
    confirmation: {
      title: `${confirmLabel} venue?`,
      message: restoring
        ? 'This will restore the venue to verified status.'
        : target === 'verified'
          ? 'This will mark the venue as verified.'
          : `This will change the venue status to ${target}.`,
      confirmLabel,
      destructive: target === 'rejected' || target === 'suspended',
    },
  };
}

export function getVenueReviewPresentation(status: string, actor: string): VenueReviewPresentation {
  if (!isReviewStatus(status)) {
    return { statusLabel: status.replaceAll('_', ' ').toUpperCase(), canEditDetails: false, actions: [] };
  }

  const ownerActions: VenueReviewAction[] =
    actor === 'owner' && (status === 'draft' || status === 'rejected')
      ? [{
          kind: 'submit',
          label: 'Submit for verification',
          confirmation: {
            title: 'Submit venue for verification?',
            message: 'Your venue details, courts, hours and prices will be sent for review.',
            confirmLabel: 'Submit',
            destructive: false,
          },
        }]
      : [];

  const adminTargets: SportsVenueReviewTarget[] = actor !== 'admin' || status === 'draft'
    ? []
    : status === 'submitted'
      ? ['verified', 'rejected', 'suspended']
      : status === 'verified'
        ? ['rejected', 'suspended']
        : status === 'rejected'
          ? ['verified', 'suspended']
          : ['verified', 'rejected'];
  const adminActions = adminTargets.map((target) => adminAction(status, target));

  return {
    statusLabel: status === 'submitted' ? 'UNDER REVIEW' : status.toUpperCase(),
    canEditDetails: actor === 'owner' && status !== 'suspended',
    actions: actor === 'admin' ? adminActions : ownerActions,
  };
}

export function hasSportsVenueReviewChanges(
  saved: SportsVenueReviewDetails,
  normalizedDraft: SportsVenueReviewDetails,
): boolean {
  return saved.name !== normalizedDraft.name
    || saved.description !== normalizedDraft.description
    || saved.address_line !== normalizedDraft.address_line
    || saved.city !== normalizedDraft.city
    || saved.area !== normalizedDraft.area
    || saved.lat !== normalizedDraft.lat
    || saved.lng !== normalizedDraft.lng
    || saved.amenities.length !== normalizedDraft.amenities.length
    || saved.amenities.some((value, index) => value !== normalizedDraft.amenities[index])
    || saved.photos.length !== normalizedDraft.photos.length
    || saved.photos.some((value, index) => value !== normalizedDraft.photos[index]);
}
