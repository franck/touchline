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

const neutrals=(board:Document)=>board.elements.filter(e=>e.type==='player'&&e.team==='neutral');
const neutral=(number:number)=>({id:`neutral-${number}`,type:'player' as const,team:'neutral' as const,number,position:{x:25,y:75}});
const trainingBoard=():Document=>validateDocument({...defaultDocument(),elements:[...defaultDocument().elements,...Array.from({length:11},(_,i)=>neutral(i+1))]});

test('neutral shirts are independent of team size, unique, and editable with atomic validation',()=>{
 const board=trainingBoard();assert.equal(board.teamSize,5);assert.equal(neutrals(board).length,11);
 assert.deepEqual(neutrals(toDocument(fromDocument(board))),neutrals(board));
 const edited=applyOperations(board,{expectedRevision:0,operations:[
  {action:'delete',id:'neutral-2'},
  {action:'update',id:'neutral-11',changes:{number:2,position:{x:80,y:20}}}
 ]});
 assert.equal(neutrals(edited).length,10);
 assert.deepEqual(edited.elements.find(e=>e.id==='neutral-11'),{...neutral(2),id:'neutral-11',position:{x:80,y:20}});
 const restored=applyOperations(edited,{expectedRevision:0,operations:[{action:'add',element:{...neutral(11),id:'neutral-2'}}]});
 assert.equal(neutrals(restored).length,11);
 assert.throws(()=>applyOperations(board,{expectedRevision:0,operations:[{action:'delete',id:'neutral-2'},{action:'add',element:{...neutral(1),id:'duplicate-shirt'}}]}),/neutral.*unique numbers/);
 assert.equal(neutrals(board).length,11);
 for(const number of [0,12,1.5])assert.throws(()=>validateDocument({...board,elements:[{...neutral(number)}]}));
 assert.throws(()=>validateDocument({...board,elements:[...board.elements,{...neutral(1),id:'duplicate-shirt'}]}),/neutral.*unique numbers/);
 assert.throws(()=>validateDocument({...board,elements:[...board.elements,{...neutral(1),id:'home-0'}]}),/Duplicate element ID/);
 assert.throws(()=>validateDocument({...board,elements:[...board.elements,{...neutral(6),id:'too-many-home',team:'home'}]}),/home.*unique numbers/);
 assert.deepEqual(validateDocument(defaultDocument()),defaultDocument());
});

test('neutral IDs and positions survive formations, size changes, and both reset operations',()=>{
 const board=trainingBoard(),expected=neutrals(board);
 for(const operations of [[{action:'configure',formations:{home:'2–2',away:'2–1–1'}}],[{action:'configure',teamSize:11}],[{action:'configure',pitch:'classic'}]]){
  assert.deepEqual(neutrals(applyOperations(board,{expectedRevision:0,operations})),expected);
 }
 assert.deepEqual(neutrals(toDocument(resetExistingPositions(fromDocument(board)))),expected);
 assert.deepEqual(neutrals(clearBoard(board,'reset')),expected);
 assert.deepEqual(neutrals(clearBoard(board,'annotations')),expected);
 assert.deepEqual(clearBoard(board,'everything').elements,[]);
 const sparse={...board,elements:[{...neutral(11),id:'home-0'}]};
 assert.deepEqual(neutrals(clearBoard(sparse,'reset')),sparse.elements);
 assert.equal(new Set(clearBoard(sparse,'reset').elements.map(e=>e.id)).size,12);
});

test('neutral exports show yellow numbered players in either orientation and layout',()=>{
 for(const pitch of ['u8','classic'] as const){for(const vertical of [false,true]){
  const board={...defaultDocument(),pitch,elements:[neutral(11)]};const svg=String(exportBoard(board,'svg',vertical));
  assert.match(svg,/fill="#f8d44c"/);assert.match(svg,/>11<\/text>/);assert.match(svg,/fill="#493b12"/);
  assert.equal(svg.includes('transform="rotate(90)"'),vertical);
  const png=Buffer.from(exportBoard(board,'png',vertical));
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.notDeepEqual(png,Buffer.from(exportBoard({...board,elements:[]},'png',vertical)));
 }}
});

test('HTTP neutral edits, Undo, and saved sessions persist across server restarts',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'touchline-neutrals-')),port=19576;let child:ChildProcess|undefined;
 async function start(){
  child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,PORT:String(port),BOARD_DATA_DIR:directory},stdio:['ignore','pipe','pipe']});
  let logs='';child.stderr!.on('data',d=>logs+=d);child.stdout!.on('data',d=>logs+=d);
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error(logs);try{if((await fetch(`http://127.0.0.1:${port}/api/v1/board`)).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}
  throw new Error('Server not ready: '+logs);
 }
 async function stop(){if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
 async function request(path:string,method='GET',body?:unknown,status=200){
  const response=await fetch(`http://127.0.0.1:${port}/api/v1${path}`,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal(response.status,status,`${method} ${path}`);return response.json();
 }
 try{
  await start();const original=await request('/board');
  const added=await request('/board/operations','POST',{expectedRevision:original.revision,operations:[{action:'add',element:neutral(11)}]});
  await request('/board/operations','POST',{expectedRevision:added.revision,operations:[{action:'delete',id:'neutral-11'},{action:'add',element:{...neutral(12),id:'invalid-neutral'}}]},422);
  assert.deepEqual(await request('/board'),added);
  const saved=await request('/sessions','POST',{name:'Neutral support player',expectedRevision:added.revision},201);
  const moved=await request('/board/operations','POST',{expectedRevision:added.revision,operations:[{action:'update',id:'neutral-11',changes:{position:{x:70,y:10}}}]});
  const deleted=await request('/board/operations','POST',{expectedRevision:moved.revision,operations:[{action:'delete',id:'neutral-11'}]});
  assert.equal(neutrals(deleted.board).length,0);
  await stop();await start();assert.deepEqual(await request('/board'),deleted);
  assert.deepEqual((await request('/sessions')).find((s:{id:string})=>s.id===saved.id).board,added.board);
  const undone=await request('/board/undo','POST',{expectedRevision:deleted.revision});assert.deepEqual(undone.board,moved.board);
  const loaded=await request('/board','PUT',{expectedRevision:undone.revision,board:saved.board});assert.deepEqual(loaded.board,added.board);
  await stop();await start();assert.deepEqual(await request('/board'),loaded);
 }finally{await stop();rmSync(directory,{recursive:true,force:true});}
});
