// Build-selected ablation. A uses the immutable RC4 artifact directly.
export const EXPERIMENT_MODE='C';
export function experimentSettings(mode=EXPERIMENT_MODE){
 if(!['A','B','C','D'].includes(mode))throw new Error('Unknown Hopeful ablation');
 return {mode,immutableRC4:mode==='A',fairExternal:mode!=='D',commonSelection:['B','C'].includes(mode),
  valueMode:mode==='C'?'coordinated-terminal':'legacy-point',newLearning:false,
  scope:mode==='A'?'exact external RC4 baseline':mode==='D'?'reverse control: original unmatched/first-local incumbent privilege':'same source pool and gates; only C adds bounded endpoint coordination'};
}
