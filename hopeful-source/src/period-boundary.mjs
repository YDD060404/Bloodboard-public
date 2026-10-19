// Actual public phases, independent of the active team left on an End state.
export const periodPhase=phase=>['halfOver','fullTime','touchdown'].includes(phase);
export const periodEnd=branch=>!!branch?.touchdown||periodPhase(branch?.observation?.phase);
