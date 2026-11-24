import type { ShopProfile } from '../api';

export interface ShopManageActions {
  canEditProducts: boolean;
  canSubmit: boolean;
  canSaveDetails: boolean;
}

type ManageableShop = Pick<ShopProfile, 'business_role' | 'status'> | null;

export function shopManageActions({
  shop,
  actualOwner,
  productsEnabled,
}: {
  shop: ManageableShop;
  actualOwner: boolean;
  productsEnabled: boolean;
}): ShopManageActions {
  const owner = actualOwner && (shop === null || shop.business_role === 'owner');
  const canSaveDetails = owner && productsEnabled;
  const canEditProducts = canSaveDetails && shop !== null && shop.status !== 'suspended';
  const canSubmit = canSaveDetails && shop !== null
    && shop.status !== 'suspended'
    && shop.status !== 'submitted'
    && shop.status !== 'under_review'
    && shop.status !== 'verified';

  return { canEditProducts, canSubmit, canSaveDetails };
}
