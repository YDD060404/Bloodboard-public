import {chromium} from 'playwright';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from '../lan/server.mjs';
import {memoryStore} from '../lan/store.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const replayBundle=await build({absWorkingDir:root,entryPoints:['src/ui/replayui.ts'],bundle:true,write:false,format:'iife',globalName:'ReplayKeyTest',platform:'browser'});
const srv=await createServer({code:'KEYBOARD22',store:memoryStore(),webDir:join(root,'dist/web')});
const port=await srv.listen(0,'127.0.0.1'),browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1600,height:1000}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const check=(name,ok)=>{assert.ok(ok,name);checks.push({name,passed:true});console.log('PASS '+name);};
const selected=()=>page.getAttribute('#decision-keyboard-status','data-selected-option');
async function choose(id){for(let i=0;i<15&&await selected()!==id;i++)await page.keyboard.press('ArrowRight');assert.equal(await selected(),id);await page.keyboard.press('Enter');}
async function blockFixture(rerolls=0,team='A'){return page.evaluate(({rerolls,team})=>{
 window.bloodboardOpenPractice(0);const a=window.bloodboard,E=window.BloodboardEngine,g=E.cloneState(a.game),p=g.players.find(p=>p.team===team),enemy=g.players.find(p=>p.team!==team);
 for(const q of g.players){q.location='reserves';q.pos=null;q.activated=false;}
 Object.assign(p,{location:'pitch',pos:{x:8,y:7},stance:'standing',st:7,skills:[],distracted:false});Object.assign(enemy,{location:'pitch',pos:{x:9,y:7},stance:'standing',st:3,skills:[],distracted:false});
 g.ball={kind:'none'};g.turn.active=team;g.turn.activation=null;g.pending=null;g.log=[];g.teams[team].rerolls=rerolls;
 const input={kind:'playerAction',playerId:p.id,action:'block',path:[],blockTarget:enemy.id};
 for(let seed=1;seed<200;seed++){
  const trial=E.cloneState(g);trial.rng={seed:seed*7919,counter:0};const r=E.execute(trial,input),req=r.state.pending?.request;
  const faces=req?.options.map(o=>o.id)??[];
  if(req?.type===(rerolls?'reroll':'blockDie')&&(rerolls?req.context?.pool?.includes('push'):faces.includes('push')&&new Set(faces).size>1)){
   a.st.pauseDice=false;a.replaceGame(trial,{keepDirty:true});a.runSimple(input);return {id:p.id,enemy:enemy.id,pushIndex:req.context?.pool?.indexOf('push')};
  }
 }throw Error('No block fixture');
 },{rerolls,team});}
try{
 await page.goto('http://127.0.0.1:'+port+'/');await page.waitForFunction(()=>!!window.bloodboard);let ids=await blockFixture();
 check('actual Block dice expose keyboard selection',await page.locator('#decision-keyboard-status').count()===1&&await page.locator('.keyboard-choice').count()>0);
 const before=await page.evaluate(()=>JSON.stringify(window.bloodboard.game)),first=await selected();await page.keyboard.press('ArrowRight');
 check('arrow switches Block die without rolling or committing',await selected()!==first&&before===await page.evaluate(()=>JSON.stringify(window.bloodboard.game)));
 const held=await selected();await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true})));
 check('held Enter cannot apply a decision',await selected()===held&&before===await page.evaluate(()=>JSON.stringify(window.bloodboard.game)));
 await choose('push');check('one Enter applies die then exposes push direction',await page.evaluate(()=>window.bloodboard.game.pending?.request.type)==='pushSquare');
 const pushBefore=await page.evaluate(()=>JSON.stringify(window.bloodboard.game));await page.keyboard.press('ArrowDown');
 check('push navigation changes only the highlighted legal square',pushBefore===await page.evaluate(()=>JSON.stringify(window.bloodboard.game))&&await page.locator('rect.keyboard-choice').count()>0);
 const target=await page.evaluate(()=>{const a=window.bloodboard,id=document.getElementById('decision-keyboard-status').dataset.selectedOption;return a.game.pending.request.options.find(o=>o.id===id).square;});await page.keyboard.press('Enter');
 check('Enter moves the defender into the selected push square',await page.evaluate(({ids,target})=>{const p=window.bloodboard.player(ids.enemy);return p.pos.x===target.x&&p.pos.y===target.y;},{ids,target}));
 check('continuous choices reset highlight for new follow-up request',await page.evaluate(()=>window.bloodboard.game.pending?.request.type)==='followUp'&&await selected()==='yes');
 await choose('no');check('follow-up can be declined through arrows and Enter',await page.evaluate(ids=>!window.bloodboard.game.pending&&window.bloodboard.player(ids.id).pos.x===8,ids));
 ids=await blockFixture(2);check('reroll tray includes existing dice as keyboard keep choices',(await selected()).startsWith('keep:'));
 await choose('keep:'+ids.pushIndex);check('keeping a Block die advances without spending a reroll',await page.evaluate(()=>window.bloodboard.game.pending?.request.type)==='pushSquare'&&await page.evaluate(()=>window.bloodboard.game.teams.A.rerolls)===2);
 
 for(const team of ['A','B']){
  await blockFixture(0,team);await page.evaluate(()=>{window.bloodboard.st.pitchOrientation='vertical';window.bloodboard.emit();});await choose('push');
  const current=await page.evaluate(()=>{const a=window.bloodboard,id=document.getElementById('decision-keyboard-status').dataset.selectedOption;return a.game.pending.request.options.find(o=>o.id===id).square;});
  const direction=await page.evaluate(({team,current})=>{const options=window.bloodboard.game.pending.request.options,other=options.find(o=>o.square&&o.square.y!==current.y);if(!other)throw Error('No directional choice');const dx=(team==='A'?1:-1)*(other.square.y-current.y);return dx>0?'ArrowRight':'ArrowLeft';},{team,current});
  await page.keyboard.press(direction);const after=await page.evaluate(()=>{const a=window.bloodboard,id=document.getElementById('decision-keyboard-status').dataset.selectedOption;return a.game.pending.request.options.find(o=>o.id===id).square;});
  const dx=(team==='A'?1:-1)*(after.y-current.y);check('push arrows follow displayed screen direction for home '+team,direction==='ArrowRight'?dx>0:dx<0);
 }
 await blockFixture();const pendingBefore=await page.evaluate(()=>JSON.stringify(window.bloodboard.game));await page.evaluate(()=>{const input=document.createElement('input');input.id='keyboard-test-input';document.body.append(input);input.focus();});await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
 check('input focus does not trigger gameplay shortcuts',pendingBefore===await page.evaluate(()=>JSON.stringify(window.bloodboard.game)));
 await page.evaluate(()=>{document.getElementById('keyboard-test-input').remove();const e=document.createElement('div');e.id='keyboard-test-editable';e.contentEditable='true';document.body.append(e);e.focus();});await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');
 check('editable content does not trigger gameplay shortcuts',pendingBefore===await page.evaluate(()=>JSON.stringify(window.bloodboard.game)));await page.evaluate(()=>document.getElementById('keyboard-test-editable').remove());
 // Use real engine log entries and replay verification, never a fake timer-only replay.
 await page.addScriptTag({content:replayBundle.outputFiles[0].text});
 const replay=await page.evaluate(()=>{
  window.bloodboardOpenPractice(0);const a=window.bloodboard,E=window.BloodboardEngine,g=E.cloneState(a.game),p=g.players.find(p=>p.team==='A');
  for(const q of g.players){q.location='reserves';q.pos=null;q.activated=false;}Object.assign(p,{location:'pitch',pos:{x:8,y:7},stance:'standing',ma:6,skills:[],distracted:false});
  g.ball={kind:'none'};g.turn.active='A';g.turn.activation=null;g.pending=null;g.log=[];
  const t=E.buildTeam('human',{format:'standard',play:'exhibition',id:'key-a',name:'A'}),u=E.buildTeam('human',{format:'standard',play:'exhibition',id:'key-b',name:'B'}),m=E.createMatch('exhibition',t,u,{},43);
  if(!m.ok)throw Error('No match fixture');g.match=m.state.match;g.match.pendingPhase=null;g.phase='play';const initial=E.cloneState(g);let state=g;
  for(const x of [9,10,11]){const r=E.execute(state,{kind:'playerAction',playerId:p.id,action:'move',path:[{to:{x,y:7},kind:'step'}]});if(r.status!=='completed')throw Error('Recording failed '+r.status);state=r.state;}
  const save=E.toSaveFile(state,'Keyboard replay');save.meta={...save.meta,initial};window.ReplayKeyTest.openReplay(a,save,'keyboard.json');return {mode:a.st.replay.mode,count:a.st.replay.count,reason:a.st.replay.reason};
 });check('test replay verifies against actual engine history',replay.mode==='full'&&replay.count===3);
 await page.evaluate(()=>document.activeElement.blur());await page.keyboard.press('Space');check('Space starts actual replay playback',await page.evaluate(()=>window.bloodboard.st.replay.playing));
 await page.keyboard.press('Space');const stopped=await page.evaluate(()=>window.bloodboard.st.replay.index);await page.waitForTimeout(1150);
 check('Space pauses replay and stops its timer',!await page.evaluate(()=>window.bloodboard.st.replay.playing)&&stopped===await page.evaluate(()=>window.bloodboard.st.replay.index));
 await page.keyboard.press('ArrowRight');check('replay arrow-step remains available',await page.evaluate(()=>window.bloodboard.st.replay.index)===stopped+1);
 await page.focus('#replay-play');await page.keyboard.press('Space');check('focused playback button does not double-toggle Space',await page.evaluate(()=>window.bloodboard.st.replay.playing));await page.keyboard.press('Space');
 // Actual computer card, while the human has the turn: avoid unrelated AI simulations.
 await page.evaluate(()=>{
  const a=window.bloodboard,E=window.BloodboardEngine;window.ReplayKeyTest.stopReplayTimer(a.st.replay);window.bloodboardOpenPractice(0);
  const t=E.buildTeam('human',{format:'standard',play:'exhibition',id:'cpu-a',name:'A'}),u=E.buildTeam('human',{format:'standard',play:'exhibition',id:'cpu-b',name:'B'}),m=E.createMatch('exhibition',t,u,{coaches:{B:{ai:'bloodboard-balanced'}}},43);
  const g=E.cloneState(a.game);g.match=m.state.match;g.match.pendingPhase=null;g.phase='play';g.turn.active='A';a.openBoard(g,{kind:'match'});a.st.computer.paused=true;a.emit();
 });await page.waitForSelector('#computer-pause');await page.evaluate(()=>document.activeElement.blur());await page.keyboard.press('Space');
 check('Space resumes computer actions through the existing pause control',!await page.evaluate(()=>window.bloodboard.st.computer.paused));
 // Watched real match: pause within the configured delay, before any AI work begins.
 await page.evaluate(()=>{const a=window.bloodboard;a.game.match.options.coaches.A={ai:'bloodboard-balanced'};a.st.computer.speed='slow';a.st.computer.paused=true;a.emit();});await page.keyboard.press('Space');await page.keyboard.press('Space');
 check('Space also pauses a watched computer match',await page.evaluate(()=>window.bloodboard.st.computer.paused));
 await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',repeat:true,bubbles:true})));check('held Space does not repeatedly resume computer actions',await page.evaluate(()=>window.bloodboard.st.computer.paused));
 check('no unexpected browser errors',errors.length===0);
 mkdirSync(join(root,'verification'),{recursive:true});writeFileSync(join(root,'verification/keyboard-results.json'),JSON.stringify({version:'0.2.0',checks,errors,scope:'Built browser, real Block/push/follow-up/reroll requests, verified engine replay and existing computer pause control. No production deployment.'},null,2)+'\n');console.log(checks.length+'/'+checks.length+' passed');
}finally{await browser.close();await srv.close();}
