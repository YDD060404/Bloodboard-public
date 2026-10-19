import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createServer } from '../lan/server.mjs';
import { memoryStore } from '../lan/store.mjs';
import { E, makeMatch } from '../lan/test/helpers.mjs';
const engine = { ...E, execute: state => ({ status:'ok', state:{...state,phase:'fullTime'},events:[] }) };
let clock=Date.now();const store=memoryStore();
const srv=await createServer({engine,code:'CLOSEUI22',store,webDir:new URL('../dist/web',import.meta.url).pathname,now:()=>clock,completedPollMs:5});
const port=await srv.listen(),base=`http://127.0.0.1:${port}`;
const browser=await chromium.launch();const checks=[],errors=[];
const check=(name,ok)=>{assert.ok(ok,name);checks.push({name,passed:true});console.log('PASS '+name);};
const wait=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('UI lifecycle timeout');};
const contexts=await Promise.all(['A','B'].map(()=>browser.newContext()));
const pages=await Promise.all(contexts.map(c=>c.newPage()));
const saved=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('bloodboard.lan.session.v1')||'null'));
try{
 for(let i=0;i<2;i++){
  const p=pages[i];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);
  await p.evaluate(()=>localStorage.setItem('broadboard.online.language','en'));await p.reload();
  await p.click('#lan-open');await p.fill('#lan-code','CLOSEUI22');await p.fill('#lan-name',i?'Guest':'Host');await p.selectOption('#lan-seat',i?'B':'A');await p.click('#lan-connect');await p.waitForSelector('#lan-status');
 }
 const a=await saved(pages[0]),b=await saved(pages[1]);
 const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);};
 await post('/api/start',{token:a.token,state:makeMatch()});
 await wait(()=>pages[0].evaluate(()=>window.bloodboard.lan.started));
 await post('/api/command',{token:a.token,commandId:'terminal-ui-001',baseRev:0,kind:'action',input:{kind:'pregame'}});
 await wait(()=>pages.every(()=>srv.room.state.phase==='fullTime'));
 for(const p of pages){await p.click('#lan-open');await p.waitForSelector('#lan-auto-close');check('full-time notice and history link are visible',await p.locator('#lan-history').count()===1&&/one minute/.test(await p.textContent('#lan-auto-close')));}
 const oldLines=[...store.lines];clock=srv.room.completedAt+59999;await new Promise(r=>setTimeout(r,60));check('no early release before the minute',store.archives.length===0&&srv.room.seats.A&&srv.room.seats.B);
 clock=srv.reopenAt;await wait(()=>store.archives.length===1);
 for(const p of pages){await wait(async()=>await saved(p)===null);check('browser leaves finished room and clears old token',await p.evaluate(()=>window.bloodboard.lan.status==='closed'&&window.bloodboard.st.screen==='home'));}
 check('neither browser automatically retakes a released seat',srv.room.seats.A===null&&srv.room.seats.B===null);
 check('exact old journal is retained',JSON.stringify(store.archives[0])===JSON.stringify(oldLines));
 check('no browser runtime errors',errors.length===0);
 writeFileSync(new URL('../verification/auto-close-results.json',import.meta.url),JSON.stringify({version:'0.2.0',scope:'Real built client, two independent browser sessions, server lifecycle. Terminal transition is a test double; 60-second boundary uses a controlled clock.',checks,errors},null,2)+'\n');
 console.log(`${checks.length}/${checks.length} passed`);
}finally{await browser.close();await srv.close();}
