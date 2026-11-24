import { enquiryPresentation } from '../enquiryPresentation';

describe('enquiry presentation', () => {
  it('MK-ENQUIRY-closed-role-actions keeps closed staff read-only and trusts server authorization', () => {
    const staff = enquiryPresentation({
      status: 'closed',
      fromShopUser: true,
      businessRole: 'staff',
      canChangeStatus: false,
      canReopen: true,
      activeEnquiryId: null,
    });
    const manager = enquiryPresentation({
      status: 'closed',
      fromShopUser: true,
      businessRole: 'manager',
      canChangeStatus: false,
      canReopen: false,
      activeEnquiryId: null,
    });
    const customer = enquiryPresentation({
      status: 'closed',
      fromShopUser: false,
      businessRole: null,
      canChangeStatus: true,
      canReopen: true,
      activeEnquiryId: null,
    });
    const roleAlone = enquiryPresentation({
      status: 'closed',
      fromShopUser: true,
      businessRole: 'owner',
      canChangeStatus: false,
      canReopen: true,
      activeEnquiryId: null,
    });

    expect({
      staff: { action: staff.statusAction, readOnly: staff.readOnly, explanation: staff.closedExplanation },
      manager: { action: manager.statusAction, readOnly: manager.readOnly },
      customer: customer.statusAction,
      ownerRoleWithoutServerGrant: roleAlone.statusAction,
    }).toEqual({
      staff: {
        action: null,
        readOnly: true,
        explanation: 'Only the shop owner or customer can reopen this enquiry. Ask them to reopen it.',
      },
      manager: { action: null, readOnly: true },
      customer: { type: 'reopen', label: 'Reopen' },
      ownerRoleWithoutServerGrant: null,
    });
  });

  it('MK-ENQUIRY-active-twin-route navigates to the current thread instead of offering a duplicate reopen', () => {
    const presentation = enquiryPresentation({
      status: 'closed',
      fromShopUser: true,
      businessRole: 'manager',
      canChangeStatus: false,
      canReopen: false,
      activeEnquiryId: 'active-enquiry-id',
    });

    expect(presentation).toEqual({
      statusAction: {
        type: 'open_active',
        label: 'Open active conversation',
        targetId: 'active-enquiry-id',
      },
      closedExplanation: 'You cannot reopen this enquiry. Continue in the active conversation.',
      readOnly: true,
    });
  });
});
