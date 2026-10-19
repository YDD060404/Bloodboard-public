import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createServer } from '../lan/server.mjs';
import { memoryStore } from '../lan/store.mjs';
const srv=await createServer({code:'REPAIRUI22',store:memoryStore(),webDir:new URL('../dist/web',import.meta.url).pathname});
const port=await srv.listen(),browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1600,height:1000}}),checks=[],errors=[];
const check=(name,ok)=>{assert.ok(ok,name);checks.push({name,passed:true});console.log('PASS '+name);};
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(`http://127.0.0.1:${port}`);await page.waitForFunction(()=>!!window.bloodboard);
 await page.evaluate(()=>{
  window.BroadboardLanguage.setLanguage('en');window.bloodboardOpenPractice(0);
  const a=window.bloodboard,E=window.BloodboardEngine,g=E.cloneState(a.game),gl=g.players.find(p=>p.team==='A'),opp=g.players.find(p=>p.team==='B'),st=E.STAR_BY_ID.glotl;
  for(const p of g.players){p.location='reserves';p.pos=null;p.activated=false;}
  Object.assign(gl,{location:'pitch',pos:{x:8,y:7},stance:'standing',distracted:false,star:'glotl',starUsed:[],position:st.name,ma:st.ma,st:st.st,ag:st.ag,av:st.av,skills:st.skills.map(k=>({...k})),keywords:st.keywords.slice()});
  Object.assign(opp,{location:'pitch',pos:{x:9,y:7},stance:'standing',distracted:false,skills:[],st:3,av:10});
  g.phase='play';g.rulesEdition='faq2026';g.turn.active='A';g.turn.activation=null;g.teams.A.rerolls=0;g.ball={kind:'none'};g.log=[];g.pending=null;
  a.replaceGame(g,{keepDirty:true});a.select(gl.id);a.startDraft('block');a.updateDraft({blockTarget:opp.id});
 });
 await page.waitForFunction(()=>!window.bloodboard.st.planBusy);
 check('real browser worker accepts Glotl Block preview',await page.evaluate(()=>window.bloodboard.st.plan?.ok===true));
 check('Glotl execution button is no longer disabled',await page.isEnabled('#execute-plan'));
 const playback=await page.evaluate(()=>{
  window.bloodboardOpenPractice(0);const a=window.bloodboard,E=window.BloodboardEngine,g=E.cloneState(a.game),p=g.players.find(p=>p.team==='A');
  for(const q of g.players){q.location='reserves';q.pos=null;q.activated=false;}
  Object.assign(p,{location:'pitch',pos:{x:8,y:7},stance:'standing',distracted:false,skills:[],ma:6});
  g.phase='play';g.turn.active='A';g.turn.activation=null;g.ball={kind:'none'};g.log=[];g.pending=null;a.replaceGame(g,{keepDirty:true});a.st.pauseDice=true;
  const one=E.execute(g,{kind:'playerAction',playerId:p.id,action:'move',path:[{to:{x:9,y:7},kind:'step'},{to:{x:10,y:7},kind:'step'}]});
  a.applyRemoteResult(one,'first route',false,'B');a.st.playback.shown=0;const old={...a.st.playback},count=old.events.length;
  const two=E.execute(one.state,{kind:'playerAction',playerId:p.id,action:'move',path:[{to:{x:11,y:7},kind:'step'},{to:{x:12,y:7},kind:'step'}]});
  a.applyRemoteResult(two,'continuation',false,'B');
  const out={one:one.status,two:two.status,expected:count+two.events.length,actual:a.st.playback.events.length,shown:a.st.playback.shown,beforePreserved:a.st.playback.before===old.before,current:a.game.players.find(q=>q.id===p.id).pos.x,display:a.displayGame().players.find(q=>q.id===p.id).pos.x,events:a.st.playback.events.filter(e=>e.type==='move').map(e=>e.to?.x)};
  a.skipPlayback();out.afterSkip=a.displayGame().players.find(q=>q.id===p.id).pos.x;return out;
 });
 check('fixture actions use actual successful engine results',playback.one==='completed'&&playback.two==='completed');
 check('later network update retains all unplayed events',playback.actual===playback.expected&&playback.shown===0&&playback.beforePreserved);
 check('authority advances while the visible board preserves intermediate playback',playback.current===12&&playback.display===8);
 check('skip finishes at the exact authoritative position',playback.afterSkip===12);
 check('no browser errors',errors.length===0);
 writeFileSync(new URL('../verification/repair-ui-results.json',import.meta.url),JSON.stringify({version:'0.2.0',checks,errors,playback,scope:'Built browser + real engine worker; remote playback component uses real engine results, two-browser transport checked separately.'},null,2)+'\n');
 console.log(`${checks.length}/${checks.length} passed`);
}finally{await browser.close();await srv.close();}
