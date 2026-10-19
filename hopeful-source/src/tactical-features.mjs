/** Runtime public-observation inference only; never reconstructs historical state. */
const SKILLS='alwaysHungry block boneHead breakTackle catch claws dauntless dodge eyeGouge foulAppearance frenzy guard hatred jumpUp juggernaut leader loner mightyBlow noBall pass pro projectileVomit reallyStupid regeneration sidestep standFirm stripBall sureFeet sureHands tackle taunt thickSkull throwTeamMate unsteady wrestle'.split(' ');
const ACTIONS='block blitz move pass handoff foul secureBall throwTeamMate throwBomb punt kickTeamMate'.split(' ');
const STATUS=['activated','distracted','eyeGouged','rooted'];
const USAGE=['breakTackle','dodgeReroll','shadowing','sureFeet'];
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const value=(o,k)=>own(o??{},k)&&o[k]!==undefined?o[k]:null;
const distance=(a,b)=>a&&b?Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)):null;
const fail=r=>{throw Error(r);};
function checkInput(input,activation){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('INPUT_NOT_OBJECT');
 const keys=Object.keys(input).sort().join(',');
 if(activation){
  if(keys==='kind'&&input.kind==='endActivation')return;
  if(keys!=='action,handoffTarget,kind,path,playerId'||input.kind!=='playerAction'||input.action!=='handoff'||input.playerId!==activation.playerId||!Array.isArray(input.path)||input.path.length||typeof input.handoffTarget!=='string')fail('OUTSIDE_ACTIVE_HANDOFF_INPUT_SCOPE');
 }else{
  if(keys==='kind'&&input.kind==='endTurn')return;
  if(input.kind!=='playerAction'||!['move','block','blitz'].includes(input.action)||typeof input.playerId!=='string')fail('OUTSIDE_TRAINED_FIRST_INPUT_ACTION_SCOPE');
  const required=input.action==='move'?'action,kind,path,playerId':input.action==='blitz'?'action,blitzTarget,blockTarget,kind,path,playerId':'action,blockTarget,kind,path,playerId';
  if(input.action==='blitz'&&input.blitzTarget!==input.blockTarget)fail('BLITZ_TARGET_MISMATCH');
  if(keys!==required||!Array.isArray(input.path)||input.action!=='move'&&typeof input.blockTarget!=='string')fail('UNREPRESENTED_INPUT_FIELDS');
  if(input.path.some(s=>!s||s.kind!=='step'||!s.to||!Number.isFinite(s.to.x)||!Number.isFinite(s.to.y)||Object.keys(s).some(k=>!['kind','to'].includes(k))||Object.keys(s.to).some(k=>!['x','y'].includes(k))))fail('UNREPRESENTED_PATH_FIELDS');
 }
}
export function tacticalFeatures(o,input,task=null){
 if(!o||o.phase!=='play'||!own(o,'pending')||o.pending!==null||!own(o,'activation'))fail('PUBLIC_DECISION_DOMAIN_UNVERIFIED');
 if(o.team!==o.active||!['A','B'].includes(o.active))fail('NOT_OWN_ACTIVE_SIDE');
 if(o.format!=='standard'||o.pitch?.width!==26||o.pitch?.height!==15)fail('OUTSIDE_TRAINED_PITCH');
 const activation=o.activation;
 if(activation!==null&&(!activation||activation.action!=='handoff'))fail('OUTSIDE_TRAINED_ACTIVATION');
 if(task!==null&&!['advance','protect','prevent_td'].includes(task))fail('TASK_CONTEXT_INVALID');
 checkInput(input,activation);
 if(!Array.isArray(o.players)||!o.players.length)fail('PUBLIC_ROSTER_MISSING');
 const active=o.active,opponent=active==='A'?'B':'A',f={};
 const put=(k,v)=>{if(v===undefined)v=null;if(typeof v==='boolean')v=Number(v);if(v!==null&&(typeof v!=='number'||!Number.isFinite(v)))fail('NON_NUMERIC_PUBLIC_FEATURE');f[k]=v;};
 const ps=o.players.map(p=>{
  if(typeof p.id!=='string'||!['A','B'].includes(p.team)||!Array.isArray(p.skills)||p.skills.some(s=>typeof s!=='string')||typeof p.location!=='string'||typeof p.stance!=='string')fail('PUBLIC_PLAYER_SCHEMA_UNVERIFIED');
  if(p.pos!==null&&(!p.pos||!Number.isFinite(p.pos.x)||!Number.isFinite(p.pos.y)))fail('PUBLIC_POSITION_INVALID');
  const skills=p.skills.map(s=>{const m=/^([^()]+)\((\d+)\)$/.exec(s);return m?{id:m[1],value:Number(m[2])}:{id:s};});
  return {...p,skills,eyeGouged:own(p,'eyeGouged')?p.eyeGouged:false};
 });
 const byid=new Map(ps.map(p=>[p.id,p]));if(byid.size!==ps.length)fail('DUPLICATE_PUBLIC_PLAYER_ID');
 const holder=o.ball?.kind==='held'?byid.get(o.ball.playerId):null;
 if(o.ball?.kind==='held'&&!holder)fail('PUBLIC_HOLDER_MISSING');
 const actor=byid.get(input.playerId),target=byid.get(activation?input.handoffTarget:input.blockTarget),activeActor=byid.get(activation?.playerId);
 if(input.playerId&&!actor||input.blockTarget&&!target||input.handoffTarget&&!target||activation&&!activeActor)fail('PUBLIC_INPUT_JOIN_MISSING');
 if(activation){
  put('pitch_width',26);put('pitch_height',15);put('own_scoring_endzone_x',active==='A'?25:0);put('opponent_scoring_endzone_x',active==='A'?0:25);put('own_forward_x_sign',active==='A'?1:-1);
  put('activation_present',true);for(const a of ACTIONS)put('activation_action_'+a,activation.action===a);
  for(const k of ['maUsed','rushesUsed','blocksDone','ballActionDone','over'])put('activation_'+k,value(activation,k));
  put('turn_betweenTurns',value(o,'betweenTurns'));
 }
 for(const t of ['advance','protect','prevent_td'])put('task_'+t,task===null?null:task===t);
 put('half',value(o,'half'));put('drive',value(o,'drive'));
 for(const p of ['play','setup','kickoff'])put('phase_'+p,o.phase===p);
 for(const w of ['perfect','swelteringHeat','verySunny','pouringRain','blizzard'])put('weather_'+w,value(o,'weather')===null?null:o.weather===w);
 put('pending_present',false);
 for(const [role,side] of [['own',active],['opponent',opponent]])for(const k of ['score','turn','rerolls','bonusRerolls','leaderReroll','mascotReroll'])put(role+'_'+k,value(o.teams?.[side],k));
 for(const k of ['blitz','pass','handoff','foul','secure','ttm','bomb','punt','ktm'])put('used_'+k,value(o.used,k));
 const kind=value(o.ball,'kind'),ballpos=holder?.pos??o.ball?.pos;
 for(const k of ['held','ground','air'])put('ball_'+k,kind===null?null:kind===k);
 for(const a of ['x','y'])put('ball_'+a,value(ballpos,a));
 put('possession_own',kind===null?null:!!holder&&holder.team===active);put('possession_opponent',kind===null?null:!!holder&&holder.team===opponent);
 const roles={actor,target,holder,...(activation?{active_actor:activeActor}:{})};
 for(const [role,q] of Object.entries(roles)){
  put(role+'_present',!!q);
  for(const k of ['ma','st','ag',...STATUS])put(role+'_'+k,value(q,k));
  if(activation)for(const k of USAGE)put(role+'_usage_'+k,value(q?.usage,k));
  for(const k of ['standing','prone','stunned'])put(role+'_stance_'+k,q?value(q,'stance')===null?null:q.stance===k:null);
  for(const k of ['pitch','reserves','ko','cas'])put(role+'_location_'+k,q?value(q,'location')===null?null:q.location===k:null);
  for(const a of ['x','y'])put(role+'_'+a,value(q?.pos,a));
  put(role+'_own',q?q.team===active:null);put(role+'_has_ball',q?q.id===holder?.id:null);
  const ids=q?.skills.map(s=>s.id);
  for(const k of SKILLS)put(role+'_skill_'+k,ids?ids.includes(k):null);
  put(role+'_skill_other_count',ids?ids.filter(k=>!SKILLS.includes(k)).length:null);
  for(const k of ['loner','hatred'])put(role+'_skill_'+k+'_value',q?.skills.find(s=>s.id===k)?.value??null);
  for(const [sideName,side] of [['own',active],['opponent',opponent]])for(const radius of [1,2,3,5]){
   const neighbours=q?.pos?ps.filter(p=>p.team===side&&p.location==='pitch'&&p.pos&&p.id!==q.id&&distance(p.pos,q.pos)<=radius):null;
   put(`${role}_${sideName}_within_${radius}`,neighbours?.length??null);put(`${role}_${sideName}_standing_within_${radius}`,neighbours?neighbours.filter(p=>p.stance==='standing').length:null);
  }
 }
 for(const [name,side] of [['own',active],['opponent',opponent]]){
  for(const loc of ['pitch','reserves','ko','cas'])put(name+'_count_'+loc,ps.filter(p=>p.team===side&&p.location===loc).length);
  const pitch=ps.filter(p=>p.team===side&&p.location==='pitch');
  for(const stance of ['standing','prone','stunned'])put(name+'_pitch_'+stance,pitch.filter(p=>p.stance===stance).length);
  for(const sk of SKILLS)put(name+'_pitch_skill_'+sk,pitch.filter(p=>p.skills.some(s=>s.id===sk)).length);
 }
 for(const [a,b] of [['actor','target'],['actor','holder'],['target','holder']])put(a+'_'+b+'_chebyshev',distance(roles[a]?.pos,roles[b]?.pos));
 if(activation){put('handoff_target_present',!!target);put('actor_matches_active_actor',actor?actor.id===activation.playerId:null);}
 for(const a of ACTIONS)put('action_'+a,input.action===a);
 for(const k of ['playerAction','endTurn','endActivation'])put('kind_'+k,input.kind===k);
 const path=input.path??[],endpoint=path.length?path[path.length-1].to:actor?.pos;
 put('path_length',path.length);for(const a of ['x','y'])put('path_end_'+a,value(endpoint,a));
 return f;
}
