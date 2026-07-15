// Public surface of the Meta Conversions API module (Phase 11). Built ON TOP of
// the existing Meta OAuth (connectedAccounts) + the CRM event bus; it does NOT
// modify Lead Ads, the Assignment Engine, Website Forms, AI, or Billing.
// Sending is fully asynchronous + queue-based (see ./queue) so the Assignment
// Engine never waits for Meta.
export { enqueueCapiForLead, processDueCapiEvents, kickCapiWorker, reclaimStaleCapi, retryCapiEvent, reconcileCapiEvents, flushCapiEnqueue, pendingCapiCount } from "./queue";
export {
  listPixelConfigs, createPixelConfig, deletePixelConfig, getMappingUi, updateMappings,
  resendHistorical, getDeliveryLog, getDiagnostics, getConnectedMetaAccounts,
} from "./service";
export { getActivePixels, resolveSendToken, getPixel } from "./config";
export type { PixelConfig } from "./config";
export { META_EVENTS, SYSTEM_TRIGGERS, resolveEvent, defaultMetaEventFor } from "./mapping";
export { listBusinesses, listAdAccounts, listPixels } from "./graph";
export { buildMetaEvent, extractPii } from "./events";
export { buildUserData, splitName } from "./hashing";
export { rateEmq, aggregateEmq } from "./emq";
export type { EmqRating } from "./emq";
