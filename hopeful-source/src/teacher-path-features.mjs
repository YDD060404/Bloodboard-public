import {preferenceFeatures} from './teacher-base-features.mjs';

export const PREFERENCE_PATH_FEATURE_KEYS=Object.freeze([
 'path_public_forward_sign',
 'path_actor_scoring_distance',
 'path_end_scoring_distance',
 'path_forward_progress',
 'path_root_enemy_standing_adjacent',
 'path_root_enemy_zone_count',
 'path_arrival_enemy_standing_max',
 'path_arrival_enemy_standing_sum',
 'path_arrival_enemy_zone_max',
 'path_arrival_enemy_zone_sum',
 'path_departure_enemy_zone_sum',
 'path_departure_zone_exposed_steps'
]);

const fail=reason=>{throw Error(reason);};
const distance=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const coordinate=(p,width,height)=>p&&Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.x<width&&p.y>=0&&p.y<height;
const knownLocations=new Set(['pitch','reserves','ko','cas']);
const knownStances=new Set(['standing','prone','stunned']);

// A static public count. Missing facts remain unknown; no probability or
// projected outcome is reconstructed. Champion uses standing && !distracted
// && tackleZone!==false; here the native published boolean must be known.
function countsAt(root,at){
 let standing=0,zones=0,standingKnown=true,zonesKnown=true;
 for(const player of root.players){
  if(player.team===root.team)continue;
  if(!knownLocations.has(player.location)){standingKnown=false;zonesKnown=false;continue;}
  if(player.location!=='pitch')continue;
  if(!player.pos){standingKnown=false;zonesKnown=false;continue;}
  if(distance(player.pos,at)!==1)continue;
  if(!knownStances.has(player.stance)){standingKnown=false;zonesKnown=false;continue;}
  if(player.stance!=='standing')continue;
  standing++;
  if(player.distracted===true||player.tackleZone===false)continue;
  if(player.tackleZone===true&&player.distracted===false)zones++;
  else zonesKnown=false;
 }
 return {standing:standingKnown?standing:null,zones:zonesKnown?zones:null};
}

function aggregate(values,kind){
 if(values.some(value=>value===null))return null;
 return values.reduce((result,value)=>kind==='max'?Math.max(result,value):result+value,0);
}

/** Independent research encoder. Only public root and input are consumed. */
export function preferenceFeaturesV2(publicRoot,input){
 const features={...preferenceFeatures(publicRoot,input)};
 for(const key of PREFERENCE_PATH_FEATURE_KEYS)features[key]=null;
 const {width,height,endZone}=publicRoot.pitch;
 if(endZone!==undefined&&endZone!==null){
  if(endZone.A!==25||endZone.B!==0)fail('PUBLIC_SCORING_DIRECTION_UNVERIFIED');
  features.path_public_forward_sign=publicRoot.team==='A'?1:-1;
 }
 const actor=publicRoot.players.find(player=>player.id===input.playerId);
 if(!actor)return features; // EndTurn / EndActivation have no declared actor.
 if(actor.team!==publicRoot.team||actor.location!=='pitch'||!coordinate(actor.pos,width,height))
  fail('PUBLIC_PATH_SOURCE_UNVERIFIED');
 // Even irrelevant malformed pitch coordinates cannot silently become zero
 // contacts. Missing pitch positions are instead retained as unknown counts.
 for(const player of publicRoot.players)
  if(player.location==='pitch'&&player.pos&&!coordinate(player.pos,width,height))fail('PUBLIC_PATH_POSITION_INVALID');
 const path=input.path??[],points=[actor.pos];
 for(const step of path){
  if(!coordinate(step.to,width,height)||distance(points.at(-1),step.to)!==1)fail('PUBLIC_PATH_GEOMETRY_INVALID');
  points.push(step.to);
 }
 const endpoint=points.at(-1),sign=features.path_public_forward_sign;
 if(sign!==null){
  const scoringColumn=endZone[publicRoot.team];
  features.path_actor_scoring_distance=Math.abs(scoringColumn-actor.pos.x);
  features.path_end_scoring_distance=Math.abs(scoringColumn-endpoint.x);
  features.path_forward_progress=sign*(endpoint.x-actor.pos.x);
 }
 const counts=points.map(point=>countsAt(publicRoot,point)),arrivals=counts.slice(1),departures=counts.slice(0,-1);
 features.path_root_enemy_standing_adjacent=counts[0].standing;
 features.path_root_enemy_zone_count=counts[0].zones;
 features.path_arrival_enemy_standing_max=aggregate(arrivals.map(count=>count.standing),'max');
 features.path_arrival_enemy_standing_sum=aggregate(arrivals.map(count=>count.standing),'sum');
 features.path_arrival_enemy_zone_max=aggregate(arrivals.map(count=>count.zones),'max');
 features.path_arrival_enemy_zone_sum=aggregate(arrivals.map(count=>count.zones),'sum');
 features.path_departure_enemy_zone_sum=aggregate(departures.map(count=>count.zones),'sum');
 features.path_departure_zone_exposed_steps=aggregate(departures.map(count=>count.zones===null?null:Number(count.zones>0)),'sum');
 return features;
}
