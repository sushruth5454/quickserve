import { createClient } from "npm:@supabase/supabase-js@2";
import {
  classifyAssetRegistrationResult,
  handleBrandingAssetsRequest,
  type BrandingAssetDependencies,
  type BrandingAssetStatus,
} from "./logic.ts";
import { requireEnv } from "../_shared/razorpay.ts";

const BUCKET = "branding-assets";

function dependencies(): BrandingAssetDependencies {
  const projectUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");

  const serviceClient = () =>
    createClient(projectUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const userClient = (token: string) =>
    createClient(projectUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  const publicClient = () =>
    createClient(projectUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  return {
    projectUrl,
    async verifyUser(token) {
      const { data, error } = await serviceClient().auth.getUser(token);
      if (error || !data.user) return null;
      return { id: data.user.id };
    },
    async isAdmin(token) {
      const { error } = await userClient(token).rpc("admin_list_branding_versions");
      if (!error) return true;
      if (error.code === "42501") return false;
      throw new Error("admin role check failed");
    },
    async getFeatures(token) {
      const { data, error } = await userClient(token).rpc("get_app_features");
      if (error || !data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("feature state unavailable");
      }
      return data as Record<string, unknown>;
    },
    async getPublicFeatures() {
      const { data, error } = await publicClient().rpc("get_app_features");
      if (error || !data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("feature state unavailable");
      }
      return data as Record<string, unknown>;
    },
    async getAssetStatus(assetId) {
      const { data, error } = await serviceClient().rpc("service_get_branding_asset_status", {
        p_asset_id: assetId,
      });
      if (error) throw new Error("asset status unavailable");
      if (!Array.isArray(data) || data.length === 0) return null;
      if (data.length !== 1) throw new Error("asset status is ambiguous");
      return data[0] as BrandingAssetStatus;
    },
    async uploadPrivate(path, bytes) {
      const { error } = await serviceClient().storage.from(BUCKET).upload(path, bytes, {
        contentType: "image/png",
        upsert: false,
        cacheControl: "300",
      });
      return !error;
    },
    async downloadPrivate(path) {
      const { data, error } = await serviceClient().storage.from(BUCKET).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async removePrivate(path) {
      const { error } = await serviceClient().storage.from(BUCKET).remove([path]);
      return !error;
    },
    async registerAsset(input) {
      const { data, error } = await serviceClient().rpc("admin_register_branding_asset", {
        p_asset_id: input.assetId,
        p_sha256: input.sha256,
        p_byte_length: input.byteLength,
        p_width: input.width,
        p_height: input.height,
        p_actor_id: input.actorId,
      });
      return classifyAssetRegistrationResult(error?.code, data, input.assetId);
    },
    async createSignedUrl(path, expiresInSeconds) {
      const { data, error } = await serviceClient().storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
      return error ? null : data?.signedUrl ?? null;
    },
  };
}

Deno.serve((request) => handleBrandingAssetsRequest(request, dependencies()));
