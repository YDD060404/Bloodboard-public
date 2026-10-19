/** Receiving/setup role correction derived from frozen source SHA f2437dab2a9ad888e4e9130e672e9bc159393772650084170d9da91c52c833ff.
 * Original action chooser and original setup fallback remain byte-identical.
 * The only original scoring-expression change is removing My Ball from the
 * No Ball handling exclusion. All actual attributes, skills and weights remain. */
const other = t => t === 'A' ? 'B' : 'A';
const num = (x, d = 0) => Number.isFinite(x) ? x : d;
const has = (p, s) => (p?.skills || []).some(x => x === s || x.startsWith(s + '('));
const dist = (a, b) => a && b ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : 99;
const sqKey = p => `${p.x},${p.y}`;
const find = (o, id) => o.players.find(p => p.id === id);
const onPitch = p => p?.location === 'pitch' && !!p.pos;
const standing = p => onPitch(p) && p.stance === 'standing';
const height = o => o.pitch?.height ?? (o.format === 'sevens' ? 11 : 15);
const usefulSkill = p => ['block', 'dodge', 'guard', 'standFirm', 'sidestep'].filter(s => has(p, s)).length;
const unreliable = p => ['boneHead', 'reallyStupid', 'unchannelledFury', 'animalSavagery', 'takeRoot', 'bloodlust'].filter(s => has(p, s)).length;
function remainingTurns(o, team, includeCurrent = true) {
    return Math.max(0, o.turnsPerHalf - num(o.turn?.[team]) +
      (includeCurrent && o.active === team ? 1 : 0));
  }

function correctedSetup(o, req, inspect) {
    const buildDrivePlan=(ob,prior)=>inspect.buildDrivePlan(ob,prior);
    if (!Array.isArray(req.fixedPlayerIds) || !Array.isArray(req.legalSquares)) return null;
    const team = o.team, receiving = o.kicking !== team;
    const players = req.fixedPlayerIds.map(id => find(o,id));
    if (players.some(p => !p) || !players.length) return null;
    const foes = o.players.filter(p => p.team !== team && ['pitch','reserves'].includes(p.location) && !p.benched);
    const fast = foes.some(p => p.ma >= 8) || foes.filter(p => p.ma >= 7).length >= foes.length / 2;
    const bash = foes.filter(p => p.st >= 4 || has(p,'guard') || has(p,'mightyBlow')).length >= 3;
    const behind = num(o.score?.[team]) < num(o.score?.[other(team)]);
    const timeShort = remainingTurns(o,team,false) <= 2 && num(o.turn?.[team]) > 0;
    const attacking = receiving || behind && timeShort;
    const mid = (height(o)-1)/2, direction = team === 'A' ? -1 : 1;
    const legal = new Set(req.legalSquares.map(sqKey));
    const centre = req.legalSquares.filter(s => s.y >= req.centreRows.min && s.y <= req.centreRows.max);
    const line = req.minLine, count = players.length;
    const roleValue = (p,role) => {
      const handling = has(p,'noBall') ? -100 : (7-p.ag)*3 + p.ma +
        (has(p,'sureHands') ? 7 : 0) + (has(p,'dodge') ? 2 : 0) - unreliable(p)*7;
      if (role === 'recovery' || role === 'backup') return handling;
      if (role === 'safety') return p.ma*2 + (has(p,'tackle') ? 5 : 0) + (has(p,'wrestle') ? 3 : 0) +
        (has(p,'block') ? 2 : 0) - unreliable(p)*4;
      if (role === 'line') return p.av*2 + p.st*3 + (has(p,'block') ? 3 : 0) +
        (has(p,'regeneration') ? 2 : 0) - Math.max(0,handling-12)*2 - (p.star ? 7 : 0) -
        (['catch','pass','sureHands'].some(s=>has(p,s)) ? 4 : 0);
      return p.st*2 + p.ma + usefulSkill(p)*2 - unreliable(p)*2;
    };
    let best = null;
    // Jointly compare small complete layouts. Slots are regenerated from N,
    // opponent speed/strength, receive/kick and clock; not a deleted template.
    for (const spread of [1,2,3]) for (const depthShift of [0,1]) {
      const occupied = new Set(), slots = [];
      const put = (x,y,role) => {
        const preferred = {x,y:Math.round(y)};
        const wideCount = side => slots.filter(c => side === 'upper' ? c.y < req.centreRows.min : c.y > req.centreRows.max).length;
        const candidates = role === 'line' ? centre.filter(c => c.x === req.lineOfScrimmage) :
          req.legalSquares.filter(c => c.y > 0 && c.y < height(o)-1 &&
            (c.y >= req.centreRows.min && c.y <= req.centreRows.max ||
              wideCount(c.y < req.centreRows.min ? 'upper' : 'lower') < req.maxWide));
        const slot = candidates.filter(c => !occupied.has(sqKey(c))).sort((a,b) =>
          dist(a,preferred)-dist(b,preferred) || Math.abs(a.y-mid)-Math.abs(b.y-mid) || a.x-b.x)[0];
        if (!slot || !legal.has(sqKey(slot))) return false;
        occupied.add(sqKey(slot)); slots.push({ ...slot,role }); return true;
      };
      const lineSpread = bash && !receiving ? 2 : 1;
      for (let i=0;i<line;i++) put(req.lineOfScrimmage,mid+(i-(line-1)/2)*lineSpread,'line');
      const offLine = count-line;
      // With fewer players, retain coverage roles but shrink unsupported gaps.
      const deep = receiving ? (o.format === 'sevens' ? 3 : 4) : fast && !attacking ? 5 : 3;
      const rear = req.lineOfScrimmage + direction*(deep+depthShift);
      if (offLine>0) put(rear,mid-(offLine>=4 ? spread : 0),receiving ? 'recovery':'safety');
      if (offLine>1) put(rear+direction,mid+spread,receiving ? 'backup':'safety');
      const screenCount = Math.max(0,offLine-2);
      for (let i=0;i<screenCount;i++) {
        const row = Math.floor(i/4), inRow = Math.min(4,screenCount-row*4);
        const y = mid+(i%4-(inRow-1)/2)*Math.min(spread*2,screenCount>=6?3:2);
        const depth = (receiving ? 1 : bash ? 2 : attacking ? 1 : 3)+row+depthShift;
        put(req.lineOfScrimmage+direction*depth,y,'screen');
      }
      if (slots.length!==count) continue;
      const assigned = [], unused = new Set(players);
      // Assign protected roles first, then optimize all player/slot exchanges.
      for (const ix of slots.map((s,i)=>i).sort((a,b)=>
        (slots[a].role==='line'?1:0)-(slots[b].role==='line'?1:0))) {
        const p=[...unused].sort((a,b)=>roleValue(b,slots[ix].role)-roleValue(a,slots[ix].role) || a.id.localeCompare(b.id))[0];
        assigned[ix]=p;unused.delete(p);
      }
      const pairValue = (p,s) => roleValue(p,s.role) -
        (s.role==='line'?0:foes.filter(q => q.pos && dist(q.pos,s)<=1).length*(8+Math.max(0,11-p.av)));
      for(let pass=0;pass<3;pass++) for(let i=0;i<count;i++) for(let j=i+1;j<count;j++) {
        const before=pairValue(assigned[i],slots[i])+pairValue(assigned[j],slots[j]);
        const after=pairValue(assigned[i],slots[j])+pairValue(assigned[j],slots[i]);
        if(after>before+.01) [assigned[i],assigned[j]]=[assigned[j],assigned[i]];
      }
      let value=assigned.reduce((v,p,i)=>v+pairValue(p,slots[i]),0);
      const coverage = slots.filter(s=>s.role!=='line');
      // Measure both flanks and central coverage, instead of rewarding width
      // itself. Sparse teams must not stretch unsupported gaps.
      for (const y of [req.centreRows.min,mid,req.centreRows.max])
        value-=Math.min(...coverage.map(s=>Math.abs(s.y-y)),height(o))*(fast?2:1);
      for(let i=0;i<coverage.length;i++) {
        const nearest=coverage.filter((_,j)=>j!==i).reduce((d,s)=>Math.min(d,dist(s,coverage[i])),99);
        if(coverage.length>1) value-=Math.max(0,nearest-3)*(count<10?3:1);
      }
      if(receiving) {
        // Recovery reach is based on actual MA/reliability over plausible
        // landing coverage; these are geometry estimates, not pickup odds.
        const recovery=slots.map((s,i)=>({s,p:assigned[i]})).filter(x=>['recovery','backup'].includes(x.s.role));
        for(const landing of centre.filter(s=>s.x===rear && [req.centreRows.min,Math.round(mid),req.centreRows.max].includes(s.y)))
          value-=Math.min(...recovery.map(x=>Math.max(0,dist(x.s,landing)-x.p.ma)))*3;
      }
      if(!best || value>best.value) best={value,slots,assigned,spread,depthShift};
    }
    if(!best) return null;
    const positions={...req.defaultPositions};
    best.assigned.forEach((p,i)=>positions[p.id]={x:best.slots[i].x,y:best.slots[i].y});
    return { positions, coachContext:{drivePlan:buildDrivePlan(o,null)},
      trace:{ballRoleCorrection:{basis:'My Ball restricts transfer, not pickup/carry',source:'unchanged six-formation geometry and role coefficients; corrected eligibility only',roles:best.assigned.map((p,i)=>({playerId:p.id,role:best.slots[i].role,position:positions[p.id],myBall:has(p,'myBall'),noBall:has(p,'noBall')}))}},
      why:`Hopeful 1.5.9-GPT: ${receiving?'receiving recovery and protection':'kicking screen and safety'}; ${count} fielded, ${fast?'fast':'ordinary'} opponent, ${bash?'physical':'mobile'} matchup; joint role assignment across six regenerated formations.` };
  }

export function correctSetupBallRoles(o,request,baseline,inspect){
 if(!baseline||!Array.isArray(request?.fixedPlayerIds)||!Array.isArray(request?.legalSquares)||
  !request.fixedPlayerIds.some(id=>{const p=find(o,id);return p&&has(p,'myBall')&&!has(p,'noBall');}))return baseline;
 try{
  const next=correctedSetup(o,request,inspect);if(!next?.positions)return baseline;
  const used=new Set(),legal=new Set(request.legalSquares.map(sqKey));
  for(const id of request.fixedPlayerIds){const p=next.positions[id];if(!p||!Number.isInteger(p.x)||!Number.isInteger(p.y)||!legal.has(sqKey(p))||used.has(sqKey(p)))return baseline;used.add(sqKey(p));}
  return {...next,why:'Hopeful setup: actual pickup/carry eligibility determines recovery roles; My Ball transfer restrictions remain in force'};
 }catch{return baseline;}
}
