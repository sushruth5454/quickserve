export function isFeatureOn(features: Record<string, unknown>, key: string): boolean {
  return features[key] === true;
}
