export interface ProfileField {
  type: "string" | "integer" | "number" | "boolean" | "array";
  enum?: string[];
  maxItems?: number;
  items?: { type: string; enum?: string[] };
}

export interface ProfileSchema {
  type: "object";
  properties: Record<string, ProfileField>;
  required?: string[];
}

export interface ServiceConfig {
  schema: ProfileSchema;
  specialisations: string[];
  brands: string[];
  tools: string[];
  serviceRadiusKm: number;
}

export interface PackageDeliverable {
  type: string;
  qty: number;
  spec: string;
}

export interface ServiceInput {
  serviceId?: string | null;
  categoryId: string;
  skillLevel: string;
  visitFee: number;
  labourRate: number;
  rateUnit: string;
  specialisations: string[];
  brands: string[];
  tools: string[];
  attributes: Record<string, unknown>;
  maxTravelKm: number | null;
  travelFeeMode: string;
  travelFeeFlat: number;
  travelFeePerKm: number;
}

export interface PackageInput {
  packageId?: string | null;
  providerServiceId: string;
  package: {
    title: string;
    description: string;
    price_type: string;
    price: number | null;
    price_min: number | null;
    price_max: number | null;
    unit: string;
    qty_min: number;
    qty_max: number;
    duration_min: number | null;
    inclusions: string[];
    exclusions: string[];
    deliverables: PackageDeliverable[];
    turnaround_days: number | null;
    revisions_included: number;
    raw_files_included: boolean;
    usage_rights: Record<string, unknown>;
    travel_included_km: number;
    active: boolean;
    sort_order: number;
  };
}

const CONTACT_HINT =
  /(^|[^0-9])(?:\+?91[\s().-]*)?[6-9](?:[\s().-]*\d){9}([^0-9]|$)|[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:whats\s?app|telegram|phonepe|gpay|paytm|upi)\b/i;

export function containsContactHint(value: string): boolean {
  return CONTACT_HINT.test(value);
}

function fail(message: string): never {
  throw new Error(message);
}

function strings(value: unknown, label: string, limit: number): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) fail(`${label} must be a list.`);
  const result = value as string[];
  if (result.length > limit) fail(`Choose at most ${limit} ${label.toLowerCase()}.`);
  if (result.some((item) => !item.trim() || item.length > 80)) fail(`${label} contain an invalid value.`);
  return [...new Set(result)];
}

function exactAllowed(values: string[], allowed: string[], label: string) {
  if (values.some((value) => !allowed.includes(value))) fail(`${label} contain an option not configured for this service.`);
}

function validateAttributes(schema: ProfileSchema, attributes: Record<string, unknown>) {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) fail("Attributes must be an object.");
  const allowedKeys = new Set(Object.keys(schema.properties ?? {}));
  if (Object.keys(attributes).some((key) => !allowedKeys.has(key))) fail("Attributes contain a field not configured for this service.");
  for (const [key, field] of Object.entries(schema.properties ?? {})) {
    const value = attributes[key];
    if ((schema.required ?? []).includes(key) && (value === undefined || value === null || value === "")) fail(`${key} is required.`);
    if (value === undefined || value === null || value === "") continue;
    const allowed = field.enum ?? field.items?.enum;
    if (field.type === "string") {
      if (typeof value !== "string") fail(`${key} must be text.`);
      if (field.enum && !field.enum.includes(value)) fail(`${key} has an unsupported value.`);
      if (containsContactHint(value)) fail("Do not add phone or contact details to service descriptions.");
    } else if (field.type === "integer" || field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || (field.type === "integer" && !Number.isInteger(value))) fail(`${key} must be a ${field.type === "integer" ? "whole " : ""}number.`);
    } else if (field.type === "boolean") {
      if (typeof value !== "boolean") fail(`${key} must be yes or no.`);
    } else if (field.type === "array") {
      const values = strings(value, key, field.maxItems ?? 50);
      if (allowed && values.some((item) => !allowed.includes(item))) fail(`${key} contains an unsupported value.`);
      if (values.some(containsContactHint)) fail("Do not add phone or contact details to service descriptions.");
    }
  }
}

export function validateServiceInput(raw: unknown, config: ServiceConfig): ServiceInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Service details are required.");
  const input = raw as Partial<ServiceInput>;
  if (typeof input.categoryId !== "string" || !input.categoryId) fail("Choose a service category.");
  if (input.serviceId !== undefined && input.serviceId !== null && typeof input.serviceId !== "string") fail("Invalid service id.");
  if (!["beginner", "skilled", "expert", "certified"].includes(input.skillLevel ?? "")) fail("Choose a valid experience level.");
  if (!Number.isInteger(input.visitFee) || (input.visitFee ?? -1) < 0 || (input.visitFee ?? 0) > 200000) fail("Visit fee must be between ₹0 and ₹2,000.");
  if (!Number.isInteger(input.labourRate) || (input.labourRate ?? 0) <= 0 || (input.labourRate ?? 0) > 5000000) fail("Labour rate must be between ₹0.01 and ₹50,000.");
  if (!["job", "hour"].includes(input.rateUnit ?? "")) fail("Choose a valid labour rate unit.");
  const specialisations = strings(input.specialisations, "Specialisations", 20);
  const brands = strings(input.brands, "Brands", 15);
  const tools = strings(input.tools, "Tools", 15);
  exactAllowed(specialisations, config.specialisations, "Specialisations");
  exactAllowed(brands, config.brands, "Brands");
  exactAllowed(tools, config.tools, "Tools");
  validateAttributes(config.schema, (input.attributes ?? {}) as Record<string, unknown>);
  if (!["none", "flat", "per_km"].includes(input.travelFeeMode ?? "")) fail("Choose a valid travel fee mode.");
  if (!Number.isInteger(input.travelFeeFlat) || (input.travelFeeFlat ?? -1) < 0 || (input.travelFeeFlat ?? 0) > 10000000) fail("Travel fee is invalid.");
  if (!Number.isInteger(input.travelFeePerKm) || (input.travelFeePerKm ?? -1) < 0 || (input.travelFeePerKm ?? 0) > 1000000) fail("Per-kilometre fee is invalid.");
  if (input.travelFeeMode === "none") {
    if (input.maxTravelKm !== null) fail("Maximum travel must be empty when extra travel is disabled.");
  } else {
    if (!Number.isInteger(input.maxTravelKm) || (input.maxTravelKm ?? 0) < Math.max(1, config.serviceRadiusKm) || (input.maxTravelKm ?? 0) > 100) {
      fail(`Maximum travel must be ${Math.max(1, config.serviceRadiusKm)}–100 km.`);
    }
    if (input.travelFeeMode === "flat" && (input.travelFeeFlat ?? 0) < 0) fail("Enter a valid travel fee.");
    if (input.travelFeeMode === "per_km" && (input.travelFeePerKm ?? 0) <= 0) fail("Per-kilometre travel fee must be above ₹0.");
  }
  return input as ServiceInput;
}

function validatePackageNumber(value: unknown, label: string, allowNull = false) {
  if (allowNull && value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} is invalid.`);
}

export function validatePackageInput(raw: unknown): PackageInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Package details are required.");
  const input = raw as Partial<PackageInput>;
  if (typeof input.providerServiceId !== "string" || !input.providerServiceId) fail("Provider service not found.");
  if (input.packageId !== undefined && input.packageId !== null && typeof input.packageId !== "string") fail("Invalid package id.");
  const value = input.package;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Package details are required.");
  const p = value as PackageInput["package"];
  if (typeof p.title !== "string" || p.title.trim().length < 2 || p.title.length > 120) fail("Package title must be 2–120 characters.");
  if (typeof p.description !== "string" || p.description.length > 1000) fail("Package description is too long.");
  if ([p.title, p.description].some(containsContactHint)) fail("Keep phone, email, WhatsApp, UPI and payment details out of package descriptions.");
  if (!["fixed", "range", "from", "quote"].includes(p.price_type)) fail("Choose a valid package price type.");
  if (!["job", "hour", "day", "session", "person", "plate", "sqft", "bhk", "seat", "litre", "event", "month"].includes(p.unit)) fail("Choose a valid pricing unit.");
  if (p.price_type !== "quote") validatePackageNumber(p.price_min, "Minimum price");
  validatePackageNumber(p.price, "Price", true);
  validatePackageNumber(p.price_max, "Maximum price", true);
  if (!Number.isFinite(p.qty_min) || p.qty_min <= 0 || !Number.isFinite(p.qty_max) || p.qty_max < p.qty_min) fail("Enter valid minimum and maximum quantities.");
  if (p.duration_min !== null && (!Number.isInteger(p.duration_min) || p.duration_min <= 0)) fail("Duration must be a positive whole number.");
  if (p.turnaround_days !== null && (!Number.isInteger(p.turnaround_days) || p.turnaround_days < 0)) fail("Turnaround must be a non-negative whole number.");
  if (!Array.isArray(p.inclusions) || !Array.isArray(p.exclusions) || [...p.inclusions, ...p.exclusions].some((item) => typeof item !== "string" || item.length > 160)) fail("Inclusions and exclusions are invalid.");
  if ([...p.inclusions, ...p.exclusions].some(containsContactHint)) fail("Keep contact details out of package inclusions and exclusions.");
  if (!Array.isArray(p.deliverables) || p.deliverables.length === 0) fail("Add at least one deliverable.");
  if (p.deliverables.some((item) =>
    !item || typeof item.type !== "string" || !item.type.trim() || item.type.length > 60 ||
    typeof item.spec !== "string" || !item.spec.trim() || item.spec.length > 500 ||
    typeof item.qty !== "number" || item.qty <= 0 ||
    containsContactHint(item.type) || containsContactHint(item.spec)
  )) fail("Every deliverable needs a safe type, quantity and specification.");
  const rights = p.usage_rights;
  if (!rights || typeof rights !== "object" || Array.isArray(rights) || Object.keys(rights).some((key) => !["organic_posting", "paid_ads_days", "exclusivity_days"].includes(key))) fail("Usage rights are invalid.");
  if (rights.organic_posting !== undefined && typeof rights.organic_posting !== "boolean") fail("Organic posting must be yes or no.");
  if (rights.paid_ads_days !== undefined && ![0, 30, 90, 365].includes(Number(rights.paid_ads_days))) fail("Paid-ad usage is invalid.");
  if (!Number.isInteger(p.revisions_included) || p.revisions_included < 0 || typeof p.raw_files_included !== "boolean") fail("Revision and raw-file settings are invalid.");
  if (!Number.isFinite(p.travel_included_km) || p.travel_included_km < 0 || typeof p.active !== "boolean" || !Number.isInteger(p.sort_order)) fail("Package settings are invalid.");
  // The save runs with the service role, so only these columns may reach the database. Anything else the
  // client sends (provider_service_id, id, package_template_id…) is dropped, never written.
  const pkg = Object.fromEntries(PACKAGE_COLUMNS.map((key) => [key, p[key]])) as PackageInput["package"];
  return { providerServiceId: input.providerServiceId, packageId: input.packageId ?? null, package: pkg };
}

const PACKAGE_COLUMNS = [
  "title", "description", "price_type", "price", "price_min", "price_max", "unit", "qty_min", "qty_max",
  "duration_min", "inclusions", "exclusions", "deliverables", "turnaround_days", "revisions_included",
  "raw_files_included", "usage_rights", "travel_included_km", "active", "sort_order",
] as const satisfies readonly (keyof PackageInput["package"])[];
