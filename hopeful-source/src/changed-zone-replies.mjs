import {stableDataKey} from './policy.mjs';
/** Pure public-observation discovery plan. No action or completeness claim. */
export function changedZoneReplyPlans(sources,team){
 const invalid=reason=>({valid:false,plans:[],reason});
 if(!['A','B'].includes(team)||!Array.isArray(sources))return invalid('changed-zone-source-invalid');
 const up=p=>p?.location==='pitch'&&p.stance==='standing'&&Number.isInteger(p.pos?.x)&&Number.isInteger(p.pos?.y);
 const distance=(a,b)=>Math.max(Math.abs(a.pos.x-b.pos.x),Math.abs(a.pos.y-b.pos.y));
 const maps=[];
 for(const o of sources){
  if(!Array.isArray(o?.players))return invalid('changed-zone-players-unavailable');
  const m=new Map();
  for(const p of o.players){
   if(typeof p?.id!=='string'||!p.id||m.has(p.id)||!['A','B'].includes(p.team))return invalid('changed-zone-player-identity-invalid');
   if(p.team===team&&up(p)&&typeof p.tackleZone!=='boolean')return invalid('changed-zone-evidence-unavailable');
   m.set(p.id,p);
  }
  maps.push(m);
 }
 if(maps.length<2)return {valid:true,plans:[]};
 if(maps.some(m=>m.size!==maps[0].size||[...maps[0]].some(([id,p])=>m.get(id)?.team!==p.team)))return invalid('changed-zone-source-identities-mismatch');
 const stable=p=>up(p)&&maps.every(m=>{const q=m.get(p.id);return up(q)&&q.pos.x===p.pos.x&&q.pos.y===p.pos.y;});
 const targets=[...maps[0].values()].filter(p=>p.team===team&&stable(p));
 const plans=[];
 for(const p of maps[0].values()){
  if(p.team===team||!stable(p))continue;
  const counts=maps.map(m=>[...m.values()].filter(q=>q.team===team&&up(q)&&q.tackleZone===true&&distance(q,m.get(p.id))===1).length);
  if(Math.max(...counts)===Math.min(...counts))continue;
  const ids=targets.filter(q=>maps.every(m=>{const d=distance(m.get(p.id),m.get(q.id));return d>=2&&d<=3;})).map(q=>q.id).sort();
  if(ids.length)plans.push({players:[p.id],targets:ids});
 }
 plans.sort((a,b)=>a.players[0]<b.players[0]?-1:a.players[0]>b.players[0]?1:0);
 return {valid:true,plans};
}
export function reserveChangedZoneReplies(ranked,representatives,limit=8){
 const moving=ranked.filter(r=>Number.isInteger(r.zoneRank)&&r.zoneRank>=0&&r.input?.action==='blitz'&&r.input.path?.length>0);
 if(!moving.length)return {complete:true,rows:representatives.slice(0,limit),omittedActors:[]};
 const actors=[...new Set(moving.map(r=>r.input.playerId))].sort(),rows=[],seen=new Set();
 const add=row=>{const key=stableDataKey(row.input);if(seen.has(key))return true;if(rows.length>=limit)return false;rows.push(row);seen.add(key);return true;};
 let complete=true;
 for(const row of representatives.filter(r=>r.priority<2))if(!add(row))complete=false;
 const omittedActors=[];
 for(const id of actors){
  const candidates=moving.filter(r=>r.input.playerId===id).sort((a,b)=>a.zoneRank-b.zoneRank||a.input.path.length-b.input.path.length||stableDataKey(a.input).localeCompare(stableDataKey(b.input)));
  if(!add(candidates[0])){complete=false;omittedActors.push(id);}
 }
 for(const row of representatives)add(row);
 return {complete,rows,omittedActors};
}
