import test from 'node:test';
import assert from 'node:assert/strict';
import {changedZoneReplyPlans,reserveChangedZoneReplies} from '../src/changed-zone-replies.mjs';
const p=(id,team,x,y,extra={})=>({id,team,pos:{x,y},location:'pitch',stance:'standing',tackleZone:true,...extra});
function source(){return [
 {players:[p('marker','B',13,7),p('target','B',11,11),p('enemy','A',11,9)]},
 {players:[p('marker','B',12,8),p('target','B',11,11),p('enemy','A',11,9)]}
];}
test('all affected actors survive an exposure tie and have separate native plans',()=>{
 const s=source();for(const o of s)o.players.push(p('e2','A',11,9),p('e3','A',11,9));
 const r=changedZoneReplyPlans(s,'B');assert.equal(r.valid,true);
 assert.deepEqual(r.plans.map(p=>p.players),[['e2'],['e3'],['enemy']]);
 assert.ok(r.plans.every(p=>p.targets.length===1&&p.targets[0]==='target'));
});
test('target sets belong to each actor rather than their global cross-product',()=>{
 const s=source();for(const o of s)o.players.push(p('nearOnlyOther','B',15,10),p('other','A',14,8));
 const plans=changedZoneReplyPlans(s,'B').plans;
 assert.ok(!plans.find(p=>p.players[0]==='enemy').targets.includes('nearOnlyOther'));
 assert.ok(plans.find(p=>p.players[0]==='other').targets.includes('nearOnlyOther'));
});
test('source ordering, array ordering and ID renaming preserve coverage',()=>{
 const a=source(),b=a.slice().reverse().map(o=>({players:o.players.slice().reverse().map(p=>({...p,id:'r_'+p.id}))}));
 assert.deepEqual(changedZoneReplyPlans(b,'B').plans.map(p=>({players:p.players.map(x=>x.slice(2)),targets:p.targets.map(x=>x.slice(2))})),changedZoneReplyPlans(a,'B').plans);
});
test('unchanged zones, prone targets and moving marker targets add no queries',()=>{
 const s=source();assert.deepEqual(changedZoneReplyPlans([s[0],s[0]],'B'),{valid:true,plans:[]});
 for(const o of s)o.players[1].stance='prone';assert.deepEqual(changedZoneReplyPlans(s,'B'),{valid:true,plans:[]});
});
test('missing zone evidence or inconsistent player identities cannot certify a plan',()=>{
 const a=source();delete a[0].players[0].tackleZone;assert.equal(changedZoneReplyPlans(a,'B').valid,false);
 const b=source();b[1].players[0].team='A';assert.equal(changedZoneReplyPlans(b,'B').valid,false);
 const c=source();c[0].players.push({...c[0].players[0]});assert.equal(changedZoneReplyPlans(c,'B').valid,false);
 assert.equal(changedZoneReplyPlans(source(),'Z').valid,false);
});
const row=(actor,target,n,zoneRank)=>({priority:2,zoneRank,input:{kind:'playerAction',action:'blitz',playerId:actor,blitzTarget:target,path:Array.from({length:n},()=>({to:{x:1,y:1},kind:'step'}))}});
test('native proposal rank preserves each moving actor before stationary contacts',()=>{
 const a=row('a','t',0),b=row('b','t',0),moving=row('a','z',1,0),other=row('b','z',1,0),later=row('a','alphabetical',1,1);
 const r=reserveChangedZoneReplies([a,b,moving,other,later],[a,b,moving,other,later],2);
 assert.equal(r.complete,true);assert.deepEqual(r.rows,[moving,other]);
});
test('critical proposals stay first and actor overflow cannot claim discovery coverage',()=>{
 const score={priority:0,input:{kind:'playerAction',action:'move',playerId:'carrier',path:[]}},a=row('a','t',1,0),b=row('b','t',1,0);
 const r=reserveChangedZoneReplies([score,a,b],[score,a,b],2);
 assert.equal(r.complete,false);assert.equal(r.rows[0],score);assert.deepEqual(r.omittedActors,['b']);
});
test('without changed-zone proposals the original finite representative order is unchanged',()=>{
 const rows=[row('z','t',0),row('a','t',0)];assert.deepEqual(reserveChangedZoneReplies(rows,rows,8),{complete:true,rows,omittedActors:[]});
});
