import express from 'express';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {exportBoard} from './export';
import {applyOperations,clearBoard,clearSchema,defaultDocument,exportSchema,fromDocument,toDocument,replaceSchema,operationsSchema,schemaBundle,validateDocument,type Document} from '../shared/api';

const root=fileURLToPath(new URL('..',import.meta.url));
const dataDir=process.env.BOARD_DATA_DIR?resolve(process.env.BOARD_DATA_DIR):resolve(root,'data');
mkdirSync(dataDir,{recursive:true});const file=resolve(dataDir,'workspace.json');
type Session={id:string;name:string;date:string;board:Document};
type State={revision:number;board:Document;history:Document[];sessions:Session[];migrations:string[]};
let state:State={revision:0,board:defaultDocument(),history:[],sessions:[],migrations:[]};
if(existsSync(file)){state=JSON.parse(readFileSync(file,'utf8'));validateDocument(state.board);for(const s of state.sessions)validateDocument(s.board);}
const clients=new Set<express.Response>();
const snapshot=()=>({revision:state.revision,board:state.board,canUndo:state.history.length>0});
function persist(next:State){const temp=file+'.tmp';writeFileSync(temp,JSON.stringify(next,null,2));renameSync(temp,file);state=next;}
function broadcast(){const event=`data: ${JSON.stringify({...snapshot(),sessions:state.sessions})}\n\n`;for(const client of clients)client.write(event);}
function commit(board:Document){persist({...state,board,revision:state.revision+1,history:[...state.history.slice(-49),state.board]});broadcast();return snapshot();}
class HttpError extends Error{constructor(public status:number,message:string){super(message);}}
function checkRevision(value:unknown){if(!Number.isInteger(value)||Number(value)<0)throw new HttpError(400,'expectedRevision must be a nonnegative integer');if(value!==state.revision)throw new HttpError(409,'Board changed; read the latest board and retry');}
const app=express();app.use(express.json({limit:'2mb'}));
app.use('/api',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
app.get('/api/v1/board',(_req,res)=>res.json(snapshot()));
app.get('/api/v1/board/export',(req,res,next)=>{try{
 const input=z.strictObject({format:z.enum(['png','svg']).default('png'),orientation:z.enum(['horizontal','vertical']).default('horizontal'),expectedRevision:z.coerce.number().int().nonnegative().optional()}).parse(req.query);
 if(input.expectedRevision!==undefined)checkRevision(input.expectedRevision);
 const revision=state.revision;
 const image=exportBoard(state.board,input.format,input.orientation==='vertical');
 res.set({'Content-Type':input.format==='png'?'image/png':'image/svg+xml','Content-Disposition':`attachment; filename="touchline-board-r${revision}.${input.format}"`,'X-Board-Revision':String(revision)}).send(image);
 }catch(e){next(e);}});
app.get('/api/v1/schema',(_req,res)=>res.json(schemaBundle()));
app.post('/api/v1/board/export',(req,res,next)=>{try{
 const input=exportSchema.parse(req.body);
 const image=exportBoard(validateDocument(input.board),input.format,input.orientation==='vertical');
 res.set({'Content-Type':input.format==='png'?'image/png':'image/svg+xml','Content-Disposition':`attachment; filename="touchline-board.${input.format}"`}).send(image);
 }catch(e){next(e);}});
app.put('/api/v1/board',(req,res,next)=>{try{const input=replaceSchema.parse(req.body);checkRevision(input.expectedRevision);res.json(commit(validateDocument(input.board)));}catch(e){next(e);}});
app.post('/api/v1/board/operations',(req,res,next)=>{try{const input=operationsSchema.parse(req.body);checkRevision(input.expectedRevision);res.json(commit(applyOperations(state.board,input)));}catch(e){next(e);}});
app.post('/api/v1/board/clear',(req,res,next)=>{try{const input=clearSchema.parse(req.body);checkRevision(input.expectedRevision);res.json(commit(clearBoard(state.board,input.scope)));}catch(e){next(e);}});
app.post('/api/v1/board/undo',(req,res,next)=>{try{checkRevision(req.body?.expectedRevision);if(!state.history.length)throw new HttpError(400,'Nothing to undo');persist({...state,board:state.history[state.history.length-1],history:state.history.slice(0,-1),revision:state.revision+1});broadcast();res.json(snapshot());}catch(e){next(e);}});
app.get('/api/v1/events',(req,res)=>{res.set({'Content-Type':'text/event-stream','Connection':'keep-alive','Cache-Control':'no-cache'});res.flushHeaders();clients.add(res);res.write(`data: ${JSON.stringify({...snapshot(),sessions:state.sessions})}\n\n`);const timer=setInterval(()=>res.write(': heartbeat\n\n'),15000);req.on('close',()=>{clearInterval(timer);clients.delete(res);});});
app.get('/api/v1/sessions',(_req,res)=>res.json(state.sessions));
app.post('/api/v1/sessions',(req,res,next)=>{try{const input=z.strictObject({name:z.string().trim().min(1).max(80),expectedRevision:z.number().int().nonnegative()}).parse(req.body);checkRevision(input.expectedRevision);const session={id:crypto.randomUUID(),name:input.name,date:new Date().toISOString(),board:structuredClone(state.board)};persist({...state,sessions:[session,...state.sessions]});broadcast();res.status(201).json(session);}catch(e){next(e);}});
app.delete('/api/v1/sessions/:id',(req,res,next)=>{try{if(!state.sessions.some(s=>s.id===req.params.id))throw new HttpError(404,'Session not found');persist({...state,sessions:state.sessions.filter(s=>s.id!==req.params.id)});broadcast();res.json({ok:true});}catch(e){next(e);}});
app.post('/api/v1/sessions/import',(req,res,next)=>{try{
 const input=z.strictObject({migrationId:z.string().min(1).max(100),sessions:z.array(z.strictObject({id:z.string().min(1).max(100),name:z.string().min(1).max(80),date:z.iso.datetime(),board:z.unknown()})).max(1000)}).parse(req.body);
 if(!state.migrations.includes(input.migrationId)){
  // Round-trip legacy browser documents through the public validator before storing.
  const sessions=input.sessions.map(s=>({...s,board:toDocument(fromDocument(toDocument(s.board as Parameters<typeof toDocument>[0])))}));
  persist({...state,sessions:[...state.sessions,...sessions.filter(s=>!state.sessions.some(old=>old.id===s.id))],migrations:[...state.migrations,input.migrationId]});broadcast();
 }
 res.json(state.sessions);
 }catch(e){next(e);}});
app.use('/api',(_req,res)=>res.status(404).json({error:'Unknown API endpoint'}));
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
 if(error instanceof z.ZodError){res.status(422).json({error:'Invalid JSON document',details:error.issues});return;}
 const status=error instanceof HttpError?error.status:error instanceof SyntaxError?400:422;
 res.status(status).json({error:error instanceof Error?error.message:'Invalid request',...(status===409?{...snapshot()}: {})});
});
if(process.argv.includes('--dev')){const {createServer}=await import('vite');const vite=await createServer({root,server:{middlewareMode:true,hmr:{port:Number(process.env.PORT||5173)+1}},appType:'spa'});app.use(vite.middlewares);}
else{app.use(express.static(resolve(root,'dist')));app.get('/{*path}',(_req,res)=>res.sendFile(resolve(root,'dist/index.html')));}
const port=Number(process.env.PORT||5173);const host=process.env.HOST||'127.0.0.1';
const server=app.listen(port,host,()=>console.log(`Touchline board & API: http://${host}:${port}`));
function shutdown(){for(const c of clients)c.end();server.close(()=>process.exit(0));}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
