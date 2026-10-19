import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from '../lan/server.mjs';
import { memoryStore } from '../lan/store.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
mkdirSync(join(root,'verification'),{recursive:true});
const store=memoryStore(),srv=await createServer({code:'PREVIEW22',store,webDir:join(root,'dist/web'),seed:()=>8771});
const port=await srv.listen(0,'127.0.0.1'),url='http://127.0.0.1:'+port+'/';
const browser=await chromium.launch();const results=[],errors=[];
const check=(name,ok)=>{assert.ok(ok,name);results.push({name,passed:true});console.log('PASS '+name);};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn)=>{for(let i=0;i<100;i++){if(await fn())return;await sleep(100);}throw Error('Timed out waiting for UI/server state');};
const ctxA=await browser.newContext({viewport:{width:1440,height:1000}}),ctxB=await browser.newContext({viewport:{width:1440,height:1000}});
await ctxA.addInitScript(() => localStorage.setItem('broadboard.online.language', 'en'));
await ctxB.addInitScript(() => localStorage.setItem('broadboard.online.language', 'en'));
const a=await ctxA.newPage(),b=await ctxB.newPage();for(const p of [a,b]){p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());}
const saved=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('bloodboard.lan.session.v1')||'null'));
async function joinRoom(p,seat){await p.click('#lan-open');await p.fill('#lan-code','PREVIEW22');await p.fill('#lan-name',seat==='A'?'Host':'Guest');await p.selectOption('#lan-seat',seat);await p.click('#lan-connect');await p.waitForSelector('#lan-status');await wait(()=>p.evaluate(()=>window.bloodboard.lan.status==='online'));}
try{
 await a.goto(url);await b.goto(url);check('independent brand and version are visible',(await a.title())==='Bloodboard Unified'&&(await a.textContent('#build-line')).includes('0.2.0'));
 check('browser homepage exposes online entry',await a.locator('#online-room-open').count()===1);
 await joinRoom(a,'A');await joinRoom(b,'B');check('two isolated browsers join different seats',srv.room.seats.A&&srv.room.seats.B);
 const originalB=(await saved(b)).token;await b.click('#lan-disconnect');check('temporary disconnect retains saved seat token',(await saved(b)).token===originalB);check('disconnect does not release server ownership',srv.room.seatOf(originalB)==='B');
 await b.click('#lan-open');await b.click('#lan-resume');await b.waitForSelector('#lan-status');await wait(()=>b.evaluate(()=>window.bloodboard.lan.status==='online'));check('explicit reconnect restores same token and seat',(await saved(b)).token===originalB);
 store.failNext=1;await b.click('#lan-release');await sleep(400);check('store failure keeps credentials and server seat',(await saved(b)).token===originalB&&srv.room.seatOf(originalB)==='B');
 await b.click('#lan-release');await wait(()=>!srv.room.seats.B);await wait(async()=>await saved(b)===null);check('release is server-confirmed before credentials are removed',await saved(b)===null);await joinRoom(b,'B');check('a released seat can be joined again',(await saved(b)).token!==originalB);
 const oldA=(await saved(a)).token;await a.click('#lan-new-match');await wait(()=>store.archives.length===1);await wait(()=>srv.room.seats.A&&srv.room.seats.B);check('lobby host can archive and reopen both seats',srv.room.seatOf(oldA)===null&&store.archives[0].length>=4);
 await a.click('#lan-setup');await a.waitForSelector('#start-match');await a.click('#nm-hotseat');await a.click('#start-match');await wait(()=>srv.room.started);await wait(()=>a.evaluate(()=>window.bloodboard.lan.started));await wait(()=>b.evaluate(()=>window.bloodboard.lan.started));
 for(const [p,seat] of [[a,'A'],[b,'B']]){await p.evaluate(()=>{window.bloodboard.st.pitchOrientation='vertical';window.bloodboard.emit();});check('network seat '+seat+' keeps its own half at the bottom',await p.getAttribute('.pitchhost svg','data-home-team')===seat);}
 await b.click('#lan-open');check('live match offers disconnect but no silent seat release',await b.isDisabled('#lan-release'));
 await a.click('#lan-open');check('host can explicitly abandon a live match',/Abandon/.test(await a.textContent('#lan-new-match')));
 const oldLines=[...store.lines];await a.click('#lan-new-match');await wait(()=>store.archives.length===2);await wait(()=>srv.room.seats.A&&srv.room.seats.B);check('abandonment retains exact old match journal',JSON.stringify(store.archives[1])===JSON.stringify(oldLines));check('both browsers can enter the fresh lobby',!srv.room.started&&srv.room.seats.A&&srv.room.seats.B);
 check('no unexpected JavaScript errors',errors.length===0);
 await a.locator('button').filter({hasText:/^Close$/}).click();await a.screenshot({path:join(root,'verification/Broadboard-Online-0.2.0.png'),fullPage:true});
 writeFileSync(join(root,'verification/ui-results.json'),JSON.stringify({version:'0.2.0',scope:'Local loopback, real built browser + server, two independent browser contexts. Not a Render/two-device test.',checks:results,errors},null,2)+'\n');
 console.log(results.length+'/'+results.length+' passed');
}finally{await browser.close();await srv.close();}
