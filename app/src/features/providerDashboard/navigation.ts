import { router } from 'expo-router';

export const openBooking = (id: string) => router.push({ pathname: '/booking/[id]', params: { id } });
