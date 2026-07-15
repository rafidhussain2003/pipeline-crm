// Public surface of the AI assignment intelligence layer (Phase 3).
export { getAIConfig, updateAIConfig, DEFAULT_AI_CONFIG } from "./config";
export type { AIScoringConfig, FactorName, FactorConfig } from "./config";
export { aiAssignmentStrategy, AIAssignmentStrategy, warmAIContext } from "./strategy";
export { runScoringEngine } from "./scoring-engine";
export type { ScoringResult, ScoredCandidate, RejectedCandidate, FactorScoreDetail } from "./scoring-engine";
export { ALL_FACTORS } from "./factors";
export type { ScoringFactor } from "./factors";
export { getAgentFeatures } from "./features";
export type { AgentFeatures } from "./features";
export { getAIMetrics } from "./metrics";
export type { AIMetricsSnapshot } from "./metrics";
// Phase 5 skills / capacity / schedule / overrides surface.
export { getAgentProfiles, isWithinSchedule, DEFAULT_AGENT_PROFILE } from "./agent-profile";
export type { AgentProfile, AgentCapacity, AgentSchedule } from "./agent-profile";
export { getAgentSkills, gradeSkillMatch, parseLeadRequirements } from "./skills";
export type { LeadSkillRequirements, SkillGrade } from "./skills";
export { getActiveOverrides, createOverride, clearOverride, listActiveOverrides } from "./overrides";
export type { OverrideType, ActiveOverrides } from "./overrides";
export { getRoutingMetrics } from "./routing-metrics";
export type { RoutingMetrics } from "./routing-metrics";
