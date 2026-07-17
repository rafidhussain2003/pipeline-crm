// Phase 18 — public surface of the feature management system.
export { FEATURES, featureDef, isKnownFeature, defaultFeatureMap } from "./registry";
export type { FeatureDef, FeatureKey } from "./registry";
export { featureService, getEnabledFeatures, isFeatureEnabled, setCompanyFeatures } from "./service";
export type { FeatureMap } from "./service";
export { requireFeature, checkFeature, featureGateResponse, FEATURE_DISABLED_MESSAGE } from "./guard";
