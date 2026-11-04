/* NovelGlyph manual full-glyph template matching, no OCR and no presegmented glyphs.
 * A user-defined rectangle supplies the ONLY glyph boundary. The engine
 * searches image pixels, not the automatic region list or any Unicode model.
 */
(function(root){
 'use strict';
 const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
 const normRect=(r,W,H)=>[clamp(Math.floor(Math.min(r[0],r[2])),0,W),clamp(Math.floor(Math.min(r[1],r[3])),0,H),clamp(Math.ceil(Math.max(r[0],r[2])),0,W),clamp(Math.ceil(Math.max(r[1],r[3])),0,H)];
 function chooseAnchors(mask,w,h,count=16){
  const buckets=[],rows=4,cols=4;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
   let winner=-1,best=Infinity;
   for(let y=Math.floor(row*h/rows);y<Math.ceil((row+1)*h/rows);y++)for(let x=Math.floor(col*w/cols);x<Math.ceil((col+1)*w/cols);x++){
    if(x>=w||y>=h||!mask[y*w+x])continue;
    // Prefer interior ink, but spread the anchors across the full shape.
    const d=Math.abs(x-(col+.5)*w/cols)+Math.abs(y-(row+.5)*h/rows);
    if(d<best){best=d;winner=y*w+x}
   }
   if(winner>=0)buckets.push([winner%w,Math.floor(winner/w)]);
  }
  return buckets.slice(0,count);
 }
 function makeTemplate(gray,W,H,rect,{threshold=185,trim=true}={}){
  if(!(gray instanceof Uint8Array)||gray.length!==W*H)throw Error('原图灰度数据无效');
  let [x0,y0,x1,y1]=normRect(rect,W,H);
  if(x1-x0<3||y1-y0<3)throw Error('选框太小；请完整框出一个字形');
  if(trim){let a=x1,b=y1,c=x0,d=y0;
   for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(gray[y*W+x]<210){if(x<a)a=x;if(x>c)c=x;if(y<b)b=y;if(y>d)d=y;}
   if(a>c)throw Error('选框中没有足够的墨迹');
   [x0,y0,x1,y1]=[a,b,c+1,d+1];
  }
  let w=x1-x0,h=y1-y0;
  if(w>190||h>240)throw Error('单次选框暂限 190×240 原始像素，可适当缩小到单字');
  let dark=new Uint8Array(w*h),soft=new Uint8Array(w*h),ink=0,softInk=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const g=gray[(y0+y)*W+x0+x],i=y*w+x;
   if(g<threshold){dark[i]=1;ink++}if(g<210){soft[i]=1;softInk++}
  }
  if(ink<5)throw Error('当前选框内有效墨迹太少，无法可靠重合');
  if(ink/(w*h)<.035)throw Error('当前选框的墨迹过稀，容易产生大量假阳性');
  const anchors=chooseAnchors(dark,w,h,16);
  if(anchors.length<3)throw Error('选框里的墨迹分布过于集中，不能可靠搜索');
  return {rect:[x0,y0,x1,y1],w,h,dark,soft,ink,softInk,anchors,threshold};
 }
 function borders(gray,W,H,x,y,w,h,threshold){
  let touched=0,valid=0;const d=2;
  for(let col=x;col<x+w;col+=Math.max(1,Math.round(w/8))){for(const yy of [y-d,y+h+d-1]){if(yy>=0&&yy<H){valid++;if(gray[yy*W+col]<threshold)touched++}}}
  for(let row=y;row<y+h;row+=Math.max(1,Math.round(h/8))){for(const xx of [x-d,x+w+d-1]){if(xx>=0&&xx<W){valid++;if(gray[row*W+xx]<threshold)touched++}}}
  return {nearbyInkRatio:valid?touched/valid:0,touchesOthers:touched>Math.max(2,valid*.24)};
 }
 function compare(gray,W,H,t,x,y,{scoreMin=.86}={}){
  const {w,h,threshold,dark,soft,ink,softInk}=t;
  if(x<0||y<0||x+w>W||y+h>H)return null;
  let hits=0,n=0,softHits=0,softN=0;
  for(let j=0;j<h;j++){
   const start=(y+j)*W+x,ti=j*w;
   for(let i=0;i<w;i++){
    const g=gray[start+i];const a=g<threshold,b=g<210,k=ti+i;
    if(a)n++;if(a&&dark[k])hits++;if(b)softN++;if(b&&soft[k])softHits++;
   }
  }
  const score=2*hits/(ink+n||1),softScore=2*softHits/(softInk+softN||1);
  if(score<scoreMin||softScore<scoreMin-.07)return null;
  const boundary=borders(gray,W,H,x,y,w,h,threshold);
  return {x,y,w,h,score:+score.toFixed(4),softScore:+softScore.toFixed(4),...boundary};
 }
 function searchPage(gray,W,H,t,{roi=[0,0,1,1],scoreMin=.86,allPositions=true,limit=0,abort=()=>false}={}){
  // Unlike projection segmentation, this scans *every* possible pixel origin
  // inside ROI, including symbols that automatic glyph cutters omitted.
  if(!gray||gray.length!==W*H)throw Error('页面灰度大小不匹配');
  const [x0,y0,x1,y1]=roi.length===4&&roi.every(v=>v>=0&&v<=1)?
     [Math.floor(roi[0]*W),Math.floor(roi[1]*H),Math.ceil(roi[2]*W),Math.ceil(roi[3]*H)]:normRect(roi,W,H);
  const ax=t.anchors;
  const anchMin=Math.max(2,Math.ceil(ax.length*.70));
  const candidates=[];
  let examined=0,prefilter=0;
  for(let y=Math.max(0,y0);y<=Math.min(H-t.h,y1-t.h);y++){
   if((y&31)===0&&abort())return {matches:[],examined,prefilter,cancelled:true};
   for(let x=Math.max(0,x0);x<=Math.min(W-t.w,x1-t.w);x++){
    examined++;
    // Dark anchors are a prefilter, not a proof; complete masks are rechecked.
    let matchCount=0,remain=ax.length;
    for(let ai=0;ai<ax.length;ai++){
     const [dx,dy]=ax[ai];remain--;
     if(gray[(y+dy)*W+x+dx]<t.threshold)matchCount++;
     if(matchCount+remain<anchMin)break;
    }
    if(matchCount<anchMin)continue;
    prefilter++;
    const proof=compare(gray,W,H,t,x,y,{scoreMin});
    if(proof)candidates.push(proof);
   }
  }
  // One glyph yields several near-pixel candidates; keep the best for each
  // local overlap. NMS is grid-indexed, so repeated characters scale linearly.
  candidates.sort((a,b)=>b.score-a.score||b.softScore-a.softScore);
  const result=[],grid=new Map(),sx=Math.max(3,Math.floor(t.w*.65)),sy=Math.max(3,Math.floor(t.h*.65));
  for(const c of candidates){
   const gx=Math.floor(c.x/sx),gy=Math.floor(c.y/sy);
   let duplicate=false;
   for(let yy=gy-2;yy<=gy+2&&!duplicate;yy++)for(let xx=gx-2;xx<=gx+2&&!duplicate;xx++){
    for(const p of grid.get(xx+','+yy)||[]){
     const overlapX=Math.max(0,Math.min(c.x+c.w,p.x+p.w)-Math.max(c.x,p.x));
     const overlapY=Math.max(0,Math.min(c.y+c.h,p.y+p.h)-Math.max(c.y,p.y));
     if(overlapX*overlapY/(c.w*c.h)>.55){duplicate=true;break}
    }
   }
   if(duplicate)continue;
   result.push(c);const k=gx+','+gy;let arr=grid.get(k);if(!arr){arr=[];grid.set(k,arr)}arr.push(c);
   if(limit>0&&result.length>=limit)break;
  }
  return {matches:result,examined,prefilter,cancelled:false};
 }
 function resultId(templateId,m){return `${templateId}:p${m.page}:x${m.x}:y${m.y}`}
 const api={makeTemplate,searchPage,compare,chooseAnchors,resultId};
 root.GlyphManualMatch=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof self!=='undefined'?self:globalThis);
