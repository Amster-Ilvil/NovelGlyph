/* NovelGlyph Web - deterministic pixel projection and three-threshold group engine.
   No OCR, fixed-size glyph grid, external requests or Unicode assignment. */
(function(root){
 'use strict';
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 function grayFromRGBA(data,width,height){const gray=new Uint8Array(width*height);for(let i=0,j=0;i<data.length;i+=4,j++){gray[j]=Math.round(.299*data[i]+.587*data[i+1]+.114*data[i+2]);}return gray}
 function runsOfPositive(vec,start,end,threshold,maxBlank){const out=[];let begin=-1,last=-1;
  for(let i=start;i<end;i++){if(vec[i]>=threshold){if(begin<0)begin=i;last=i}else if(begin>=0&&i-last>maxBlank){out.push([begin,last+1]);begin=-1;last=-1}}
  if(begin>=0)out.push([begin,last+1]);return out;
 }
 function median(a){if(!a.length)return 0;const z=[...a].sort((x,y)=>x-y);return z[Math.floor(z.length/2)]}
 function toBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s)}
 function fnv32(bytes,seed){let hash=seed>>>0;for(let i=0;i<bytes.length;i++){hash^=bytes[i];hash=Math.imul(hash,16777619)>>>0}return hash.toString(16).padStart(8,'0')}
 function signature(gray,W,x0,x1,y0,y1){
  // Tight ink crop at threshold 210, not an arbitrary fixed font box.
  let minX=x1,minY=y1,maxX=x0,maxY=y0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){if(gray[y*W+x]<210){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}}
  if(maxX<minX)return null;
  const w=maxX-minX+1,h=maxY-minY+1,n=w*h;
  if(n>16000)return null;
  const bits=new Uint8Array(Math.ceil(n/8)*3),size=Math.ceil(n/8);
  let ink=[0,0,0];for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
   const idx=(y-minY)*w+(x-minX),v=gray[y*W+x],byte=idx>>3,bit=1<<(idx&7);
   if(v<160){bits[byte]|=bit;ink[0]++}if(v<185){bits[size+byte]|=bit;ink[1]++}if(v<210){bits[2*size+byte]|=bit;ink[2]++}
  }
  const sizeBytes=new Uint8Array([w&255,(w>>8)&255,h&255,(h>>8)&255]);
  const proof=toBase64(bits);const h1=fnv32(bits,2166136261),h2=fnv32(sizeBytes,2166136261);
  return {rect:[minX,minY,maxX+1,maxY+1],width:w,height:h,ink,proof,key:`${w}x${h}-${h1}-${h2}`}
 }
 function findColumns(gray,W,H,opts={}){
  const r=opts.roi||[.07,.055,.94,.955],x0=clamp(Math.floor(r[0]*W),0,W-1),x1=clamp(Math.ceil(r[2]*W),1,W),
        y0=clamp(Math.floor(r[1]*H),0,H-1),y1=clamp(Math.ceil(r[3]*H),1,H);
  const histogram=new Uint32Array(W),threshold=opts.threshold||185;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(gray[y*W+x]<threshold)histogram[x]++;
  const low=Math.max(5,Math.round((y1-y0)*.012));
  const raw=runsOfPositive(histogram,x0,x1,low,Math.max(2,opts.colGap||5));
  const widths=raw.map(x=>x[1]-x[0]).filter(w=>w>=6&&w<Math.min(160,W*.20));const typical=median(widths)||Math.max(16,Math.round(W*.035));
  const columns=[];
  for(const [a,b] of raw){const w=b-a; if(w<Math.max(3,typical*.16))continue;
   const risky=w>Math.max(typical*2.3,125);
   // Never interpret a huge page art strip as a normal text column.
   if(w>Math.max(typical*4,W*.18))continue;
   columns.push({x0:a,x1:b,y0,y1,risk:risky?'WIDE_COLUMN':'',pitch:Math.max(12,Math.round(typical*1.03))});
  }
  return columns.sort((a,b)=>b.x0-a.x0);
 }
 function projectColumn(gray,W,H,col,opts={}){
  const {x0,x1,y0,y1}=col,thr=opts.threshold||185,pitch=col.pitch;
  const hist=new Uint16Array(H),histWeak=new Uint16Array(H);
  for(let y=y0;y<y1;y++){let dark=0,weak=0;for(let x=x0;x<x1;x++){const g=gray[y*W+x];if(g<thr)dark++;if(g<210)weak++}hist[y]=dark;histWeak[y]=weak}
  const spans=runsOfPositive(histWeak,y0,y1,1,0);if(!spans.length)return {cuts:[],regions:[],hist};
  // A cut exists only in a real projection-zero gap. Internal gaps are hypotheses, not facts.
  const gaps=[];for(let j=0;j<spans.length-1;j++){let a=spans[j][1],b=spans[j+1][0];if(b-a>=Math.max(2,Math.round(pitch*.07)))gaps.push({y:Math.floor((a+b)/2),width:b-a})}
  let start=spans[0][0],end=spans.at(-1)[1];let cuts=[];
  // Retain small gaps as unresolved evidence; do not force a fixed n * pitch grid.
  for(const g of gaps){const len=g.y-start;const after=end-g.y;
   if(len<Math.max(7,pitch*.37) && g.width<Math.max(5,pitch*.21))continue;
   if(after<Math.max(6,pitch*.28) && g.width<Math.max(6,pitch*.24))continue;
   cuts.push(g);start=g.y;
  }
  const nodes=[spans[0][0],...cuts.map(g=>g.y),spans.at(-1)[1]],regions=[],cutSet=new Set(cuts.map(g=>g.y));
  let gapCursor=0;
  for(let i=0;i<nodes.length-1;i++){
    const a=nodes[i],b=nodes[i+1];if(b<=a)continue;
    const sig=signature(gray,W,x0,x1,a,b);if(!sig)continue;
    const ratio=(b-a)/pitch;
    const risks=[];if(ratio<.55)risks.push('SHORT_REGION');if(ratio>1.6)risks.push('LONG_UNSPLIT');
    if(sig.width<Math.max(5,pitch*.23))risks.push('NARROW_SYMBOL');
    if(i>0&&cuts[i-1].width<Math.max(4,pitch*.13))risks.push('WEAK_GAP');
    if(i<cuts.length&&cuts[i].width<Math.max(4,pitch*.13))risks.push('WEAK_GAP');
    if(col.risk)risks.push(col.risk);
    // Rejected real zero-ink valleys are not discarded: propose alternative
    // split positions but NEVER rewrite physical regions or Unicode from them.
    while(gapCursor<gaps.length&&gaps[gapCursor].y<=a)gapCursor++;
    const rejected=[];for(let gi=gapCursor;gi<gaps.length&&gaps[gi].y<b;gi++)if(!cutSet.has(gaps[gi].y))rejected.push(gaps[gi]);
    const alternatives=[];
    for(const gap of rejected.slice(0,12)){
     const left=signature(gray,W,x0,x1,a,gap.y);
     const right=signature(gray,W,x0,x1,gap.y,b);
     if(!left||!right)continue;
     alternatives.push({y:gap.y,gapWidth:gap.width,
        left:{key:left.key,proof:left.proof,w:left.width,h:left.height},
        right:{key:right.key,proof:right.proof,w:right.width,h:right.height},
        verified:false});
    }
    if(alternatives.length)risks.push('INTERNAL_REAL_GAP');
    regions.push({x0,y0:a,x1,y1:b,rect:sig.rect,key:sig.key,proof:sig.proof,w:sig.width,h:sig.height,ink:sig.ink[1],risk:[...new Set(risks)],alternatives,pitch,verified:false});
  }
  return {cuts,regions,hist};
 }
 function analyzeGray(gray,W,H,opts={}){
  const cols=findColumns(gray,W,H,opts),out=[],colSummary=[];
  for(let c=0;c<cols.length;c++){const col=cols[c],p=projectColumn(gray,W,H,col,opts);
   colSummary.push({...col,cuts:p.cuts.length,regions:p.regions.length});
   for(const reg of p.regions)out.push({...reg,column:c+1})}
  return {width:W,height:H,columns:colSummary,regions:out};
 }
 function checkProof(a,b){return a.key===b.key&&a.proof===b.proof}
 root.GlyphEngine={grayFromRGBA,findColumns,projectColumn,analyzeGray,signature,checkProof};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.GlyphEngine;
})(typeof self!=='undefined'?self:globalThis);
