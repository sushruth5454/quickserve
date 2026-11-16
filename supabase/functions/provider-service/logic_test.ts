import { validatePackageInput, validateServiceInput } from "./logic.ts";

const service = {
  categoryId: "cat-1",
  skillLevel: "skilled",
  visitFee: 19900,
  labourRate: 29900,
  rateUnit: "job",
  specialisations: ["split"],
  brands: ["Daikin"],
  tools: ["Vacuum pump"],
  attributes: { equipment: ["split"], turnaround_days: 2 },
  maxTravelKm: 20,
  travelFeeMode: "flat",
  travelFeeFlat: 5000,
  travelFeePerKm: 0,
};

const config = {
  schema: {
    type: "object" as const,
    properties: {
      equipment: { type: "array" as const, items: { type: "string", enum: ["split", "window"] } },
      turnaround_days: { type: "integer" as const },
    },
  },
  specialisations: ["split"],
  brands: ["Daikin"],
  tools: ["Vacuum pump"],
  serviceRadiusKm: 10,
};

Deno.test("service input accepts exact category configuration", () => {
  const parsed = validateServiceInput(service, config);
  if (parsed.specialisations[0] !== "split" || parsed.attributes.turnaround_days !== 2) throw new Error("valid service was changed");
});

Deno.test("service input rejects arbitrary tags and contact data", () => {
  for (const patch of [
    { brands: ["Any brand"] },
    { tools: ["My special custom tool"] },
    { specialisations: ["unknown"] },
    { attributes: { equipment: ["split"], turnaround_days: 2, phone: "9876543210" } },
    { attributes: { equipment: ["split"], turnaround_days: "call 9876543210" } },
  ]) {
    let rejected = false;
    try { validateServiceInput({ ...service, ...patch }, config); } catch { rejected = true; }
    if (!rejected) throw new Error("unsafe service input was accepted");
  }
});

const packageInput = {
  providerServiceId: "svc-1",
  package: {
    title: "Jet service",
    description: "Outdoor unit cleaning and pressure wash.",
    price_type: "fixed",
    price: 49900,
    price_min: 49900,
    price_max: 49900,
    unit: "job",
    qty_min: 1,
    qty_max: 1,
    duration_min: 90,
    inclusions: ["Outdoor unit wash"],
    exclusions: ["Spare parts"],
    deliverables: [{ type: "jet_service", qty: 1, spec: "Split AC outdoor unit" }],
    turnaround_days: 0,
    revisions_included: 0,
    raw_files_included: false,
    usage_rights: {},
    travel_included_km: 10,
    active: true,
    sort_order: 0,
  },
};

Deno.test("package descriptions reject off-platform contact hints", () => {
  let rejected = false;
  try { validatePackageInput({ ...packageInput, package: { ...packageInput.package, description: "Call me on 9876543210" } }); } catch { rejected = true; }
  if (!rejected) throw new Error("contact detail was accepted");
  validatePackageInput(packageInput);
});

Deno.test("package saves only write package columns (no moving a package to another service)", () => {
  const out = validatePackageInput({
    ...packageInput,
    package: { ...packageInput.package, provider_service_id: "victim-service", id: "other", package_template_id: "x" },
  });
  const keys = Object.keys(out.package);
  for (const forbidden of ["provider_service_id", "id", "package_template_id"]) {
    if (keys.includes(forbidden)) throw new Error(`${forbidden} reached the database payload`);
  }
  if (out.package.title !== packageInput.package.title) throw new Error("package fields were lost");
});
