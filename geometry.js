/* NovelGlyph 0.6: explicitly reviewed physical-boundary edits.
   No OCR, no estimated pitch grid, and no automatic Unicode changes.
   A split or moved boundary MUST sit in actual two-row zero-ink projection.
   A merge combines strictly consecutive non-overlapping intervals of one column. */
(function(root){
'use strict';
const RISK='MANUAL_BOUNDARY_EDIT_UNVERIFIED';
function rows(gray,W,x0,x1,y0,y1){
 const out=[];let begin=-1;
 for(let y=y0;y<=y1;y++){
  let ink=false;
  if(y<y1)for(let x=x0;x<x1;x++)if(gray[y*W+x]<210){ink=true;break}
  if(!ink && y<y1){if(begin<0)begin=y}
  else if(begin>=0){if(y-begin>=2)out.push({start:begin,end:y,cut:Math.floor((begin+y)/2),width:y-begin});begin=-1}
 }
 return out;
}
function assertRegion(r,W,H){
 if(!r||![r.x0,r.x1,r.y0,r.y1,r.column].every(Number.isInteger)||r.x0<0||r.x1>W||r.y0<0||r.y1>H||r.x0>=r.x1||r.y0>=r.y1)throw Error('区段坐标已失效或越过原始图像');
}
function legalCut(gray,W,r,y){
 if(!Number.isInteger(y)||y<=r.y0||y>=r.y1)throw Error('切线必须位于原有区段内部');
 const available=rows(gray,W,r.x0,r.x1,r.y0,r.y1);
 const gap=available.find(g=>g.start<y&&y<g.end);
 if(!gap)throw Error('原图在此位置没有至少两行连续的真实投影空谷；禁止切断墨迹');
 return gap;
}
function create(gray,W,H,source,y0,y1,operation){
 const r={...source,x0:source.x0,x1:source.x1,y0,y1};
 assertRegion(r,W,H);
 const s=root.GlyphEngine.signature(gray,W,r.x0,r.x1,y0,y1);
 if(!s)throw Error('切分后出现空白区段，拒绝创建幽灵字位');
 return {...r,rect:s.rect,key:s.key,proof:s.proof,w:s.width,h:s.height,ink:s.ink[1],alternatives:[],risk:[RISK],verified:false,manualEdited:true,manualOperation:operation};
}
function split(gray,W,H,r,at){
 assertRegion(r,W,H);legalCut(gray,W,r,at);
 return [create(gray,W,H,r,r.y0,at,'SPLIT'),create(gray,W,H,r,at,r.y1,'SPLIT')];
}
function pair(first,second){
 if(!first||!second||first.column!==second.column||first.x0!==second.x0||first.x1!==second.x1||first.y0>=second.y0||first.y1>second.y0)throw Error('必须选择同一物理列中不重叠、按纵向排列的相邻两区段');
}
function merge(gray,W,H,first,second){
 assertRegion(first,W,H);assertRegion(second,W,H);pair(first,second);
 return [create(gray,W,H,first,first.y0,second.y1,'MERGE')];
}
function move(gray,W,H,first,second,at){
 assertRegion(first,W,H);assertRegion(second,W,H);pair(first,second);
 const union={...first,y1:second.y1};legalCut(gray,W,union,at);
 if(at===first.y1&&at===second.y0)throw Error('边界未变化');
 return [create(gray,W,H,first,first.y0,at,'MOVE'),create(gray,W,H,second,at,second.y1,'MOVE')];
}
function neighboring(regions,r){
 const arr=regions.filter(x=>x.column===r.column&&x.x0===r.x0&&x.x1===r.x1).sort((a,b)=>a.y0-b.y0||a.y1-b.y1);
 const idx=arr.indexOf(r);if(idx<0)throw Error('原始区段不存在，不能编辑陈旧位置');
 return arr[idx+1]||null;
}
// All operations return a proposed replacement. The caller must apply it
// atomically and invalidate any previous per-position human approvals.
root.GlyphGeometry={rows,legalCut,split,merge,move,neighboring,RISK};
if(typeof module!=='undefined'&&module.exports)module.exports=root.GlyphGeometry;
})(typeof self!=='undefined'?self:globalThis);
