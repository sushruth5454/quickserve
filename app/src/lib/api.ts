/**
 * Backend facade used by every screen. Picks the real Supabase implementation or the in-memory demo backend
 * (EXPO_PUBLIC_DEMO_MODE=1, or Supabase env vars missing). Screens never branch on the mode.
 */
import type { Api } from './apiTypes';
import { isDemoMode } from './config';
import { demoApi } from './demo/demoApi';
import * as supabaseApi from './supabaseApi';

export type * from './apiTypes';
export { isDemoMode };

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
  listCategories,
  listMyAddresses,
  addAddress,
  searchProviders,
  listTopRated,
  getProviderDetail,
  getProviderService,
  createBooking,
  createPayment,
  listMyBookings,
  getBooking,
  getQuotes,
  getPayments,
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
  cancelBooking,
  disputeBooking,
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
  upsertProviderProfile,
  setOnline,
  listMyServices,
  upsertService,
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
  registerPushDevice,
  unregisterPushDevice,
} = impl;
