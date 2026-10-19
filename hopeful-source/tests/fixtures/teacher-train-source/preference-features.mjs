import {tacticalFeatures} from '../../../../candidate-s4-12/source/src/tactical-features.mjs';

const ACTIONS=[['move','action_move'],['block','action_block'],['blitz','action_blitz'],['endTurn','kind_endTurn']];
const value=(x)=>typeof x==='number'&&Number.isFinite(x)?x:null;

/** Public root + candidate only. Extra caller metadata is intentionally ignored. */
export function preferenceFeatures(publicRoot,input){
 const base=tacticalFeatures(publicRoot,input);
 const features={...base};
 const scoreOwn=value(base.own_score),scoreOpp=value(base.opponent_score);
 const contexts={
  possession_own:value(base.possession_own),
  possession_opponent:value(base.possession_opponent),
  ball_ground:value(base.ball_ground),
  own_turn:value(base.own_turn),
  score_diff:scoreOwn===null||scoreOpp===null?null:scoreOwn-scoreOpp
 };
 for(const [action,key] of ACTIONS){
  const indicator=base[key];
  if(indicator!==0&&indicator!==1)throw Error('ACTION_INDICATOR_UNAVAILABLE:'+action);
  for(const [context,x] of Object.entries(contexts))
   features[`interaction_${action}_${context}`]=x===null?null:indicator*x;
 }
 return features;
}
