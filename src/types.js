// List the fields shared by settings, progress updates, and results.
/**
 * @typedef {{ power: number, count: number }} WorkerInput
 * @typedef {{ engineeringBadge: boolean, swarmLevel: number, productivityLevel: number, research58: number, research70: number, research80: number, relic3: number, ts07Enabled: boolean }} ModifierInput
 * @typedef {{
 *   ouroUnlocked: boolean,
 *   workers: Record<string, WorkerInput>,
 *   weights: Record<string, number>,
 *   selectedFarmMissions: string[],
 *   selectedCampaignFarmMissions: string[],
 *   mode: string,
 *   searchEffort: "standard"|"crazy",
 *   hybridFragmentPercent: number,
 *   fragmentsPerCompletion: number,
 *   campaignEnabled: boolean,
 *   campaignTargetName: string,
 *   relic11Level: number,
 *   modifiers: ModifierInput
 * }} OptimizerInput
 * @typedef {{ name: string, type: string, count: number }} Assignment
 * @typedef {{ field: string, message: string }} ValidationError
 * @typedef {{ phase: string, determinate: boolean, completed: number, total: number, elapsedMs?: number, nodes?: number, upperBound?: number, relativeGap?: number | null, solverSearch?: number, solverStage?: string, solverNodes?: number | null, solverIterations?: number | null, solverUpdate?: number }} OptimizerProgress
 * @typedef {{
 *   assignments: Assignment[],
 *   unassignedWorkers: Record<string, number>,
 *   totals: Record<string, number>,
 *   campaignETA: number,
 *   campaignCapacity: number,
 *   campaignAssigned: number,
 *   selectedFarmCount: number,
 *   selectedFarmNames: string[],
 *   globalSpeedMult: number,
 *   modeUsed: string,
 *   searchEffort: "standard"|"crazy",
 *   solutionStatus: "best-found"|"optimal"|"tolerance-met"|"cancelled-best",
 *   objective: { primaryName: string, primaryValue: number, secondaryName: string, secondaryValue: number, upperBound: number|null, relativeGap: number|null },
 *   solverStats: { engine: string, version: string, nodes: number, iterations: number },
 *   hybridIdeals: { fragments: number, resourceUtility: number, fragmentWeight: number, resourceWeight: number, proven: boolean, fragmentUpperBound?: number, resourceUpperBound?: number }|null,
 *   seed: number,
 *   runId: string,
 *   durationMs?: number,
 *   notices: string[]
 * }} OptimizerResult
 * @typedef {{ schemaVersion: 3, savedAt: string, input: OptimizerInput }} SavedStateV3
 */

export {};
