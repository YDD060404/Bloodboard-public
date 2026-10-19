/** Activation eligibility shared with the frozen selector. Native validation
 * still decides action-specific traits, declarations and resource legality. */
export function available(o,p){
 return p?.location==='pitch'&&!!p.pos&&p.stance!=='stunned'&&
  (o.activation?.playerId===p.id&&!o.activation.over||!p.activated&&p.canBeActivated!==false);
}
export function protectionReady(o,p){
 if(!available(o,p)||p.stance!=='standing'||p.distracted||p.rooted)return false;
 const used=o.activation?.playerId===p.id&&Number.isFinite(o.activation.maUsed)?o.activation.maUsed:0;
 return !Number.isFinite(p.ma)||p.ma-used>0;
}
