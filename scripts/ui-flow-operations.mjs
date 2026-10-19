import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from '../lan/server.mjs';
import { memoryStore } from '../lan/store.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const srv=await createServer({code:'OPERATIONS22',store:memoryStore(),webDir:join(root,'dist/web')});
const port=await srv.listen(0,'127.0.0.1'),browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1600,height:1000}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const check=(name,ok)=>{assert.ok(ok,name);checks.push({name,passed:true});console.log('PASS '+name);};
async function fixture(prone=false){return page.evaluate(prone=>{
 window.bloodboardOpenPractice(0);const a=window.bloodboard,E=window.BloodboardEngine,g=E.cloneState(a.game);
 const p=g.players.find(p=>p.team==='A'),enemy=g.players.find(p=>p.team==='B');
 for(const q of g.players){q.location='reserves';q.pos=null;q.activated=false;}
 Object.assign(p,{location:'pitch',pos:{x:8,y:7},stance:prone?'prone':'standing',ma:6,skills:[],distracted:false});
 Object.assign(enemy,{location:'pitch',pos:{x:12,y:7},stance:'standing',skills:[],distracted:false});
 g.ball={kind:'none'};g.turn.active='A';g.turn.activation=null;g.pending=null;g.log=[];g.rng={seed:42,counter:0};
 a.replaceGame(g,{keepDirty:true});a.select(p.id);return p.id;
 },prone);}
async function plan(id){await page.evaluate(id=>{const a=window.bloodboard;a.select(id);a.startDraft('move');a.updateDraft({path:[{to:{x:9,y:7},kind:'step'}]});},id);await page.waitForFunction(()=>!window.bloodboard.st.planBusy);assert.ok(await page.evaluate(()=>window.bloodboard.st.plan?.ok),JSON.stringify(await page.evaluate(()=>window.bloodboard.st.plan?.errors)));}
try{
 await page.goto('http://127.0.0.1:'+port+'/');await page.waitForFunction(()=>!!window.bloodboard);
 check('fresh settings default to continuous dice playback',!await page.evaluate(()=>window.bloodboard.st.pauseDice));
 let id=await fixture();const before=await page.evaluate(()=>JSON.stringify(window.bloodboard.game));await plan(id);
 check('planning still changes no game state',before===await page.evaluate(()=>JSON.stringify(window.bloodboard.game)));
 check('side panel offers execution without a review gate',await page.locator('#execute-plan').isEnabled()&&await page.evaluate(()=>window.bloodboard.st.stage)==='plan');
 await page.click('#execute-plan');
 check('one side-panel click executes the complete route',await page.evaluate(id=>window.bloodboard.player(id).pos.x===9&&window.bloodboard.st.history.length===1,id));
 await page.evaluate(()=>window.bloodboard.confirmNow());check('a second submit cannot execute the same cleared plan',await page.evaluate(()=>window.bloodboard.st.history.length)===1);
 id=await fixture();await plan(id);await page.evaluate(()=>document.activeElement.blur());await page.keyboard.press('Enter');
 check('Enter executes without a separate Review press',await page.evaluate(id=>window.bloodboard.player(id).pos.x===9,id));
 id=await fixture();await plan(id);await page.click('#tray-review');
 check('optional Details retains full probability review',await page.evaluate(()=>window.bloodboard.st.stage)==='review'&&await page.locator('#confirm-btn').isEnabled());
 await page.click('#confirm-btn');check('Details also needs just one execution click',await page.evaluate(id=>window.bloodboard.player(id).pos.x===9,id));
 id=await fixture();await page.evaluate(id=>{const a=window.bloodboard;a.startDraft('move');a.updateDraft({path:[{to:{x:12,y:7},kind:'step'}]});},id);await page.waitForFunction(()=>!window.bloodboard.st.planBusy);
 check('illegal plan remains disabled',!await page.locator('#execute-plan').isEnabled());
 id=await fixture(true);const standBefore=await page.evaluate(()=>JSON.stringify(window.bloodboard.game));
 check('selecting prone player alone does not stand them up',standBefore===await page.evaluate(()=>JSON.stringify(window.bloodboard.game))&&await page.locator('#stand-up-now').count()===1);
 await page.click('#stand-up-now');
 check('explicit Stand up needs one click and pays movement',await page.evaluate(id=>{const a=window.bloodboard,p=a.player(id),act=a.game.turn.activation;return p.stance==='standing'&&act.playerId===id&&act.maUsed===3;},id));
 await plan(id);await page.click('#execute-plan');check('standing up retains subsequent movement in the same activation',await page.evaluate(id=>window.bloodboard.player(id).pos.x===9&&window.bloodboard.game.turn.activation.maUsed===4,id));
 id=await fixture(true);await page.evaluate(id=>{const a=window.bloodboard;a.game.players.find(p=>p.id===id).activated=true;a.emit();},id);
 check('already-used prone players have no immediate action',await page.locator('#stand-up-now').count()===0);
 // Real engine execution with two Rush dice; find a seed with a successful route.
 await fixture();await page.evaluate(()=>{const a=window.bloodboard,E=window.BloodboardEngine,p=a.game.players.find(p=>p.pos&&p.team==='A');p.ma=1;const input={kind:'playerAction',playerId:p.id,action:'move',path:[{to:{x:9,y:7},kind:'step'},{to:{x:10,y:7},kind:'step'},{to:{x:11,y:7},kind:'step'}]};for(let seed=1;seed<100;seed++){const g=E.cloneState(a.game);g.rng={seed,counter:0};const r=E.execute(g,input);if(r.status==='completed'&&r.events.filter(e=>e.dice?.length).length>=2){a.replaceGame(g,{keepDirty:true});a.runSimple(input);return;}}throw Error('No two-dice fixture');});
 check('continuous playback exposes every actual dice event without Continue',await page.evaluate(()=>{const a=window.bloodboard,p=a.st.playback;return p.shown===p.events.length&&!a.playbackActive();}));
 // Opt-in pause remains useful; turning it off must release a currently paused playback.
 await page.check('#pause-dice-toggle');await page.evaluate(()=>{const a=window.bloodboard;a.st.playback.shown=0;a.emit();});
 check('step-by-step playback remains an explicit option',await page.locator('#tray-continue').count()===1);
 await page.uncheck('#pause-dice-toggle');check('disabling pausing immediately releases the current playback',!await page.evaluate(()=>window.bloodboard.playbackActive()));
 await page.check('#pause-dice-toggle');await page.reload();await page.waitForFunction(()=>!!window.bloodboard);
 check('explicitly saved pause preference survives reload',await page.evaluate(()=>window.bloodboard.st.pauseDice));
 await fixture();await page.uncheck('#pause-dice-toggle');
 // Find an actual failed Rush with a real reroll request: continuous animation must not answer it.
 const pending=await page.evaluate(()=>{const a=window.bloodboard,E=window.BloodboardEngine,p=a.game.players.find(p=>p.pos&&p.team==='A');p.ma=1;a.game.teams.A.rerolls=2;const input={kind:'playerAction',playerId:p.id,action:'move',path:[{to:{x:9,y:7},kind:'step'},{to:{x:10,y:7},kind:'step'}]};for(let seed=1;seed<100;seed++){const g=E.cloneState(a.game);g.rng={seed,counter:0};const r=E.execute(g,input);if(r.status==='awaitingDecision'&&r.state.pending?.request.type==='reroll'){a.replaceGame(g,{keepDirty:true});a.runSimple(input);return {request:a.game.pending.request.id,history:a.st.history.length};}}throw Error('No reroll fixture');});
 check('continuous playback still stops for a real reroll choice',await page.locator('#tray-keep').count()===1&&await page.evaluate(()=>window.bloodboard.game.pending.request.type)==='reroll');
 await page.evaluate(()=>window.bloodboard.confirmNow());check('plan execution cannot bypass a pending rules choice',pending.request===await page.evaluate(()=>window.bloodboard.game.pending.request.id));
 await page.click('#tray-keep');check('reroll decision itself applies with a single click',await page.evaluate(()=>window.bloodboard.game.pending?.request.id)!==pending.request);
 check('new operation labels support Chinese',await page.evaluate(()=>window.BroadboardLanguage.getLanguage())==='zh-CN');
 check('no unexpected browser errors',errors.length===0);
 mkdirSync(join(root,'verification'),{recursive:true});writeFileSync(join(root,'verification/operations-results.json'),JSON.stringify({version:'0.2.0',checks,errors,scope:'Compiled browser with actual rules engine; single-click execution, keyboard, invalid plans, stand-up, playback preference and mandatory reroll decisions. No production deployment.'},null,2)+'\n');console.log(checks.length+'/'+checks.length+' passed');
}finally{await browser.close();await srv.close();}
