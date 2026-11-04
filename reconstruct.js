/* NovelGlyph Web 0.5: conservative, auditable vertical reading-order reconstruction.
   This module NEVER guesses Unicode, infers missing glyphs from OCR, or edits image pixels.
   Regions are physically observed intervals. A same-shape group label is used only after
   human approval; ambiguously encoded glyphs and risky intervals require per-place approval. */
(function(root){
'use strict';
const GLYPH_AMBIGUOUS=new Set(['力','カ','エ','工','一','ー','口','ロ','二','ニ','八','ハ','夕','タ','へ','ヘ','り','リ','卜','ト','十','＋','０','〇','○','。','・','･']);
const UNSAFE_BOUNDARIES=new Set(['LONG_UNSPLIT','WIDE_COLUMN','INTERNAL_REAL_GAP','MANUAL_BOUNDARY_EDIT_UNVERIFIED']);
const MARK='□';
function oneGlyph(value){
 if(typeof value!=='string'||!value.trim())return false;
 try{return [...new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(value)].length===1}
 catch(_){return Array.from(value).length===1}
}
function keyOf(page,r){return `v1:${page}:${r.column}:${r.x0},${r.y0},${r.x1},${r.y1}:${r.groupId||''}`}
function validRegion(r){return r&&[r.x0,r.y0,r.x1,r.y1,r.column].every(Number.isFinite)&&r.x1>r.x0&&r.y1>r.y0&&Number.isInteger(r.column)}
function riskList(r){return Array.isArray(r.risk)?r.risk:(r.risk?[r.risk]:[])}
function reconstruct(pageRegions,groups,overrides=new Map(),pageNames=[]){
 const index=groups instanceof Map?groups:new Map((groups||[]).map(g=>[g.id,g]));
 const edits=overrides instanceof Map?overrides:new Map(overrides||[]);
 const physical=pageRegions instanceof Map?pageRegions:new Map(pageRegions||[]);
 const pages=[];const totals={sourceIntervals:0,confirmed:0,manualOverrides:0,unresolved:0,ambiguous:0,risky:0,rejected:0,overlap:0,missingGroup:0,invalid:0};
 const nums=[...physical.keys()].map(Number).filter(Number.isInteger);
 const n=Math.max(pageNames.length,nums.length?Math.max(...nums)+1:0);
 for(let page=0;page<n;page++){
  const raw=physical.get(page)||physical.get(String(page))||[];
  const byColumn=new Map();const extras=[];
  raw.forEach((r,pos)=>{
   totals.sourceIntervals++;
   const token={page,pos,region:r,key:keyOf(page,r),unicode:null,status:'unresolved',source:'none'};
   if(!validRegion(r)){token.status='invalid';extras.push(token);return}
   if(!byColumn.has(r.column))byColumn.set(r.column,[]);
   byColumn.get(r.column).push(token);
  });
  // Physical x ordering is authoritative; column numbering is only an audit reference.
  const columns=[...byColumn.entries()].map(([number,items])=>{
   items.sort((a,b)=>a.region.y0-b.region.y0||a.region.x0-b.region.x0||a.pos-b.pos);
   const overlaps=new Set();let active=null;
   for(const item of items){
    if(active&&item.region.y0<active.region.y1){overlaps.add(active);overlaps.add(item)}
    if(!active||item.region.y1>active.region.y1)active=item;
   }
   for(const item of items){
    const r=item.region,g=index.get(r.groupId),edit=edits.get(item.key);
    if(overlaps.has(item)){item.status='overlap';continue}
    if(edit?.verified_by==='human'&&edit.groupId===r.groupId&&edit.shapeKey===r.key&&oneGlyph(edit.unicode)&&edit.status==='confirmed'){
      item.status='manualOverrides';item.unicode=edit.unicode;item.source='HUMAN_OCCURRENCE';continue;
    }
    if(!g){item.status='missingGroup';continue}
    if(g.status==='rejected'){item.status='rejected';continue}
    if(riskList(r).some(risk=>UNSAFE_BOUNDARIES.has(risk))){item.status='risky';continue}
    if(g.status!=='confirmed'||!oneGlyph(g.label)){item.status='unresolved';continue}
    if(GLYPH_AMBIGUOUS.has(g.label)){item.status='ambiguous';continue}
    item.status='confirmed';item.unicode=g.label;item.source='HUMAN_GROUP_APPROVAL';
   }
   const x=Math.max(...items.map(i=>i.region.x1));
   return {number,x,items,text:items.map(i=>i.unicode??MARK).join('')};
  }).sort((a,b)=>b.x-a.x||a.number-b.number);
  for(const col of columns)for(const item of col.items)totals[item.status]++;
  for(const item of extras)totals.invalid++;
  pages.push({page,name:pageNames[page]||`第 ${page+1} 页`,columns,extras,counts:{confirmed:columns.reduce((s,c)=>s+c.items.filter(i=>i.unicode).length,0),total:raw.length},text:columns.map(c=>c.text).join('\n')});
 }
 totals.coverage=totals.sourceIntervals?((totals.confirmed+totals.manualOverrides)/totals.sourceIntervals):0;
 totals.unresolvedAll=totals.sourceIntervals-totals.confirmed-totals.manualOverrides;
 return {format:'NovelGlyph-Transcription-Draft-v1',pages,totals,unknownMarker:MARK,warning:'候选物理区段未经过全文金标验证。□ 表示缺失或不安全的位置；列和页面的阅读顺序需要人工复核。'};
}
function textDraft(draft){return draft.pages.map(p=>`〔第 ${p.page+1} 页｜${p.name}〕\n${p.text}`).join('\n\n')}
function jsonDraft(draft){return {format:draft.format,warning:draft.warning,unknownMarker:draft.unknownMarker,totals:draft.totals,pages:draft.pages.map(p=>({page:p.page,name:p.name,columns:p.columns.map(c=>({column:c.number,text:c.text,items:c.items.map(i=>({key:i.key,status:i.status,unicode:i.unicode,source:i.source,group_id:i.region.groupId,rect:[i.region.x0,i.region.y0,i.region.x1,i.region.y1],risk:riskList(i.region)}))})),invalid:p.extras.map(i=>({key:i.key,status:i.status}))}))}}
root.GlyphTranscript={reconstruct,textDraft,jsonDraft,keyOf,oneGlyph,GLYPH_AMBIGUOUS,UNSAFE_BOUNDARIES};
if(typeof module!=='undefined'&&module.exports)module.exports=root.GlyphTranscript;
})(typeof self!=='undefined'?self:globalThis);
