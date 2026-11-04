/* NovelGlyph Web 0.3: full-shape proof gated by projected physical ink gaps.
   A repeated 24x24 window is an ANCHOR, never a character. This layer only
   promotes a provisional full-shape candidate when both source columns give
   independently delimited spans and the full three-threshold bitmaps agree.
   It does not derive Unicode, assume OCR counts, or modify segmentation. */
(function(root){
 'use strict';
 const THRESH=210;
 function columnRows(gray,W,H,col){
  if(!col||!Number.isSafeInteger(W)||!Number.isSafeInteger(H)||gray.length!==W*H)return null;
  const {x0,x1,y0,y1}=col;
  if(![x0,x1,y0,y1].every(Number.isFinite)||x0<0||x1>W||x1<=x0||y0<0||y1>H||y1<=y0)return null;
  const rows=new Uint16Array(y1-y0);
  for(let y=y0;y<y1;y++){let ink=0;for(let x=x0;x<x1;x++)if(gray[y*W+x]<THRESH)ink++;rows[y-y0]=ink}
  return rows;
 }
 function projectSpan(gray,W,H,col,anchor,opts={}){
  if(!anchor||anchor.w!==24||anchor.h!==24)return {status:'INVALID_ANCHOR'};
  const rows=columnRows(gray,W,H,col);if(!rows)return {status:'INVALID_COLUMN'};
  const pitch=Number(col.pitch)||Math.max(12,col.x1-col.x0);
  const minHeight=Math.max(10,pitch*(opts.minRatio||.55));
  const maxHeight=Math.max(minHeight+1,pitch*(opts.maxRatio||1.48));
  const ay=anchor.y-col.y0,by=ay+anchor.h;
  if(ay<0||by>rows.length||anchor.x<col.x0||anchor.x+anchor.w>col.x1)return {status:'ANCHOR_OUTSIDE_COLUMN'};
  // Reject windows spanning a real 2+ pixel blank band, independently of OCR.
  let blanks=0;for(let y=ay;y<by;y++){if(!rows[y]){if(++blanks>=2)return {status:'ANCHOR_CROSSES_GAP'}}else blanks=0}
  const gaps=[];let start=-1;
  for(let y=0;y<=rows.length;y++){
   if(y<rows.length&&!rows[y]){if(start<0)start=y}
   else if(start>=0){if(y-start>=2)gaps.push({a:start,b:y,w:y-start});start=-1}
  }
  let upper=0,lower=rows.length,upperGap=0,lowerGap=0;
  for(const g of gaps){
   if(g.b<=ay){upper=g.b;upperGap=g.w}
   else if(g.a>=by){lower=g.a;lowerGap=g.w;break}
  }
  const y0=col.y0+upper,y1=col.y0+lower,height=y1-y0;
  if(height<minHeight||height>maxHeight)return {status:'NON_GLYPH_HEIGHT',rect:[col.x0,y0,col.x1,y1],height,pitch};
  // Must be bounded by observed ink gaps, not the page edges.
  if(!upperGap||!lowerGap)return {status:'UNBOUNDED_SHAPE',rect:[col.x0,y0,col.x1,y1]};
  const image=root.GlyphEngine.signature(gray,W,col.x0,col.x1,y0,y1);
  if(!image)return {status:'EMPTY_SHAPE'};
  if(image.width<Math.max(5,pitch*.22)||image.width>pitch*1.35)return {status:'UNUSUAL_SHAPE_WIDTH',rect:image.rect};
  return {status:'PROJECTED_FULL_SHAPE_CANDIDATE',rect:image.rect,sourceRect:[col.x0,y0,col.x1,y1],key:image.key,proof:image.proof,
    width:image.width,height:image.height,pitch,upperGap,lowerGap,
    risk:[...(upperGap<Math.max(4,pitch*.12)||lowerGap<Math.max(4,pitch*.12)?['THIN_BOUNDARY_GAP']:[]),
      ...(height>pitch*1.18?['LONG_POSSIBLY_COMPOSITE']:[])]};
 }
 function compareAnchors(srcA,srcB,locA,locB,colA,colB){
  if(!locA||!locB||locA.page===locB.page)return {status:'NOT_CROSSPAGE'};
  const A=projectSpan(srcA.gray,srcA.width,srcA.height,colA,locA);
  const B=projectSpan(srcB.gray,srcB.width,srcB.height,colB,locB);
  if(A.status!=='PROJECTED_FULL_SHAPE_CANDIDATE'||B.status!=='PROJECTED_FULL_SHAPE_CANDIDATE')return {status:'NOT_FULL_SHAPE',left:A.status,right:B.status};
  if(A.key!==B.key||A.proof!==B.proof)return {status:'PARTIAL_MATCH_ONLY',left:A.rect,right:B.rect};
  // This proves two delimited three-threshold pixel shapes, NOT semantic
  // equality, absence of Ruby, or correctness of Unicode assignment.
  return {status:'DUAL_PAGE_FULL_SHAPE_PROOF_CANDIDATE',key:A.key,proof:A.proof,
   first:{page:locA.page,column:locA.column,rect:A.rect,sourceRect:A.sourceRect,seed:{x:locA.x,y:locA.y}},
   second:{page:locB.page,column:locB.column,rect:B.rect,sourceRect:B.sourceRect,seed:{x:locB.x,y:locB.y}},
   risk:[...new Set([...A.risk,...B.risk,'NOT_HUMAN_VERIFIED'])]};
 }
 root.GlyphAnchored={columnRows,projectSpan,compareAnchors};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.GlyphAnchored;
})(typeof self!=='undefined'?self:globalThis);
