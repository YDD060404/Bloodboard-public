/** Strategy platform (V5.6): the host-independent core. Research/offline code lives in ./research and is not exported here. */
export * from './limits';
export { Session, fail, KeyError, type Position, type ServiceFailure, type ProgressUpdate } from './session';
export { observe, type Observation } from './observe';
export { callService, SERVICE_NAMES } from './services';
export { capabilities, schemas, schemaNamed, SERVICES } from './schemas';
export { HARNESS } from './harness';
export { platformDecide, moduleMeta, runModule, type Spawn, type WorkerLike, type DecideMeta, type ModuleMeta, type ProgressEvent } from './host';
export { resolveAction, resolveDecision } from './respond';
export { featuresOf, FEATURE_NAMES, FEATURE_SCHEMA_VERSION, TERM_NAMES } from './evaluation';
// V5.7: engine worker pool, pooled services, shared analysis caches
export { EnginePool, type PoolStats, type PoolSnapshot, type PoolOptions } from './pool';
export { callServiceAsync, poolKey, type Offload } from './dispatch';
export { PlanCache, ResultCache, forWorker, analysisHash, ANALYSIS_VERSION } from './analysis';
