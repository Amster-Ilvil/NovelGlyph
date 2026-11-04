/* NovelGlyph Web 0.8: OCR-free, non-destructive review adviser.
 * Priorities are geometric HINTS only. Never creates Unicode labels or cuts.
 * Column order matches the original page (right -> left).
 */
(function(root){
'use strict';
const FLAG_WEIGHTS={
 LONG_UNSPLIT:7,INTERNAL_REAL_GAP:6,WIDE_COLUMN:6,
 NARROW_SYMBOL:3,SHORT_REGION:3,WEAK_GAP:2
};
const LABELS={
 LONG_UNSPLIT:'超长候选（可能漏切）',INTERNAL_REAL_GAP:'内部真实空谷',
 WIDE_COLUMN:'超宽物理列',NARROW_SYMBOL:'窄字形／标点形态',
 SHORT_REGION:'短字形／标点形态',WEAK_GAP:'边界空谷较窄'
};
function finiteBox(b){return b && ['x0','x1','y0','y1'].every(k=>Number.isSafeInteger(b[k]))&&b.x0>=0&&b.x1>b.x0&&b.y0>=0&&b.y1>b.y0}
function summaries(columns,regions){
 if(!Array.isArray(columns)||!Array.isArray(regions))throw Error('缺少物理列或字位索引');
 const byCol=new Map();
 for(const r of regions){
  if(!r||!Number.isSafeInteger(r.column)||r.column<1||r.column>columns.length)continue;
  if(!byCol.has(r.column))byCol.set(r.column,[]);
  byCol.get(r.column).push(r);
 }
 return columns.map((col,i)=>{
  const n=i+1,found=byCol.get(n)||[],counts={};
  for(const reg of found)for(const risk of new Set(Array.isArray(reg.risk)?reg.risk:[])){
    if(Object.hasOwn(FLAG_WEIGHTS,risk))counts[risk]=(counts[risk]||0)+1;
  }
  const total=found.length,short=(counts.SHORT_REGION||0)+(counts.NARROW_SYMBOL||0),
   long=(counts.LONG_UNSPLIT||0)+(counts.INTERNAL_REAL_GAP||0);
  const riskPositions=found.filter(r=>(r.risk||[]).some(x=>Object.hasOwn(FLAG_WEIGHTS,x))).length;
  const score=Math.min(100,Math.round((col.risk?20:0)+
    (riskPositions/Math.max(1,total))*54+
    Math.min(25,long*3)+Math.min(12,short*1.2)+
    (total===0?10:0)));
  const reasons=Object.keys(FLAG_WEIGHTS).filter(k=>counts[k]>0)
   .sort((a,b)=>(FLAG_WEIGHTS[b]*counts[b])-(FLAG_WEIGHTS[a]*counts[a]))
   .map(k=>({key:k,count:counts[k],label:LABELS[k]}));
  const likelyPunctuation=short>0;
  return {column:n,score,total,risky:riskPositions,counts,reasons,
    likelyPunctuation,needsReview:score>=22||long>0,
    suggestedAction:long>0?'检查内部切线':likelyPunctuation?'核查标点边界':col.risk?'检查列宽':'例行复核'};
 });
}
function gaps(gray,W,H,col,regions=[],options={}){
 if(!finiteBox(col)||!gray||!Number.isSafeInteger(W)||!Number.isSafeInteger(H)||
    gray.length!==W*H||col.x1>W||col.y1>H)throw Error('需要有效的原图和物理列');
 const minGap=Math.max(2,Math.min(12,Number(options.minGap)||2));
 const minMargin=Math.max(5,Number(options.minMargin)||8);
 const maxResults=Math.max(1,Math.min(80,Number(options.maxResults)||12));
 const y0=col.y0,y1=col.y1,marks=[];
 const inkRows=new Uint8Array(y1-y0);
 for(let y=y0;y<y1;y++)for(let x=col.x0;x<col.x1;x++){
  if(gray[y*W+x]<210){inkRows[y-y0]=1;break}
 }
 let start=-1;
 for(let y=y0;y<=y1;y++){
  const isBlank=y<y1&&!inkRows[y-y0];
  if(isBlank&&start<0)start=y;
  if((!isBlank||y===y1)&&start>=0){
   const end=y,width=end-start;
   if(width>=minGap){
    const center=Math.floor((start+end)/2);
    if(center-col.y0>=minMargin&&col.y1-center>=minMargin){
     let crossing=0,nearShort=0,nearLong=0;
     const pitch=Math.max(12,Number(col.pitch)||col.x1-col.x0);
     for(const r of regions){
      if(r.column!==undefined&&r.column!==options.column)continue;
      if(r.y0<center&&r.y1>center)crossing++;
      const dist=Math.min(Math.abs(r.y0-center),Math.abs(r.y1-center));
      if(dist<pitch*.8){
       if((r.risk||[]).some(x=>x==='SHORT_REGION'||x==='NARROW_SYMBOL'))nearShort++;
       if((r.risk||[]).some(x=>x==='LONG_UNSPLIT'||x==='INTERNAL_REAL_GAP'))nearLong++;
      }
     }
     const score=Math.round(Math.min(100,width*2+nearShort*12+nearLong*14+(crossing===0?18:-18)));
     marks.push({y:center,start,end,width,crossing,nearShort,nearLong,score,
       reason:crossing?`${crossing} 个旧字位跨线，先人工核对`:
        nearLong?'邻近可能漏切的长字位':nearShort?'邻近短字形／标点': '真实零墨迹空谷'});
    }
   }
   start=-1;
  }
 }
 return marks.sort((a,b)=>b.score-a.score||b.width-a.width||a.y-b.y).slice(0,maxResults);
}
function queue(pageColumns,pageRegions,annotated=new Map(),mode='risk'){
 if(!(pageColumns instanceof Map)||!(pageRegions instanceof Map))throw Error('审核队列必须使用实际页码映射');
 const out=[];
 for(const [page,cols] of pageColumns){
  const items=summaries(cols,pageRegions.get(page)||[]);
  for(const item of items){
   const key=`${page}:${item.column}`,marked=annotated.has(key);
   if(mode==='risk'&&!item.needsReview)continue;
   if(mode==='unreviewed'&&marked)continue;
   if(mode==='punctuation'&&!item.likelyPunctuation)continue;
   out.push({page,...item,marked});
  }
 }
 return out.sort((a,b)=>b.score-a.score||a.page-b.page||a.column-b.column);
}
root.GlyphColumnAdvisor={summaries,gaps,queue,FLAG_WEIGHTS};
if(typeof module!=='undefined'&&module.exports)module.exports=root.GlyphColumnAdvisor;
})(typeof self!=='undefined'?self:globalThis);
