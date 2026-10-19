import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {E,observe,Session,callService} from './deps/archived-v6-host.mjs';
import {createChampion} from '../src/champion.mjs';

const inspect=createChampion().inspector;
const identity={coachId:'required-dependency-entry',version:'1',contextSchema:'required-dependency-entry'};
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const mocks={
 './champion.mjs':`import {createChampion as real} from ${JSON.stringify(new URL('../src/champion.mjs',import.meta.url).href)};
 export function createChampion(options={}){return {inspector:real().inspector,async chooseAction(o,n,s){options.onSelected?.(s.snapshot);return s.answer;},async chooseDecision(){return null;},chooseSetup(){return null;}};}`,
 './protection.mjs':`export function certifiedScopeClosure(){return false;}
 export async function challengeProtection(){return {attempted:true,reason:'fixture-proposal',selected:globalThis.__dependencyEntryCandidate};}`,
 './receiver-defense.mjs':`export function createReceiverDefenseReservation(){return {enabled:false};} export async function challengeReceiverDefense(){return {attempted:false,selected:null};}`,
 './scoring.mjs':`export function createScoringDiscovery(){return {enabled:false};} export async function challengeFinalScoring(){return {attempted:false,selected:null};}`,
 './clearance.mjs':`export function createClearanceDiscovery(){return {enabled:false};} export async function challengeFinalClearance(){return {attempted:false,selected:null};} export async function auditOrdinaryMoves(){return null;}`,
 './endguard.mjs':`export async function challengeEnd(){return {attempted:false,selected:null,reason:'fixture'};}`,
 './relay.mjs':`export async function challengeRelay(){return {attempted:false,selected:null,reason:'fixture'};}`,
 './defense.mjs':`export async function reserveDefenseTerminals(){return {attempted:false};} export async function captureDefenseTerminal(){} export async function challengeDefense(){return {attempted:false,selected:null,reason:'fixture'};}`,
 './contact-coordination.mjs':`export async function discoverContactCoordination(){return {attempted:false,selected:null,reason:'fixture'};}`,
 './goals.mjs':`export async function challengeRepairTasks(){return {attempted:false,selected:null,reason:'fixture'};}
 export async function challengeGoalTasks(){return {attempted:true,selected:null,reason:'fixture',discoveryCoverage:{queried:2,unexamined:1,localRefusals:1},queries:[{input:{kind:'test'}}],discovery:{complete:false}};}`,
 './mechanisms.mjs':`export async function challengeMechanisms(){return {attempted:false,selected:null,reason:'fixture'};}`,
 './strategy.mjs':`export async function challengeStrategicWindow(){return {attempted:false,selected:null,reason:'fixture'};} export function matchIntent(){return null;}`,
 './continuation.mjs':`export async function challengeContinuation(){return {attempted:false,selected:null,reason:'fixture'};} export async function challengeCompletedActivation(){return {attempted:false,selected:null,reason:'fixture'};}`,
 './learned-choice.mjs':`export function learnedChoiceShadow(){return {mode:'shadow',attempted:false};}`,
 './tactical-shadow.mjs':`export async function tacticalShadow(){return {mode:'shadow',attempted:false,override:false};}`,
 './learned-proposal.mjs':`export async function prepareLearnedProposal(){return {line:null,report:{attempted:false,ownComplete:false,learning:{model_invoked:false}}};}
 export async function compareLearnedProposal(){return {attempted:false,selected:null};} export async function bindLearnedForCommonPool(){return null;}`,
 './common-turn-pool.mjs':`export async function compareCommonTurnPool(){return {attempted:true,selected:globalThis.__dependencyEntryCandidate,reason:'fixture-common-winner',rows:[]};}`,
 './common-boundary.mjs':`export async function auditCommonBoundary(){return {mode:'shadow',override:false,action_executed:false,reason:'fixture'};}`,
 './rules.mjs':`export async function auditSharedRule(){return {agreement:false};} export function commitClearanceRule(){return null;} export function certifiedRuleChoice(){return null;} export function clearanceRuleChoice(){return null;} export function builtinRuleChoice(){return null;}`
};
let source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
source=source.replaceAll(/from '(\.\/[^']+)'/g,(_,rel)=>'from '+JSON.stringify(mocks[rel]?data(mocks[rel]):new URL('../src/'+rel.slice(2),import.meta.url).href));
globalThis.bloodboard={register(){}};
const {chooseAction}=await import(data(source));
delete globalThis.bloodboard;

const move=(id,x,y)=>({kind:'playerAction',playerId:id,action:'move',path:[{kind:'step',to:{x,y}}]});
async function fixture(withPricedDependency){
 const state=E.buildScenario({teams:{A:'human',B:'human'},players:[
  {id:'carrier',team:'A',roster:'human',position:'lineman',at:[8,7],number:1},
  {id:'helper',team:'A',roster:'human',position:'lineman',at:[8,5],number:2},
  {id:'foe',team:'B',roster:'human',position:'lineman',at:[1,14],number:1}],ball:{holder:'carrier'}},13);
 const first=move('helper',9,5),second=move('carrier',9,7),o=observe(state,'A',1),host=new Session(state,'A',1,60000);
 const ex=callService(host,'explore',[first,{observations:true,decisions:'builtin',maxOutcomes:40,maxMs:500}]);
 const championLine={...inspect.canonical({input:first},o),ex,preparedBranches:new Map()};
 const priced=ex.outcomes.find(b=>!b.turnover&&!b.touchdown&&b.observation);
 const candidate={...championLine,preparedBranches:withPricedDependency?
  new Map([[priced.key,{plan:{input:second},ex:callService(host,'explore',[second,{from:priced.key,observations:true,decisions:'builtin',maxMs:500}])}]]) :
  new Map([['dangling-priced-outcome',{plan:{input:second},ex}]]),
 };
 const services={answer:{input:first,coachContext:{drivePlan:inspect.buildDrivePlan(o,null),movementMemory:[]}},
  snapshot:{mode:'normal',selected:championLine,lines:[championLine]}};
 globalThis.__dependencyEntryCandidate=candidate;
 const answer=await chooseAction(o,[],services);
 delete globalThis.__dependencyEntryCandidate;
 return {answer,candidate,championLine};
}

test('same first input falls back to frozen champion policy when its priced dependency is dangling',async()=>{
 const {answer,championLine}=await fixture(false);
 assert.deepEqual(answer.input,championLine.input);
 assert.equal(answer.trace.selection21.challenger.selected,null);
 assert.equal(answer.trace.selection21.challenger.reason,'required-plan-does-not-fit-final-context');
 assert.equal(answer.trace.champion.policyPreserved,true);
 assert.equal(answer.trace.selection21.policyChanged,false);
 assert.equal(answer.trace.execution.dependencyAdmission.danglingObligations,false);
 assert.equal(answer.trace.execution.persisted,true);
});

test('same first input retains a fully covered priced dependency plan',async()=>{
 const {answer,candidate}=await fixture(true);
 assert.deepEqual(answer.input,candidate.input);
 assert.deepEqual(answer.trace.selection21.challenger.selected,candidate.input);
 assert.equal(answer.trace.champion.preserved,true);
 assert.equal(answer.trace.champion.policyPreserved,false);
 assert.equal(answer.trace.selection21.policyChanged,true);
 assert.equal(answer.trace.execution.dependencyAdmission.complete,true);
 assert.equal(answer.trace.execution.persisted,true);
});

test('late producer trace preserves bounded discovery accounting only when supplied',async()=>{
 const {answer}=await fixture(false),goal=answer.trace.planning.checks.lateProducers.find(x=>x.source==='goals');
 assert.deepEqual(goal.discoveryCoverage,{queried:2,unexamined:1,localRefusals:1});
 assert.deepEqual(goal.queries,[{input:{kind:'test'}}]);
 assert.deepEqual(goal.discovery,{complete:false});
});
