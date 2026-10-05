import {useEffect,useRef,useState,useCallback,type SetStateAction} from 'react';
import {initial,type Board,type Saved} from '../shared/board';
import {fromDocument,toDocument,type Document} from '../shared/api';
type Snapshot={revision:number;board:Document;canUndo:boolean;sessions?:{id:string;name:string;date:string;board:Document}[]};
export function useWorkspace(notify:(message:string)=>void){
 const [board,setLocalBoard]=useState<Board>(initial);const [saves,setSaves]=useState<Saved[]>([]);const [canUndo,setCanUndo]=useState(false);const [ready,setReady]=useState(false);const [busy,setBusy]=useState(false);const [revision,setRevision]=useState(-1);
 const current=useRef<Snapshot|null>(null);const locked=useRef(false);const notifyRef=useRef(notify);notifyRef.current=notify;
 const apply=useCallback((snapshot:Snapshot,force=false)=>{
  if(current.current&&snapshot.revision<current.current.revision)return;
  const changed=!current.current||snapshot.revision!==current.current.revision;
  current.current=snapshot;setRevision(snapshot.revision);if(changed||force)setLocalBoard(fromDocument(snapshot.board));setCanUndo(snapshot.canUndo);setReady(true);
  if(snapshot.sessions)setSaves(snapshot.sessions.map(s=>({...s,board:fromDocument(s.board)})));
 },[]);
 useEffect(()=>{
  const events=new EventSource('/api/v1/events');let live=true;
  events.onmessage=event=>{try{if(live)apply(JSON.parse(event.data));}catch{notifyRef.current('Could not read the server board.');}};
  events.onerror=()=>{if(live){setReady(false);if(current.current)setLocalBoard(fromDocument(current.current.board));}};
  async function migrate(){
   try{
    const legacy=JSON.parse(localStorage.getItem('touchline-layouts')||'[]');
    if(!legacy.length)return;
    let migrationId=localStorage.getItem('touchline-migration-id');if(!migrationId){migrationId=crypto.randomUUID();localStorage.setItem('touchline-migration-id',migrationId);}
    const response=await fetch('/api/v1/sessions/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({migrationId,sessions:legacy})});
    if(!response.ok)throw new Error('Saved sessions could not be migrated. The browser copy is preserved.');
    if(live){const sessions=await response.json();setSaves(sessions.map((s:{id:string;name:string;date:string;board:Document})=>({...s,board:fromDocument(s.board)})));localStorage.setItem('touchline-migrated','true');}
   }catch(e){if(live)notifyRef.current(e instanceof Error?e.message:'Could not migrate saved sessions.');}
  }
  void migrate();return()=>{live=false;events.close();};
 },[apply]);
 const request=async(path:string,method:string,payload?:unknown)=>{
  const response=await fetch(path,{method,headers:{'Content-Type':'application/json'},...(payload!==undefined?{body:JSON.stringify(payload)}:{})});const value=await response.json();
  if(!response.ok){if(value.board)apply(value,true);throw new Error(response.status===409?'Board changed elsewhere. Your edit was not applied.':value.error||'Request failed');}return value;
 };
 const write=async(path:string,method:string,payload:unknown,optimistic?:Board)=>{
  if(locked.current||!current.current||!ready){notifyRef.current('Wait for the board to connect.');return false;}
  locked.current=true;setBusy(true);if(optimistic)setLocalBoard(optimistic);
  try{const result=await request(path,method,payload);if(result.board&&typeof result.revision==='number')apply(result,true);return result;}
  catch(error){if(current.current)apply(current.current,true);notifyRef.current(error instanceof Error?error.message:'Could not connect to the board server.');return false;}
  finally{locked.current=false;setBusy(false);}
 };
 const update=(next:Board)=>{void write('/api/v1/board','PUT',{expectedRevision:revision,board:toDocument(next)},next);};
 const undo=()=>{void write('/api/v1/board/undo','POST',{expectedRevision:current.current?.revision});};
 const clear=async(scope:'annotations'|'reset'|'everything')=>write('/api/v1/board/clear','POST',{expectedRevision:revision,scope});
 const saveSession=async(name:string)=>write('/api/v1/sessions','POST',{name,expectedRevision:revision});
 const store=(list:Saved[])=>{const removed=saves.find(s=>!list.some(v=>v.id===s.id));if(removed)void write(`/api/v1/sessions/${encodeURIComponent(removed.id)}`,'DELETE',undefined);};
 const setBoard=(value:SetStateAction<Board>)=>setLocalBoard(value);
 return {board,setBoard,saves,update,undo,clear,canUndo,store,saveSession,ready,busy,revision};
}
