import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {applyOperations,defaultDocument,type Document} from '../shared/api';

test('POST image export renders supplied documents and never changes workspace or Undo',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'touchline-export-')),port=19577;
 const base=`http://127.0.0.1:${port}/api/v1`;let child:ChildProcess|undefined;
 async function start(){
  child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,PORT:String(port),BOARD_DATA_DIR:directory},stdio:['ignore','pipe','pipe']});
  let logs='';child.stderr!.on('data',d=>logs+=d);child.stdout!.on('data',d=>logs+=d);
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error(logs);try{if((await fetch(base+'/board')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}
  throw new Error('Server not ready: '+logs);
 }
 async function stop(){if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
 async function request(path:string,method='GET',body?:unknown){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal(response.ok,true,`${method} ${path}: ${response.status}`);return response.json();
 }
 const post=(body:unknown)=>fetch(base+'/board/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  await start();const original=await request('/board');
  const edited=await request('/board/operations','POST',{expectedRevision:original.revision,operations:[{action:'update',id:'ball',changes:{position:{x:15,y:20}}}]});
  await request('/sessions','POST',{name:'Live board before export',expectedRevision:edited.revision});
  const before=await request('/board'),sessionsBefore=await request('/sessions'),fileBefore=readFileSync(join(directory,'workspace.json'),'utf8');
  async function unchanged(){
   assert.deepEqual(await request('/board'),before);assert.deepEqual(await request('/sessions'),sessionsBefore);
   assert.equal(readFileSync(join(directory,'workspace.json'),'utf8'),fileBefore);
  }
  const empty:Document={...defaultDocument(),elements:[]};
  const partial:Document={...empty,elements:[{id:'diagram-player',type:'player',team:'home',number:3,position:{x:30,y:30}}]};
  const multi:Document={...partial,elements:[...partial.elements,{id:'diagram-ball-a',type:'ball',position:{x:30,y:35}},{id:'diagram-ball-b',type:'ball',position:{x:60,y:65}}]};
  const populated=applyOperations(multi,{expectedRevision:0,operations:[
   {action:'add',element:{id:'cone',type:'cone',position:{x:20,y:20},rotation:45}},
   {action:'add',element:{id:'disc',type:'small-cone',position:{x:80,y:80},rotation:0,color:'blue'}},
   {action:'add',element:{id:'goal',type:'goal',position:{x:85,y:50},rotation:90}},
   {action:'add',element:{id:'pass',type:'drawing',start:{x:30,y:35},end:{x:60,y:65},style:'dotted',arrow:true}}
  ]});
  // Omitted options must render the supplied empty board, not the populated live board.
  const defaults=await post({board:empty});assert.equal(defaults.status,200);assert.equal(defaults.headers.get('content-type'),'image/png');
  const defaultPng=Buffer.from(await defaults.arrayBuffer());assert.equal(defaultPng.readUInt32BE(16),2000);assert.equal(defaultPng.readUInt32BE(20),1465);await unchanged();
  for(const board of [empty,partial,multi,populated]){for(const orientation of ['horizontal','vertical'] as const){
   const svgResponse=await post({board,format:'svg',orientation});assert.equal(svgResponse.status,200);
   assert.match(svgResponse.headers.get('content-type')!,/^image\/svg\+xml/);
   assert.equal(svgResponse.headers.get('content-disposition'),'attachment; filename="touchline-board.svg"');
   assert.equal(svgResponse.headers.get('x-board-revision'),null);assert.equal(svgResponse.headers.get('cache-control'),'no-store');
   const svg=await svgResponse.text();assert.match(svg,/xmlns="http:\/\/www.w3.org\/2000\/svg"/);
   assert.equal((svg.match(/r="14"/g)||[]).length,board.elements.filter(e=>e.type==='ball').length);
   assert.equal((svg.match(/<text\b/g)||[]).length,board.elements.filter(e=>e.type==='player').length);
   if(board===populated){assert.match(svg,/#58aaf0/);assert.match(svg,/#ff9b38/);assert.match(svg,/stroke-dasharray="1 11"/);assert.match(svg,/marker-end="url\(#arrowhead\)"/);}
   if(orientation==='vertical')assert.match(svg,/translate\(0 1000\) rotate\(-90\)/);
   const pngResponse=await post({board,format:'png',orientation});assert.equal(pngResponse.status,200);
   assert.equal(pngResponse.headers.get('content-type'),'image/png');assert.equal(pngResponse.headers.get('content-disposition'),'attachment; filename="touchline-board.png"');assert.equal(pngResponse.headers.get('x-board-revision'),null);
   const png=Buffer.from(await pngResponse.arrayBuffer());assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
   assert.equal(png.readUInt32BE(16),orientation==='vertical'?1465:2000);assert.equal(png.readUInt32BE(20),orientation==='vertical'?2000:1465);
   if(board!==empty&&orientation==='horizontal')assert.notDeepEqual(png,defaultPng);
   await unchanged();
  }}
  const invalid=[
   {},{board:empty,format:'jpg'},{board:empty,orientation:'diagonal'},
   {board:empty,expectedRevision:before.revision},{board:empty,unknown:true},
   {board:{...empty,unknown:true}},
   {board:{...multi,elements:[...multi.elements,multi.elements[1]]}},
   {board:{...empty,formations:{home:'invalid',away:'2–2'}}},
   {board:{...empty,elements:[{id:'bad',type:'ball',position:{x:101,y:0}}]}},
   {board:{...empty,elements:[{id:'bad',type:'ball',position:{x:50,y:50},number:1}]}},
   {board:{...partial,elements:[...partial.elements,{...partial.elements[0],id:'duplicate-shirt'}]}},
   {board:{...empty,elements:[{id:'too-high',type:'player',team:'home',number:6,position:{x:50,y:50}}]}},
   {board:{...empty,elements:Array.from({length:2001},(_,i)=>({id:`b-${i}`,type:'ball',position:{x:50,y:50}}))}}
  ];
  for(const body of invalid){const response=await post(body);assert.equal(response.status,422);assert.ok((await response.json()).error);await unchanged();}
  const malformed=await fetch(base+'/board/export',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});assert.equal(malformed.status,400);await malformed.json();await unchanged();
  const schema=await request('/schema');assert.equal(schema.export.additionalProperties,false);assert.deepEqual(schema.export.required,['board']);assert.equal(schema.export.properties.format.default,'png');assert.equal(schema.export.properties.orientation.default,'horizontal');
  const currentImage=await fetch(base+'/board/export?format=svg&expectedRevision='+before.revision);assert.equal(currentImage.status,200);assert.equal(currentImage.headers.get('x-board-revision'),String(before.revision));await currentImage.text();await unchanged();
  await stop();await start();await unchanged();
  const undone=await request('/board/undo','POST',{expectedRevision:before.revision});assert.deepEqual(undone.board,original.board);assert.equal(undone.revision,before.revision+1);
  assert.deepEqual(await request('/sessions'),sessionsBefore);
 }finally{await stop();rmSync(directory,{recursive:true,force:true});}
});
