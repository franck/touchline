import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Resvg} from '@resvg/resvg-js';
import {exportBoard} from '../server/export';
import {defaultDocument,type Document} from '../shared/api';

test('PNG arrowheads follow their lines in both board orientations',()=>{
 for(const pitch of ['u8','classic'] as const){
  for(const end of [{x:75,y:50},{x:25,y:50},{x:50,y:25},{x:50,y:75},{x:75,y:25},{x:25,y:75}]){
   const board:Document={...defaultDocument(),pitch,elements:[{id:'arrow',type:'drawing',start:{x:50,y:50},end,style:'solid',arrow:true}]};
   // Compare automatic orientation with the explicit rendered line angle.
   for(const vertical of [false,true]){
    const svg=String(exportBoard(board,'svg',vertical));
    const line=svg.match(/<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"[^>]*marker-end/)!;
    assert.ok(line);
    const angle=Math.atan2(Number(line[4])-Number(line[2]),Number(line[3])-Number(line[1]))*180/Math.PI;
    const expected=svg.replace(/orient="[^"]+"/,`orient="${angle}"`);
    assert.deepEqual(Buffer.from(exportBoard(board,'png',vertical)),Buffer.from(new Resvg(expected).render().asPng()),`${pitch}: ${JSON.stringify(end)}, vertical=${vertical}`);
   }
  }
 }
});
