import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Resvg} from '@resvg/resvg-js';
import {PitchImage} from '../shared/Pitch';
import {fromDocument,type Document} from '../shared/api';

export function exportBoard(board:Document,format:'png'|'svg',vertical:boolean){
 const svg=renderToStaticMarkup(React.createElement(PitchImage,{board:fromDocument(board),vertical}));
 return format==='svg'?svg:new Resvg(svg).render().asPng();
}
