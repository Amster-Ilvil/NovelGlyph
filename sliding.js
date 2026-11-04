/* NovelGlyph Web 0.2: non-OCR, segmentation-independent rolling window evidence.
 * Windows are NOT glyphs. A hash coincidence is never treated as an exact
 * match until the corresponding original pixels are compared at 3 thresholds.
 */
(function(root){
 'use strict';
 const WIDTH=24,HEIGHT=24,BA=131,BB=257;
 const limits={minInk:38,maxInk:WIDTH*HEIGHT*.68,minRows:7,minCols:7};
 function classify(v){return v<160?3:v<185?2:v<210?1:0}
 function hex(n){return (n>>>0).toString(16).padStart(8,'0')}
 function rowSignature(gray,W,x,y,w){
  let a=2166136261>>>0,b=0x9e3779b9>>>0,ink=0,columns=0;
  for(let xx=0;xx<w;xx++){
   const q=classify(gray[y*W+x+xx]);
   a=Math.imul(a^q,16777619)>>>0;
   b=(Math.imul(b^q,2246822519)+3266489917)>>>0;
   if(q){ink++;columns|=(1<<xx)}
  }
  return {a,b,ink,columns};
 }
 function popcount(n){let c=0;while(n){n&=n-1;c++}return c}
 function hashRows(rows,start,h){let a=0,b=0;for(let j=0;j<h;j++){const r=rows[start+j];a=(Math.imul(a,BA)+r.a)>>>0;b=(Math.imul(b,BB)+r.b)>>>0}return {a,b}}
 function metric(rows,start,h){let ink=0,active=0,colmask=0;for(let j=0;j<h;j++){const row=rows[start+j];ink+=row.ink;active+=(row.ink>0?1:0);colmask|=row.columns}return {ink,rows:active,cols:popcount(colmask)}}
 function fingerprint(gray,W,H,x,y,w=WIDTH,h=HEIGHT){
  if(x<0||y<0||x+w>W||y+h>H||w>30)return null;
  const rows=[];for(let j=0;j<h;j++)rows.push(rowSignature(gray,W,x,y+j,w));
  const metrics=metric(rows,0,h);
  if(metrics.ink<limits.minInk||metrics.ink>limits.maxInk||metrics.rows<limits.minRows||metrics.cols<limits.minCols)return null;
  const {a,b}=hashRows(rows,0,h);
  return {key:`${w}x${h}-${hex(a)}-${hex(b)}`,...metrics};
 }
 function exactProof(grayA,WA,HA,a,grayB,WB,HB,b){
  if(!a||!b||a.w!==b.w||a.h!==b.h)return false;
  if(a.x<0||a.y<0||b.x<0||b.y<0||a.x+a.w>WA||b.x+b.w>WB||a.y+a.h>HA||b.y+b.h>HB)return false;
  for(let j=0;j<a.h;j++)for(let i=0;i<a.w;i++){
   if(classify(grayA[(a.y+j)*WA+a.x+i])!==classify(grayB[(b.y+j)*WB+b.x+i]))return false;
  }
  return true;
 }
 function slidingSeeds(gray,W,H,columns,opt={}){
  const stride=Math.max(2,Math.min(12,Math.floor(opt.stride||4)));
  const offsets=opt.offsets||[-2,0,2];
  const maxPage=Math.max(100,Math.min(100000,Math.floor(opt.maxPerPage||24000)));
  const seeds=[],stats={columns:0,examined:0,retained:0,thinColumns:0,truncated:false};
  const w=WIDTH,h=HEIGHT;
  const powA=(()=>{let p=1;for(let i=1;i<h;i++)p=Math.imul(p,BA)>>>0;return p})();
  const powB=(()=>{let p=1;for(let i=1;i<h;i++)p=Math.imul(p,BB)>>>0;return p})();
  for(let ci=0;ci<columns.length;ci++){
   const col=columns[ci];if(col.x1-col.x0<w+1||col.y1-col.y0<h){stats.thinColumns++;continue}
   stats.columns++;
   // Phase is anchored to actual ink, independent of OCR and fixed char boxes.
   let inkTop=-1;
   for(let y=col.y0;y<col.y1&&inkTop<0;y++)for(let x=col.x0;x<col.x1;x++)if(gray[y*W+x]<210){inkTop=y;break}
   if(inkTop<0||inkTop+h>col.y1)continue;
   const centered=Math.round((col.x0+col.x1-w)/2);
   const xs=[...new Set(offsets.map(d=>Math.min(col.x1-w,Math.max(col.x0,centered+d))))];
   for(const x of xs){
    const rows=[];for(let y=inkTop;y<col.y1;y++)rows.push(rowSignature(gray,W,x,y,w));
    let {a,b}=hashRows(rows,0,h);
    const maxStart=rows.length-h;
    for(let start=0;start<=maxStart;start++){
     if(start%stride===0){
      stats.examined++;
      const m=metric(rows,start,h);
      if(m.ink>=limits.minInk&&m.ink<=limits.maxInk&&m.rows>=limits.minRows&&m.cols>=limits.minCols){
       seeds.push({key:`${w}x${h}-${hex(a)}-${hex(b)}`,hashA:a,hashB:b,x,y:inkTop+start,w,h,column:ci+1,ink:m.ink});
       if(seeds.length>=maxPage){stats.retained=seeds.length;stats.truncated=true;return {seeds,stats}}
      }
     }
     if(start<maxStart){
      a=(Math.imul((a-Math.imul(rows[start].a,powA))>>>0,BA)+rows[start+h].a)>>>0;
      b=(Math.imul((b-Math.imul(rows[start].b,powB))>>>0,BB)+rows[start+h].b)>>>0;
     }
    }
   }
  }
  stats.retained=seeds.length;
  return {seeds,stats};
 }
 function createSeedIndex(config={}){
  const maxIndex=Math.max(200,Math.floor(config.maxIndex||400000));
  const keepPairs=Math.max(1,Math.min(1000,Math.floor(config.keepPairs||300)));
  const first=new Map(),repeated=new Map();
  const stats={examined:0,indexed:0,ignoredNewHashes:0,candidates:0,crossPageHashes:0,pages:0,scannedColumns:0,truncatedPages:0,notExactYet:true};
  function ingest(page,seeds,pageStats={}){
   stats.pages++;stats.scannedColumns+=(pageStats.columns||0);
   if(pageStats.truncated)stats.truncatedPages++;
   for(const s of seeds){
    stats.examined++;
    const prev=first.get(s.key);
    if(!prev){if(first.size<maxIndex){first.set(s.key,{...s,page});stats.indexed++}else stats.ignoredNewHashes++;continue}
    if(prev.page===page)continue;
    stats.candidates++;
    let pair=repeated.get(s.key);
    if(!pair){pair={key:s.key,first:prev,second:{...s,page},occurrences:2,status:'HASH_ONLY_NOT_EXACT'};repeated.set(s.key,pair)}
    else pair.occurrences++;
   }
  }
  function finish(){
   stats.crossPageHashes=repeated.size;
   const ranked=[...repeated.values()].sort((a,b)=>b.occurrences-a.occurrences);
   const selected=[],used=new Set(),bucketCounts=new Map();
   // A top-frequency-only sample is dominated by adjacent pixels of one kana.
   // Stratify DISPLAY/VERIFICATION examples by ink area without changing
   // the underlying matches, counts, safety threshold or Unicode policy.
   for(const cap of [3,6,12,Number.POSITIVE_INFINITY]){
    for(const pair of ranked){
     if(selected.length>=keepPairs)break;
     if(used.has(pair.key))continue;
     const bucket=Math.floor((pair.first.ink||0)/8);
     if((bucketCounts.get(bucket)||0)>=cap)continue;
     selected.push(pair);used.add(pair.key);bucketCounts.set(bucket,(bucketCounts.get(bucket)||0)+1);
    }
    if(selected.length>=keepPairs)break;
   }
   return {pairs:selected,stats:{...stats}};
  }
  return {ingest,finish};
 }
 function createCompactSeedIndex(config={}){
  // Each raw 24x24 sliding-window occurrence occupies 16 bytes in typed arrays.
  // Unlike a capped Map of distinct fingerprints, this sorts ALL sampled seeds
  // (unless explicit maxTotal is reached), so late-book unique shapes are kept.
  const maxTotal=Math.max(1000,Math.floor(config.maxTotal||6000000));
  const retainAudit=!!config.retainAudit;
  const keepPairs=Math.max(1,Math.min(1000,Math.floor(config.keepPairs||300)));
  let capacity=Math.min(250000,maxTotal),count=0;
  let hi=new Uint32Array(capacity),lo=new Uint32Array(capacity);
  let pages=new Uint16Array(capacity),cols=new Uint16Array(capacity);
  let xs=new Uint16Array(capacity),ys=new Uint16Array(capacity),ink=new Uint16Array(capacity);
  const stats={examined:0,indexed:0,ignoredNewHashes:0,seedLimitDropped:0,
    candidates:0,crossPageHashes:0,pages:0,scannedColumns:0,truncatedPages:0,notExactYet:true,compact:true};
  function grow(){
   if(count>=maxTotal)return false;
   const n=Math.min(maxTotal,Math.ceil(capacity*1.7));
   function resize(T,old){const next=new T(n);next.set(old);return next}
   hi=resize(Uint32Array,hi);lo=resize(Uint32Array,lo);
   pages=resize(Uint16Array,pages);cols=resize(Uint16Array,cols);
   xs=resize(Uint16Array,xs);ys=resize(Uint16Array,ys);ink=resize(Uint16Array,ink);
   capacity=n;return true;
  }
  function ingest(page,seeds,pageStats={}){
   stats.pages++;stats.scannedColumns+=(pageStats.columns||0);
   if(pageStats.truncated)stats.truncatedPages++;
   for(const s of seeds){
    stats.examined++;
    if(page>65535||s.x>65535||s.y>65535||s.column>65535){stats.seedLimitDropped++;continue}
    if(count>=capacity&&!grow()){stats.seedLimitDropped++;continue}
    let a=s.hashA,b=s.hashB;
    if(a===undefined||b===undefined){const parts=s.key.split('-');a=parseInt(parts[1],16);b=parseInt(parts[2],16)}
    if(!Number.isFinite(a)||!Number.isFinite(b)){stats.seedLimitDropped++;continue}
    hi[count]=a>>>0;lo[count]=b>>>0;pages[count]=page;
    cols[count]=s.column;xs[count]=s.x;ys[count]=s.y;ink[count]=s.ink||0;
    count++;
   }
  }
  function finish(){
   if(!count)return {pairs:[],stats:{...stats,storedSeeds:0}};
   let current=new Uint32Array(count),next=new Uint32Array(count);
   for(let i=0;i<count;i++)current[i]=i;
   // Four stable 16-bit counting-sort passes -> 64-bit fingerprint order.
   for(let pass=0;pass<4;pass++){
    const keys=pass<2?lo:hi,shift=pass%2?16:0;
    const bins=new Uint32Array(65536);
    for(let i=0;i<count;i++)bins[(keys[current[i]]>>>shift)&65535]++;
    let sum=0;for(let i=0;i<bins.length;i++){const n=bins[i];bins[i]=sum;sum+=n}
    for(let i=0;i<count;i++){
     const idx=current[i],bucket=(keys[idx]>>>shift)&65535;
     next[bins[bucket]++]=idx;
    }
    const swap=current;current=next;next=swap;
   }
   const repeated=[];
   function loc(i){return {page:pages[i],column:cols[i],x:xs[i],y:ys[i],w:WIDTH,h:HEIGHT,ink:ink[i]}}
   let distinct=0;
   for(let start=0;start<count;){
    const first=current[start];let end=start+1;
    while(end<count&&hi[current[end]]===hi[first]&&lo[current[end]]===lo[first])end++;
    distinct++;
    if(end-start>=2){
     // The first two pages are a poor proxy for a whole book: use quarter
     // and three-quarter positions from the stable ingest/page order. This
     // spreads full-shape audits through the book; fall back to extremes if
     // those quantiles happen to be on the same page.
     const extent=end-start;
     const early=current[start+Math.floor((extent-1)*.25)];
     const late=current[start+Math.floor((extent-1)*.75)];
     let left=early,right=late;
     if(pages[left]===pages[right]){left=first;right=current[end-1]}
     if(pages[left]!==pages[right]){
      const key=`${WIDTH}x${HEIGHT}-${hex(hi[first])}-${hex(lo[first])}`;
      repeated.push({key,first:loc(left),second:loc(right),occurrences:extent,status:'HASH_ONLY_NOT_EXACT'});
      stats.candidates+=extent;
     }
    }
    start=end;
   }
   stats.indexed=distinct;stats.crossPageHashes=repeated.length;stats.storedSeeds=count;
   repeated.sort((a,b)=>b.occurrences-a.occurrences);
   const selected=[],used=new Set(),usedContexts=new Set(),bucketCounts=new Map();
   for(const cap of [3,6,12,Number.POSITIVE_INFINITY]){
    for(const pair of repeated){
     if(selected.length>=keepPairs)break;
     if(used.has(pair.key))continue;
     // Adjacent overlapping 24px windows often refer to the SAME printed
     // symbol. Never burn the entire audit budget on shifted duplicates.
     const a=pair.first,b=pair.second;
     const context=`${a.page}/${a.column}/${Math.floor(a.y/48)}|${b.page}/${b.column}/${Math.floor(b.y/48)}`;
     if(usedContexts.has(context))continue;
     const bucket=Math.floor(pair.first.ink/8);
     if((bucketCounts.get(bucket)||0)>=cap)continue;
     selected.push(pair);used.add(pair.key);usedContexts.add(context);bucketCounts.set(bucket,(bucketCounts.get(bucket)||0)+1);
    }
    if(selected.length>=keepPairs)break;
   }
   // A compact, exhaustive catalog of one *unverified* cross-page candidate
   // per repeated hash. 11 uint32 values per record (44 B). No images or
   // Unicode are stored in this catalog. Its byte order is little endian.
   let audit=null;
   if(retainAudit){
    const words=new Uint32Array(repeated.length*11);
    for(let k=0;k<repeated.length;k++){
     const p=repeated[k],v=p.key.split('-'),q=k*11;
     words[q]=parseInt(v[1],16)>>>0;words[q+1]=parseInt(v[2],16)>>>0;
     words[q+2]=p.first.page;words[q+3]=p.first.column;
     words[q+4]=p.first.x;words[q+5]=p.first.y;
     words[q+6]=p.second.page;words[q+7]=p.second.column;
     words[q+8]=p.second.x;words[q+9]=p.second.y;
     words[q+10]=p.occurrences;
    }
    audit={format:'NovelGlyph-SeedCatalog-u32x11-v1',words};
   }
   return {pairs:selected,stats:{...stats},audit};
  }
  return {ingest,finish};
 }
 function overlapSeedCandidates(seedPages,config={}){const idx=createSeedIndex(config);seedPages.forEach((seeds,page)=>idx.ingest(page,seeds));return idx.finish()}
 root.GlyphSliding={fingerprint,exactProof,slidingSeeds,createSeedIndex,createCompactSeedIndex,overlapSeedCandidates,config:{width:WIDTH,height:HEIGHT}};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.GlyphSliding;
})(typeof self!=='undefined'?self:globalThis);
