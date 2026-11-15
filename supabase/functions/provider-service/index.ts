import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, requireEnv } from "../_shared/razorpay.ts";
import { validatePackageInput, validateServiceInput, type ProfileSchema } from "./logic.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);
    const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "unauthorized" }, 401);
    const uid = userData.user.id;
    const body = await req.json().catch(() => ({}));
    const action = (body as { action?: string }).action;

    if (action === "save_service") {
      const { data: provider, error: providerError } = await admin.from("providers")
        .select("id, service_radius_km")
        .eq("id", uid)
        .maybeSingle();
      if (providerError) throw providerError;
      if (!provider) return json({ error: "Create your provider profile first." }, 400);
      const raw = body as { categoryId?: string };
      if (typeof raw.categoryId !== "string") return json({ error: "Choose a service category." }, 422);
      const [{ data: category, error: categoryError }, { data: skills, error: skillsError }] = await Promise.all([
        admin.from("categories").select("id, active, profile_schema").eq("id", raw.categoryId).maybeSingle(),
        admin.from("category_skills").select("kind, slug, label").eq("category_id", raw.categoryId).eq("active", true),
      ]);
      if (categoryError) throw categoryError;
      if (skillsError) throw skillsError;
      if (!category?.active) return json({ error: "That service category is no longer available." }, 422);
      const input = validateServiceInput(body, {
        schema: (category.profile_schema ?? { type: "object", properties: {} }) as ProfileSchema,
        specialisations: (skills ?? []).filter((skill) => skill.kind === "skill").map((skill) => skill.slug),
        brands: (skills ?? []).filter((skill) => skill.kind === "brand").map((skill) => skill.label),
        tools: (skills ?? []).filter((skill) => skill.kind === "tool").map((skill) => skill.label),
        serviceRadiusKm: Number(provider.service_radius_km ?? 0),
      });

      let existing: { id: string; category_id: string } | null = null;
      if (input.serviceId) {
        const result = await admin.from("provider_services").select("id, category_id").eq("id", input.serviceId).eq("provider_id", uid).maybeSingle();
        if (result.error) throw result.error;
        existing = result.data;
        if (!existing) return json({ error: "Service not found." }, 404);
        if (existing.category_id !== input.categoryId) return json({ error: "Category cannot be changed while editing a service." }, 422);
      } else {
        const result = await admin.from("provider_services").select("id, category_id").eq("provider_id", uid).eq("category_id", input.categoryId).maybeSingle();
        if (result.error) throw result.error;
        existing = result.data;
      }

      const fields = {
        skill_level: input.skillLevel,
        visit_fee: input.visitFee,
        labour_rate: input.labourRate,
        rate_unit: input.rateUnit,
        specialisations: input.specialisations,
        brands: input.brands,
        tools: input.tools,
        attributes: input.attributes,
        max_travel_km: input.maxTravelKm,
        travel_fee_mode: input.travelFeeMode,
        travel_fee_flat: input.travelFeeFlat,
        travel_fee_per_km: input.travelFeePerKm,
        active: true,
      };
      const result = existing
        ? await admin.from("provider_services").update(fields).eq("id", existing.id).eq("provider_id", uid).select("id").single()
        : await admin.from("provider_services").insert({ provider_id: uid, category_id: input.categoryId, ...fields }).select("id").single();
      if (result.error) throw result.error;
      return json({ id: result.data.id });
    }

    if (action === "save_package") {
      const input = validatePackageInput(body);
      const { data: service, error: serviceError } = await admin.from("provider_services")
        .select("id")
        .eq("id", input.providerServiceId)
        .eq("provider_id", uid)
        .maybeSingle();
      if (serviceError) throw serviceError;
      if (!service) return json({ error: "Provider service not found." }, 404);
      if (input.packageId) {
        const { data: existing, error: packageError } = await admin.from("service_packages")
          .select("id")
          .eq("id", input.packageId)
          .eq("provider_service_id", input.providerServiceId)
          .maybeSingle();
        if (packageError) throw packageError;
        if (!existing) return json({ error: "Package not found." }, 404);
      }
      const result = input.packageId
        ? await admin.from("service_packages").update(input.package).eq("id", input.packageId).eq("provider_service_id", input.providerServiceId).select("id").single()
        : await admin.from("service_packages").insert({ ...input.package, provider_service_id: input.providerServiceId }).select("id").single();
      if (result.error) throw result.error;
      return json({ id: result.data.id });
    }

    return json({ error: "unknown action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save service.";
    const known = /required|Choose|Choose at most|must|invalid|unsupported|contact|phone|service category|Maximum travel|Labour rate|Visit fee|Package|deliverable|configured/i.test(message);
    if (known) return json({ error: message }, 422);
    console.error("provider-service", message);
    return json({ error: "Could not save service. Try again." }, 500);
  }
});
