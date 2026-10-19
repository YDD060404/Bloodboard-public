import {LEARNED_MODEL} from './learned-model.mjs';
const MAP={playerDown:'attacker_down',bothDown:'both_down',push:'push',stumble:'defender_stumbles',pow:'defender_down'};
const ORDER=['attacker_down','both_down','push','defender_stumbles','defender_down'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
/** Source-choice probability is not an engine value or proof of safe play.
 * This integration observes a live closed offer and never changes its answer. */
export function learnedChoiceShadow(o,request,championOptionId,certified=false){
 const report={mode:'shadow',modelSha256:LEARNED_MODEL.modelSha256,attempted:false,
  championOptionId,learnedOptionId:null,override:false,certifiedPlanPreserved:certified,
  scope:'conditional published face-choice imitation; not success probability or tactical value'};
 const reject=reason=>({...report,reason});
 if(request?.type!=='blockDie')return reject('outside-trained-decision-type');
 if(!o?.pending||o.pending.requestId!==request.id||o.pending.type!==request.type||
    o.pending.team!==o.team||request.team!==o.team||!same(o.pending.options,request.options)||
    !same(o.pending.context,request.context))return reject('live-offer-source-mismatch');
 const ctx=request.context,pool=ctx?.pool,options=request.options;
 if(!Array.isArray(pool)||![2,3].includes(pool.length)||pool.some(f=>!MAP[f]))return reject('unsupported-dice-pool');
 if(!Array.isArray(options)||options.length<2||options.some(x=>!MAP[x.id])||
    new Set(options.map(x=>x.id)).size!==options.length||
    new Set(pool).size!==options.length||options.some(x=>!pool.includes(x.id)))return reject('offered-mask-mismatch');
 if(!options.some(x=>x.id===championOptionId))return reject('incumbent-option-not-legal');
 const attacker=o.players?.find(p=>p.id===ctx.attacker),defender=o.players?.find(p=>p.id===ctx.defender);
 if(!attacker||!defender||!['A','B'].includes(attacker.team)||!['A','B'].includes(defender.team)||
    attacker.team===defender.team)return reject('chooser-relationship-unverified');
 const isDefender=defender.team===o.team;
 const scores=options.map(x=>{
  const face=MAP[x.id];return LEARNED_MODEL.weights[face+'|bias']+
    (isDefender?LEARNED_MODEL.weights[face+'|chooser_is_defender']:0);
 });
 if(scores.some(x=>!Number.isFinite(x)))return reject('model-weight-invalid');
 const max=Math.max(...scores),ps=scores.map(x=>Math.exp(x-max)),total=ps.reduce((a,b)=>a+b,0);
 const ranking=options.map((x,i)=>({optionId:x.id,semanticFace:MAP[x.id],probability:ps[i]/total})).sort(
  (a,b)=>b.probability-a.probability||ORDER.indexOf(a.semanticFace)-ORDER.indexOf(b.semanticFace));
 return {...report,attempted:true,learnedOptionId:ranking[0].optionId,ranking,
  chooser:isDefender?'defender':'attacker',agreement:ranking[0].optionId===championOptionId,
  reason:certified?'certified-rule-choice-preserved':ranking[0].optionId===championOptionId?
   'learned-and-incumbent-agree':'shadow-disagreement-no-equal-rule-evidence-or-promotion'};
}
