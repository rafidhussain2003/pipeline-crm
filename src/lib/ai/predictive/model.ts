// Predictive model interface (Part 8) — "every model independently
// replaceable" means each prediction type is a class implementing this one
// interface, selected by name, never referenced by concrete class
// elsewhere. Today's implementations are heuristics built from existing
// CRM data, NOT trained ML models — there's no labeled historical dataset,
// training pipeline, or model-serving infrastructure in this codebase, and
// standing one up is a much bigger decision than this pass should make.
// Swapping a heuristic for a real trained model later means implementing
// this same interface and changing one registry entry — call sites never
// change.
export interface PredictiveModel<TInput, TOutput> {
  readonly name: string;
  predict(input: TInput): Promise<TOutput>;
}
