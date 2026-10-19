export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export const num=(n,d=0)=>Number.isFinite(n)?n:d;
export const other=t=>t==='A'?'B':'A';
export const has=(p,s)=>(p?.skills||[]).some(k=>k===s||k.startsWith(s+'('));
export const dist=(a,b)=>a&&b?Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)):99;
export const at=(o,id)=>o.players.find(p=>p.id===id);
export const up=p=>p?.location==='pitch'&&p.pos&&p.stance==='standing';
export const live=p=>p?.location==='pitch'&&p.pos;
export const holder=o=>o.ball?.kind==='held'?at(o,o.ball.playerId):null;
export const available=(o,p)=>live(p)&&p.stance!=='stunned'&&!p.rooted&&
  (o.activation?.playerId===p.id&&!o.activation.over||!p.activated&&p.canBeActivated!==false);
export const goal=(o,t)=>o.pitch?.endZone?.[t]??(t==='A'?(o.pitch?.width||26)-1:0);
export const key=x=>JSON.stringify(x);
export function canonical(c,o){
  if(!c?.input||c.legal===false)return null;
  const i=c.input,a=at(o,i.playerId),family=c.family||(i.kind==='playerAction'?i.action:i.kind);
  const receiver=i.passTarget&&a?o.players.find(p=>p.team===a.team&&up(p)&&dist(p.pos,i.passTarget)===0):null;
  const destination=c.destination??i.path?.at(-1)?.to??null;
  const goalCarry=holder(o)?.id===a?.id&&!!a&&destination?.x===goal(o,a.team)&&['move','blitz'].includes(family);
  // Secure closes the activation, but a pickup on the actual scoring square
  // checks TD within that same input. Discovery retains this opportunity;
  // only exploration supplies its catch/trait odds and resulting state.
  const secureDestination=destination??a?.pos;
  const goalSecure=family==='secure'&&!!a&&o.ball?.kind==='ground'&&
    dist(secureDestination,o.ball.pos)===0&&secureDestination?.x===goal(o,a.team);
  return {...c,family,kind:goalCarry||goalSecure?'score':c.kind,actorId:c.actorId??c.playerId??i.playerId??null,
    targetId:c.targetId??i.handoffTarget??receiver?.id??i.blockTarget??i.blitzTarget??i.specialTarget??i.foulTarget??null,
    destination,
    rushes:c.rushes??i.path?.filter(p=>p.kind==='rush').length??0};
}
// Used for proposal ranking only. It cannot certify legal movement or probability.
export function proposalPosition(o,c){
  const i=c.input,copy={...o,players:o.players.map(p=>({...p,pos:p.pos&&{...p.pos}})),ball:{...o.ball}};
  const p=at(copy,c.actorId),dst=i.path?.at(-1)?.to;
  if(p&&dst)p.pos={...dst};
  if(p&&c.kind==='standUp'){p.stance='standing';p.tackleZone=true;}
  if(p&&c.kind==='pickup')copy.ball={kind:'held',playerId:p.id};
  if(p&&['pass','handoff'].includes(c.family)&&c.targetId)copy.ball={kind:'held',playerId:c.targetId};
  return copy;
}
