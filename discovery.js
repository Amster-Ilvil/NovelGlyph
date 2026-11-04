/* NovelGlyph 1.1 — OCR-free candidate ledger, exact-shape dictionary, human edits.
 * A projection interval is not a guaranteed character.  Never silently assign
 * Unicode or suppress ruby.  All edits and uncertain positions remain auditable.
 */
(function(root){
'use strict';
const E=root.GlyphEngine||((typeof require!=='undefined')?require('./engine.js'):null);
const T=root.GlyphTranscript||((typeof require!=='undefined')?require('./reconstruct.js'):null);
const AMBIGUOUS=T.GLYPH_AMBIGUOUS;
const KINDS=new Set(['body','ruby','excluded','review']);
function validateRect(a,W,H){return Array.isArray(a)&&a.length===4&&a.every(Number.isFinite)&&a[0]>=0&&a[1]>=0&&a[2]<=W&&a[3]<=H&&a[2]>a[0]&&a[3]>a[1]}
function create(){return {format:'NovelGlyph-Discovery-v1',pages:[],groups:[],revision:0,nextRegion:1};}
function indexOf(book){return new Map(book.groups.map(g=>[g.shape+'|'+g.proof,g]));}
function assign(book,occ,sig,index){const key=sig.key+'|'+sig.proof;let group=index.get(key);
 if(!group){group={id:'S'+(book.groups.length+1),shape:sig.key,proof:sig.proof,unicode:'',approved:false};book.groups.push(group);index.set(key,group)}
 occ.groupId=group.id;return occ;
}
function addPage(book,page,gray,W,H,{roi=[.07,.05,.94,.95],threshold=185,colGap=5}={}){
 if(!Number.isInteger(page)||page<0||book.pages.some(p=>p.page===page))throw Error('页面编号重复或无效');
 const {columns,regions}=E.analyzeGray(gray,W,H,{roi,threshold,colGap});const widths=columns.map(c=>c.x1-c.x0).sort((a,b)=>a-b);const median=widths[Math.floor(widths.length/2)]||1;
 const idx=indexOf(book);const occurrences=[];
 for(const r of regions){
  const col=columns[r.column-1],width=col.x1-col.x0;
  const neighbor=columns.some(c=>c!==col&&(c.x1<=col.x0||c.x0>=col.x1)&&Math.min(Math.abs(c.x1-col.x0),Math.abs(c.x0-col.x1))<median*.75&&(c.x1-c.x0)>=median*.78);
  const rubySuspect=width<median*.65&&neighbor;
  // Preserve ruby-like source positions as review candidates. No silent exclusion.
  const kind='body';const tightHeight=r.rect[3]-r.rect[1];const risks=[...new Set([...r.risk.filter(t=>t!=='LONG_UNSPLIT'||tightHeight>Math.max(col.pitch*1.55, (r.rect[2]-r.rect[0])*1.8)),...(rubySuspect?['POSSIBLE_RUBY']:[])])];
  const occ={id:'R'+book.nextRegion++,page,column:r.column,rect:r.rect,span:[r.x0,r.y0,r.x1,r.y1],kind,risk:risks,unicode:'',verified:false,edited:false};
  assign(book,occ,r,idx);occurrences.push(occ);
 }
 book.pages.push({page,width:W,height:H,columns:columns.map(c=>({x0:c.x0,x1:c.x1,y0:c.y0,y1:c.y1})),occurrences});
 book.pages.sort((a,b)=>a.page-b.page);book.revision++;return {columns:columns.length,candidates:occurrences.length,rubySuspects:occurrences.filter(o=>o.risk.includes('POSSIBLE_RUBY')).length};
}
function counts(book){const map=new Map(book.groups.map(g=>[g.id,{...g,count:0,pageSet:new Set(),example:null}]));
 for(const p of book.pages)for(const o of p.occurrences){let g=map.get(o.groupId);if(!g)continue;g.count++;g.pageSet.add(p.page);if(!g.example)g.example={page:p.page,rect:o.rect};}
 const groups=[...map.values()].filter(g=>g.count).map(g=>({...g,pages:g.pageSet.size,pageSet:undefined})).sort((a,b)=>b.count-a.count||a.id.localeCompare(b.id));
 return {pages:book.pages.length,occurrences:book.pages.reduce((n,p)=>n+p.occurrences.length,0),groups:groups.length,rubySuspects:book.pages.reduce((n,p)=>n+p.occurrences.filter(o=>o.risk.includes('POSSIBLE_RUBY')).length,0),groupList:groups};
}
function getOccurrence(book,id){for(const p of book.pages){const o=p.occurrences.find(r=>r.id===id);if(o)return {page:p,occ:o}}throw Error('找不到字位');}
function kindOf(book,id,kind){if(!KINDS.has(kind))throw Error('无效分类');const {occ}=getOccurrence(book,id);occ.kind=kind;book.revision++;return occ;}
function setOccurrenceUnicode(book,id,unicode){const {occ}=getOccurrence(book,id);if(!T.oneGlyph(unicode))throw Error('人工逐位置确认只接受一个 Unicode 字素');occ.unicode=unicode;occ.verified=true;occ.kind='body';book.revision++;return occ;}
function clearOccurrenceUnicode(book,id){const {occ}=getOccurrence(book,id);occ.unicode='';occ.verified=false;book.revision++;}
function groupLabel(book,id,unicode,approved){const g=book.groups.find(g=>g.id===id);if(!g)throw Error('找不到形状组');if(unicode&&!T.oneGlyph(unicode))throw Error('组标签只允许一个字素');g.unicode=unicode||'';g.approved=!!(approved&&unicode);book.revision++;return g;}
function cropGray(gray,W,rect){const [x0,y0,x1,y1]=rect,h=y1-y0,w=x1-x0;const crop=new Uint8Array(w*h);for(let y=0;y<h;y++)crop.set(gray.subarray((y0+y)*W+x0,(y0+y)*W+x1),y*w);return crop}
function resegment(book,id,y,gray,W,H,mode='split',id2=null){const {page:p,occ:o}=getOccurrence(book,id);if(gray.length!==W*H||p.width!==W||p.height!==H)throw Error('原图尺寸不匹配');let a,b;
 if(mode==='split'){
  const [x0,y0,x1,y1]=o.span; y=Math.round(y);if(!Number.isFinite(y)||y<=y0+2||y>=y1-2)throw Error('切线须在当前区段内部，两侧至少3像素');
  a=[x0,y0,x1,y];b=[x0,y,x1,y1];
 }else if(mode==='merge'){
  const peer=p.occurrences.find(v=>v.id===id2);if(!peer||peer.column!==o.column||peer.id===o.id)throw Error('只能合并同一页同一列的两个区段');
  if(peer.span[1]<o.span[3]&&o.span[1]<peer.span[3])throw Error('重叠区段不允许合并');
  a=[Math.min(o.span[0],peer.span[0]),Math.min(o.span[1],peer.span[1]),Math.max(o.span[2],peer.span[2]),Math.max(o.span[3],peer.span[3])];b=null;
 }else throw Error('未知编辑模式');
 const candidates=[a,...(b?[b]:[])].map(span=>{
  const sig=E.signature(gray,W,...[span[0],span[2],span[1],span[3]]);if(!sig)throw Error('编辑后区段缺少原图墨迹');return {span,sig};
 });
 // Atomic: calculate all signatures before altering the previous state.
 const idx=indexOf(book),replacement=[];
 for(const {span,sig} of candidates){const n={id:'R'+book.nextRegion++,page:p.page,column:o.column,rect:sig.rect,span,kind:'review',risk:['MANUAL_BOUNDARY_EDIT_UNVERIFIED'],unicode:'',verified:false,edited:true};assign(book,n,sig,idx);replacement.push(n);}
 p.occurrences=p.occurrences.filter(v=>v.id!==id&&(mode!=='merge'||v.id!==id2));p.occurrences.push(...replacement);book.revision++;return replacement;
}
function addManualRegion(book,page,gray,W,H,rect){
 const p=book.pages.find(p=>p.page===page);if(!p)throw Error('该页尚未建立候选字位库');
 if(gray.length!==W*H||p.width!==W||p.height!==H)throw Error('原始灰度图与字位页不一致');
 if(!Array.isArray(rect)||rect.length!==4||!rect.every(Number.isFinite))throw Error('请先在原图手动框选');
 const x0=Math.max(0,Math.floor(Math.min(rect[0],rect[2]))),x1=Math.min(W,Math.ceil(Math.max(rect[0],rect[2])));
 const y0=Math.max(0,Math.floor(Math.min(rect[1],rect[3]))),y1=Math.min(H,Math.ceil(Math.max(rect[1],rect[3])));
 if(x1-x0<3||y1-y0<3||x1-x0>250||y1-y0>250)throw Error('补录选框尺寸须在3至250像素内');
 const sig=E.signature(gray,W,x0,x1,y0,y1);if(!sig)throw Error('选框内没有达到墨迹阈值的像素');
 const a=sig.rect;
 for(const o of p.occurrences){const b=o.rect,ix=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0])),iy=Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
  const i=ix*iy,smaller=Math.min((a[2]-a[0])*(a[3]-a[1]),(b[2]-b[0])*(b[3]-b[1]));
  if(i/smaller>.4)throw Error('选框与现有候选字位明显重叠；请使用拆分／合并修正旧区段，避免重复字位');
 }
 // Select a physical column by overlap in X (not by a guessed grid cell).
 let colNo=0,best=0;for(const [i,c] of p.columns.entries()){
  const width=Math.max(0,Math.min(a[2],c.x1)-Math.max(a[0],c.x0));if(width>best){colNo=i+1;best=width}
 }
 if(!colNo){colNo=p.columns.length+1;p.columns.push({x0:a[0],x1:a[2],y0:a[1],y1:a[3]})}
 const o={id:'R'+book.nextRegion++,page,column:colNo,rect:a,span:[x0,y0,x1,y1],kind:'review',risk:['MANUAL_REGION_UNVERIFIED'],unicode:'',verified:false,edited:true};
 assign(book,o,sig,indexOf(book));p.occurrences.push(o);book.revision++;return o;
}
function linkManualProposals(book,manual){
 // Transfer only labeling SUGGESTIONS to already-existing physical glyph slots.
 // Human acceptance of a pixel match is not a codepoint/context approval.
 if(!manual||!Array.isArray(manual.items))throw Error('没有可用的手工框选记录');
 const gridByPage=new Map(),tile=48;
 for(const p of book.pages){const grid=new Map();for(const o of p.occurrences){delete o.manualEvidence;
  const [x0,y0,x1,y1]=o.rect;if(x1-x0>240||y1-y0>240)continue;
  for(let gy=Math.floor(y0/tile);gy<=Math.floor((y1-1)/tile);gy++)for(let gx=Math.floor(x0/tile);gx<=Math.floor((x1-1)/tile);gx++){
   const key=gx+','+gy;let a=grid.get(key);if(!a){a=[];grid.set(key,a)}a.push(o);
  }
 }gridByPage.set(p.page,grid)}
 const stats={templates:0,hits:0,linked:0,ambiguous:0,skipped:0,conflicts:0};
 for(const t of manual.items){if(!T.oneGlyph(t.unicode)||!Array.isArray(t.matches))continue;stats.templates++;
  for(const hit of t.matches){if(hit.decision==='rejected')continue;stats.hits++;
   if(![hit.page,hit.x,hit.y,hit.w,hit.h].every(Number.isFinite)||hit.w<=0||hit.h<=0){stats.skipped++;continue}
   const grid=gridByPage.get(hit.page);if(!grid){stats.skipped++;continue}
   const a=[hit.x,hit.y,hit.x+hit.w,hit.y+hit.h],possibles=new Set();
   for(let gy=Math.floor(a[1]/tile);gy<=Math.floor((a[3]-1)/tile);gy++)for(let gx=Math.floor(a[0]/tile);gx<=Math.floor((a[2]-1)/tile);gx++)for(const o of (grid.get(gx+','+gy)||[]))possibles.add(o);
   let first=null,runner=0;for(const o of possibles){const b=o.rect;
    const ix=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0])),iy=Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
    const inter=ix*iy,areaA=hit.w*hit.h,areaB=(b[2]-b[0])*(b[3]-b[1]),iou=inter/(areaA+areaB-inter||1);
    if(first===null||iou>first.score){runner=first?.score||0;first={o,score:iou}}else if(iou>runner)runner=iou;
   }
   if(!first||first.score<.55){stats.skipped++;continue}
   if(runner>first.score*.85){stats.ambiguous++;continue}
   const o=first.o,entry=o.manualEvidence||(o.manualEvidence={labels:[],humanAccepted:false,templates:[]});
   if(!entry.labels.includes(t.unicode)){if(entry.labels.length>=6)continue;entry.labels.push(t.unicode)}
   if(!entry.templates.includes(t.id)&&entry.templates.length<10)entry.templates.push(t.id);
   if(hit.decision==='accepted')entry.humanAccepted=true;
   stats.linked++;
  }
 }
 for(const p of book.pages)for(const o of p.occurrences)if(o.manualEvidence?.labels.length>1)stats.conflicts++;
 book.revision++;return stats;
}
function groupBlocks(book){
 // A contradictory HUMAN confirmation anywhere invalidates a group's bulk
 // propagation. Strong consensus from two distinct OCR sources also triggers
 // a review hold; OCR alone never authorizes a Unicode label.
 const groups=new Map(book.groups.map(g=>[g.id,g]));const blocks=new Map();
 for(const p of book.pages)for(const o of p.occurrences){const g=groups.get(o.groupId);if(!g?.approved||!T.oneGlyph(g.unicode))continue;
  if(o.verified&&T.oneGlyph(o.unicode)&&o.unicode!==g.unicode){blocks.set(g.id,'HUMAN_CONFLICT');continue;}
  const vs=new Map();for(const e of o.ocrEvidence||[]){if(e.confidence<.85||!T.oneGlyph(e.unicode))continue;
   let a=vs.get(e.unicode);if(!a){a=new Set();vs.set(e.unicode,a)}a.add(e.source);
  }
  if([...vs].some(([u,src])=>u!==g.unicode&&src.size>=2))blocks.set(g.id,'OCR_CONSENSUS_CONFLICT');
 }
 return blocks;
}
function glyphFor(book,o,groupIndex,blocks){if(o.kind==='excluded'||o.kind==='ruby')return {status:o.kind,unicode:''};if(o.verified&&T.oneGlyph(o.unicode))return {status:'verified_position',unicode:o.unicode};const g=groupIndex.get(o.groupId);
 if(g?.approved&&T.oneGlyph(g.unicode)&&blocks?.has(g.id))return {status:'group_conflict_hold',unicode:'□'};
 if(g?.approved&&T.oneGlyph(g.unicode)&&!AMBIGUOUS.has(g.unicode)&&!o.risk.length&&!o.edited&&o.kind==='body')return {status:'approved_shape',unicode:g.unicode};
 return {status:o.risk.includes('POSSIBLE_RUBY')?'ruby_risk':o.edited?'edited_unreviewed':AMBIGUOUS.has(g?.unicode)?'ambiguous':'unresolved',unicode:'□'};
}
function reconstruct(book,names=[]){const totals={pages:book.pages.length,positions:0,resolved:0,unresolved:0,excluded:0,ruby:0};const pages=[];const groupIndex=new Map(book.groups.map(g=>[g.id,g]));const blocks=groupBlocks(book);
 for(const p of [...book.pages].sort((a,b)=>a.page-b.page)){
  const columns=new Map();for(const o of p.occurrences){if(!columns.has(o.column))columns.set(o.column,[]);columns.get(o.column).push(o)}
  // When a manual split has introduced two segments, keep source-physical order.
  const colList=[...columns].map(([col,arr])=>({column:col,x:Math.max(...arr.map(o=>o.span[2])),items:arr.sort((a,b)=>a.span[1]-b.span[1]||a.span[0]-b.span[0]).map(o=>({id:o.id,rect:o.rect,...glyphFor(book,o,groupIndex,blocks)}))})).sort((a,b)=>b.x-a.x);
  const lines=[];for(const col of colList){let text='';for(const item of col.items){totals.positions++;if(item.status==='excluded'||item.status==='ruby'){totals[item.status]++;continue}text+=item.unicode;if(item.unicode==='□')totals.unresolved++;else totals.resolved++;}if(text)lines.push(text)}
  pages.push({page:p.page,name:names[p.page]||`第${p.page+1}页`,columns:colList,text:lines.join('\n')});
 }
 totals.groupConflictHolds=pages.reduce((n,p)=>n+p.columns.reduce((m,c)=>m+c.items.filter(i=>i.status==='group_conflict_hold').length,0),0);
 totals.coverage=totals.positions?(totals.resolved/totals.positions):0;
 return {format:'NovelGlyph-Discovery-Draft-v1',warning:'这是图像投影候选字位草稿；□代表未知或不安全字位。列归属、Ruby、合并字符和丢失字位仍须人工核对。覆盖率分母是候选字位，非真实字数。',totals,pages};
}
function draftText(draft){return draft.pages.map(p=>`〔第${p.page+1}页 · ${p.name}〕\n${p.text}`).join('\n\n');}
function snapshot(book){return JSON.parse(JSON.stringify(book));}
function restore(data,pageCount){if(!data||data.format!=='NovelGlyph-Discovery-v1'||!Array.isArray(data.pages)||!Array.isArray(data.groups))throw Error('字位库格式无效');
 if(data.pages.length>pageCount||data.pages.some(p=>!Number.isInteger(p.page)||p.page<0||p.page>=pageCount||!Array.isArray(p.occurrences)))throw Error('字位库页码超出本书范围');
 const groups=new Set(data.groups.map(g=>g.id));if(groups.size!==data.groups.length)throw Error('组编号重复');
 if(data.pages.some(p=>p.occurrences.some(o=>!groups.has(o.groupId)||!validateRect(o.rect,p.width,p.height))))throw Error('字位库存在无效分组或选框');
 if(data.pages.reduce((n,p)=>n+p.occurrences.length,0)>500000)throw Error('字位记录超出安全上限');
 const copy=snapshot(data);copy.nextRegion=Math.max(copy.nextRegion||1,...copy.pages.flatMap(p=>p.occurrences.map(o=>Number(o.id.slice(1))+1)).filter(Number.isFinite),1);
 return copy;
}
const api={create,addPage,counts,getOccurrence,kindOf,setOccurrenceUnicode,clearOccurrenceUnicode,groupLabel,resegment,reconstruct,draftText,snapshot,restore,groupBlocks,cropGray,linkManualProposals,addManualRegion};root.GlyphDiscovery=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof self!=='undefined'?self:globalThis);
