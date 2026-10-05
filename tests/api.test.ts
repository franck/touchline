import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {applyOperations,clearBoard,defaultDocument,fromDocument,toDocument,validateDocument,type Document} from '../shared/api';
import {initial,formationNames,resetExistingPositions} from '../shared/board';
import {exportBoard} from '../server/export';

test('image exports render both layouts, orientations, all elements and empty boards',()=>{
 const populated=applyOperations(defaultDocument(),{expectedRevision:0,operations:[
  {action:'add',element:{id:'cone',type:'cone',position:{x:25,y:25},rotation:45}},
  {action:'add',element:{id:'disc',type:'small-cone',position:{x:35,y:35},rotation:0,color:'blue'}},
  {action:'add',element:{id:'goal',type:'goal',position:{x:75,y:50},rotation:90}},
  {action:'add',element:{id:'route',type:'drawing',start:{x:25,y:25},end:{x:75,y:50},style:'dotted',arrow:true}}
 ]});
 for(const pitch of ['u8','classic'] as const){for(const vertical of [false,true]){
  const board={...populated,pitch};const svg=String(exportBoard(board,'svg',vertical));
  assert.match(svg,/xmlns="http:\/\/www.w3.org\/2000\/svg"/);assert.match(svg,/#58aaf0/);assert.match(svg,/#ff9b38/);assert.match(svg,/rotate\(90\)/);assert.match(svg,/stroke-dasharray="1 11"/);assert.match(svg,/marker-end="url\(#arrowhead\)"/);assert.match(svg,/<text[^>]*>1<\/text>/);assert.doesNotMatch(svg,/stroke-dasharray="5 4"/);
  if(vertical)assert.match(svg,/translate\(0 1000\) rotate\(-90\)/);
  const png=Buffer.from(exportBoard(board,'png',vertical));assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  const shortEdge=pitch==='u8'?1465:1200;assert.equal(png.readUInt32BE(16),vertical?shortEdge:2000);assert.equal(png.readUInt32BE(20),vertical?2000:shortEdge);
  const empty=clearBoard(board,'everything');const emptySvg=String(exportBoard(empty,'svg',vertical));assert.doesNotMatch(emptySvg,/<text/);assert.notDeepEqual(Buffer.from(exportBoard(empty,'png',vertical)),png);
 }}
});

test('coordinate round-trip and compatibility with old layouts',()=>{
 const old=initial();delete old.pitch;delete old.teamSize;delete old.equipment;
 const converted=fromDocument(toDocument(old));assert.equal(converted.pitch,'classic');assert.equal(converted.teamSize,5);assert.deepEqual(converted.equipment,[]);
 for(let i=0;i<old.players.length;i++){assert.ok(Math.abs(converted.players[i].x-old.players[i].x)<1e-9);assert.ok(Math.abs(converted.players[i].y-old.players[i].y)<1e-9);}
});
test('operation validation is atomic, preserves IDs, and supports every formation',()=>{
 const current=defaultDocument();
 assert.throws(()=>applyOperations(current,{expectedRevision:0,operations:[{action:'add',element:{id:'cone',type:'small-cone',position:{x:25,y:25},rotation:0,color:'yellow'}},{action:'update',id:'missing',changes:{position:{x:20,y:20}}}]}),/Unknown element/);
 assert.equal(current.elements.length,11);
 for(const size of [5,7,11] as const){for(const f of formationNames[size]){
  const next=applyOperations(current,{expectedRevision:0,operations:[{action:'configure',teamSize:size,formations:{home:f,away:f}}]});
  assert.equal(next.elements.filter(e=>e.type==='player').length,size*2);
  assert.equal(next.elements.find(e=>e.type==='player'&&e.team==='home'&&e.number===1)?.id,'home-0');
 }}
 assert.throws(()=>validateDocument({...current,elements:[...current.elements,current.elements[0]]}),/Duplicate/);
 assert.equal(applyOperations(current,{expectedRevision:0,operations:[{action:'delete',id:'ball'}]}).elements.filter(e=>e.type==='ball').length,0);
 assert.throws(()=>applyOperations(current,{expectedRevision:0,operations:[{action:'add',element:{id:'extra-ball',type:'ball',position:{x:50,y:50}}}]}),/At most one ball/);
 assert.throws(()=>applyOperations(current,{expectedRevision:0,operations:[{action:'update',id:'ball',changes:{color:'red'}}]}));
});
test('clearing preserves custom IDs and settings and resets the selected formations',()=>{
 const d=applyOperations(defaultDocument(),{expectedRevision:0,operations:[{action:'configure',pitch:'classic',teamSize:7,formations:{home:'3–2–1',away:'2–2–2'}},{action:'update',id:'home-0',changes:{position:{x:40,y:10}}},{action:'update',id:'ball',changes:{position:{x:20,y:20}}},{action:'add',element:{id:'cone',type:'cone',position:{x:15,y:20},rotation:45}}]});
 d.elements.find(e=>e.id==='home-0')!.id='custom-keeper';d.elements.find(e=>e.type==='ball')!.id='custom-ball';
 const annotations=clearBoard(d,'annotations');assert.deepEqual(annotations.elements,d.elements.filter(e=>e.type==='player'||e.type==='ball'));
 const reset=clearBoard(d,'reset');assert.equal(reset.pitch,'classic');assert.equal(reset.teamSize,7);assert.deepEqual(reset.formations,d.formations);assert.equal(reset.elements.length,15);
 assert.deepEqual(reset.elements.find(e=>e.id==='custom-ball'),{id:'custom-ball',type:'ball',position:{x:50,y:50}});
 assert.equal(reset.elements.find(e=>e.type==='player'&&e.team==='home'&&e.number===1)?.id,'custom-keeper');
 assert.notDeepEqual(reset.elements.find(e=>e.id==='custom-keeper'),d.elements.find(e=>e.id==='custom-keeper'));
 assert.equal(d.elements.length,16);
});
test('empty and partial boards support rebuilding, numbering constraints, and sparse reset',()=>{
 const current=defaultDocument();const empty=clearBoard(current,'everything');assert.deepEqual(empty.elements,[]);assert.equal(empty.teamSize,5);assert.deepEqual(empty.formations,current.formations);
 assert.deepEqual(fromDocument(empty).players,[]);
 const partial=applyOperations(empty,{expectedRevision:0,operations:[{action:'add',element:{id:'home-1',type:'player',team:'home',number:1,position:{x:35,y:45}}},{action:'add',element:{id:'cone',type:'cone',position:{x:50,y:50},rotation:0}}]});
 const sparseReset=toDocument(resetExistingPositions(fromDocument(partial)));assert.equal(sparseReset.elements.length,2);assert.equal(sparseReset.elements[0].id,'home-1');assert.equal(sparseReset.elements.filter(e=>e.type==='ball').length,0);
 const homePopulated=applyOperations(partial,{expectedRevision:0,operations:[{action:'configure',formations:{home:partial.formations.home}}]});assert.equal(homePopulated.elements.filter(e=>e.type==='player').length,5);assert.equal(homePopulated.elements.find(e=>e.type==='player'&&e.number===1)?.id,'home-1');assert.equal(new Set(homePopulated.elements.map(e=>e.id)).size,homePopulated.elements.length);
 const restored=clearBoard(partial,'reset');assert.equal(restored.elements.length,11);assert.equal(restored.elements.filter(e=>e.type==='ball').length,1);assert.equal(restored.elements.find(e=>e.type==='player'&&e.team==='home'&&e.number===1)?.id,'home-1');
 assert.throws(()=>applyOperations(partial,{expectedRevision:0,operations:[{action:'add',element:{id:'duplicate-shirt',type:'player',team:'home',number:1,position:{x:50,y:50}}}]}),/unique numbers/);
 assert.throws(()=>applyOperations(partial,{expectedRevision:0,operations:[{action:'add',element:{id:'outside-format',type:'player',team:'home',number:6,position:{x:50,y:50}}}]}),/unique numbers/);
});
test('HTTP edits, conflicts, SSE, undo, sessions, schema, and restart persistence',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'touchline-api-'));const port=19573;
 let child:ChildProcess;
 async function start(){
  child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,PORT:String(port),BOARD_DATA_DIR:directory},stdio:['ignore','pipe','pipe']});
  let logs='';child.stderr!.on('data',d=>logs+=d);child.stdout!.on('data',d=>logs+=d);
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error(logs);try{const response=await fetch(`http://127.0.0.1:${port}/api/v1/board`);if(response.ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw new Error('Server not ready: '+logs);
 }
 async function stop(){if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
 async function request(path:string,method='GET',body?:unknown){const r=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:r.status,value:await r.json()};}
 try{
  await start();const base=await request('/api/v1/board');assert.equal(base.value.revision,0);
  const abort=new AbortController();const stream=await fetch(`http://127.0.0.1:${port}/api/v1/events`,{signal:abort.signal});const reader=stream.body!.getReader();await reader.read();
  const edited=await request('/api/v1/board/operations','POST',{expectedRevision:0,operations:[{action:'add',element:{id:'disc',type:'small-cone',position:{x:30,y:35},rotation:0,color:'blue'}},{action:'add',element:{id:'route',type:'drawing',start:{x:30,y:35},end:{x:50,y:60},style:'dotted',arrow:true}}]});
   assert.equal(edited.status,200);assert.equal(edited.value.revision,1);
   const image=await fetch(`http://127.0.0.1:${port}/api/v1/board/export?expectedRevision=1`);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('x-board-revision'),'1');assert.match(image.headers.get('content-disposition')!,/touchline-board-r1.png/);assert.equal(Buffer.from(await image.arrayBuffer()).readUInt32BE(16),2000);
   const svgImage=await fetch(`http://127.0.0.1:${port}/api/v1/board/export?format=svg&orientation=vertical`);assert.equal(svgImage.status,200);assert.match(svgImage.headers.get('content-type')!,/^image\/svg\+xml/);assert.match(await svgImage.text(),/translate\(0 1000\) rotate\(-90\)/);
   for(const query of ['format=jpg','orientation=diagonal','expectedRevision=-1','expectedRevision=no','unexpected=true','format=png&format=svg'])assert.equal((await request('/api/v1/board/export?'+query)).status,422);
   assert.equal((await request('/api/v1/board/export?expectedRevision=0')).status,409);assert.deepEqual((await request('/api/v1/board')).value,edited.value);
  const event=await reader.read();assert.match(new TextDecoder().decode(event.value),/"revision":1/);abort.abort();
  assert.equal((await request('/api/v1/board/operations','POST',{expectedRevision:0,operations:[{action:'delete',id:'disc'}]})).status,409);
  const rejected=await request('/api/v1/board/operations','POST',{expectedRevision:1,operations:[{action:'delete',id:'disc'},{action:'update',id:'missing',changes:{position:{x:20,y:20}}}]});assert.equal(rejected.status,422);assert.equal((await request('/api/v1/board')).value.board.elements.length,13);
  assert.equal((await request('/api/v1/board','PUT',{expectedRevision:1,board:{...edited.value.board,elements:edited.value.board.elements.map((e:{id:string})=>e.id==='disc'?{...e,position:{x:101,y:0}}:e)}})).status,422);
  const saved=await request('/api/v1/sessions','POST',{name:'API exercise',expectedRevision:1});assert.equal(saved.status,201);
  const importRequest={migrationId:'test-migration',sessions:[{id:'legacy',name:'Legacy',date:new Date().toISOString(),board:initial()}]};
  await request('/api/v1/sessions/import','POST',importRequest);await request('/api/v1/sessions/import','POST',importRequest);assert.equal((await request('/api/v1/sessions')).value.length,2);
  const schema=await request('/api/v1/schema');assert.equal(schema.status,200);assert.ok(schema.value.operations.properties.operations);assert.equal(schema.value.board.$schema,'https://json-schema.org/draft/2020-12/schema');
  const beforeRestart=(await request('/api/v1/board')).value;await stop();await start();assert.deepEqual((await request('/api/v1/board')).value,beforeRestart);assert.equal((await request('/api/v1/sessions')).value.length,2);
  const undone=await request('/api/v1/board/undo','POST',{expectedRevision:1});assert.equal(undone.value.revision,2);assert.equal(undone.value.board.elements.length,11);
  const replacement=await request('/api/v1/board','PUT',{expectedRevision:2,board:edited.value.board as Document});assert.equal(replacement.status,200);
  const cleared=await request('/api/v1/board/clear','POST',{expectedRevision:3,scope:'annotations'});assert.equal(cleared.status,200);assert.equal(cleared.value.revision,4);assert.equal(cleared.value.board.elements.length,11);
  assert.deepEqual(cleared.value.board.elements,edited.value.board.elements.filter((e:{type:string})=>e.type==='player'||e.type==='ball'));
  const restored=await request('/api/v1/board/undo','POST',{expectedRevision:4});assert.deepEqual(restored.value.board,edited.value.board);
  const reset=await request('/api/v1/board/clear','POST',{expectedRevision:5,scope:'reset'});assert.equal(reset.status,200);assert.equal(reset.value.revision,6);
  assert.equal((await request('/api/v1/board/clear','POST',{expectedRevision:5,scope:'reset'})).status,409);
  assert.equal((await request('/api/v1/board/clear','POST',{expectedRevision:6,scope:'invalid'})).status,422);
  assert.equal((await request('/api/v1/board')).value.revision,6);assert.equal((await request('/api/v1/sessions')).value.length,2);
  assert.equal((await request(`/api/v1/sessions/${saved.value.id}`,'DELETE')).status,200);
  const malformed=await fetch(`http://127.0.0.1:${port}/api/v1/board`,{method:'PUT',headers:{'Content-Type':'application/json'},body:'{'});assert.equal(malformed.status,400);
  const everything=await request('/api/v1/board/clear','POST',{expectedRevision:6,scope:'everything'});assert.equal(everything.status,200);assert.equal(everything.value.revision,7);assert.deepEqual(everything.value.board.elements,[]);
  const emptySave=await request('/api/v1/sessions','POST',{name:'Empty setup',expectedRevision:7});assert.equal(emptySave.status,201);assert.deepEqual(emptySave.value.board.elements,[]);
  await stop();await start();assert.deepEqual((await request('/api/v1/board')).value.board.elements,[]);
  const undoEmpty=await request('/api/v1/board/undo','POST',{expectedRevision:7});assert.deepEqual(undoEmpty.value.board,reset.value.board);
  const loadEmpty=await request('/api/v1/board','PUT',{expectedRevision:8,board:emptySave.value.board});assert.equal(loadEmpty.status,200);
  const addedPlayer=await request('/api/v1/board/operations','POST',{expectedRevision:9,operations:[{action:'add',element:{id:'training-player',type:'player',team:'home',number:3,position:{x:40,y:40}}}]});assert.equal(addedPlayer.status,200);assert.equal(addedPlayer.value.board.elements.length,1);
  const removedPlayer=await request('/api/v1/board/operations','POST',{expectedRevision:10,operations:[{action:'delete',id:'training-player'}]});assert.equal(removedPlayer.status,200);assert.deepEqual(removedPlayer.value.board.elements,[]);
 }finally{await stop();rmSync(directory,{recursive:true,force:true});}
});
