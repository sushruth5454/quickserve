import type { CategorySkill, ProfileSchema } from '../../lib/onboarding';
import { parseRupees, validateFees, validateProfileAttributes } from '../../lib/onboarding/validation';
import type { ProviderService, RateUnit, SkillLevel, TravelFeeMode } from '../../lib/types';

export const SERVICE_EDITOR_STEPS = ['category', 'expertise', 'details', 'pricing', 'coverage', 'review'] as const;
export type ServiceEditorStep = (typeof SERVICE_EDITOR_STEPS)[number];

export interface ServiceEditorState {
  serviceId: string | null;
  categoryId: string | null;
  level: SkillLevel;
  visitFee: string;
  labour: string;
  unit: RateUnit;
  specialisations: string[];
  brands: string[];
  tools: string[];
  attributes: Record<string, unknown>;
  maxTravel: string;
  travelFeeMode: TravelFeeMode;
  travelFlat: string;
  travelPerKm: string;
}

export type ServiceEditorErrors = {
  category?: string;
  expertise?: string;
  attributes?: string;
  visitFee?: string;
  labourRate?: string;
  travel?: string;
};

export type EditableService = ProviderService & { specialisations?: string[]; brands?: string[]; tools?: string[] };

export const EMPTY_SERVICE_EDITOR_STATE: ServiceEditorState = {
  serviceId: null,
  categoryId: null,
  level: 'skilled',
  visitFee: '',
  labour: '',
  unit: 'job',
  specialisations: [],
  brands: [],
  tools: [],
  attributes: {},
  maxTravel: '',
  travelFeeMode: 'none',
  travelFlat: '',
  travelPerKm: '',
};

export function serviceEditorStateFromService(service?: EditableService): ServiceEditorState {
  if (!service) return { ...EMPTY_SERVICE_EDITOR_STATE };
  return {
    serviceId: service.id,
    categoryId: service.category_id,
    level: service.skill_level,
    visitFee: String(service.visit_fee / 100),
    labour: String(service.labour_rate / 100),
    unit: service.rate_unit,
    specialisations: [...(service.specialisations ?? [])],
    brands: [...(service.brands ?? [])],
    tools: [...(service.tools ?? [])],
    attributes: { ...(service.attributes ?? {}) },
    maxTravel: service.max_travel_km == null ? '' : String(service.max_travel_km),
    travelFeeMode: service.travel_fee_mode ?? 'none',
    travelFlat: service.travel_fee_flat ? String(service.travel_fee_flat / 100) : '',
    travelPerKm: service.travel_fee_per_km ? String(service.travel_fee_per_km / 100) : '',
  };
}

export function selectServiceCategory(state: ServiceEditorState, categoryId: string): ServiceEditorState {
  if (state.categoryId === categoryId) return state;
  return {
    ...state,
    categoryId,
    specialisations: [],
    brands: [],
    tools: [],
    attributes: {},
  };
}

export function configuredFieldIsExpertise(key: string, field: ProfileSchema['properties'][string]): boolean {
  if (field.type !== 'array' || !(field.enum ?? field.items?.enum)?.length) return false;
  return /expertise|special|style|technique|equipment|event|pest|tank|cuisine|genre|format|niche|language|brand/i.test(key);
}

export function profileFieldOptions(field: ProfileSchema['properties'][string]): string[] {
  return field.enum ?? field.items?.enum ?? [];
}

export function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function expertiseExplanation(label: string): string {
  return `Choose this if you can complete ${label.toLowerCase()} work independently.`;
}

export function attributeExample(key: string, field: ProfileSchema['properties'][string]): string {
  const values = profileFieldOptions(field);
  if (values.length) return `Example: ${values.slice(0, 3).map(humanize).join(', ')}.`;
  if (field.type === 'integer' || field.type === 'number') return /turnaround/i.test(key) ? 'Example: 7 days.' : 'Enter a whole number.';
  if (/software/i.test(key)) return 'Example: Premiere Pro or CapCut.';
  if (/size|count|guest|team|budget/i.test(key)) return 'Enter the range you can reliably handle.';
  return 'Enter a short, customer-facing detail. Do not add contact information.';
}

export function skillsForCategory(skills: CategorySkill[], categoryId: string | null, kind: CategorySkill['kind']) {
  return skills
    .filter((skill) => skill.category_id === categoryId && skill.kind === kind)
    .map((skill) => ({ value: kind === 'skill' ? skill.slug : skill.label, label: skill.label }));
}

export interface ExpertiseOption {
  value: string;
  label: string;
  /** Profile-field values that mean the same job; kept in sync so matching sees both stores. */
  links?: { key: string; value: string }[];
}

export interface ExpertiseGroup {
  key: string;
  title: string;
  target: 'specialisations' | 'attribute';
  options: ExpertiseOption[];
}

function stems(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word && !['and', 'or', 'the', 'of'].includes(word))
    .map((word) => {
      if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
      if (/(ch|sh|x|o)es$/.test(word)) return word.slice(0, -2);
      if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
      return word;
    });
}

function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const shortest = Math.min(a.length, b.length);
  if (shortest < 4) return false;
  let prefix = 0;
  while (prefix < shortest && a[prefix] === b[prefix]) prefix += 1;
  return prefix >= shortest - 1;
}

/** True when every word of a profile-field value is covered by the job label (e.g. "bed_bugs" ↔ "Bed bugs"). */
export function sameExpertise(attributeValue: string, jobLabel: string): boolean {
  const attribute = stems(attributeValue);
  const job = stems(jobLabel);
  return attribute.length > 0 && attribute.every((word) => job.some((candidate) => sameWord(word, candidate)));
}

/**
 * Every selectable expertise list for a category: configured jobs first, then expertise-like profile fields.
 * Profile-field values that duplicate a job are folded into that job so each job is shown once.
 */
export function expertiseGroups(skills: CategorySkill[], categoryId: string | null, schema: ProfileSchema): ExpertiseGroup[] {
  const jobs: ExpertiseOption[] = skillsForCategory(skills, categoryId, 'skill').map((job) => ({ ...job, links: [] }));
  const fieldGroups: ExpertiseGroup[] = [];
  for (const [key, field] of Object.entries(schema.properties ?? {})) {
    if (!configuredFieldIsExpertise(key, field)) continue;
    const options: ExpertiseOption[] = [];
    for (const value of profileFieldOptions(field)) {
      const job = jobs.find((candidate) => sameExpertise(value, candidate.label));
      if (job) job.links!.push({ key, value });
      else options.push({ value, label: humanize(value) });
    }
    if (options.length) fieldGroups.push({ key, title: humanize(key), target: 'attribute', options });
  }
  return [
    ...(jobs.length ? [{ key: 'specialisations', title: 'Jobs you do', target: 'specialisations' as const, options: jobs }] : []),
    ...fieldGroups,
  ];
}

export function expertiseSelected(
  group: ExpertiseGroup,
  option: ExpertiseOption,
  specialisations: string[],
  attributes: Record<string, unknown>,
): boolean {
  const has = (key: string, value: string) => Array.isArray(attributes[key]) && (attributes[key] as string[]).includes(value);
  if (group.target === 'attribute') return has(group.key, option.value);
  return specialisations.includes(option.value) || (option.links ?? []).some((link) => has(link.key, link.value));
}

/** Toggles one visible option, updating the job and any linked profile-field values together. */
export function toggleExpertise(state: ServiceEditorState, group: ExpertiseGroup, option: ExpertiseOption): ServiceEditorState {
  const on = !expertiseSelected(group, option, state.specialisations, state.attributes);
  const attributes = { ...state.attributes };
  const setAttribute = (key: string, value: string) => {
    const current = Array.isArray(attributes[key]) ? attributes[key] as string[] : [];
    const next = on ? [...new Set([...current, value])] : current.filter((item) => item !== value);
    if (next.length) attributes[key] = next; else delete attributes[key];
  };
  if (group.target === 'attribute') {
    setAttribute(group.key, option.value);
    return { ...state, attributes };
  }
  for (const link of option.links ?? []) setAttribute(link.key, link.value);
  const specialisations = on
    ? [...new Set([...state.specialisations, option.value])]
    : state.specialisations.filter((item) => item !== option.value);
  return { ...state, specialisations, attributes };
}

export function selectedExpertiseCount(groups: ExpertiseGroup[], state: Pick<ServiceEditorState, 'specialisations' | 'attributes'>): number {
  return groups.reduce(
    (total, group) => total + group.options.filter((option) => expertiseSelected(group, option, state.specialisations, state.attributes)).length,
    0,
  );
}

/** Human labels for everything a saved service has selected across all expertise groups. */
export function serviceExpertiseLabels(service: EditableService, skills: CategorySkill[], schema: ProfileSchema): string[] {
  const specialisations = service.specialisations ?? [];
  const attributes = (service.attributes ?? {}) as Record<string, unknown>;
  return [
    ...new Set(
      expertiseGroups(skills, service.category_id, schema).flatMap((group) =>
        group.options.filter((option) => expertiseSelected(group, option, specialisations, attributes)).map((option) => option.label),
      ),
    ),
  ];
}

export function configuredExpertiseCount(
  state: ServiceEditorState,
  schema: ProfileSchema,
): number {
  let count = state.specialisations.length;
  for (const [key, field] of Object.entries(schema.properties)) {
    if (!configuredFieldIsExpertise(key, field)) continue;
    const value = state.attributes[key];
    count += Array.isArray(value) ? value.length : value ? 1 : 0;
  }
  return count;
}

export function validateServiceEditorStep(
  step: ServiceEditorStep,
  state: ServiceEditorState,
  schema: ProfileSchema,
  skills: CategorySkill[],
  radiusKm: number,
): ServiceEditorErrors {
  const errors: ServiceEditorErrors = {};
  if (step === 'category' && !state.categoryId) errors.category = 'Choose the service category you offer.';
  if (step === 'expertise') {
    if (
      configuredExpertiseCount(state, schema) === 0 &&
      (skillsForCategory(skills, state.categoryId, 'skill').length > 0 ||
        Object.entries(schema.properties).some(([key, field]) => configuredFieldIsExpertise(key, field)))
    ) {
      errors.expertise = 'Choose at least one exact area you handle.';
    }
  }
  if (step === 'details') {
    const attributeError = validateProfileAttributes(schema, state.attributes);
    if (attributeError) errors.attributes = attributeError;
  }
  if (step === 'pricing') Object.assign(errors, validateFees(state.visitFee, state.labour));
  if (step === 'coverage') {
    if (state.travelFeeMode !== 'none') {
      const maxTravel = Number(state.maxTravel);
      if (!Number.isInteger(maxTravel) || maxTravel < Math.max(1, radiusKm) || maxTravel > 100) {
        errors.travel = `Maximum travel must be ${Math.max(1, radiusKm)}–100 km.`;
      }
      const flat = parseRupees(state.travelFlat);
      const perKm = parseRupees(state.travelPerKm);
      if (state.travelFeeMode === 'flat' && (flat == null || flat < 0)) errors.travel = 'Enter a valid flat travel fee.';
      if (state.travelFeeMode === 'per_km' && (perKm == null || perKm <= 0)) errors.travel = 'Enter a travel fee above ₹0 per km.';
    }
  }
  return errors;
}

export function validateServiceEditor(
  state: ServiceEditorState,
  schema: ProfileSchema,
  skills: CategorySkill[],
  radiusKm: number,
): ServiceEditorErrors {
  return SERVICE_EDITOR_STEPS.filter((step) => step !== 'review').reduce<ServiceEditorErrors>(
    (errors, step) => ({ ...errors, ...validateServiceEditorStep(step, state, schema, skills, radiusKm) }),
    {},
  );
}

const CONTACT_HINT =
  /(^|[^0-9])(?:\+?91[\s().-]*)?[6-9](?:[\s().-]*\d){9}([^0-9]|$)|[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:whats\s?app|telegram|phonepe|gpay|paytm|upi)\b/i;

export function containsContactHint(text: string): boolean {
  return CONTACT_HINT.test(text);
}

export function packageHasContactHint(input: {
  title?: string;
  description?: string;
  inclusions?: string[];
  exclusions?: string[];
  deliverables?: { type: string; spec: string }[];
}): boolean {
  return [
    input.title ?? '',
    input.description ?? '',
    ...(input.inclusions ?? []),
    ...(input.exclusions ?? []),
    ...(input.deliverables ?? []).flatMap((item) => [item.type, item.spec]),
  ].some(containsContactHint);
}
