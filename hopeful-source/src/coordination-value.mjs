/** Finite geometric coordination features, never route probabilities or a
 * threat upper bound. Native action/End states remain the sole chance inputs. */
const dist=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const key=p=>p.x+','+p.y;
const standing=p=>p.location==='pitch'&&p.pos&&p.stance==='standing'&&!p.distracted;
const zone=p=>standing(p)&&p.tackleZone!==false;
const neighbours=p=>Array.from({length:9},(_,i)=>({x:p.x+i%3-1,y:p.y+Math.floor(i/3)-1})).filter(q=>dist(p,q)>0);
// S4.35 exact-geometry-v1: the same multi-source BFS on a typed-array grid. A BFS field is the unique shortest
// 8-neighbour step count, so the distances, and every value the returned closure gives, equal the string-keyed
// original below. Any input outside the safe-integer grid (non-number or fractional coordinates, a non-integer
// pitch) uses that verbatim original instead. The checks run in the original's evaluation order, so a malformed
// input reaches the original and throws the identical error.
const cell=v=>Number.isSafeInteger(v),numeric=p=>typeof p.pos.x==='number'&&typeof p.pos.y==='number';
function distanceField(o,targets,guards=[],removed=null){
 const occupants=o.players.filter(p=>p.location==='pitch'&&p.pos&&p.id!==removed);
 if(!occupants.every(numeric))return distanceFieldStrings(o,targets,guards,removed);
 const markers=guards.filter(zone);
 if(!markers.every(numeric))return distanceFieldStrings(o,targets,guards,removed);
 const w=o.pitch?.width,h=o.pitch?.height;
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>65536||!Array.isArray(targets)||!targets.every(p=>cell(p.x)&&cell(p.y)))
  return distanceFieldStrings(o,targets,guards,removed);
 const n=w*h,closed=new Uint8Array(n),field=new Int32Array(n).fill(-1),queue=new Int32Array(n);
 // A number key matches an integer cell's key only when it is that integer.
 const mark=q=>{if(Number.isInteger(q.x)&&Number.isInteger(q.y)&&q.x>=0&&q.y>=0&&q.x<w&&q.y<h)closed[q.y*w+q.x]=1;};
 for(const p of occupants)mark(p.pos);
 for(const p of markers)for(const q of neighbours(p.pos))mark(q);
 let tail=0;
 for(const p of targets)if(p.x>=0&&p.y>=0&&p.x<w&&p.y<h){const at=p.y*w+p.x;if(!closed[at]&&field[at]<0){field[at]=0;queue[tail++]=at;}}
 for(let head=0;head<tail;head++){
  const at=queue[head],x=at%w,y=(at-x)/w,next=field[at]+1;
  for(let dy=-1;dy<=1;dy++){const ny=y+dy;if(ny<0||ny>=h)continue;
   for(let dx=-1;dx<=1;dx++){const nx=x+dx;if((!dx&&!dy)||nx<0||nx>=w)continue;
    const to=ny*w+nx;if(closed[to]||field[to]>=0)continue;field[to]=next;queue[tail++]=to;}}
 }
 let strings=null;
 return p=>{
  const x=p.x,y=p.y;
  if(!cell(x)||!cell(y)){
   // Fractional or non-number queries: the original expression over an identical key/value map.
   if(!strings){strings=new Map();for(let at=0;at<n;at++)if(field[at]>=0)strings.set(key({x:at%w,y:(at-at%w)/w}),field[at]);}
   return Math.min(...neighbours(p).map(q=>strings.has(key(q))?strings.get(key(q))+1:Infinity));
  }
  let best=Infinity;
  for(let dy=-1;dy<=1;dy++){const ny=y+dy;if(ny<0||ny>=h)continue;
   for(let dx=-1;dx<=1;dx++){const nx=x+dx;if((!dx&&!dy)||nx<0||nx>=w)continue;
    const d=field[ny*w+nx];if(d>=0&&d+1<best)best=d+1;}}
  return best;
 };
}
// S4.34 string-keyed BFS, verbatim: the reference and the fallback for inputs outside the integer grid.
function distanceFieldStrings(o,targets,guards=[],removed=null){
 const inside=p=>p.x>=0&&p.y>=0&&p.x<o.pitch.width&&p.y<o.pitch.height;
 const occupied=new Set(o.players.filter(p=>p.location==='pitch'&&p.pos&&p.id!==removed).map(p=>key(p.pos)));
 const zones=new Set(guards.filter(zone).flatMap(p=>neighbours(p.pos)).map(key));
 const queue=targets.filter(p=>inside(p)&&!occupied.has(key(p))&&!zones.has(key(p))),field=new Map(queue.map(p=>[key(p),0]));
 for(let i=0;i<queue.length;i++)for(const p of neighbours(queue[i])){
  const k=key(p);if(!inside(p)||occupied.has(k)||zones.has(k)||field.has(k))continue;
  field.set(k,field.get(key(queue[i]))+1);queue.push(p);
 }
 return p=>Math.min(...neighbours(p).map(q=>field.has(key(q))?field.get(key(q))+1:Infinity));
}
export function coordinationFeatures(o){
 const empty={adjustment:0,escort:0,missedPressure:0,screenResidual:0,
  scope:'bounded geometry and current public movement budgets; no Dodge/TD probability, complete threat coverage or future activation certificate'};
 if(o?.phase!=='play'||!Array.isArray(o.players)||!Number.isInteger(o.pitch?.width)||!Number.isInteger(o.pitch?.height))return {...empty,reason:'outside-normal-public-board'};
 const carrier=o.ball?.kind==='held'?o.players.find(p=>p.id===o.ball.playerId):null;
 if(!carrier||!standing(carrier)||carrier.rooted)return {...empty,reason:'no-mobile-held-carrier'};
 const allies=o.players.filter(p=>p.team===carrier.team&&p.id!==carrier.id&&standing(p)),foes=o.players.filter(p=>p.team!==carrier.team&&zone(p));
 const own=carrier.team===o.team;
 const mobile=p=>!p.rooted&&(p.team!==o.team||o.activation?.playerId===p.id&&!o.activation.over||!p.activated&&p.canBeActivated!==false);
 const used=p=>p.team===o.team&&o.activation?.playerId===p.id&&!o.activation.over?(o.activation.maUsed||0):0;
 const budget=p=>!mobile(p)?0:Math.max(0,(Number.isFinite(p.ma)?p.ma:0)-used(p));
 const end=o.pitch.endZone?.[carrier.team];
 if(!Number.isFinite(end))return {...empty,reason:'missing-public-end-zone'};
 const advance=Math.min(3,budget(carrier),Number.isFinite(end)?Math.abs(end-carrier.pos.x):0);
 const relevant=foes.filter(p=>dist(p.pos,carrier.pos)<=budget(p)+5);
 if(!relevant.length)return {...empty,reason:'no-local-mobility-pressure'};
 const projected={x:carrier.pos.x+Math.sign(end-carrier.pos.x)*advance,y:carrier.pos.y};
 const targets=neighbours(projected),supportDistance=distanceField(o,targets);
 const ready=allies.filter(p=>mobile(p)&&supportDistance(p.pos)<=budget(p));
 const sides=new Set(ready.map(p=>Math.sign(p.pos.y-carrier.pos.y)));
 const escort=advance>0?Math.min(24,ready.length*8+(sides.has(-1)&&sides.has(1)?8:0)):0;
 const approach=distanceField(o,neighbours(carrier.pos)),distances=foes.map(p=>dist(p.pos,carrier.pos));
 // Include an entire distance-tie group when it crosses the frozen four-foe
 // cutoff. IDs, input order and either mirror axis cannot choose its members.
 const omitted=relevant.filter(p=>distances.filter(d=>d<=dist(p.pos,carrier.pos)).length>4);
 const missedPressure=omitted.reduce((worst,p)=>Math.max(worst,Math.max(0,Math.min(12,(budget(p)+1-approach(p.pos))*3))),0);
 // Static free routes after one nearby guard is cleared from its square. The real Block/
 // Dodge/side-route alternatives are still required in the common reply domain.
 const guards=allies.filter(p=>zone(p)&&dist(p.pos,carrier.pos)<=4);
 let screenResidual=0;
 if(guards.length){
  const gaps=guards.map(lost=>{
   const remaining=guards.filter(p=>p!==lost);if(!remaining.length)return 0;
   const free=distanceField(o,neighbours(carrier.pos),remaining,lost.id),baseline=distanceField(o,neighbours(carrier.pos),[],lost.id);
   return Math.min(...relevant.map(p=>{
    const plain=baseline(p.pos),screened=free(p.pos);
    if(dist(p.pos,carrier.pos)<=1||!Number.isFinite(plain))return 0;
    return Math.max(0,Math.min(4,Math.max(0,screened-budget(p))-Math.max(0,plain-budget(p))));
   }));
  });
  screenResidual=Math.min(...gaps)*3;
 }
 const sign=own?1:-1;
 return {...empty,escort,missedPressure,screenResidual,adjustment:sign*(escort-missedPressure+screenResidual),
  reason:'actual-board-geometric-coordination',supportActors:ready.map(p=>p.id),omittedPressureActors:omitted.map(p=>p.id),
  nextOpponentWindowUnverified:!own,singleGuardLossScenario:true,clearedGuardIsHypothetical:true};
}
