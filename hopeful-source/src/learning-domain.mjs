import {TEACHER_TRAIN_DOMAIN} from './teacher-domain.mjs';
import {TRAINING_ENGINE,runtimeEngine} from './runtime-engines.mjs';
import {TEACHER_MODEL} from './teacher-model.mjs';
/** Frozen legacy-trained imitation weights propose inputs only. A FAQ proposal
 * earns no probability, value or safety credit; current native evidence must
 * independently certify its action and the incumbent in the same units. */
export function learningDomain(o){
 if(!o?.engine)return {admitted:false,reason:'RUNTIME_IDENTITY_UNOBSERVED_IN_API1'};
 // S4.35: an explicit accepted-runtime list (runtime-engines.mjs) replaces the single 7.0.1 pin at runtime only.
 const runtime=runtimeEngine(o.engine);if(!runtime)return {admitted:false,reason:'RUNTIME_FINGERPRINT_MISMATCH'};
 const edition=o.ruleset?.rulesEdition;
 if(!['legacy','faq2026'].includes(edition))return {admitted:false,reason:edition===undefined?'PUBLIC_RULES_EDITION_UNOBSERVED':'PUBLIC_RULES_EDITION_UNSUPPORTED'};
 if(o.rulesEdition!==undefined&&o.rulesEdition!==edition)return {admitted:false,reason:'PUBLIC_RULES_EDITION_CONFLICT'};
 return {admitted:true,runtime_engine:runtime.id,runtime_engine_relation:runtime.relation,training_rulesEdition:'legacy',runtime_rulesEdition:edition,
  domain_mode:edition==='legacy'?'native-legacy-imitation-proposal':'faq2026-transfer-proposal',
  probability_semantics:'expert-choice imitation; never action success probability',
  execution_requires:'actual native legality, complete own policy, builtin offer agreement and same-unit common evidence'};
}

/** TeacherV3 is a separate finite-policy preference task, not legacy expert
 * transfer. Runtime identity/edition and full native proof remain mandatory. */
export function teacherPreferenceDomain(o,trainingDomain=TEACHER_TRAIN_DOMAIN){
 // Production callers use the immutable compiled default only. An explicit
 // domain argument allows pure contract fixtures; tacticalShadow never forwards one.
 if(trainingDomain?.schema!=='teacher-train-public-domain/1'||trainingDomain.verified!==true||
  !/^[a-f0-9]{64}$/.test(trainingDomain.receiptSha256??'')||trainingDomain.verifiedCaptureCount!==24||
  trainingDomain.rulesEdition!=='faq2026'||Object.keys(TRAINING_ENGINE).some(k=>trainingDomain.engine?.[k]!==TRAINING_ENGINE[k])||
  trainingDomain.modelSha256!==TEACHER_MODEL.modelSha256||trainingDomain.featureSourceSha256!==TEACHER_MODEL.featureSourceSha256||
  trainingDomain.datasetSha256!==TEACHER_MODEL.datasetSha256||trainingDomain.verificationSha256!==TEACHER_MODEL.verificationSha256||
  trainingDomain.fitFreezeSha256!==TEACHER_MODEL.externalFreezeSha256||trainingDomain.runtimeSha256!=='26e02ac996afc5f6b18992a4893049366e37ec76f6fdfccdfdfc7fe1c48b9406')
  return {admitted:false,reason:'TEACHER_TRAIN_DOMAIN_RECEIPT_UNVERIFIED',training_domain_receipt_sha256:trainingDomain?.receiptSha256??null};
 if(o?.apiVersion!==2)return {admitted:false,reason:'API_VERSION_OUTSIDE_TEACHER_PUBLIC_DOMAIN'};
 if(!o?.engine)return {admitted:false,reason:'RUNTIME_IDENTITY_UNOBSERVED_IN_API1'};
 // S4.35: an explicit accepted-runtime list (runtime-engines.mjs) replaces the single 7.0.1 pin at runtime only.
 const runtime=runtimeEngine(o.engine);if(!runtime)return {admitted:false,reason:'RUNTIME_FINGERPRINT_MISMATCH'};
 const edition=o.ruleset?.rulesEdition;
 if(edition===undefined)return {admitted:false,reason:'PUBLIC_RULES_EDITION_UNOBSERVED'};
 if(o.rulesEdition!==undefined&&o.rulesEdition!==edition)return {admitted:false,reason:'PUBLIC_RULES_EDITION_CONFLICT'};
 if(edition!=='faq2026')return {admitted:false,reason:'TEACHER_RUNTIME_RULES_EDITION_UNSUPPORTED'};
 if(!Object.hasOwn(o,'activation'))return {admitted:false,reason:'PUBLIC_ACTIVATION_UNOBSERVED'};
 if(o.phase!=='play'||!Object.hasOwn(o,'pending')||o.pending!==null)return {admitted:false,reason:'PUBLIC_DECISION_DOMAIN_UNVERIFIED'};
 if(!['A','B'].includes(o.team)||o.active!==o.team)return {admitted:false,reason:'NOT_OWN_ACTIVE_SIDE'};
 if(o.activation!==null)return {admitted:false,reason:'OUTSIDE_TRAINED_ACTIVATION'};
 if(o.format!=='standard'||o.pitch?.width!==26||o.pitch?.height!==15)return {admitted:false,reason:'OUTSIDE_TRAINED_PITCH'};
 return {admitted:true,runtime_engine:runtime.id,runtime_engine_relation:runtime.relation,label_source:'engine_search_teacher',runtime_rulesEdition:edition,
  training_runtime_sha256:'26e02ac996afc5f6b18992a4893049366e37ec76f6fdfccdfdfc7fe1c48b9406',
  training_rulesEdition:trainingDomain.rulesEdition,training_domain_receipt_sha256:trainingDomain.receiptSha256,training_edition_scope:'joint frozen TRAIN public-root identity receipt; not inferred from current feature vector',
  domain_mode:'source-bound-teacher-first-input-preference-proposal',
  probability_semantics:'uncalibrated pairwise preference logits; never action success probability',
  execution_requires:'actual native root legality, complete own policy, builtin offer agreement and same-unit common evidence'};
}
