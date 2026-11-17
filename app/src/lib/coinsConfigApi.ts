import { supabase } from './supabase';
import { DEFAULT_COINS_CONFIG, type CoinsConfig } from './coins';
import { isDemoMode } from './config';

export interface AdminCoinSummary {
  issued_paise: number;
  redeemed_paise: number;
  expired_paise: number;
  outstanding_paise: number;
  budget_paise: number | null;
  budget_left_paise: number | null;
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const getCoinsConfig = () => isDemoMode
  ? Promise.resolve({
      ...DEFAULT_COINS_CONFIG,
      coins_earning_enabled: true,
      coins_redemption_enabled: true,
    })
  : rpc<CoinsConfig>('get_coins_config');
export const getAdminCoinsConfig = () => rpc<CoinsConfig>('admin_get_coins_config');
export const getAdminCoinSummary = () => rpc<AdminCoinSummary>('admin_coin_summary');
export const setAdminCoinsConfig = (config: CoinsConfig) =>
  rpc<CoinsConfig>('admin_set_coins_config', { p_config: config });
export const setCoinsFeature = (key: 'coins_earning' | 'coins_redemption', enabled: boolean) =>
  rpc<Record<string, boolean | Record<string, boolean>>>('admin_set_feature', { p_key: key, p_enabled: enabled });
