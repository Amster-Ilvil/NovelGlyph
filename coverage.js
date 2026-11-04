/* NovelGlyph Web 1.0: pixel-exact ink ledger for manual matches.
 * NO OCR, NO automatic Unicode assertion. A covered pixel means that it is
 * inside a reviewed or candidate RECTANGLE, NOT that a glyph was decoded.
 * No persistent full-resolution bitmaps; audit one page at a time.
 */
(function(root){
 'use strict';
 function roiRect(roi,W,H){
  if(!Array.isArray(roi)||roi.length!==4)roi=[0,0,1,1];
  const normalized=roi.every(v=>Number.isFinite(v)&&v>=0&&v<=1);
  const a=normalized?[Math.floor(roi[0]*W),Math.floor(roi[1]*H),Math.ceil(roi[2]*W),Math.ceil(roi[3]*H)]:roi;
  const clamp=(v,min,max)=>Math.min(max,Math.max(min,Math.round(v)));
  const [x0,y0,x1,y1]=[clamp(a[0],0,W),clamp(a[1],0,H),clamp(a[2],0,W),clamp(a[3],0,H)];
  if(x1<=x0||y1<=y0)throw Error('覆盖范围无效');return [x0,y0,x1,y1];
 }
 function validHit(h,W,H){return h&&Number.isFinite(h.x)&&Number.isFinite(h.y)&&Number.isFinite(h.w)&&Number.isFinite(h.h)&&h.w>0&&h.h>0&&h.x<W&&h.y<H&&h.x+h.w>0&&h.y+h.h>0;}
 function tally(gray,W,H,hits=[],{threshold=210,roi=[0,0,1,1],includeMask=true}={}){
  if(!(gray instanceof Uint8Array)||gray.length!==W*H)throw Error('灰度原图尺寸不符');
  const [x0,y0,x1,y1]=roiRect(roi,W,H),mask=new Uint8Array(W*H);
  // 1 = pixel inside a candidate match; 2 = pixel inside a manually accepted
  // match. Rejections do not cover anything. Accepted wins overlapping claims.
  for(const h of hits){
   if(!validHit(h,W,H)||h.decision==='rejected')continue;
   const cls=h.decision==='accepted'?2:1;
   const a=Math.max(x0,Math.floor(h.x)),b=Math.max(y0,Math.floor(h.y)),c=Math.min(x1,Math.ceil(h.x+h.w)),d=Math.min(y1,Math.ceil(h.y+h.h));
   for(let y=b;y<d;y++)for(let x=a;x<c;x++){
    const k=y*W+x;if(cls>mask[k])mask[k]=cls;
   }
  }
  let total=0,accepted=0,candidate=0,uncovered=0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
   const k=y*W+x;
   if(gray[k]>=threshold){mask[k]=0;continue}
   total++;
   if(mask[k]===2)accepted++;else if(mask[k]===1)candidate++;else{uncovered++;mask[k]=3}
  }
  // 0 = ignored/no ink/out of ROI, 1 = pending, 2 = accepted, 3 = uncovered.
  return {total,accepted,candidate,uncovered,ratio:total?accepted/total:0,
   candidateRatio:total?(accepted+candidate)/total:0,roi:[x0,y0,x1,y1],width:W,height:H,...(includeMask?{mask}:{})};
 }
 function summed(mask,W,H,type){const stride=W+1,integral=new Float64Array(stride*(H+1));
  for(let y=0;y<H;y++){let running=0;for(let x=0;x<W;x++){running+=type===3?(mask[y*W+x]===3?1:0):(mask[y*W+x]===1||mask[y*W+x]===2?1:0);integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+running;}}
  return integral;
 }
 function area(sum,stride,x,y,w,h){return sum[(y+h)*stride+x+w]-sum[y*stride+x+w]-sum[(y+h)*stride+x]+sum[y*stride+x]}
 function recommend(ledger,{sizes=[[28,28],[36,36],[44,44]],limit=5,step=7,minInk=8}={}){
  const {width:W,height:H,mask,roi:[rx0,ry0,rx1,ry1]}=ledger;
  if(!mask)throw Error('推荐功能需要完整覆盖位图');
  if(!ledger.uncovered)return [];
  const uncovered=summed(mask,W,H,3),claimed=summed(mask,W,H,1),stride=W+1;
  // Only retain the best seed per coarse spatial cell; a full scan may
  // visit millions of windows, so materializing every candidate is wasteful.
  const cells=new Map(),bucketSize=48;
  const windows=sizes.filter(s=>Array.isArray(s)&&s.length===2&&s.every(v=>Number.isFinite(v)&&v>=8&&v<=240))
   .map(([w,h])=>[Math.round(w),Math.round(h)]);
  for(const [w,h] of windows){if(w>rx1-rx0||h>ry1-ry0)continue;
   for(let y=ry0;y+h<=ry1;y+=step)for(let x=rx0;x+w<=rx1;x+=step){
    const ink=area(uncovered,stride,x,y,w,h),blocked=area(claimed,stride,x,y,w,h);
    if(ink<minInk||ink/(w*h)<.025)continue;
    const score=ink/(Math.sqrt(w*h)) - 2.0*blocked/Math.sqrt(w*h);
    if(score<=0)continue;
    const key=Math.floor((x+w/2)/bucketSize)+','+Math.floor((y+h/2)/bucketSize);
    const prior=cells.get(key);
    if(!prior||score>prior.score)cells.set(key,{x,y,w,h,ink,blocked,score});
   }
  }
  const candidates=[...cells.values()];candidates.sort((a,b)=>b.score-a.score||b.ink-a.ink);
  const chosen=[];
  for(const c of candidates){
   if(chosen.some(q=>{
    const dx=Math.max(0,Math.min(c.x+c.w,q.x+q.w)-Math.max(c.x,q.x));
    const dy=Math.max(0,Math.min(c.y+c.h,q.y+q.h)-Math.max(c.y,q.y));
    return dx*dy/Math.min(c.w*c.h,q.w*q.h)>.22;
   }))continue;
   // Crop down to actual uncovered ink, plus a 1px margin, so a manual
   // selection can be quickly refined by dragging before searching.
   let x0=c.x+c.w,y0=c.y+c.h,x1=c.x,y1=c.y;
   for(let y=c.y;y<c.y+c.h;y++)for(let x=c.x;x<c.x+c.w;x++)if(mask[y*W+x]===3){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)}
   if(x1<x0)continue;
   chosen.push({...c,rect:[Math.max(rx0,x0-1),Math.max(ry0,y0-1),Math.min(rx1,x1+2),Math.min(ry1,y1+2)]});
   if(chosen.length>=limit)break;
  }
  return chosen;
 }
 function summarize(pages){const s={pages:pages.length,total:0,accepted:0,candidate:0,uncovered:0};
  for(const p of pages)for(const key of ['total','accepted','candidate','uncovered'])s[key]+=p[key]||0;
  s.acceptedRatio=s.total?s.accepted/s.total:0;
  s.coveredRatio=s.total?(s.accepted+s.candidate)/s.total:0;
  return s;
 }
 const api={tally,recommend,summarize,roiRect};root.GlyphCoverage=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof self!=='undefined'?self:globalThis);
