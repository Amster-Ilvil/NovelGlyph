/* NovelGlyph 1.2 — optional, local-only OCR evidence bridge.
 * No OCR models executed. Imports external per-glyph coordinates, resolves to
 * physical candidates, and builds a conservative review queue. OCR NEVER writes
 * verified occurrence Unicode nor approves a shape group.
 */
(function(root){
'use strict';
const T=root.GlyphTranscript||((typeof require!=='undefined')?require('./reconstruct.js'):null);
const D=root.GlyphDiscovery||((typeof require!=='undefined')?require('./discovery.js'):null);
const MAX_ITEMS=300000, TILE=48;
function goodRect(a){return Array.isArray(a)&&a.length===4&&a.every(Number.isFinite)&&a[2]>a[0]&&a[3]>a[1]}
function iou(a,b){const ix=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0])),iy=Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));const i=ix*iy;
 return i/((a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-i||1);
}
function positions(book){const perPage=new Map();for(const p of book.pages){const grid=new Map();for(const o of p.occurrences){const a=o.rect;if(!goodRect(a))continue;for(let y=Math.floor(a[1]/TILE);y<=Math.floor((a[3]-1)/TILE);y++)for(let x=Math.floor(a[0]/TILE);x<=Math.floor((a[2]-1)/TILE);x++){
 const key=x+','+y;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(o);
 }}perPage.set(p.page,{p,grid});}return perPage;}
function importOCR(book,doc,{minimumIoU=.60}={}){
 if(!doc||doc.format!=='NovelGlyph-OCR-Evidence-v1'||!Array.isArray(doc.items))throw Error('OCR JSON 格式应为 NovelGlyph-OCR-Evidence-v1，items 为单字坐标数组');
 const source=String(doc.source||'').trim();if(!/^[\w.\-]{1,64}$/.test(source))throw Error('source 请填写稳定的 OCR 模型标识（英文字母/数字/._-）');
 if(doc.items.length>MAX_ITEMS)throw Error('单次导入超过 30 万条；请按书页分批整理，并使用不同 source 标识');
 if(!Number.isFinite(minimumIoU)||minimumIoU<.5||minimumIoU>1)throw Error('最小重合比例无效');
 // Validate entire imported file before destructive replacement of a source.
 const clean=[];let invalid=0;for(const x of doc.items){
  if(!x||!Number.isInteger(x.page)||x.page<0||!goodRect(x.rect)||!T.oneGlyph(x.unicode)||!Number.isFinite(x.confidence)||x.confidence<0||x.confidence>1){invalid++;continue}
  clean.push({page:x.page,rect:x.rect,unicode:x.unicode,confidence:x.confidence});
 }
 const index=positions(book),byTarget=new Map();const stats={source,records:doc.items.length,valid:clean.length,invalid,linked:0,unmatched:0,ambiguous:0,duplicates:0,conflictingDuplicates:0};
 for(const e of clean){const target=index.get(e.page);if(!target){stats.unmatched++;continue}
  const {p,grid}=target;if(e.rect[0]<0||e.rect[1]<0||e.rect[2]>p.width||e.rect[3]>p.height){stats.unmatched++;continue}
  const nearby=new Set();for(let y=Math.floor(e.rect[1]/TILE);y<=Math.floor((e.rect[3]-1)/TILE);y++)for(let x=Math.floor(e.rect[0]/TILE);x<=Math.floor((e.rect[2]-1)/TILE);x++)for(const o of grid.get(x+','+y)||[])nearby.add(o);
  let best=null,runner=0;for(const o of nearby){const score=iou(e.rect,o.rect);if(!best||score>best.score){runner=best?.score||0;best={o,score}}else if(score>runner)runner=score}
  if(!best||best.score<minimumIoU){stats.unmatched++;continue}
  if(runner>.8*best.score){stats.ambiguous++;continue}
  const id=best.o.id;if(!byTarget.has(id))byTarget.set(id,[]);byTarget.get(id).push({...e,source,matchedIoU:best.score});stats.linked++;
 }
 // Replace this source *atomically*; duplicate records for one slot are not votes.
 const dup=new Set();for(const [id,records] of byTarget){if(records.length>1){dup.add(id);stats.duplicates+=records.length;stats.conflictingDuplicates+=new Set(records.map(r=>r.unicode)).size>1?1:0;}}
 for(const p of book.pages)for(const o of p.occurrences){if(o.ocrEvidence)o.ocrEvidence=o.ocrEvidence.filter(e=>e.source!==source);const matched=byTarget.get(o.id)||[];
  if(!dup.has(o.id)&&matched.length)o.ocrEvidence=(o.ocrEvidence||[]).concat(matched);
 }
 stats.stored=stats.linked-stats.duplicates;stats.sourceReplaced=true;book.revision++;return stats;
}
function review(book,{minConfidence=.85,minPages=2}={}){
 const sourceSet=new Set(),sources=new Map();const groupIndex=new Map(book.groups.map(g=>[g.id,g]));const aggs=new Map();const totals={pages:book.pages.length,positions:0,ocrEvidence:0,positionsWithEvidence:0,multiModelAgreement:0,multiModelDisagreement:0,humanConflicts:0,unmatchedRisk:0,eligibleCandidates:0};
 for(const p of book.pages)for(const o of p.occurrences){totals.positions++;
  const evidence=(o.ocrEvidence||[]).filter(e=>e&&T.oneGlyph(e.unicode)&&typeof e.source==='string'&&Number.isFinite(e.confidence));
  totals.ocrEvidence+=evidence.length;if(evidence.length)totals.positionsWithEvidence++;
  for(const e of evidence){sourceSet.add(e.source);sources.set(e.source,(sources.get(e.source)||0)+1)}
  const g=groupIndex.get(o.groupId);if(!g)continue;
  let agg=aggs.get(g.id);if(!agg){agg={id:g.id,label:g.unicode||'',approved:g.approved,positions:0,clean:0,unsafe:0,pages:new Set(),sourceSet:new Set(),votes:new Map(),consensusLocations:0,contradictions:0,individualDisagreements:0,manualConflicts:0};aggs.set(g.id,agg)}
  agg.positions++;agg.pages.add(p.page);const safe=o.kind==='body'&&!o.risk.length&&!o.edited;
  if(safe)agg.clean++;else agg.unsafe++;
  const confident=evidence.filter(e=>e.confidence>=minConfidence);
  const byUnicode=new Map();for(const e of confident){let s=byUnicode.get(e.unicode);if(!s){s=new Set();byUnicode.set(e.unicode,s)}s.add(e.source);agg.sourceSet.add(e.source)}
  if(byUnicode.size>1){agg.individualDisagreements++;totals.multiModelDisagreement++}
  const consensus=[...byUnicode].filter(([_,s])=>s.size>=2);
  if(consensus.length===1&&byUnicode.size===1){totals.multiModelAgreement++;if(safe){const [u]=consensus[0];let vote=agg.votes.get(u);if(!vote){vote={positions:0,pages:new Set(),sources:new Set()};agg.votes.set(u,vote)}vote.positions++;vote.pages.add(p.page);for(const s of byUnicode.get(u))vote.sources.add(s);agg.consensusLocations++;}}
  // Even a single independent model disagreeing at high confidence must force
  // manual conflict review; it cannot silently be discarded by majority vote.
  if(byUnicode.size>1)agg.contradictions++;
  if(o.verified&&T.oneGlyph(o.unicode)){
   if(g.approved&&g.unicode!==o.unicode)agg.manualConflicts++;
   if([...byUnicode.keys()].some(u=>u!==o.unicode))agg.manualConflicts++;
  }
 }
 const queue=[];for(const agg of aggs.values()){
  const g=groupIndex.get(agg.id),voteList=[...agg.votes].sort((a,b)=>b[1].positions-a[1].positions);
  const primary=voteList[0],uniqueVote=voteList.length===1;const contradictory=agg.contradictions>0||agg.manualConflicts>0||voteList.length>1;
  const suggested=(primary&&uniqueVote&&!contradictory&&primary[1].positions>=2&&primary[1].pages.size>=minPages&&primary[1].sources.size>=2&&!T.GLYPH_AMBIGUOUS.has(primary[0]))?primary[0]:'';
  const flags=[];if(agg.manualConflicts)flags.push('人工确认/组标签/OCR冲突');if(agg.contradictions)flags.push('OCR读法分歧');if(voteList.length>1)flags.push('跨位置异码');if(agg.unsafe)flags.push('部分候选边界/Ruby待审');if(primary&&T.GLYPH_AMBIGUOUS.has(primary[0]))flags.push('同形异码逐位置核对');
  if(suggested)totals.eligibleCandidates+=agg.clean;
  queue.push({id:agg.id,count:agg.positions,clean:agg.clean,unsafe:agg.unsafe,pages:agg.pages.size,modelCount:agg.sourceSet.size,suggested,support:primary?.[1]?.positions||0,independentPages:primary?.[1]?.pages.size||0,manualConflicts:agg.manualConflicts,disagreements:agg.contradictions,flags,approved:!!g.approved,approvedLabel:g.unicode||'',suggestedReviewOnly:true});
 }
 queue.sort((a,b)=>((b.manualConflicts+b.disagreements)-(a.manualConflicts+a.disagreements))*100000||Number(!!b.suggested)-Number(!!a.suggested)||b.count-a.count);
 const safe=queue.filter(q=>q.suggested&&!q.approved);const maxReviewSavings=safe.reduce((n,q)=>n+Math.max(0,q.clean-1),0);
 return {format:'NovelGlyph-Hybrid-Audit-v1',warning:'OCR读数只用于人工复核排序。建议不等于真实字、正确切分或自动传播。人工工作量节省是单组一次审核的理论上限，非实际耗时。',sources:[...sources].sort((a,b)=>a[0].localeCompare(b[0])).map(([name,observations])=>({name,observations})),totals:{...totals,groupCount:queue.length,reviewSuggestions:safe.length,theoreticalUpperBoundSavedPositionReviews:maxReviewSavings},queue};
}
function clear(book,source=null){if(source!==null&&(!/^[\w.\-]{1,64}$/.test(source)))throw Error('OCR 来源名不合法');let removed=0;for(const p of book.pages)for(const o of p.occurrences){const current=o.ocrEvidence||[];const remain=source===null?[]:current.filter(e=>e.source!==source);removed+=current.length-remain.length;if(remain.length)o.ocrEvidence=remain;else delete o.ocrEvidence;}book.revision++;return removed}
const api={importOCR,review,clear,iou};root.GlyphHybrid=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof self!=='undefined'?self:globalThis);
