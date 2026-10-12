import {z} from 'zod';
import {boardIds,formationNames,initial,teamPlayers,type Board,type Point} from './board';

const id=z.string().min(1).max(100);
const position=z.strictObject({x:z.number().min(0).max(100),y:z.number().min(0).max(100)});
const rotation=z.number().min(0).lt(360);
const color=z.enum(['red','green','yellow','blue']);
const player=z.strictObject({id,type:z.literal('player'),team:z.enum(['home','away','neutral']),number:z.number().int().min(1).max(11),position});
const ball=z.strictObject({id,type:z.literal('ball'),position});
const cone=z.strictObject({id,type:z.literal('cone'),position,rotation});
const smallCone=z.strictObject({id,type:z.literal('small-cone'),position,rotation,color});
const goal=z.strictObject({id,type:z.literal('goal'),position,rotation});
const drawing=z.strictObject({id,type:z.literal('drawing'),start:position,end:position,style:z.enum(['solid','dotted']),arrow:z.boolean()});
export const elementSchema=z.discriminatedUnion('type',[player,ball,cone,smallCone,goal,drawing]);
const settingsSchema=z.strictObject({pitch:z.enum(['classic','u8']),teamSize:z.union([z.literal(5),z.literal(7),z.literal(11)]),formations:z.strictObject({home:z.string(),away:z.string()})});
export const documentSchema=settingsSchema.extend({schemaVersion:z.literal(1),elements:z.array(elementSchema).max(2000)});
export const exportSchema=z.strictObject({board:documentSchema,format:z.enum(['png','svg']).default('png'),orientation:z.enum(['horizontal','vertical']).default('horizontal')});
const revision=z.number().int().nonnegative();
export const replaceSchema=z.strictObject({expectedRevision:revision,board:documentSchema});
export const clearSchema=z.strictObject({expectedRevision:revision,scope:z.enum(['annotations','reset','everything'])});
const changes=z.strictObject({position:position.optional(),rotation:rotation.optional(),color:color.optional(),number:z.number().int().min(1).max(11).optional(),start:position.optional(),end:position.optional(),style:z.enum(['solid','dotted']).optional(),arrow:z.boolean().optional()});
export const operationsSchema=z.strictObject({expectedRevision:revision,operations:z.array(z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('add'),element:elementSchema}),
 z.strictObject({action:z.literal('update'),id,changes}),
 z.strictObject({action:z.literal('delete'),id}),
 z.strictObject({action:z.literal('configure'),pitch:z.enum(['classic','u8']).optional(),teamSize:z.union([z.literal(5),z.literal(7),z.literal(11)]).optional(),formations:z.strictObject({home:z.string().optional(),away:z.string().optional()}).optional()})
])).min(1).max(2000)});
export type Document=z.infer<typeof documentSchema>;
export type Element=z.infer<typeof elementSchema>;
export const toPosition=(p:Point):Point=>({x:(p.x-32)/936*100,y:(p.y-32)/536*100});
const fromPosition=(p:Point):Point=>({x:32+p.x/100*936,y:32+p.y/100*536});
export function toDocument(b:Board):Document{
 return {schemaVersion:1,pitch:b.pitch||'classic',teamSize:b.teamSize||5,formations:{home:b.home,away:b.away},elements:[
 ...b.players.map(p=>p.team==='ball'?{id:p.id,type:'ball' as const,position:toPosition(p)}:{id:p.id,type:'player' as const,team:p.team,number:p.number,position:toPosition(p)}),
 ...(b.equipment||[]).map(e=>e.type==='small-cone'?{id:e.id,type:e.type,position:toPosition(e),rotation:e.rotation,color:e.color||'red'}:{id:e.id,type:e.type,position:toPosition(e),rotation:e.rotation}),
 ...b.drawings.map(d=>({id:d.id,type:'drawing' as const,start:toPosition(d.start),end:toPosition(d.end),style:d.dotted?'dotted' as const:'solid' as const,arrow:d.arrow}))]};
}
export function validateDocument(input:unknown):Document{
 const d=documentSchema.parse(input);
 const ids=new Set<string>();for(const e of d.elements){if(ids.has(e.id))throw new Error(`Duplicate element ID: ${e.id}`);ids.add(e.id);}
 for(const team of ['home','away','neutral'] as const){
  if(team!=='neutral'&&!formationNames[d.teamSize].includes(d.formations[team]))throw new Error(`Invalid ${team} formation for ${d.teamSize}-a-side; use ${formationNames[d.teamSize].join(', ')}`);
  const limit=team==='neutral'?11:d.teamSize;
  const ps=d.elements.filter(e=>e.type==='player'&&e.team===team) as z.infer<typeof player>[];
  if(ps.length>limit||new Set(ps.map(p=>p.number)).size!==ps.length||ps.some(p=>p.number>limit))throw new Error(`${team} may have up to ${limit} players with unique numbers from 1 to ${limit}`);
 }
 return d;
}
export function fromDocument(input:unknown):Board{
 const d=validateDocument(input);const b:Board={players:[],equipment:[],drawings:[],pitch:d.pitch,teamSize:d.teamSize,home:d.formations.home,away:d.formations.away};
 for(const e of d.elements){if(e.type==='player'||e.type==='ball')b.players.push({id:e.id,...fromPosition(e.position),team:e.type==='ball'?'ball':e.team,number:e.type==='ball'?0:e.number});else if(e.type==='drawing')b.drawings.push({id:e.id,start:fromPosition(e.start),end:fromPosition(e.end),arrow:e.arrow,dotted:e.style==='dotted'});else b.equipment!.push({id:e.id,type:e.type,...fromPosition(e.position),rotation:e.rotation,...(e.type==='small-cone'?{color:e.color}:{})});}
 return b;
}
export function applyOperations(current:Document,input:unknown):Document{
 const request=operationsSchema.parse(input);let d=structuredClone(current);
 for(const op of request.operations){
  if(op.action==='configure'){
   if(op.pitch)d.pitch=op.pitch;
   const sizeChanged=op.teamSize!==undefined&&op.teamSize!==d.teamSize;
   if(op.teamSize)d.teamSize=op.teamSize;
   for(const team of ['home','away'] as const){
    const formation=op.formations?.[team]||(sizeChanged?formationNames[d.teamSize][0]:d.formations[team]);
    if(!formationNames[d.teamSize].includes(formation))throw new Error(`Invalid ${team} formation: ${formation}`);
    if(sizeChanged||op.formations?.[team]){
     const oldPlayers=d.elements.filter(e=>e.type==='player'&&e.team===team) as z.infer<typeof player>[];
     d.elements=d.elements.filter(e=>!(e.type==='player'&&e.team===team));
     d.elements.push(...teamPlayers(team,formation,oldPlayers.map(p=>({id:p.id,team:p.team,number:p.number,...fromPosition(p.position)})),[...d.elements,...oldPlayers].map(e=>e.id)).map(p=>({id:p.id,type:'player' as const,team,number:p.number,position:toPosition(p)})));
    }
    d.formations[team]=formation;
   }
  }else if(op.action==='add'){
   if(d.elements.some(e=>e.id===op.element.id))throw new Error(`Element already exists: ${op.element.id}`);d.elements.push(op.element);
  }else{
   const index=d.elements.findIndex(e=>e.id===op.id);if(index<0)throw new Error(`Unknown element: ${op.id}`);
   if(op.action==='delete')d.elements.splice(index,1);else d.elements[index]=elementSchema.parse({...d.elements[index],...op.changes});
  }
 }
 return validateDocument(d);
}
export const defaultDocument=()=>toDocument(initial());
export function clearBoard(current:Document,scope:z.infer<typeof clearSchema>['scope']):Document{
 const b=fromDocument(current);b.drawings=[];b.equipment=[];
 if(scope==='everything')b.players=[];
 if(scope==='reset'){
   b.players=[...teamPlayers('home',b.home,b.players,boardIds(b)),...teamPlayers('away',b.away,b.players,boardIds(b)),...b.players.filter(p=>p.team==='neutral'),...b.players.filter(p=>p.team==='ball').map(p=>({...p,x:500,y:300}))];
  if(!b.players.some(p=>p.team==='ball'))b.players.push({id:b.players.some(p=>p.id==='ball')?crypto.randomUUID():'ball',team:'ball',number:0,x:500,y:300});
 }
 return validateDocument(toDocument(b));
}
export const schemaBundle=()=>({schemaVersion:1,coordinates:{range:[0,100],x:'Home goal line to away goal line',y:'Top to bottom touchline in horizontal view',rotation:'Degrees clockwise in horizontal view; 0 points small-goal opening toward positive y'},formations:formationNames,board:z.toJSONSchema(documentSchema),replace:z.toJSONSchema(replaceSchema),operations:z.toJSONSchema(operationsSchema),clear:z.toJSONSchema(clearSchema),export:z.toJSONSchema(exportSchema,{io:'input'})});
