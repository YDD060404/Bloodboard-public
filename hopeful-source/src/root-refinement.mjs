const EPS = 1e-8;
const finite = Number.isFinite;
const positiveInt = value => Number.isSafeInteger(value) && value > 0;

function rootSource(result) {
  return result?.position?.key === 'root' && result?.position?.depth === 0;
}
function rootRequestIdentity(result) {
  if (!Array.isArray(result?.outcomes) || result.outcomes.length === 0) return null;
  const prefixes = new Set(result.outcomes.map(outcome =>
    typeof outcome?.key === 'string' ? /^(\d+)\.\d+$/.exec(outcome.key)?.[1] ?? null : null));
  return prefixes.size === 1 && !prefixes.has(null) ? [...prefixes][0] : null;
}
const nativeOutcomeKey=(key,requestId)=>typeof key==='string'&&
  new RegExp('^'+String(requestId).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\.\\d+$').test(key);

export function completeRootEvidence(result, requestId, appliedLimit, expected) {
  if (result?.ok !== true) return 'native-root-request-failed';
  if (result?.exact !== true) return 'root-not-exact';
  if (requestId === undefined || requestId === null) return 'root-request-id-unobserved';
  if (!rootSource(result)) return 'root-source-mismatch';
  if (result.outcomeIdentity !== 'complete-state-v1') return 'root-outcome-identity-unverified';
  if (result.activeTeam !== expected.team || result.perspective !== expected.perspective ||
      result.decisionPolicy?.mode !== 'builtin' || result.decisionPolicy?.own !== 'builtin' ||
      result.decisionPolicy?.opponent !== 'builtin') return 'root-policy-or-team-mismatch';
  if (!positiveInt(expected.maxAllowedAppliedMs)) return 'root-caller-applied-ceiling-unverified';
  if (!finite(result.unresolvedMass) || result.unresolvedMass < 0 || result.unresolvedMass > EPS)
    return 'root-unresolved-mass';
  if (!finite(result.rest?.p) || result.rest.p < 0 || result.rest.p > EPS) return 'root-rest-mass';
  const applied = result.applied;
  if (!applied || !positiveInt(applied.maxOutcomes) || !positiveInt(applied.maxLeaves) ||
      !positiveInt(applied.maxMs) || !finite(applied.threshold) || applied.threshold <= 0 ||
      applied.threshold < 1e-6 || applied.threshold > 0.05 ||
      applied.maxOutcomes > appliedLimit.maxOutcomesPerCall ||
      applied.maxLeaves > appliedLimit.maxLeavesPerCall || applied.maxMs > expected.maxAllowedAppliedMs ||
      applied.maxOutcomes > expected.requestOptions.maxOutcomes ||
      applied.maxLeaves > expected.requestOptions.maxLeaves ||
      applied.threshold > expected.requestOptions.threshold + EPS ||
      applied.horizon !== expected.horizon)
    return 'root-applied-limits-unverified';
  for (const key of ['pTurnover', 'pTouchdown', 'pOpponentTouchdown'])
    if (!finite(result[key]) || result[key] < 0 || result[key] > 1) return 'root-event-probability-unverified';
  if (!positiveInt(result.leaves)) return 'root-leaf-count-unobserved';
  if (!Array.isArray(result.outcomes) || result.outcomes.length === 0 ||
      result.outcomes.length > applied.maxOutcomes) return 'root-outcome-list-incomplete';
  const seen = new Set();
  let mass = 0;
  for (const outcome of result.outcomes) {
    if (!finite(outcome?.p) || outcome.p <= 0 || outcome.p > 1 ||
        !nativeOutcomeKey(outcome.key,requestId) || seen.has(outcome.key) ||
        !outcome.observation || !['A', 'B'].includes(outcome.active) ||
        outcome.observation.active !== outcome.active || typeof outcome.completed !== 'boolean' ||
        typeof outcome.turnover !== 'boolean' ||
        !(outcome.touchdown === null || outcome.touchdown === 'A' || outcome.touchdown === 'B'))
      return 'root-outcome-source-or-flags-unverified';
    seen.add(outcome.key);
    mass += outcome.p;
  }
  if (Math.abs(mass - 1) > EPS) return 'root-outcome-mass-does-not-close';
  return null;
}

function selectTargets(candidates, maximum) {
  const unique = [...new Set(candidates)].filter(candidate => candidate?.ex &&
    rootSource(candidate.ex) && finite(candidate.unknown) && candidate.unknown > EPS);
  return unique.sort((a, b) => (finite(b.value) ? b.value : -Infinity) -
    (finite(a.value) ? a.value : -Infinity)).slice(0, maximum);
}

function usableBudget(snapshot) {
  const limits = snapshot?.limits, remaining = snapshot?.remaining;
  return snapshot?.verified === true && limits && remaining &&
    positiveInt(limits.maxServiceCalls) && positiveInt(limits.maxPositions) &&
    positiveInt(limits.maxOutcomesPerCall) && positiveInt(limits.maxLeavesPerCall) &&
    positiveInt(limits.maxLeavesPerRequest) && positiveInt(limits.maxCallMs) &&
    finite(limits.serviceTimeShare) && limits.serviceTimeShare > 0 && limits.serviceTimeShare <= 1 &&
    ['calls', 'positions', 'leaves'].every(key => Number.isSafeInteger(remaining[key]) && remaining[key] >= 0) &&
    finite(remaining.serviceMs) && remaining.serviceMs >= 0;
}

export async function refineRootCandidates({candidates, services, requestId, initialOptions,
  team, remainingMs, reserveAfterMs, rescore, maxRefinements = 3}) {
  const targets = selectTargets(candidates, maxRefinements);
  const report = {schema: 's4-15-root-refinement/1', eligible: targets.length, attempted: 0,
    committed: 0, refused: 0, samples: [], scope: 'same-request root-only refinement before preparation; incomplete evidence remains unknown'};
  for (const candidate of targets) {
    if (report.attempted >= maxRefinements) break;
    if (typeof services?.rootRefinementBudget !== 'function') {
      report.refused++;
      report.samples.push({label: candidate.label, status: 'refused', reason: 'verified-root-resource-view-unavailable'});
      continue;
    }
    let budget;
    try { budget = await services.rootRefinementBudget(); }
    catch { budget = null; }
    if (!usableBudget(budget)) {
      report.refused++;
      report.samples.push({label: candidate.label, status: 'refused', reason: 'verified-root-resource-budget-unavailable'});
      continue;
    }
    const limits = budget.limits;
    const inferredRequestId = requestId ?? rootRequestIdentity(candidate.ex);
    const requestIdentitySource = requestId === undefined || requestId === null ?
      'inferred-from-initial-root-outcome-keys' : 'public-request-id';
    if (inferredRequestId === undefined || inferredRequestId === null) {
      report.refused++;
      report.samples.push({label: candidate.label, status: 'refused', reason: 'root-request-identity-unobserved'});
      continue;
    }
    const callerWindowStartedAt=Date.now();
    const callerWindowMs = Math.floor(remainingMs() - reserveAfterMs);
    const fixedCallerDeadline = callerWindowStartedAt+callerWindowMs;
    const left = Math.floor(callerWindowMs - 400);
    const maxOutcomes = Math.min(limits.maxOutcomesPerCall, budget.remaining.positions);
    const maxLeaves = Math.min(limits.maxLeavesPerCall, limits.maxLeavesPerRequest, budget.remaining.leaves,
      Math.max((candidate.ex.applied?.maxLeaves ?? initialOptions.maxLeaves) + 1,
        (candidate.ex.applied?.maxLeaves ?? initialOptions.maxLeaves) * 2));
    const appliedBefore = candidate.ex.applied ?? initialOptions;
    if (appliedBefore.horizon !== 'root') {
      report.refused++;
      report.samples.push({label: candidate.label, status: 'refused', reason: 'initial-root-horizon-unobserved'});
      continue;
    }
    const maxMs = Math.floor(Math.min(limits.maxCallMs, budget.remaining.serviceMs * limits.serviceTimeShare, left));
    const thresholdBefore = finite(appliedBefore.threshold) ? appliedBefore.threshold : initialOptions.threshold;
    const threshold = Math.max(1e-6, thresholdBefore / 10);
    const maxKeep = Math.max(Number.isSafeInteger(initialOptions.maxKeep) ? initialOptions.maxKeep : 0, maxOutcomes);
    const hasOwnActionWindow = candidate.input?.kind === 'playerAction';
    const callerWindow = hasOwnActionWindow ? {coachEnumerationDeadline:fixedCallerDeadline,
      coachEnumerationDeadlineSource:'s4-15-root-refinement-reserve'} : {};
    const options = {...initialOptions, from: 'root', team, maxKeep, ...callerWindow,
      decisions: 'builtin', horizon: appliedBefore.horizon, maxOutcomes, maxLeaves, maxMs, threshold};
    const changedSemanticBudget = maxOutcomes > (appliedBefore.maxOutcomes ?? initialOptions.maxOutcomes) ||
      maxLeaves > (appliedBefore.maxLeaves ?? initialOptions.maxLeaves) || threshold < thresholdBefore;
    const reasons = [];
    if (budget.remaining.calls < 1) reasons.push('call-reserve');
    if (maxOutcomes < 1) reasons.push('position-reserve');
    if (maxLeaves < 1) reasons.push('leaf-budget');
    if (maxMs < 50) reasons.push('service-or-own-window-below-minimum');
    if (!changedSemanticBudget) reasons.push('no-cache-distinguishing-enumeration-budget');
    if (reasons.length) {
      report.refused++;
      report.samples.push({label: candidate.label, status: 'refused', reason: reasons.join(',')});
      continue;
    }
    report.attempted++;
    let result = null;
    try { result = await services.explore(candidate.input, options); } catch { /* Preserve the original partial tree. */ }
    const requested = {maxOutcomes, maxKeep, maxLeaves, maxMs, threshold, horizon:options.horizon,
      callerWindowMs,callerDeadline:hasOwnActionWindow?fixedCallerDeadline:null,
      callerDeadlineSource:options.coachEnumerationDeadlineSource??'bounded-by-requested-maxMs',requestIdentitySource};
    const reason = completeRootEvidence(result, inferredRequestId, limits,
      {team, perspective: initialOptions.perspective, horizon: appliedBefore.horizon,
       maxAllowedAppliedMs:Math.floor(Math.min(limits.maxCallMs,budget.remaining.serviceMs,callerWindowMs-40)),requestOptions: options});
    if (reason) {
      const capInsufficient = reason === 'root-rest-mass' && result?.exact === true &&
        result?.unresolvedMass <= EPS && result?.outcomes?.length === result?.applied?.maxOutcomes &&
        result?.applied?.maxOutcomes >= limits.maxOutcomesPerCall;
      report.refused++;
      report.samples.push({label: candidate.label, status: 'refused', reason: capInsufficient ?
        'actual-max-outcomes-cap-insufficient' : reason,
        requested,
        beforeUnknown: candidate.unknown, returnedOutcomes: result?.outcomes?.length ?? null,
        returnedRestMass: result?.rest?.p ?? null, returnedUnresolvedMass: result?.unresolvedMass ?? null,
        actualApplied: result?.applied ?? null});
      continue;
    }
    const beforeUnknown = candidate.unknown;
    let score;
    try { score = rescore(candidate, result); } catch { score = null; }
    if (!score || score.ex !== result || !finite(score.value) || !finite(score.baseValue) ||
        !finite(score.unknown) || score.unknown > EPS || !finite(score.terminalScoreMass) ||
        !finite(score.strategicDelta)) {
      report.refused++;
      report.samples.push({label: candidate.label, status: 'refused', reason: 'root-rescore-not-finite-or-source-matched',
        requested, beforeUnknown: candidate.unknown});
      continue;
    }
    Object.assign(candidate, score, {rootRefinement: {schema: report.schema, source: 'root',
      position: result.position, outcomeIdentity: result.outcomeIdentity, outcomeKeys: result.outcomes.map(outcome => outcome.key)}});
    report.committed++;
    report.samples.push({label: candidate.label, status: 'committed', source: 'root',
      beforeUnknown, afterUnknown: score.unknown, outcomes: result.outcomes.length,
      probabilityMass: result.outcomes.reduce((sum, outcome) => sum + outcome.p, 0),
      requested, actualApplied: result.applied, leaves:result.leaves});
  }
  return report;
}
