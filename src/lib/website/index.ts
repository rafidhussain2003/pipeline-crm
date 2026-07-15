// Public surface of the Website Forms module (Phase 8). Isolated: it adds
// origin/replay security + a form builder on top of the existing website
// lead-source + the shared ingestInboundLead pipeline. It does not modify the
// assignment engine, presence, lifecycle, operations, mailbox, or billing.
export { getWebsiteConfig, isOriginAllowed, checkReplay } from "./security";
export type { WebsiteConfig } from "./security";
export { toConnection, getWebsiteSources, getWebsiteSource, ensureWebsiteSource, ensureSecretKey, rotateSecretKey, updateAllowedDomains, baseUrl } from "./connection";
export type { WebsiteConnection } from "./connection";
export { validateFields, createHostedForm, listHostedForms, getPublicHostedForm } from "./forms";
export type { FormField, FormFieldType } from "./forms";
