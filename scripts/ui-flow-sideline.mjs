import { chromium } from 'playwright';
import { mkdirSync,writeFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from '../lan/server.mjs';
import { memoryStore } from '../lan/store.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const srv=await createServer({code:'SIDELINE22',store:memoryStore(),webDir:join(root,'dist/web')});
const port=await srv.listen(0,'127.0.0.1'),browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1600,height:1000}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const check=(name,ok)=>{assert.ok(ok,name);checks.push({name,passed:true});console.log('PASS '+name);};
const point=async c=>page.evaluate(c=>{const s=document.querySelector('.pitchhost svg'),h=s.closest('.pitchhost'),v=s.viewBox.baseVal;let x=22+c.x*34+17,y=22+c.y*34+17;if(s.dataset.orientation==='vertical')[x,y]=s.dataset.homeTeam==='A'?[y,Number(s.dataset.pitchWidth)-x]:[Number(s.dataset.pitchHeight)-y,x];const project=()=>{const r=s.getBoundingClientRect(),k=Math.min(r.width/v.width,r.height/v.height);return{x:r.left+(r.width-v.width*k)/2+(x-v.x)*k,y:r.top+(r.height-v.height*k)/2+(y-v.y)*k};};let p=project(),r=h.getBoundingClientRect();if(h.classList.contains('pitch-scroll')){if(p.x<r.left+15||p.x>r.right-15)h.scrollLeft+=p.x-r.left-h.clientWidth/2;if(p.y<r.top+15||p.y>r.bottom-15)h.scrollTop+=p.y-r.top-h.clientHeight/2;p=project();}return p;},c);
async function hoverPlayer(id){const c=await page.evaluate(id=>window.bloodboard.player(id).pos,id),p=await point(c);await page.mouse.move(p.x,p.y);await page.waitForFunction(id=>document.getElementById('player-inspection').dataset.playerId===id,id);}
try{
 await page.goto('http://127.0.0.1:'+port+'/');await page.evaluate(()=>window.bloodboardOpenPractice(0));await page.waitForSelector('#player-inspection');
 check('both dugouts present even without bench players',await page.locator('.dugout-team').count()===2);
 check('each tabletop strip has exactly three main zones',await page.locator('.dugout-group').count()===6);
 check('horizontal dugouts use left and right margins without top/bottom rows',await page.evaluate(()=>{const a=document.querySelector('.dugout-a').getBoundingClientRect(),b=document.querySelector('.dugout-b').getBoundingClientRect(),p=document.querySelector('.pitchhost').getBoundingClientRect();return a.right<=p.left+1&&b.left>=p.right-1&&Math.abs(a.top-p.top)<1&&Math.abs(b.top-p.top)<1&&Math.abs(a.height-p.height)<1;}));

 const ids=await page.evaluate(()=>{const a=window.bloodboard,E=window.BloodboardEngine,g=E.cloneState(a.game),active=g.players.find(p=>p.pos&&p.team===g.turn.active),enemy=g.players.find(p=>p.pos&&p.team!==g.turn.active);for(const [id,team,location] of [['reserve-a','A','reserves'],['ko-a','A','ko'],['reserve-b','B','reserves'],['cas-b','B','cas'],['sent-b','B','sentOff']]){const p=JSON.parse(JSON.stringify(active));Object.assign(p,{id,team,location,pos:null,number:g.players.length+1,name:'Custom '+id,activated:false});g.players.push(p);}a.replaceGame(g,{keepDirty:true});a.select(active.id);return{active:active.id,enemy:enemy.id};});
 const baseline=await page.evaluate(()=>JSON.stringify(window.bloodboard.game));await hoverPlayer(ids.enemy);
 check('hover opponent shows its real attribute card',await page.locator('#player-inspection .stat').count()===5);
 check('hover is read-only',baseline===await page.evaluate(()=>JSON.stringify(window.bloodboard.game))&&await page.evaluate(()=>window.bloodboard.st.selected)===ids.active);
 await page.mouse.move(10,10);await page.waitForFunction(id=>document.getElementById('player-inspection').dataset.playerId===id,ids.active);
 check('leaving hover restores selected player',true);
 await page.evaluate(()=>window.bloodboard.startDraft('move'));const draft=await page.evaluate(()=>JSON.stringify(window.bloodboard.st.draft));await hoverPlayer(ids.enemy);
 check('hover does not cancel or retarget an action plan',draft===await page.evaluate(()=>JSON.stringify(window.bloodboard.st.draft)));
 await page.locator('.dugout-player[data-player="ko-a"]').hover();await page.waitForFunction(()=>document.getElementById('player-inspection').dataset.playerId==='ko-a');
 check('KO bench player can be inspected without acting',draft===await page.evaluate(()=>JSON.stringify(window.bloodboard.st.draft))&&!await page.locator('.dugout-player[data-player="ko-a"]').evaluate(el=>el.classList.contains('draggable')));
 await page.locator('.dugout-player[data-player="reserve-b"]').click();
 check('click bench player selects and pins information',await page.evaluate(()=>window.bloodboard.st.selected)==='reserve-b');
 check('both benches show correct independent counts',await page.evaluate(()=>document.querySelector('.dugout-team[data-team="A"] [data-box="reserves"] b').textContent==='1'&&document.querySelector('.dugout-team[data-team="B"] [data-box="reserves"] b').textContent==='1'));
 check('battle does not allow reserve drag into play',await page.locator('.dugout-player.draggable').count()===0);
 await page.click('#pitch-orientation-toggle');
 const wide=await page.evaluate(()=>{const pitch=document.querySelector('.pitchwrap').getBoundingClientRect(),info=document.querySelector('.sideline').getBoundingClientRect(),actions=document.querySelector('.side').getBoundingClientRect();return info.left>=pitch.right-1&&actions.left>=info.right-1;});
 check('wide portrait uses unused space as a middle information rail',wide);
 check('portrait retains readable squares',await page.evaluate(()=>{const s=document.querySelector('.pitchhost svg'),r=s.getBoundingClientRect(),v=s.viewBox.baseVal;return 34*Math.min(r.width/v.width,r.height/v.height)>=33.9;}));
 await page.evaluate(()=>{const a=window.bloodboard;a.cancelDraft(false);a.replaceGame(window.BloodboardEngine.backToSetup(a.game),{keepDirty:true});});
 await page.locator('.dugout-player[data-player="reserve-a"]').scrollIntoViewIfNeeded();
 check('editor reserve can be dragged',await page.locator('.dugout-player[data-player="reserve-a"]').evaluate(el=>el.classList.contains('draggable')));
 const target=await page.evaluate(()=>{const E=window.BloodboardEngine,g=window.bloodboard.game;return E.board.neighbours(g.players.find(p=>p.pos).pos).find(c=>!E.playerAt(g,c));}),end=await point(target);
 const chip=await page.locator('.dugout-player[data-player="reserve-a"]').boundingBox();await page.mouse.move(chip.x+chip.width/2,chip.y+chip.height/2);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:12});await page.mouse.up();
 check('new reserve chip uses existing editor placement handler',await page.evaluate(c=>{const p=window.bloodboard.player('reserve-a');return p.location==='pitch'&&p.pos.x===c.x&&p.pos.y===c.y;},target));
 await page.setViewportSize({width:1000,height:800});
 check('narrow layout combines info and actions without hiding either bench',await page.evaluate(()=>getComputedStyle(document.querySelector('.board-rail')).display!=='contents')&&await page.locator('.dugout-team').count()===2);
 await page.evaluate(()=>window.BroadboardLanguage.setLanguage('en'));check('information labels switch to English',(await page.textContent('.pitcharena')).includes('Reserves'));
 await page.evaluate(()=>window.BroadboardLanguage.setLanguage('zh-CN'));check('information labels switch back to Chinese',(await page.textContent('.pitcharena')).includes('替补'));
 check('no unexpected browser errors',errors.length===0);
 mkdirSync(join(root,'verification'),{recursive:true});await page.setViewportSize({width:1600,height:1000});await hoverPlayer(ids.enemy);await page.screenshot({path:join(root,'verification/Broadboard-Online-0.2.0-portrait-layout.png'),fullPage:true});
 await page.click('#pitch-orientation-toggle');await hoverPlayer(ids.active);
 check('wide horizontal also separates information from action controls',await page.evaluate(()=>getComputedStyle(document.querySelector('.board-rail')).display==='contents'));
 check('horizontal bench tokens remain fully visible including reserves',await page.evaluate(()=>[...document.querySelectorAll('.dugout-players')].every(e=>{const p=e.querySelector('.dugout-player');if(!p)return true;const r=p.getBoundingClientRect(),v=e.getBoundingClientRect();return r.top>=v.top-1&&r.bottom<=v.bottom+1;})));
 await page.screenshot({path:join(root,'verification/Broadboard-Online-0.2.0-horizontal-layout.png'),fullPage:true});
 // The user's setup case: eleven players waiting in each reserve area.
 await page.setViewportSize({width:2560,height:1600});await page.evaluate(()=>{const a=window.bloodboard,E=window.BloodboardEngine,t=E.buildTeam('tombKings',{format:'standard',play:'exhibition',id:'layout-a',name:'Tomb Kings'}),u=E.buildTeam('bretonnian',{format:'standard',play:'exhibition',id:'layout-b',name:'Bretonnian'}),m=E.createMatch('exhibition',t,u,{},7);if(!m.ok)throw Error(JSON.stringify(m.errors));a.openBoard(m.state,{kind:'match'});a.st.pitchOrientation='horizontal';a.emit();});
 check('eleven-player setup retains accessible reserves on both sides',await page.evaluate(()=>['A','B'].every(t=>{const box=document.querySelector('.dugout-team[data-team="'+t+'"] [data-box="reserves"]'),list=box.querySelector('.dugout-players');return box.querySelectorAll('.dugout-player').length>=11&&list.clientHeight>=34&&list.scrollHeight>=list.clientHeight;})));
 check('large-window pitch recovers height freed by top/bottom strips',await page.evaluate(()=>{const p=document.querySelector('.pitchhost').getBoundingClientRect(),s=document.querySelector('.pitchhost svg'),v=s.viewBox.baseVal,r=s.getBoundingClientRect();return p.height>1000&&34*Math.min(r.width/v.width,r.height/v.height)>40;}));
 await page.screenshot({path:join(root,'verification/Broadboard-Online-0.2.0-setup-layout.png'),fullPage:true});

 writeFileSync(join(root,'verification/sideline-results.json'),JSON.stringify({version:'0.2.0',checks,errors,scope:'Built browser: both orientations, hover/select/draft preservation, bench status and editor drag; no remote deployment.'},null,2)+'\n');console.log(checks.length+'/'+checks.length+' passed');
}finally{await browser.close();await srv.close();}
