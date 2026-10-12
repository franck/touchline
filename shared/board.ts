export type Point = {x:number;y:number};
export type Player = Point & {id:string;team:'home'|'away'|'neutral'|'ball';number:number};
export type Drawing = {id:string;start:Point;end:Point;arrow:boolean;dotted?:boolean};
export type ConeColor='red'|'green'|'yellow'|'blue';
export type Equipment = Point & {id:string;type:'cone'|'goal'|'small-cone';rotation:number;color?:ConeColor};
export type TeamSize=5|7|11;
export type Board = {players:Player[];drawings:Drawing[];home:string;away:string;pitch?:'classic'|'u8';equipment?:Equipment[];teamSize?:TeamSize};
export type Saved = {id:string;name:string;date:string;board:Board};
export const shapes:Record<string,Point[]> = {'1–2–1':[{x:90,y:300},{x:220,y:300},{x:350,y:170},{x:350,y:430},{x:470,y:300}], '2–2':[{x:90,y:300},{x:230,y:180},{x:230,y:420},{x:420,y:180},{x:420,y:420}], '2–1–1':[{x:90,y:300},{x:220,y:180},{x:220,y:420},{x:340,y:300},{x:470,y:300}]};
export const formationNames:Record<TeamSize,string[]>={5:['1–2–1','2–2','2–1–1'],7:['2–3–1','3–2–1','2–2–2','3–3'],11:['4–4–2','4–3–3','4–2–3–1','3–5–2','3–4–3']};
for(const size of [7,11] as const){for(const name of formationNames[size]){const rows=name.split('–').map(Number);shapes[name]=[{x:90,y:300},...rows.flatMap((count,row)=>Array.from({length:count},(_,i)=>({x:210+260*row/(rows.length-1),y:count===1?300:100+400*i/(count-1)})))];}}
export function teamPlayers(team:'home'|'away',formation:string,existing:Player[]=[],reservedIds:string[]=existing.map(p=>p.id)):Player[]{
 const used=new Set(reservedIds);
 return shapes[formation].map((p,i)=>{const old=existing.find(v=>v.team===team&&v.number===i+1);let id=old?.id||`${team}-${i}`;if(!old&&used.has(id))id=crypto.randomUUID();used.add(id);return {...p,x:team==='away'?1000-p.x:p.x,id,team,number:i+1};});
}
export const boardIds=(b:Board)=>[...b.players,...b.drawings,...(b.equipment||[])].map(e=>e.id);
export function resetExistingPositions(b:Board):Board{
 return {...b,players:b.players.map(p=>{if(p.team==='neutral')return p;if(p.team==='ball')return {...p,x:500,y:300};const position=shapes[b[p.team]][p.number-1];return {...p,x:p.team==='away'?1000-position.x:position.x,y:position.y};})};
}
export const initial=():Board=>({players:[...teamPlayers('home','1–2–1'),...teamPlayers('away','1–2–1'),{id:'ball',team:'ball',number:0,x:500,y:300}],drawings:[],home:'1–2–1',away:'1–2–1',pitch:'u8',teamSize:5,equipment:[]});
