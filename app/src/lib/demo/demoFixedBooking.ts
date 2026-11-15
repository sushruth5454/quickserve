import type { CreateFixedBookingInput } from '../fixedBooking';
import type { ServicePackage } from '../types';

const packages: ServicePackage[] = [];

export const demoFixedBooking = {
  async listPackages(providerServiceId: string) {
    return packages.filter((item) => item.provider_service_id === providerServiceId && item.active && item.price_type === 'fixed');
  },
  async create(_input: CreateFixedBookingInput): Promise<string> {
    throw new Error('Fixed package checkout is not available in the current demo catalog.');
  },
  async sendAddons(_bookingId: string, _addons: unknown[], _note?: string): Promise<string> {
    throw new Error('No fixed demo booking is active.');
  },
  async approveChangeOrder(_bookingId: string, _quoteId: string) {
    throw new Error('No fixed demo change order is active.');
  },
};

