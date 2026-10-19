import {preferenceFeaturesV2} from './preference-features-v2.mjs';

export const PREFERENCE_V3_COORDINATE_ROLES=Object.freeze(['ball','actor','target','holder','active_actor','path_end']);
export const PREFERENCE_V3_REMOVED_KEYS=Object.freeze([
 ...PREFERENCE_V3_COORDINATE_ROLES.flatMap(role=>[role+'_x',role+'_y']),
 'path_public_forward_sign','own_forward_x_sign','own_scoring_endzone_x','opponent_scoring_endzone_x'
]);
const coordinate=(p)=>p&&Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.x<26&&p.y>=0&&p.y<15;
const fail=reason=>{throw Error(reason);};

/** Independent public-root/input encoder. No label, native law or caller metadata is consumed. */
export function preferenceFeaturesV3(publicRoot,input){
 const features={...preferenceFeaturesV2(publicRoot,input)};
 // The parent requires the published 26x15 standard pitch and own active side.
 // An absent scoring map remains unknown; team name alone is not a direction proof.
 const knownScoring=publicRoot.pitch.endZone?.A===25&&publicRoot.pitch.endZone?.B===0;
 for(const player of publicRoot.players)
  if(player.pos!==null&&!coordinate(player.pos))fail('PUBLIC_RELATIVE_POSITION_INVALID');
 for(const role of PREFERENCE_V3_COORDINATE_ROLES){
  const xKey=role+'_x',yKey=role+'_y';
  if(!Object.hasOwn(features,xKey)&&!Object.hasOwn(features,yKey))continue;
  const x=features[xKey],y=features[yKey];
  if((x===null)!==(y===null))fail('PUBLIC_RELATIVE_POSITION_INCOMPLETE');
  const known=x!==null&&y!==null;
  if(known&&!coordinate({x,y}))fail('PUBLIC_RELATIVE_POSITION_INVALID');
  features[role+'_own_scoring_distance']=known&&knownScoring?(publicRoot.team==='A'?25-x:x):null;
  features[role+'_centerline_distance']=known?Math.abs(y-7):null;
 }
 for(const key of PREFERENCE_V3_REMOVED_KEYS)delete features[key];
 // JSON/stable vector mirrors must treat signed zero identically. Normalize only
 // numeric -0; preserve nulls, unknowns, and every other parent feature value.
 for(const [key,value] of Object.entries(features))
  if(typeof value==='number'&&Object.is(value,-0))features[key]=0;
 return features;
}
