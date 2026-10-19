/** Read-only, request-local diagnostics. These facts never change a probability,
 * service result, deadline or the frozen assessment's completeness flags. */
export function auditReplyServices(raw){
 const facts=new Map();let calls=0;
 const fact=(reason,details={})=>{
  const entry=facts.get(reason)??{reason,count:0,example:details};entry.count++;facts.set(reason,entry);
 };
 const wrap=(name,fn,receiver)=>async(...args)=>{
  calls++;let r;
  try{r=await fn.apply(receiver,args);}catch(e){fact('reply-rpc-exception',{method:name});throw e;}
  try{
   const options=name==='explore'?args[1]:args[0],from=options?.from??'root';
   const details={method:name,from};
   if(r?.ok!==true)fact('reply-rpc-service-not-successful',{...details,code:r?.code??null});
   if(name==='candidates'){
    if(r?.hasMore===true)fact('reply-candidate-page-not-fully-returned',{...details,returned:r.returned,total:r.total});
    if(r?.complete===false)fact('reply-candidate-generation-incomplete',details);
   }
   if(r?.truncated&&(!Array.isArray(r.truncated)||r.truncated.length))fact('reply-service-truncated',{...details,truncated:r.truncated});
   if(r?.exact===false)fact('reply-service-inexact',details);
   if(Number.isFinite(r?.unresolvedMass)&&r.unresolvedMass>1e-8)fact('reply-explore-unexpanded-probability',{...details,p:r.unresolvedMass});
   if(Number.isFinite(r?.rest?.p)&&r.rest.p>1e-8)fact('reply-explore-unlisted-probability',{...details,p:r.rest.p});
   if(Array.isArray(r?.outcomes)&&r.outcomes.some(b=>!b.key&&!b.touchdown))fact('reply-successor-key-unavailable',details);
  }catch{fact('reply-diagnostic-response-unreadable',{method:name});}
  return r;
 };
 const services={...raw};
 for(const name of ['candidates','explore','validate','sequence'])if(typeof raw?.[name]==='function')services[name]=wrap(name,raw[name],raw);
 if(raw?.threats){services.threats={...raw.threats};for(const name of ['scoring','blitz'])if(typeof raw.threats[name]==='function')services.threats[name]=wrap('threats.'+name,raw.threats[name],raw.threats);}
 const snapshot=report=>{
  const components=[];
  for(const [name,r] of [['transfer',report?.transferContinuation],['pickup',report?.pickupContinuation],['held-contact',report?.heldReplyContinuation],['ground-contact',report?.groundReplyContinuation]]){
   if(r?.incomplete)components.push({reason:'reply-'+name+'-continuation-incomplete',lowerBound:r.lowerBound??r.scoreLowerBound??null,
    unresolved:r.unresolved??r.unexaminedMass??null,retainedLines:r.lines?.length??null,retainedBranches:r.branches?.length??null});
  }
  if(report?.groundReplySkipped)components.push({reason:'reply-ground-followup-cap',count:report.groundReplySkipped});
  if(report?.heldReplySkipped)components.push({reason:'reply-held-followup-cap',count:report.heldReplySkipped});
  if(report?.carrierThreat?.possessionUnknown>1e-8)components.push({reason:'reply-carrier-possession-unresolved',p:report.carrierThreat.possessionUnknown});
  return {calls,flags:{failed:report?.failed===true,unknown:report?.unknown===true,essentialComplete:report?.essentialComplete===true},
   directScore:report?.directScore??null,criticalAdjustment:report?.criticalAdjustment??null,
   components,serviceFacts:[...facts.values()],
   scope:'observed service/component conditions; exact frozen guard provenance is not exposed, so facts are not themselves a new safety or probability certificate'};
 };
 return {services,snapshot};
}
