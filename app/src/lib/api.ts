/**
 * Backend facade used by every screen. Picks the real Supabase implementation or the in-memory demo backend
 * (EXPO_PUBLIC_DEMO_MODE=1, or Supabase env vars missing). Screens never branch on the mode.
 */
import type { Api } from './apiTypes';
import { isDemoMode } from './config';
import { demoApi } from './demo/demoApi';
import * as supabaseApi from './supabaseApi';
import type { Category } from './types';

export type * from './apiTypes';
export { isDemoMode };

export type PublicCategory = Category & {
  recurrence_allowed?: boolean;
  allowed_frequencies?: string[];
};

const impl: Api = isDemoMode ? demoApi : supabaseApi;

export const {
  getSession,
  onAuthChange,
  sendOtp,
  verifyOtp,
  signOut,
  requestAccountDeletion,
  getMyProfile,
  updateMyProfile,
  listCategories: listCategoriesFromBackend,
  listMyAddresses,
  addAddress,
  deleteAddress,
  searchProviders,
  listTopRated,
  listLiveCities,
  resolveServiceCity,
  joinCityWaitlist,
  onCityWaitlist,
  getProviderDetail,
  getProviderService,
  createBooking,
  createFixedBooking,
  listFixedPackages,
  sendFixedAddons,
  approveFixedChangeOrder,
  createPayment,
  listMyBookings,
  getBooking,
  getBookingCommissionRate,
  getQuotes,
  getPayments,
  getReceipt,
  getEvents,
  getBookingOtps,
  getBookingAddress,
  getReviewForBooking,
  getProfileName,
  signedPhotoUrls,
  uploadJobPhoto,
  acceptBooking,
  declineBooking,
  startTrip,
  requestCompletion,
  confirmCompletion,
  previewCancellation,
  cancelBooking,
  providerCancelBooking,
  disputeBooking,
  reportNoShow,
  regenerateOtp,
  rejectQuote,
  arrive,
  completeBooking,
  sendQuote,
  approveQuote,
  getMyCoinBalance,
  listCoinHistory,
  getCoinRedemptionPreview,
  submitReview,
  getMyProvider,
  getCommissionTerms,
  upsertProviderProfile,
  setOnline,
  listMyServices,
  upsertService,
  inspectTravelRequest,
  createTravelRequest,
  listMyTravelRequests,
  respondToTravelRequest,
  deleteService,
  addRateCardItem,
  getProviderJobs,
  listMyPayouts,
  listMessages,
  sendMessage,
  subscribeToMessages,
  subscribeToBooking,
  subscribeToMyMessages,
  getUnreadCounts,
  markChatRead,
  getChatReadState,
  listNotifications,
  countUnreadNotifications,
  markNotificationsRead,
  getChatHeading,
  registerPushDevice,
  unregisterPushDevice,
  createServiceRequest,
  cancelServiceRequest,
  listMyServiceRequests,
  listProviderServiceRequests,
  getServiceRequest,
  listRequestProposals,
  getProposal,
  sendProposal,
  withdrawProposal,
  listMyProposals,
  acceptProposal,
  listRequestMessages,
  sendRequestMessage,
  listPaymentSchedule,
  createSchedulePayment,
  startProposalBooking,
  beginDelivery,
  submitDelivery,
  acceptDelivery,
  cancelProposalPaymentDefault,
} = impl;

export function listCategories(city?: string): Promise<PublicCategory[]> {
  return listCategoriesFromBackend(city) as Promise<PublicCategory[]>;
}
