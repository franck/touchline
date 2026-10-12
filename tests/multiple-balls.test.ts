import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {applyOperations,clearBoard,defaultDocument,fromDocument,toDocument,validateDocument,type Document} from '../shared/api';
import {resetExistingPositions} from '../shared/board';
import {exportBoard} from '../server/export';

const balls=(board:Document)=>board.elements.filter(e=>e.type==='ball');
function trainingBoard():Document{
 return validateDocument({schemaVersion:1,pitch:'u8',teamSize:11,formations:{home:'4–4–2',away:'4–4–2'},elements:[
  ...Array.from({length:10},(_,i)=>({id:`child-${i+1}`,type:'player',team:'home',number:i+1,position:{x:10+i*8,y:25}})),
  ...Array.from({length:10},(_,i)=>({id:`ball-${i+1}`,type:'ball',position:{x:10+i*8,y:35}}))
 ]});
}

test('multiple balls preserve positions and IDs through conversion and individual operations',()=>{
 const board=trainingBoard();assert.equal(balls(board).length,10);
 const converted=toDocument(fromDocument(board));
 assert.deepEqual(converted.elements.map(e=>e.id),board.elements.map(e=>e.id));
 for(let i=0;i<board.elements.length;i++){
  const original=board.elements[i],roundTrip=converted.elements[i];
  assert.ok('position' in original&&'position' in roundTrip);
  assert.ok(Math.abs(original.position.x-roundTrip.position.x)<1e-9);
  assert.ok(Math.abs(original.position.y-roundTrip.position.y)<1e-9);
 }
 const edited=applyOperations(board,{expectedRevision:0,operations:[
  {action:'update',id:'ball-2',changes:{position:{x:90,y:70}}},
  {action:'delete',id:'ball-3'},
  {action:'add',element:{id:'reserve-ball',type:'ball',position:{x:100,y:0}}}
 ]});
 assert.deepEqual(edited.elements.find(e=>e.id==='ball-2'),{id:'ball-2',type:'ball',position:{x:90,y:70}});
 assert.equal(edited.elements.some(e=>e.id==='ball-3'),false);assert.equal(balls(edited).length,10);
 assert.deepEqual(edited.elements.find(e=>e.id==='ball-1'),board.elements.find(e=>e.id==='ball-1'));
 assert.throws(()=>applyOperations(board,{expectedRevision:0,operations:[{action:'delete',id:'ball-1'},{action:'add',element:{id:'ball-2',type:'ball',position:{x:50,y:50}}}]}),/already exists/);
 assert.equal(balls(board).length,10);
 assert.throws(()=>validateDocument({...board,elements:[...board.elements,{id:'child-1',type:'ball',position:{x:0,y:0}}]}),/Duplicate/);
 assert.throws(()=>validateDocument({...board,elements:[...board.elements,{id:'bad-ball',type:'ball',position:{x:101,y:0}}]}));
 assert.throws(()=>validateDocument({...board,elements:[...board.elements,{id:'duplicate-shirt',type:'player',team:'home',number:1,position:{x:50,y:50}}]}),/unique numbers/);
 assert.throws(()=>validateDocument({...board,formations:{home:'invalid',away:'4–4–2'}}),/Invalid home formation/);
 const ballOnly={...board,elements:Array.from({length:2000},(_,i)=>({id:`ball-${i}`,type:'ball' as const,position:{x:50,y:50}}))};
 assert.equal(validateDocument(ballOnly).elements.length,2000);
 assert.throws(()=>validateDocument({...ballOnly,elements:[...ballOnly.elements,{id:'overflow',type:'ball',position:{x:50,y:50}}]}));
});

test('formations, clear scopes, and resets retain every existing ball',()=>{
 const board=trainingBoard();
 for(const operations of [[{action:'configure',formations:{home:'4–3–3'}}],[{action:'configure',teamSize:5}],[{action:'configure',pitch:'classic'}]]){
  assert.deepEqual(balls(applyOperations(board,{expectedRevision:0,operations})),balls(board));
 }
 const annotated=applyOperations(board,{expectedRevision:0,operations:[{action:'add',element:{id:'cone',type:'cone',position:{x:50,y:50},rotation:0}}]});
 assert.deepEqual(clearBoard(annotated,'annotations'),toDocument(fromDocument(board)));
 assert.deepEqual(clearBoard(annotated,'everything').elements,[]);
 const centred=balls(board).map(b=>({...b,position:{x:50,y:50}}));
 assert.deepEqual(balls(clearBoard(annotated,'reset')),centred);
 assert.deepEqual(balls(toDocument(resetExistingPositions(fromDocument(board)))),centred);
 const noBalls={...board,elements:board.elements.filter(e=>e.type!=='ball')};
 assert.equal(balls(clearBoard(noBalls,'reset')).length,1);
 assert.equal(balls(toDocument(resetExistingPositions(fromDocument(noBalls)))).length,0);
 for(const count of [0,1]){
  const old={...defaultDocument(),elements:defaultDocument().elements.filter(e=>e.type!=='ball'||count===1)};
  assert.equal(balls(validateDocument(toDocument(fromDocument(old)))).length,count);
 }
});

test('multi-ball exports include every distinct ball in both orientations and layouts',()=>{
 const original=trainingBoard();
 for(const pitch of ['u8','classic'] as const){for(const vertical of [false,true]){
  const board={...original,pitch};const svg=String(exportBoard(board,'svg',vertical));
  assert.equal((svg.match(/r="14"/g)||[]).length,10);
  assert.equal((svg.match(/<text\b/g)||[]).length,10);
  const internal=fromDocument(board);const height=pitch==='u8'?64+936*25/35:600;
  for(const ball of internal.players.filter(p=>p.team==='ball')){
   assert.ok(svg.includes(`transform="translate(${ball.x},${32+(ball.y-32)*(height-64)/536})"`));
  }
  const png=Buffer.from(exportBoard(board,'png',vertical));
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(png.readUInt32BE(vertical?20:16),2000);
  const missing={...board,elements:board.elements.filter(e=>e.id!=='ball-10')};
  assert.notDeepEqual(png,Buffer.from(exportBoard(missing,'png',vertical)));
 }}
});

test('HTTP multi-ball boards and sessions persist, load, and undo across restarts',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'touchline-balls-')),port=19575;
 let child:ChildProcess|undefined;
 async function start(){
  child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,PORT:String(port),BOARD_DATA_DIR:directory},stdio:['ignore','pipe','pipe']});
  let logs='';child.stderr!.on('data',d=>logs+=d);child.stdout!.on('data',d=>logs+=d);
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error(logs);try{if((await fetch(`http://127.0.0.1:${port}/api/v1/board`)).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}
  throw new Error('Server not ready: '+logs);
 }
 async function stop(){if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
 async function request(path:string,method='GET',body?:unknown){
  const response=await fetch(`http://127.0.0.1:${port}/api/v1${path}`,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal(response.ok,true,`${method} ${path}: ${response.status}`);return response.json();
 }
 try{
  await start();const original=await request('/board');const board=trainingBoard();
  const loaded=await request('/board','PUT',{expectedRevision:original.revision,board});assert.deepEqual(loaded.board,board);
  const saved=await request('/sessions','POST',{name:'Ten children, ten balls',expectedRevision:loaded.revision});assert.deepEqual(saved.board,board);
  const edited=await request('/board/operations','POST',{expectedRevision:loaded.revision,operations:[{action:'update',id:'ball-2',changes:{position:{x:80,y:60}}},{action:'delete',id:'ball-3'}]});
  assert.equal(balls(edited.board).length,9);
  await stop();await start();assert.deepEqual(await request('/board'),edited);
  assert.deepEqual((await request('/sessions')).find((s:{id:string})=>s.id===saved.id).board,board);
  const undone=await request('/board/undo','POST',{expectedRevision:edited.revision});assert.deepEqual(undone.board,board);
  const cleared=await request('/board/clear','POST',{expectedRevision:undone.revision,scope:'everything'});assert.deepEqual(cleared.board.elements,[]);
  const reopened=await request('/board','PUT',{expectedRevision:cleared.revision,board:saved.board});assert.deepEqual(reopened.board,board);
  await stop();await start();assert.deepEqual(await request('/board'),reopened);
  const undoLoad=await request('/board/undo','POST',{expectedRevision:reopened.revision});assert.deepEqual(undoLoad.board.elements,[]);
 }finally{await stop();rmSync(directory,{recursive:true,force:true});}
});
