import { supabase } from '../../lib/supabase';

export interface AdminAiFeatureUsage {
  feature: string;
  calls_today: number;
  calls_month: number;
  error_rate_percent: number;
  usage_events_today: number;
  input_tokens_month: number;
  output_tokens_month: number;
  cost_month_micros_usd: number;
}

export interface AdminAiUsageDashboard {
  features: AdminAiFeatureUsage[];
  monthly_cost_micros_usd: number;
  monthly_budget_usd: number;
  monthly_budget_micros_usd: number;
}

export async function getAdminAiUsageDashboard(): Promise<AdminAiUsageDashboard> {
  const { data, error } = await supabase.rpc('admin_ai_usage_dashboard');
  if (error) throw new Error(error.message);
  return data as AdminAiUsageDashboard;
}
