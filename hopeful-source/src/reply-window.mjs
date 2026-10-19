import {markRetainedDirectOptions,copyRetainedDirectOptions} from './services.mjs';
const replyWindows=new WeakMap();
/** Internal fixed caller windows for guarded reply exploration. The original
 * cap/parameters and every native response remain the caller's responsibility. */
export function fixedReplyWindow(services,deadline,source='champion-reply-callee-left'){
 if(services?.exploreLegalityValidation!==true||typeof services.explore!=='function'||!Number.isFinite(deadline))return services;
 const prior=replyWindows.get(services),soft=source==='champion-held-reply-deadline';
 const view={...services,explore:(input,options={})=>{
  const explicit=Number.isFinite(options.coachEnumerationDeadline),earlier=explicit&&options.coachEnumerationDeadline<=deadline;
  return services.explore(input,copyRetainedDirectOptions(options,{...options,
   coachEnumerationDeadline:earlier?options.coachEnumerationDeadline:deadline,
   coachEnumerationDeadlineSource:earlier?options.coachEnumerationDeadlineSource??'explicit-caller':source}));
 }};
 replyWindows.set(view,{outerDeadline:prior?.outerDeadline??(soft?null:deadline),
  hardDeadline:Math.min(prior?.hardDeadline??Infinity,soft?Infinity:deadline),
  heldSoftDeadline:soft?deadline:prior?.heldSoftDeadline??null});
 return view;
}
/** Sample the real callee's decreasing left once at entry, before any awaited
 * work. Earlier Date sampling is conservative; even expired windows stay expired. */
export function sampleReplyWindow(services,left){
 if(services?.exploreLegalityValidation!==true||typeof services.explore!=='function'||typeof left!=='function')return services;
 const sampledAt=Date.now(),remaining=left();
 if(!Number.isFinite(sampledAt)||!Number.isFinite(remaining))return services;
 const view=fixedReplyWindow(services,sampledAt+remaining);
 // Record the actual sampled outer separately from a pre-existing hard peer;
 // that peer still bounds the view and cannot be reset by a later sample.
 replyWindows.set(view,{...replyWindows.get(view),outerDeadline:sampledAt+remaining});
 return view;
}

/** Only this real callee can identify its retained public holder/source. A
 * phase proof is local, not a complete policy or private-state identity. */
export function retainedDirectOptions(services,out,input,options,me){
 if(services?.retainedDirectTimeExtension!==true)return options;
 const window=replyWindows.get(services),ob=out?.observation,opp=me==='A'?'B':me==='B'?'A':null;
 const car=ob?.players?.find(p=>p.id===input?.playerId),requestId=ob?.requestId;
 const valid=Number.isInteger(requestId)&&requestId>=0&&typeof out?.key==='string'&&
  new RegExp('^'+requestId+'\\.[1-9][0-9]*$').test(out.key)&&Number.isFinite(out.p)&&out.p>0&&out.p<=1&&
  out.active===opp&&ob?.active===opp&&ob.phase==='play'&&Object.hasOwn(ob,'pending')&&ob.pending===null&&
  !out.turnover&&!out.touchdown&&ob.ball?.kind==='held'&&ob.ball.playerId===input?.playerId&&
  car?.team===opp&&car.location==='pitch'&&car.stance==='standing'&&car.pos&&!car.rooted&&
  input?.kind==='playerAction'&&['move','blitz'].includes(input.action)&&options.from===out.key&&
  options.team===opp&&options.perspective===me&&Number.isFinite(window?.outerDeadline)&&
  Number.isFinite(window?.hardDeadline)&&Number.isFinite(window?.heldSoftDeadline);
 return markRetainedDirectOptions(options,{schema:'retained-direct-score-window/1',source:'champion-retainedDirectScore',
  valid:!!valid,sourceKey:typeof out?.key==='string'?out.key:null,requestId:Number.isInteger(requestId)&&requestId>=0?requestId:null,actorId:typeof input?.playerId==='string'?input.playerId:null,
  holderId:typeof ob?.ball?.playerId==='string'?ob.ball.playerId:null,team:opp,perspective:me,retainedP:Number.isFinite(out?.p)?out.p:null,
  outerDeadline:Number.isFinite(window?.outerDeadline)?window.outerDeadline:null,hardDeadline:Number.isFinite(window?.hardDeadline)?window.hardDeadline:null,
  heldSoftDeadline:Number.isFinite(window?.heldSoftDeadline)?window.heldSoftDeadline:null,qualification:'actual callee retained public source/holder; exact native source validation still required'});
}
