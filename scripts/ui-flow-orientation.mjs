import { chromium } from 'playwright';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../lan/server.mjs';
import { memoryStore } from '../lan/store.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const testBundle=await build({absWorkingDir:root,entryPoints:['src/ui/pitch.ts'],bundle:true,write:false,format:'iife',globalName:'PitchInputTest',platform:'browser'});
const animationBundle=await build({absWorkingDir:root,entryPoints:['src/ui/animate.ts'],bundle:true,write:false,format:'iife',globalName:'AnimationViewTest',platform:'browser'});
const srv=await createServer({code:'VIEWTEST22',store:memoryStore(),webDir:join(root,'dist/web')});
const port=await srv.listen(0,'127.0.0.1'),browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),page=await ctx.newPage();
const results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
const check=(name,ok)=>{assert.ok(ok,name);results.push({name,passed:true});console.log('PASS '+name);};
const point=async c=>page.evaluate(c=>{
 const svg=document.querySelector('.pitchhost svg'),host=svg.closest('.pitchhost'),[vx,vy,w,h]=svg.getAttribute('viewBox').split(' ').map(Number);
 let x=22+c.x*34+17,y=22+c.y*34+17;if(svg.dataset.orientation==='vertical')[x,y]=svg.dataset.homeTeam==='A'?[y,Number(svg.dataset.pitchWidth)-x]:[Number(svg.dataset.pitchHeight)-y,x];
 const project=()=>{const r=svg.getBoundingClientRect(),k=Math.min(r.width/w,r.height/h);return {x:r.left+(r.width-w*k)/2+(x-vx)*k,y:r.top+(r.height-h*k)/2+(y-vy)*k};};
 let p=project();if(host.classList.contains('pitch-scroll')){const b=host.getBoundingClientRect();if(p.x<b.left+20||p.x>b.right-20)host.scrollLeft+=p.x-b.left-host.clientWidth/2;if(p.y<b.top+20||p.y>b.bottom-20)host.scrollTop+=p.y-b.top-host.clientHeight/2;p=project();}return p;
},c);
async function hover(c){const p=await point(c);await page.mouse.move(p.x,p.y);await page.waitForFunction(c=>window.bloodboard.st.hover?.x===c.x&&window.bloodboard.st.hover?.y===c.y,c);}
try{
 await page.goto('http://127.0.0.1:'+port+'/');await page.evaluate(()=>window.bloodboardOpenPractice(0));await page.waitForSelector('.pitchhost svg');
 check('horizontal remains default',await page.getAttribute('.pitchhost svg','data-orientation')==='horizontal');
 const before=await page.evaluate(()=>JSON.stringify(window.bloodboard.game));
 await page.click('#pitch-orientation-toggle');await page.waitForSelector('svg.vertical');
 check('Chinese orientation control visible',(await page.textContent('#pitch-orientation-toggle'))==='横向球场');
 check('vertical view has a taller viewBox',await page.evaluate(()=>{const v=document.querySelector('.pitchhost svg').viewBox.baseVal;return v.height>v.width;}));
 check('switch preserves game state',before===await page.evaluate(()=>JSON.stringify(window.bloodboard.game)));
 check('player labels remain upright',await page.evaluate(()=>[...document.querySelectorAll('.pitchhost g.player')].every(p=>p.querySelector('.upright-player')?.getAttribute('transform')===(document.querySelector('.pitchhost svg').dataset.homeTeam==='A'?'rotate(90)':'rotate(-90)'))));
 for(const c of [{x:0,y:0},{x:25,y:14},{x:12,y:7}])await hover(c);
 check('vertical hover maps corners and centre correctly',true);
 await page.evaluate(()=>{const a=window.bloodboard,p=a.game.players.find(p=>p.pos&&p.team===a.game.turn.active&&window.BloodboardEngine.actionOptions(a.game,p).some(o=>o.action==='move'&&o.enabled));a.st.selected=p.id;a.startDraft('move');});
 const destination=await page.evaluate(()=>{const a=window.bloodboard,p=a.player(a.st.draft.playerId);return window.BloodboardEngine.board.neighbours(p.pos).find(c=>!window.BloodboardEngine.playerAt(a.game,c));});
 const to=await point(destination);await page.mouse.click(to.x,to.y);
 check('vertical click plans movement on the intended square',await page.evaluate(c=>window.bloodboard.st.draft.path.some(p=>p.to.x===c.x&&p.to.y===c.y),destination));
 const draft=await page.evaluate(()=>JSON.stringify(window.bloodboard.st.draft));await page.click('#pitch-orientation-toggle');
 check('switch preserves planned path',draft===await page.evaluate(()=>JSON.stringify(window.bloodboard.st.draft)));
 await page.click('#pitch-orientation-toggle');await page.evaluate(()=>{const a=window.bloodboard;a.cancelDraft(false);a.replaceGame(window.BloodboardEngine.backToSetup(a.game),{keepDirty:true});});
 const drag=await page.evaluate(()=>{const a=window.bloodboard,E=window.BloodboardEngine,p=a.game.players.find(p=>p.pos);return {id:p.id,from:p.pos,to:E.board.neighbours(p.pos).find(c=>!E.playerAt(a.game,c))};});
 const from=await point(drag.from),drop=await point(drag.to);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(drop.x,drop.y,{steps:10});await page.mouse.up();
 check('vertical editor drag drops on the intended square',await page.evaluate(d=>{const p=window.bloodboard.player(d.id);return p.pos.x===d.to.x&&p.pos.y===d.to.y;},drag));
 await page.evaluate(()=>{window.BroadboardLanguage.setLanguage('en');window.bloodboard.set({screen:'home'});});await page.locator('button').filter({hasText:/^Board$/}).click();
 check('orientation survives navigation and supports English',await page.getAttribute('.pitchhost svg','data-orientation')==='vertical'&&await page.textContent('#pitch-orientation-toggle')==='Horizontal pitch');
 await page.reload();await page.waitForFunction(()=>!!window.bloodboard);await page.evaluate(()=>window.bloodboardOpenPractice(0));
 check('orientation persists browser reload',await page.getAttribute('.pitchhost svg','data-orientation')==='vertical');
 await page.addScriptTag({content:testBundle.outputFiles[0].text});
 const mappings=await page.evaluate(()=>{
  const a=window.bloodboard,T=window.PitchInputTest,E=window.BloodboardEngine,original=a.st.ctx;
  a.st.pitchFit=true;let verified=0;const checkSvg=svg=>{const v=svg.viewBox.baseVal,r=svg.getBoundingClientRect(),k=Math.min(r.width/v.width,r.height/v.height),cols=Number(svg.dataset.pitchCols),rows=Number(svg.dataset.pitchRows);for(let x=0;x<cols;x++)for(let y=0;y<rows;y++){let px=22+x*34+17,py=22+y*34+17;if(svg.dataset.orientation==='vertical')[px,py]=svg.dataset.homeTeam==='A'?[py,Number(svg.dataset.pitchWidth)-px]:[Number(svg.dataset.pitchHeight)-py,px];if(px<v.x||py<v.y||px>=v.x+v.width||py>=v.y+v.height)continue;const p=T.squareFromPoint(svg,r.left+(r.width-v.width*k)/2+(px-v.x)*k,r.top+(r.height-v.height*k)/2+(py-v.y)*k);if(!p||p.x!==x||p.y!==y)throw Error('Coordinate roundtrip failed');verified++;}if(T.squareFromPoint(svg,r.left-100,r.top-100)!==null)throw Error('Outside pitch accepted');};
  for(const format of ['standard','sevens']){const team=E.buildTeam('human',{format,play:'exhibition',id:'view-a',name:'View A'}),other=E.buildTeam('human',{format,play:'exhibition',id:'view-b',name:'View B'});const made=E.createMatch('tournament',team,other,{format},532);if(!made.ok)throw Error(JSON.stringify(made.errors));a.replaceGame(made.state);for(const home of ['A','B']){a.game.turn.active=home;for(const orientation of ['horizontal','vertical']){a.st.pitchOrientation=orientation;a.emit();checkSvg(document.querySelector('.pitchhost svg'));if(orientation==='vertical'&&document.querySelector('.pitchhost svg').dataset.homeTeam!==home)throw Error('Wrong hotseat home');}}}
  // The same renderer/input must work for cropped workbook grids and nonzero viewBox origins.
  a.st.ctx={kind:'lesson',course:'blockSchool'};T.setLessonGrid(()=>({cols:4,rows:3}));for(const orientation of ['horizontal','vertical']){a.st.pitchOrientation=orientation;T.renderPitch(a,document.querySelector('.pitchhost'));checkSvg(document.querySelector('.pitchhost svg'));}a.st.ctx=original;return verified;
 });
 check('full standard Sevens and cropped grids roundtrip in both homes and orientations',mappings>=2440);
 const homeChecks=await page.evaluate(()=>{
  const T=window.PitchInputTest,E=window.BloodboardEngine;
  const team=E.buildTeam('human',{format:'sevens',play:'exhibition',id:'h-a',name:'Human'}),other=E.buildTeam('human',{format:'sevens',play:'exhibition',id:'h-b',name:'Other'});
  const made=E.createMatch('tournament',team,other,{format:'sevens',coaches:{B:{ai:'bloodboard-balanced'}}},44);if(!made.ok)throw Error('Match not built');
  const mock={game:made.state,st:{ctx:{kind:'match'},setupDraft:null},lan:null};
  const output=[T.homeTeamForView(mock)];mock.game.turn.active='B';output.push(T.homeTeamForView(mock));
  mock.game.match.options.coaches={A:{ai:'bloodboard-balanced'}};output.push(T.homeTeamForView(mock));mock.game.turn.active='A';output.push(T.homeTeamForView(mock));
  mock.game.match.options.coaches={A:{ai:'bloodboard-balanced'},B:{ai:'bloodboard-balanced'}};output.push(T.homeTeamForView(mock));
  mock.st.ctx={kind:'replay'};output.push(T.homeTeamForView(mock));
  mock.lan={active:true,mySeat:'B'};output.push(T.homeTeamForView(mock));return output;
 });
 check('human versus AI keeps the human home across opponent turns',JSON.stringify(homeChecks.slice(0,4))===JSON.stringify(['A','A','B','B']));
 check('spectator and replay defaults and network seat precedence are stable',JSON.stringify(homeChecks.slice(4))===JSON.stringify(['A','A','B']));

 
 await page.evaluate(()=>{const a=window.bloodboard;window.bloodboardOpenPractice(0);a.game.turn.active='B';a.st.pitchOrientation='vertical';a.emit();const p=a.game.players.find(p=>p.pos&&p.team==='B'&&window.BloodboardEngine.actionOptions(a.game,p).some(o=>o.action==='move'&&o.enabled));a.st.selected=p.id;a.startDraft('move');});
 const bDestination=await page.evaluate(()=>{const a=window.bloodboard,p=a.player(a.st.draft.playerId);return window.BloodboardEngine.board.neighbours(p.pos).find(c=>!window.BloodboardEngine.playerAt(a.game,c));});
 const bPoint=await point(bDestination);await page.mouse.click(bPoint.x,bPoint.y);
 check('B human view clicks plan the intended original square',await page.evaluate(c=>window.bloodboard.st.draft.path.some(p=>p.to.x===c.x&&p.to.y===c.y),bDestination));
 await page.evaluate(()=>{const a=window.bloodboard;a.cancelDraft(false);a.replaceGame(window.BloodboardEngine.backToSetup(a.game),{keepDirty:true});});
 const bDrag=await page.evaluate(()=>{const a=window.bloodboard,E=window.BloodboardEngine,p=a.game.players.find(p=>p.pos&&p.team==='B');return{id:p.id,from:p.pos,to:E.board.neighbours(p.pos).find(c=>!E.playerAt(a.game,c))};});
 const bFrom=await point(bDrag.from),bDrop=await point(bDrag.to);await page.mouse.move(bFrom.x,bFrom.y);await page.mouse.down();await page.mouse.move(bDrop.x,bDrop.y,{steps:10});await page.mouse.up();
 check('B human view drag maps to the intended original square',await page.evaluate(d=>{const p=window.bloodboard.player(d.id);return p.pos.x===d.to.x&&p.pos.y===d.to.y;},bDrag));
await page.setViewportSize({width:1000,height:800});await page.evaluate(()=>{window.bloodboardOpenPractice(0);window.bloodboard.st.pitchOrientation='vertical';window.bloodboard.st.pitchFit=false;window.bloodboard.st.pitchZoom=1;window.bloodboard.emit();window.BroadboardLanguage.setLanguage('zh-CN');});await hover({x:10,y:5});
 check('coordinate mapping survives viewport resize',true);
 const cellPixels=()=>page.evaluate(()=>{const s=document.querySelector('.pitchhost svg'),v=s.viewBox.baseVal,r=s.getBoundingClientRect();return 34*Math.min(r.width/v.width,r.height/v.height);});
 const readable=await cellPixels();check('portrait default keeps squares at least 34 CSS pixels',readable>=33.9);
 await page.click('#pitch-zoom-in');const enlarged=await cellPixels();check('zoom in enlarges squares by 25 percent',enlarged>=readable*1.24);
 const gameBeforeZoom=await page.evaluate(()=>JSON.stringify(window.bloodboard.game));await page.click('#pitch-fit');
 check('whole-pitch overview is optional and fits the viewport',await page.evaluate(()=>{const h=document.querySelector('.pitchhost');return !h.classList.contains('pitch-scroll')&&h.scrollHeight<=h.clientHeight+1;})&&await cellPixels()<readable);
 await page.click('#pitch-fit');check('readable mode restores previous zoom',Math.abs(await cellPixels()-enlarged)<0.1);
 check('zoom and overview preserve game state',gameBeforeZoom===await page.evaluate(()=>JSON.stringify(window.bloodboard.game)));
 await hover({x:20,y:7});
 const camera=await page.evaluate(()=>{const h=document.querySelector('.pitchhost');return [h.scrollLeft,h.scrollTop];});await hover({x:19,y:7});
 check('hover redraw preserves scroll position',JSON.stringify(camera)===await page.evaluate(()=>{const h=document.querySelector('.pitchhost');return JSON.stringify([h.scrollLeft,h.scrollTop]);}));
 const clipped=await page.evaluate(()=>{const svg=document.querySelector('.pitchhost svg'),h=svg.closest('.pitchhost'),v=h.getBoundingClientRect(),r=svg.getBoundingClientRect();return window.PitchInputTest.squareFromPoint(svg,(v.left+v.right)/2,v.top-2)===null&&r.top<v.top;});
 check('hidden scrolled-off squares cannot receive drops',clipped);
 await page.click('#pitch-zoom-out');await hover({x:14,y:5});

 await page.addScriptTag({content:animationBundle.outputFiles[0].text});
 const animated=await page.evaluate(()=>{
   const a=window.bloodboard,E=window.BloodboardEngine,A=window.AnimationViewTest,svg=document.querySelector('.pitchhost svg');
   const before=E.cloneState(a.game),after=E.cloneState(before),p=after.players.find(p=>p.pos&&p.pos.x<24);p.pos.x+=1;
   const el=svg.querySelector('g.player[data-player="'+p.id+'"]'),body=el.querySelector('.body'),start=body.getBoundingClientRect();
   const mock={st:{animate:true,playback:{seq:987654,shown:1,before,events:[{snap:A.snapOf(after)}]}},game:after};
   A.applyAnimations(mock,svg,{sq:34,margin:22});const animation=el.getAnimations()[0];if(!animation)return false;
   animation.pause();animation.currentTime=A.currentTimeline().total/2;
   const middle=body.getBoundingClientRect(),matrix=el.querySelector('.upright-player').getScreenCTM();
   const ok=Math.abs(middle.x-start.x)<0.5&&(svg.dataset.homeTeam==='A'?middle.y<start.y-1:middle.y>start.y+1)&&Math.abs(matrix.b)<0.001&&Math.abs(matrix.c)<0.001;
   animation.cancel();return ok;
 });
 check('movement animation follows vertical axis and keeps glyph upright',animated);

 check('no unexpected browser errors',errors.length===0);
 mkdirSync(join(root,'verification'),{recursive:true});await page.screenshot({path:join(root,'verification/Broadboard-Online-0.2.0-vertical.png'),fullPage:true});
 writeFileSync(join(root,'verification/orientation-results.json'),JSON.stringify({version:'0.2.0',checks:results,coordinateRoundtrips:mappings,errors,scope:'Built browser, real clicks and drag, standard/Sevens/cropped geometry; local only.'},null,2)+'\n');console.log(results.length+'/'+results.length+' passed');
}finally{await browser.close();await srv.close();}
