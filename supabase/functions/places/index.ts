import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, requireEnv } from "../_shared/razorpay.ts";

const PLACES = "https://places.googleapis.com/v1";
const TIMEOUT_MS = 8000;

interface Prediction {
  placePrediction?: {
    placeId: string;
    text?: { text: string };
    structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
  };
}
interface AddressComponent {
  longText: string;
  types: string[];
}
interface PlaceDetails {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  addressComponents?: AddressComponent[];
}

const pick = (components: AddressComponent[], ...types: string[]) => {
  for (const t of types) {
    const c = components.find((x) => x.types.includes(t));
    if (c) return c.longText;
  }
  return null;
};

/**
 * Address search for the app via Google Places API (New). The key (GOOGLE_MAPS_API_KEY) stays on the server.
 * POST { action: "autocomplete", input, sessionToken, lat?, lng? } -> { suggestions: [{ placeId, title, subtitle }] }
 * POST { action: "details", placeId, sessionToken } -> { place: { lat, lng, title, area, city, line1 } }
 * The same sessionToken on the autocomplete calls and the final details call bills them as one session.
 * Without a key it answers 503 { error: "not_configured" } and the app falls back to the phone's geocoder.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!key) return json({ error: "not_configured" }, 503);

  // Signed-in users only, so the paid API can't be used anonymously.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: userData } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!userData.user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken.slice(0, 64) : undefined;
  const headers = { "Content-Type": "application/json", "X-Goog-Api-Key": key };

  try {
    if (body.action === "autocomplete") {
      const input = typeof body.input === "string" ? body.input.trim().slice(0, 120) : "";
      if (input.length < 2) return json({ suggestions: [] });
      const lat = Number(body.lat), lng = Number(body.lng);
      const bias = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        ? { locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 50000 } } }
        : {};
      const res = await fetch(`${PLACES}/places:autocomplete`, {
        method: "POST",
        headers,
        body: JSON.stringify({ input, sessionToken, includedRegionCodes: ["in"], languageCode: "en", ...bias }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        console.error("places autocomplete", res.status, await res.text());
        return json({ error: "search_unavailable" }, 502);
      }
      const out = (await res.json()) as { suggestions?: Prediction[] };
      return json({
        suggestions: (out.suggestions ?? [])
          .map((s) => s.placePrediction)
          .filter((p): p is NonNullable<Prediction["placePrediction"]> => !!p?.placeId)
          .map((p) => ({
            placeId: p.placeId,
            title: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
            subtitle: p.structuredFormat?.secondaryText?.text ?? "",
          })),
      });
    }

    if (body.action === "details") {
      const placeId = typeof body.placeId === "string" ? body.placeId : "";
      if (!/^[\w-]{10,300}$/.test(placeId)) return json({ error: "invalid place" }, 400);
      const qs = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : "";
      const res = await fetch(`${PLACES}/places/${placeId}${qs}`, {
        headers: { ...headers, "X-Goog-FieldMask": "id,displayName,formattedAddress,location,addressComponents" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        console.error("places details", res.status, await res.text());
        return json({ error: "search_unavailable" }, 502);
      }
      const p = (await res.json()) as PlaceDetails;
      if (!p.location) return json({ error: "place has no location" }, 422);
      const comps = p.addressComponents ?? [];
      const city = pick(comps, "locality", "administrative_area_level_3", "administrative_area_level_2") ?? "";
      const area = pick(comps, "sublocality_level_1", "sublocality", "neighborhood", "locality") ?? p.displayName?.text ?? city;
      return json({
        place: {
          lat: p.location.latitude,
          lng: p.location.longitude,
          title: p.displayName?.text ?? area,
          area,
          city,
          line1: p.formattedAddress ?? null,
        },
      });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "search_unavailable" }, 502);
  }
});
