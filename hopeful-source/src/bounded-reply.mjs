/** Replies share the existing bounded comparison cap. The actual native
 * response is returned unchanged: residual mass and inexactness stay unknown.
 * This wrapper does not affect own-policy certification or the frozen coach. */
export function boundedReplyServices(raw,deadline=Infinity){
 if(typeof raw?.explore!=='function')return raw;
 return {...raw,explore:(input,options={})=>raw.explore(input,{...options,
  ...(raw.exploreLegalityValidation===true&&Number.isFinite(deadline)?{coachEnumerationDeadline:Math.min(deadline,Number.isFinite(options.coachEnumerationDeadline)?options.coachEnumerationDeadline:Infinity)}:{}),
  maxLeaves:Math.min(64,Number.isFinite(options.maxLeaves)&&options.maxLeaves>0?options.maxLeaves:64)})};
}

/** Carry a real local slot through a wrapped frozen reply scorer without
 * changing its enumeration settings or native response. */
export function withExploreDeadline(raw,deadline){
 if(typeof raw?.explore!=='function'||raw.exploreLegalityValidation!==true||!Number.isFinite(deadline))return raw;
 return {...raw,explore:(input,options={})=>raw.explore(input,{...options,coachEnumerationDeadline:Math.min(deadline,Number.isFinite(options.coachEnumerationDeadline)?options.coachEnumerationDeadline:Infinity)})};
}
