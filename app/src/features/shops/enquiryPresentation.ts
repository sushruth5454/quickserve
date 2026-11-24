type EnquiryBusinessRole = 'owner' | 'manager' | 'staff' | null;

export type EnquiryStatusAction =
  | { type: 'close' | 'reopen'; label: string }
  | { type: 'open_active'; label: string; targetId: string };

export interface EnquiryPresentation {
  statusAction: EnquiryStatusAction | null;
  closedExplanation: string | null;
  readOnly: boolean;
}

export function enquiryPresentation(input: {
  status: 'open' | 'closed';
  fromShopUser: boolean;
  businessRole: EnquiryBusinessRole;
  canChangeStatus: boolean;
  canReopen: boolean;
  activeEnquiryId: string | null;
}): EnquiryPresentation {
  if (input.status === 'open') {
    return {
      statusAction: input.canChangeStatus ? { type: 'close', label: 'Close' } : null,
      closedExplanation: null,
      readOnly: false,
    };
  }

  const nonOwnerShopUser = input.fromShopUser && input.businessRole !== 'owner';
  if (input.activeEnquiryId) {
    return {
      statusAction: {
        type: 'open_active',
        label: 'Open active conversation',
        targetId: input.activeEnquiryId,
      },
      closedExplanation: nonOwnerShopUser
        ? 'You cannot reopen this enquiry. Continue in the active conversation.'
        : 'An active conversation already exists. Continue there.',
      readOnly: true,
    };
  }

  if (input.canChangeStatus && input.canReopen) {
    return {
      statusAction: { type: 'reopen', label: 'Reopen' },
      closedExplanation: 'Reopen this enquiry to send a message.',
      readOnly: true,
    };
  }

  return {
    statusAction: null,
    closedExplanation: nonOwnerShopUser
      ? 'Only the shop owner or customer can reopen this enquiry. Ask them to reopen it.'
      : 'This enquiry cannot be reopened by your account.',
    readOnly: true,
  };
}
