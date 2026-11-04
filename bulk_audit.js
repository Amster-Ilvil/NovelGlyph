/* NovelGlyph Web v0.4 -- complete *candidate-pair* audit, no OCR.
 * Each catalog record is one representative cross-page 24x24 window pair
 * per repeated fingerprint. It is NOT every occurrence in every book.
 * A repeated fragment does not prove an independently identified character.
 * All classification uses three grayscale thresholds 160/185/210.
 */
(function(root){
 'use strict';
 const STRIDE=11, W=24, H=24, BYTES=W*H/4;
 function count(words){if(!(words instanceof Uint32Array)||words.length%STRIDE)throw Error('Invalid audit catalog');return words.length/STRIDE}
 function loc(words,i,side){const k=i*STRIDE+(side?6:2);return {page:words[k],column:words[k+1],x:words[k+2],y:words[k+3],w:W,h:H}}
 function makeRequests(words,pageCount){const groups=Array.from({length:pageCount},()=>[]);const n=count(words);
  for(let i=0;i<n;i++)for(let side=0;side<2;side++){const p=words[i*STRIDE+2+side*4];if(p<pageCount)groups[p].push(i*2+side)}
  return groups;
 }
 function makeSession(words,pageCount){const n=count(words);return {format:'NovelGlyph-BulkAudit-v1',words,
  proofs:new Uint8Array(n*2*BYTES),valid:new Uint8Array(n*2),regions:new Uint32Array(n*2),
  statuses:new Uint8Array(n),pageCursor:0,complete:false,summary:null,links:[],pageCount};}
 function packWindow(gray,sourceWidth,sourceHeight,x,y,target,offset){
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x+W>sourceWidth||y+H>sourceHeight||gray.length!==sourceWidth*sourceHeight)return false;
  for(let j=0;j<H;j++){
   let src=(y+j)*sourceWidth+x;
   for(let i=0;i<W;i++){
    const v=gray[src+i],q=v<160?3:v<185?2:v<210?1:0,p=j*W+i;
    target[offset+(p>>>2)]|=q<<((p&3)*2);
   }
  }
  return true;
 }
 function blankRow(gray,W,y,x0,x1){for(let x=x0;x<x1;x++)if(gray[y*W+x]<210)return false;return true}
 function qualifiesFullRegion(r,col,gray,W,H){
  if(!r||!col||r.column!==undefined&&r.column<1)return false;
  const p=r.pitch||col.pitch||Math.max(12,col.x1-col.x0),height=r.y1-r.y0;
  if(r.risk?.some(k=>['WIDE_COLUMN','LONG_UNSPLIT','INTERNAL_REAL_GAP'].includes(k)))return false;
  if(height<p*.55||height>p*1.48||r.w<p*.22||r.w>p*1.35)return false;
  const [x0,y0,x1,y1]=r.rect||[];
  if(x0<col.x0||x1>col.x1||y0-col.y0<2||col.y1-y1<2||y1<=y0||x1<=x0)return false;
  // Require independently visible 2-pixel empty rows both ABOVE and BELOW
  // the *tight ink crop*; any Ruby mixed into the column can still be risk.
  for(const y of [y0-2,y0-1,y1,y1+1])if(!blankRow(gray,W,y,col.x0,col.x1))return false;
  return true;
 }
 function makeRegionLookup(regions){const byCol=new Map();for(const reg of regions||[]){const k=reg.column;if(!byCol.has(k))byCol.set(k,[]);byCol.get(k).push(reg)}
  for(const rows of byCol.values())rows.sort((a,b)=>a.y0-b.y0);return byCol}
 function enclosingRegion(lookup,column,x,y){const regs=lookup.get(column)||[];
  // V0.4 bounds depend on observed projection intervals, never on OCR char counts.
  let lo=0,hi=regs.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(regs[mid].y0<=y)lo=mid+1;else hi=mid}
  for(let i=lo-1;i>=Math.max(0,lo-3);i--){const r=regs[i];if(r.y0<=y&&r.y1>=y+H&&r.x0<=x&&r.x1>=x+W)return r}return null;
 }
 function ingestPage(session,page,gray,width,height,reqs,regions,columns,groupIds){
  if(session.complete||page!==session.pageCursor)throw Error('Audit out-of-order page');
  const byCol=makeRegionLookup(regions),valid=session.valid,proofs=session.proofs,group=session.regions;
  let requests=0,validCount=0,fullCand=0;
  for(const id of reqs){requests++;const pair=Math.floor(id/2),side=id%2,l=loc(session.words,pair,side);
   if(!packWindow(gray,width,height,l.x,l.y,proofs,id*BYTES))continue;
   valid[id]=1;validCount++;
   const r=enclosingRegion(byCol,l.column,l.x,l.y);
   if(!r)continue;
   const c=columns?.[l.column-1];
   if(c&&qualifiesFullRegion(r,c,gray,width,height)){
    group[id]=groupIds.get(r.groupId)||0;if(group[id])fullCand++;
   }
  }
  session.pageCursor++;
  return {requests,valid:validCount,isolatedCandidates:fullCand,nextPage:session.pageCursor};
 }
 function finalize(session,groupIds){
  if(session.pageCursor!==session.pageCount)throw Error('Complete remaining pages before finalization');
  const n=count(session.words),stats={catalogPairs:n,checked:n,pixelExact:0,hashMismatch:0,invalid:0,
   isolatedDualPage:0,fullShapePairs:0,distinctFullShapeGroups:0,semanticGoldLabels:0},links=new Map();
  for(let i=0;i<n;i++){
   const left=i*2,right=left+1;
   if(!session.valid[left]||!session.valid[right]){session.statuses[i]=4;stats.invalid++;continue}
   let equals=true;let a=left*BYTES,b=right*BYTES;
   for(let j=0;j<BYTES;j++)if(session.proofs[a+j]!==session.proofs[b+j]){equals=false;break}
   if(!equals){session.statuses[i]=3;stats.hashMismatch++;continue}
   stats.pixelExact++;session.statuses[i]=1;
   const g=session.regions[left];if(g&&g===session.regions[right]){
    stats.isolatedDualPage++;stats.fullShapePairs++;session.statuses[i]=2;
    if(!links.has(g))links.set(g,{groupIndex:g,pairs:0,samples:[]});const x=links.get(g);x.pairs++;if(x.samples.length<3)x.samples.push(i);
   }
  }
  const inverse=new Map([...groupIds].map(([id,v])=>[v,id]));
  session.links=[...links.values()].map(x=>({...x,groupId:inverse.get(x.groupIndex)})).filter(x=>x.groupId);
  session.links.sort((a,b)=>b.pairs-a.pairs);stats.distinctFullShapeGroups=session.links.length;
  session.complete=true;session.summary=stats;
  // The 2-bit proofs are temporary and not persisted for completed audits.
  session.proofs=null;session.valid=null;session.regions=null;
  return stats;
 }
 root.GlyphBulk={count,loc,makeRequests,makeSession,packWindow,qualifiesFullRegion,makeRegionLookup,enclosingRegion,ingestPage,finalize,bytesPerWindow:BYTES};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.GlyphBulk;
})(typeof self!=='undefined'?self:globalThis);
