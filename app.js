/* NovelGlyph Web 0.7. Local-only, no OCR, no network submission.
   Explicit human approval is required for Unicode; model suggestions never auto-approve. */
'use strict';
const $=id=>document.getElementById(id);
const state={pages:[],groups:[],index:new Map(),pageRegions:new Map(),mode:'',selected:null,filters:[],listPage:0,view:'group',busy:false,worker:null,projectName:'未命名项目',proposals:new Map(),sliding:null,overlapPage:0,anchors:[],columnsByPage:new Map(),gapProposals:[],gapSummary:{total:0,linked:0},bulk:null,bulkRunning:false,bulkPause:false,occurrenceOverrides:new Map(),selectedOccurrence:null,geometryHistory:[],geometryRedo:[],editSerial:0,geometryAuditStale:false,columnMarks:new Map(),columnHistory:[],columnRedo:[],columnSelection:null};
const blobCache=new Map(),grayCache=new Map(),IMG_LIMIT=4;let toastTimer;
const riskNames={A_DUAL_THRESHOLD_CROSSPAGE_ANCHOR_REVIEW_ONLY:'A · 旧严格组复核',STRICT_OLD:'旧严格组',C_REJECTED_ONLY_DUAL_REPEAT_UNVERIFIED:'C · 未确认完整字形',OLD_ELIGIBLE_VARIANT:'三阈值差异',E_NO_CROSSPAGE_EXACT_MATCH:'E · 孤例',OTHER_RISK:'其他风险',WIDE_COLUMN:'宽列','SHORT_REGION':'短区段','LONG_UNSPLIT':'长区段','NARROW_SYMBOL':'窄笔画','WEAK_GAP':'弱投影谷','INTERNAL_REAL_GAP':'存在未采用的真实投影空谷'};
function notify(text){const e=$('toast');e.textContent=text;e.classList.add('on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('on'),4000)}
function download(blob,name){const a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),5000)}
function jsonDownload(obj,name){download(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),name)}
function quoteCSV(x){return '"'+String(x??'').replaceAll('"','""')+'"'}
function safe(s){return String(s).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,75)}
function graphemes(s){return [...new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(String(s||''))].map(x=>x.segment)}
function natural(a,b){return a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})}
function options(){const num=id=>Number($(id).value);const roi=[num('roiLeft'),num('roiTop'),num('roiRight'),num('roiBottom')];if(roi[2]<=roi[0]||roi[3]<=roi[1])throw Error('正文区域右/下边界必须大于左/上边界');return {threshold:num('threshold'),colGap:num('colGap'),roi:roi.map(n=>n/100),sliding:$('enableSliding').checked,stride:num('seedStride')}}
function clearState(){for(const p of state.pages)if(p.url?.startsWith('blob:'))URL.revokeObjectURL(p.url);for(const b of blobCache.values())b.close?.();blobCache.clear();grayCache.clear();state.pages=[];state.groups=[];state.index.clear();state.pageRegions.clear();state.proposals.clear();state.selected=null;state.mode='';state.sliding=null;state.anchors=[];state.columnsByPage.clear();state.overlapPage=0;state.gapProposals=[];state.gapSummary={total:0,linked:0};state.listPage=0;state.filters=[];state.bulk=null;state.bulkPause=false;state.occurrenceOverrides.clear();state.selectedOccurrence=null;state.geometryHistory=[];state.geometryRedo=[];state.editSerial=0;state.geometryAuditStale=false;state.columnMarks.clear();state.columnHistory=[];state.columnRedo=[];state.columnSelection=null;window.NovelManual?.reset();window.NovelDiscovery?.reset();updateCounts();renderAll();}
function updateCounts(){const d=state.sliding?.stats||{};$('gapAll').textContent=(state.gapSummary.total||0).toLocaleString();$('gapLinked').textContent=(state.gapSummary.linked||0).toLocaleString();$('seedCount').textContent=(d.examined||0).toLocaleString();$('seedGroups').textContent=(d.crossPageHashes||0).toLocaleString();$('seedVerified').textContent=((state.bulk?.complete?state.bulk.summary.pixelExact:d.exactVerified)||0).toLocaleString();$('seedCoverage').textContent=state.sliding?(d.truncatedPages||d.seedLimitDropped||d.ignoredNewHashes?'部分':'已索引'):'—';const bk=state.bulk,bs=bk?.summary||{};$('bulkExact').textContent=(bs.pixelExact||0).toLocaleString();$('bulkFull').textContent=(bs.fullShapePairs||0).toLocaleString();$('bulkDistinct').textContent=(bs.distinctFullShapeGroups||0).toLocaleString();$('bulkFinished').textContent=bk?(bk.complete?'完成':`${bk.pageCursor}/${bk.pageCount} 页`):'—';$('bulkAudit').disabled=!bk||state.busy&&!state.bulkRunning;$('pageCount').textContent=state.pages.length;$('regionCount').textContent=state.mode==='demo'?'—':Array.from(state.pageRegions.values()).reduce((n,a)=>n+a.length,0).toLocaleString();$('groupCount').textContent=state.groups.length.toLocaleString();$('approvedCount').textContent=state.groups.filter(g=>g.status==='confirmed').length.toLocaleString()}
async function loadProjectZip(zip){
 const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
 if(manifest.format!=='NovelGlyph-Project-v1')throw Error('不是 NovelGlyph 项目文件');
 clearState();state.mode=manifest.source;state.projectName=manifest.name||'恢复的项目';
 if(manifest.source==='images'){
  const entries=Object.values(zip.files).filter(e=>!e.dir&&e.name.startsWith('original_pages/')).sort((a,b)=>natural(a.name,b.name));
  if(entries.length>2000)throw Error('项目包含超过 2000 页，请按卷拆分');
  if(Array.isArray(manifest.pageFiles)&&manifest.pageFiles.length!==entries.length)throw Error('项目清单的书页数与实际图片数不一致');
  let restoredBytes=0;
  for(const e of entries){
   const len=e._data?.uncompressedSize||0;
   if(len>70e6||restoredBytes+len>900e6)throw Error('项目图片超过安全大小限制（单页 70 MB／全书 900 MB）');
   const blob=await e.async('blob');restoredBytes+=blob.size;
   if(restoredBytes>900e6)throw Error('项目图片总大小超过 900 MB');
   const origName=manifest.pageFiles?.[state.pages.length];
   const name=typeof origName==='string'&&origName.trim()?origName:e.name.replace(/^original_pages\/\d+_/, '');
   state.pages.push({name,blob,url:URL.createObjectURL(blob)});
   if(state.pages.length%20===0)$('progressText').textContent=`恢复书页 ${state.pages.length}/${entries.length}`;
  }
 }else if(manifest.source==='demo'){
  // The demonstration assets are distributed with the website, not duplicated into workspace ZIP.
  state.mode='demo';
 }
 state.groups=manifest.groups.map(g=>({...g,status:g.status||'unreviewed',label:g.unicode||'',source:g.source||state.mode,
  anchorEvidence:g.anchorEvidence||0,bulkEvidence:g.bulkEvidence||0,proposal:g.proposal||null,examples:(g.examples||[]).map(e=>({...e}))}));
 state.index=new Map(state.groups.map(g=>[g.id,g]));
 const savedSliding=zip.file('sliding.json');if(savedSliding){state.sliding=JSON.parse(await savedSliding.async('string'))}
 const savedAnchors=zip.file('anchors.json');if(savedAnchors){state.anchors=JSON.parse(await savedAnchors.async('string'))}
 const savedColumns=zip.file('columns.json');if(savedColumns){state.columnsByPage=new Map(JSON.parse(await savedColumns.async('string')))}
 const savedColumnMarks=zip.file('column-marks.json');if(savedColumnMarks)state.columnMarks=GlyphColumns.validateRestore(JSON.parse(await savedColumnMarks.async('string')),state.columnsByPage);
 const savedColumnHistory=zip.file('column-history.json');if(savedColumnHistory){const h=JSON.parse(await savedColumnHistory.async('string'));state.columnHistory=Array.isArray(h.history)?h.history.slice(-150):[];state.columnRedo=Array.isArray(h.redo)?h.redo.slice(-150):[]}
 const savedBulk=zip.file('bulk-index.bin');if(savedBulk){
   const raw=await savedBulk.async('uint8array');
   const words=new Uint32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
   const meta=JSON.parse(await zip.file('bulk-meta.json').async('string'));
   const restoredBulk=GlyphBulk.makeSession(words,meta.pageCount);
   restoredBulk.pageCursor=meta.pageCursor||0;restoredBulk.complete=!!meta.complete;
   restoredBulk.summary=meta.summary||null;restoredBulk.links=meta.links||[];
   if(zip.file('bulk-status.bin'))restoredBulk.statuses=await zip.file('bulk-status.bin').async('uint8array');
   if(restoredBulk.complete){restoredBulk.proofs=null;restoredBulk.valid=null;restoredBulk.regions=null}
   else if(restoredBulk.pageCursor){
    for(const [entry,typ] of [['bulk-proofs.bin','proofs'],['bulk-valid.bin','valid'],['bulk-regions.bin','regions']]){
     const obj=zip.file(entry);if(!obj)throw Error('无法恢复未完成核验：缺少 '+entry);
     const bytes=await obj.async('uint8array');
     restoredBulk[typ]=typ==='regions'?new Uint32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)):bytes;
    }
   }
   state.bulk=restoredBulk;
 }
 const savedGeometry=zip.file('geometry-history.json');if(savedGeometry){const edits=JSON.parse(await savedGeometry.async('string'));
   state.geometryHistory=Array.isArray(edits.history)?edits.history.slice(-80):[];
   state.geometryRedo=Array.isArray(edits.redo)?edits.redo.slice(-80):[];
   state.editSerial=Number.isInteger(edits.serial)?edits.serial:0;
   state.geometryAuditStale=!!edits.auditStale;
 }
 const savedOverrides=zip.file('occurrence-decisions.json');if(savedOverrides){const entries=JSON.parse(await savedOverrides.async('string'));restoreOccurrenceEdits(entries)}
 const manualSnapshot=zip.file('manual-search.json');if(manualSnapshot){window.NovelManual?.restore(JSON.parse(await manualSnapshot.async('string')))}
 const discoverySnapshot=zip.file('discovery.json');if(discoverySnapshot)window.NovelDiscovery?.restore(JSON.parse(await discoverySnapshot.async('string')));
 const savedGaps=zip.file('gap-proposals.json');if(savedGaps){const v=JSON.parse(await savedGaps.async('string'));state.gapProposals=v.proposals||[];state.gapSummary=v.summary||{total:0,linked:0}}
 const intervals=zip.file('intervals.json');if(intervals){const entries=JSON.parse(await intervals.async('string'));state.pageRegions=new Map(entries.map(([idx,regions])=>[Number(idx),regions]))}
 // Defer all decision display until a group was restored and safety constraints checked.
 if(zip.file('human-decisions.json')){const review=JSON.parse(await zip.file('human-decisions.json').async('string'));for(const item of review.decisions||[]){const g=state.index.get(item.group_id);if(!g)continue;if(item.status==='confirmed'&&graphemes(item.unicode).length===1){g.status='confirmed';g.label=item.unicode;g.notes=item.notes||''}else if(item.status==='rejected'){g.status='rejected';g.label=''}}}
 window.NovelManual?.refresh();window.NovelDiscovery?.render();updateBulkStatus(); selectGroup(state.groups[0]?.id);applyFilter();refreshPageSelect();updateCounts();renderOverlaps();renderAnchors();renderGapProposals();geometryStatus('已恢复边界编辑记录');notify(`已恢复项目：${state.pages.length} 页、${state.groups.length} 组`)
}
async function ingest(files){if(state.busy)return;const images=[];let total=0;
 for(const f of files){if(/\.(zip|cbz)$/i.test(f.name)){
   const zip=await JSZip.loadAsync(f);if(zip.file('manifest.json')){await loadProjectZip(zip);return}const entries=Object.values(zip.files).filter(x=>!x.dir&&!/(^|\/)(__MACOSX|\._)/i.test(x.name)&&/\.(png|jpe?g|webp)$/i.test(x.name)).sort((a,b)=>natural(a.name,b.name));
   if(entries.length>2000)throw Error('单个 ZIP 最多 2000 张图片');
   for(const e of entries){if(e._data?.uncompressedSize>70e6)throw Error('存在超过 70 MB 的单张图片');const b=await e.async('blob');total+=b.size;if(total>900e6)throw Error('总图片数据超过 900 MB，建议分卷导入');images.push({name:e.name,blob:b,url:URL.createObjectURL(b)})}
 }else if(/^image\//.test(f.type)||/\.(png|jpe?g|webp)$/i.test(f.name)){images.push({name:f.webkitRelativePath||f.name,blob:f,url:URL.createObjectURL(f)})}}
 if(!images.length)throw Error('没有找到 PNG/JPG/WebP 图片');
 clearState();state.mode='images';state.projectName=(files[0]?.name||'扫描书').replace(/\.zip$/i,'');state.pages=images.sort((a,b)=>natural(a.name,b.name));
 $('progressText').textContent=`已导入 ${images.length} 页，尚未生成字形索引`;
 updateCounts();renderAll();window.NovelManual?.refresh();window.NovelDiscovery?.render();notify(`已导入 ${images.length} 页；现在可直接手动框字搜索全书，或选择自动投影`);
}
function loadDemo(){if(!Array.isArray(window.NOVEL_GLYPH_DEMO)){notify('演示样本没有安装');return}clearState();state.mode='demo';state.projectName=window.NOVEL_GLYPH_DEMO_TITLE||'本地无 OCR 字形审阅演示';
 state.groups=window.NOVEL_GLYPH_DEMO.map(g=>({...g,status:'unreviewed',label:'',notes:'',proposal:null,
   strictGroup:false,source:g.id?.startsWith('synthetic')?'SYNTHETIC_PUBLIC_DEMO':'V8_1_LOCKED_SCAN',risk:g.risk,examples:g.examples.map(e=>({...e}))}));
 state.index=new Map(state.groups.map(g=>[g.id,g]));
 let saved=null;try{saved=localStorage.getItem('novelglyph-demo-decisions-v01')}catch(_){}if(saved){try{const o=JSON.parse(saved);for(const g of state.groups){let d=o[g.id];if(d&&['confirmed','rejected'].includes(d.status)){g.status=d.status;g.label=d.label||'';g.notes=d.notes||''}}}catch(_){}}
 selectGroup(state.groups[0]?.id);applyFilter();updateCounts();notify(`已载入 ${state.groups.length} 组审核样本；全部仍需人工核验`);
}
function addResults(pageIndex,result){state.pageRegions.set(pageIndex,[]);const list=state.pageRegions.get(pageIndex);
 for(const reg of result.regions){const proof=reg.proof;const base=reg.key;
  // Exact three-threshold bitset is part of identity. Hash alone is never trusted.
  const key=`${base}/${proof}`;let g=state.index.get(key);
  const item={page:pageIndex,column:reg.column,rect:reg.rect,risk:reg.risk,width:reg.w,height:reg.h};
  if(!g){g={id:`p-${state.groups.length+1}`,key:base,proof,examples:[],locations:[],count:0,pages:0,pageIds:new Set(),risk:reg.risk,status:'unreviewed',label:'',source:'LOCAL_PROJECTION',strictGroup:false};state.index.set(key,g);state.groups.push(g)}
  g.count++;g.locations.push(item);g.pageIds.add(pageIndex);
  if(g.examples.length<5)g.examples.push({...item});
  if(reg.risk?.length && !g.risk.length)g.risk=reg.risk;
  list.push({...reg,groupId:g.id});
 }
}
async function cropPatch(ex){
 const bmp=await getBmp(ex.page);if(!bmp)return null;
 const cv=document.createElement('canvas');cv.width=ex.w;cv.height=ex.h;
 const cx=cv.getContext('2d',{willReadFrequently:true});cx.drawImage(bmp,ex.x,ex.y,ex.w,ex.h,0,0,ex.w,ex.h);
 const rgba=cx.getImageData(0,0,ex.w,ex.h).data;
 return {gray:GlyphEngine.grayFromRGBA(rgba,ex.w,ex.h),url:cv.toDataURL('image/png')};
}
async function getGrayPage(page){
 if(grayCache.has(page)){const v=grayCache.get(page);grayCache.delete(page);grayCache.set(page,v);return v}
 const bmp=await getBmp(page);if(!bmp)return null;
 const cv=document.createElement('canvas');cv.width=bmp.width;cv.height=bmp.height;
 const cx=cv.getContext('2d',{willReadFrequently:true});cx.drawImage(bmp,0,0);
 const g={gray:GlyphEngine.grayFromRGBA(cx.getImageData(0,0,bmp.width,bmp.height).data,bmp.width,bmp.height),width:bmp.width,height:bmp.height};
 grayCache.set(page,g);while(grayCache.size>10)grayCache.delete(grayCache.keys().next().value);return g;
}
async function verifyTopSlidingPairs(limit=120,groupProofIndex=new Map()){
 state.anchors=[];
 const anchorShapeMap=new Map();
 const data=state.sliding;if(!data)return;
 let verified=0,invalid=0,full=0,partial=0;
 for(const pair of data.pairs.slice(0,limit)){
  // Read each full source image at most once per LRU residency; the previous
  // version decoded the same page separately for partial and full comparison.
  const leftPage=await getGrayPage(pair.first.page),rightPage=await getGrayPage(pair.second.page);
  if(!leftPage||!rightPage)continue;
  const ok=GlyphSliding.exactProof(leftPage.gray,leftPage.width,leftPage.height,pair.first,rightPage.gray,rightPage.width,rightPage.height,pair.second);
  pair.status=ok?'PIXEL_PROOF_VERIFIED':'HASH_COLLISION_OR_STALE_SOURCE';
  if(ok){verified++;
   // A partial 24x24 window is never enough to assign a character.
   // Require two independently detected full physical spans and compare
   // their ENTIRE tight shape at 160 / 185 / 210 before suggesting a group.
   const leftCol=state.columnsByPage.get(pair.first.page)?.[pair.first.column-1];
   const rightCol=state.columnsByPage.get(pair.second.page)?.[pair.second.column-1];
   if(leftPage&&rightPage&&leftCol&&rightCol){
     const anchor=GlyphAnchored.compareAnchors(leftPage,rightPage,pair.first,pair.second,leftCol,rightCol);
     pair.fullShapeStatus=anchor.status;
     if(anchor.status==='DUAL_PAGE_FULL_SHAPE_PROOF_CANDIDATE'){
       full++;
       const shapeKey=`${anchor.key}/${anchor.proof}`;
       let g=groupProofIndex.get(shapeKey)||anchorShapeMap.get(shapeKey);
       if(!g){
         g={id:`anchor-${anchorShapeMap.size+1}`,key:anchor.key,source:'SLIDING_ANCHORED',risk:anchor.risk,
           count:2,pages:2,status:'unreviewed',label:'',examples:[anchor.first,anchor.second],locations:[],anchorEvidence:0};
         anchorShapeMap.set(shapeKey,g);state.groups.push(g);state.index.set(g.id,g);
       }
       g.anchorEvidence=(g.anchorEvidence||0)+1;
       state.anchors.push({groupId:g.id,first:anchor.first,second:anchor.second,risk:anchor.risk,
         source:'FULL_SHAPE_THREE_THRESHOLD',status:'PROVISIONAL_NOT_UNICODE'});
       pair.fullShapeGroupId=g.id;
     }else{partial++}
   }
  }else invalid++;
 }
 data.stats.exactVerified=verified;data.stats.exactFailed=invalid;data.stats.fullShapeCandidatePairs=full;data.stats.partialOnlyPairs=partial;
 // Remaining candidates have NOT been pixel verified and must not be propagated.
}
function renderOverlaps(){
 const el=$('overlapList');if(!el)return;el.replaceChildren();const d=state.sliding;
 $('overlapStatus').textContent=d?(state.bulk?.complete?`${state.bulk.summary.catalogPairs.toLocaleString()} 个代表配对已全量核验；当前只展示抽样窗口`:`${d.stats.crossPageHashes.toLocaleString()} 个候选指纹；抽检 ${d.stats.exactVerified||0} 对`):'尚未检索';
 if(!d?.pairs?.length){$('overlapPageIndicator').textContent='0 / 0';$('prevOverlap').disabled=true;$('nextOverlap').disabled=true;el.innerHTML='<div class="placeholder">当前没有跨页重复窗口证据；不代表没有重复单字</div>';return}
 const totalPages=Math.ceil(d.pairs.length/16);state.overlapPage=Math.max(0,Math.min(state.overlapPage,Math.max(0,totalPages-1)));
 $('overlapPageIndicator').textContent=`${totalPages?state.overlapPage+1:0} / ${totalPages}`;$('prevOverlap').disabled=state.overlapPage===0;$('nextOverlap').disabled=state.overlapPage>=totalPages-1;
 for(const [i,pair] of d.pairs.slice(state.overlapPage*16,(state.overlapPage+1)*16).entries()){
  const card=document.createElement('div');card.className='overlap-card';
  const title=document.createElement('div');title.className=pair.status==='PIXEL_PROOF_VERIFIED'?'overlap-proof':'overlap-unproven';title.textContent=`#${state.overlapPage*16+i+1} · ${pair.status==='PIXEL_PROOF_VERIFIED'?'原图三阈值逐像素一致':pair.status==='HASH_COLLISION_OR_STALE_SOURCE'?'核验不一致 · 禁止使用':'仅指纹候选，未核验'}`;card.appendChild(title);
  const imgs=document.createElement('div');imgs.className='overlap-images';
  for(const loc of [pair.first,pair.second]){
   const side=document.createElement('div');side.className='overlap-side';const img=document.createElement('img');img.alt='原扫描完整文字列上滑动截取的像素窗口';side.appendChild(img);
   const label=document.createElement('small');label.textContent=`第 ${loc.page+1} 页 · 列 ${loc.column} · (${loc.x},${loc.y})`;side.appendChild(label);imgs.appendChild(side);
   cropPatch(loc).then(x=>{if(img.isConnected&&x)img.src=x.url}).catch(()=>{});
   const jump=document.createElement('button');jump.type='button';jump.className='textbtn';jump.textContent='查看原页';jump.addEventListener('click',()=>{changeTab('page');$('pageSelect').value=String(loc.page);renderPage([loc.x,loc.y,loc.x+loc.w,loc.y+loc.h])});side.appendChild(jump);
  }
  card.appendChild(imgs);const summary=document.createElement('div');summary.className='overlap-info';summary.textContent=`关联的窗口指纹出现记录：${pair.occurrences} · 不是单字识别或字符数`;card.appendChild(summary);el.appendChild(card);
 }
}
function renderAnchors(){
 const el=$('anchorList'),status=$('anchorStatus');if(!el||!status)return;
 const rows=state.anchors||[],unique=new Map();for(const row of rows)if(!unique.has(row.groupId))unique.set(row.groupId,row);
 status.textContent=state.geometryAuditStale?'⚠ 边界已编辑：这里保存的旧轮廓关联仅供历史参考，不对修改区段有效':state.bulk?.complete?`全量 ${state.bulk.summary.fullShapePairs.toLocaleString()} 对关联 ${state.bulk.summary.distinctFullShapeGroups.toLocaleString()} 个形状组；下方展示代表证据`:`抽样 ${rows.length} 对，归并 ${unique.size} 组；最多展示 24 组`;
 el.replaceChildren();if(!rows.length){el.innerHTML='<div class="placeholder">目前检索样本中没有同时通过两页完整投影边界与三阈值轮廓复核的候选；不会用局部匹配凑数。</div>';return}
 for(const row of [...unique.values()].slice(0,24)){
  const card=document.createElement('div');card.className='overlap-card';
  const head=document.createElement('strong');head.textContent=`${row.groupId} · 两页完整候选轮廓一致`;card.appendChild(head);
  const imgRow=document.createElement('div');imgRow.className='overlap-images';
  for(const loc of [row.first,row.second]){
   const side=document.createElement('div');side.className='overlap-side';const img=document.createElement('img');img.alt='原图独立投影区域';side.appendChild(img);
   const info=document.createElement('small');info.textContent=`第 ${loc.page+1} 页 · 列 ${loc.column} · ${loc.rect[2]-loc.rect[0]}×${loc.rect[3]-loc.rect[1]}`;side.appendChild(info);
   setThumb(img,loc,`${row.groupId}/${loc.page}`);img.dataset.token=`${row.groupId}/${loc.page}`;imgRow.appendChild(side);
  }
  card.appendChild(imgRow);
  const desc=document.createElement('small');desc.textContent=`人工复核前不视为一个完整单字：${row.risk.join('、')}`;card.appendChild(desc);
  const btn=document.createElement('button');btn.className='btn';btn.textContent='转到本组集中审核';btn.onclick=()=>{changeTab('group');selectGroup(row.groupId)};card.appendChild(btn);
  el.appendChild(card);
 }
}
function resolveGapProposals(){
 const exact=new Map(state.groups.map(g=>[`${g.key}/${g.proof}`,g]));
 const proposals=[];let total=0,linked=0;
 for(const [page,regions] of state.pageRegions){
  for(const reg of regions)for(const alt of reg.alternatives||[]){
   total++;
   const left=exact.get(`${alt.left.key}/${alt.left.proof}`),right=exact.get(`${alt.right.key}/${alt.right.proof}`);
   const leftCross=!!(left&&left.pages>1),rightCross=!!(right&&right.pages>1);
   if(!leftCross&&!rightCross)continue;
   linked++;
   if(proposals.length<5000)proposals.push({page,column:reg.column,rect:[reg.x0,reg.y0,reg.x1,reg.y1],cutY:alt.y,
     leftCross,rightCross,leftGroup:leftCross?left.id:null,rightGroup:rightCross?right.id:null,verified:false});
  }
 }
 state.gapSummary={total,linked};state.gapProposals=proposals;
}
function renderGapProposals(){
 const el=$('gapList');if(!el)return;el.replaceChildren();
 const items=state.gapProposals.slice(0,16);
 if(!items.length){el.innerHTML='<div class="placeholder">没有找到子片段可链接到跨页形状组的未采用空谷；这不等于无漏切</div>';return}
 for(const item of items){const card=document.createElement('div');card.className='gap-card';
  const title=document.createElement('strong');title.textContent=`第 ${item.page+1} 页 · 列 ${item.column} · y=${item.cutY}`;card.appendChild(title);
  const hint=document.createElement('small');hint.textContent=`左侧子片段跨页支持：${item.leftCross?'有':'无'}；右侧子片段：${item.rightCross?'有':'无'}（仍非完整字认证）`;card.appendChild(hint);
  const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='在原图查看备选切线';button.onclick=()=>{changeTab('page');$('pageSelect').value=String(item.page);renderPage({rect:item.rect,cutY:item.cutY})};card.appendChild(button);el.appendChild(card);
 }
}
async function analyze(){if(!state.pages.length){notify('请先上传原始扫描图片');return}if(state.busy)return;
 try{const opt=options();state.busy=true;$('analyze').disabled=true;state.groups=[];state.index=new Map();state.pageRegions=new Map();state.columnsByPage=new Map();state.anchors=[];state.sliding=null;state.bulk=null;state.occurrenceOverrides.clear();state.selectedOccurrence=null;state.geometryHistory=[];state.geometryRedo=[];state.editSerial=0;state.geometryAuditStale=false;state.columnMarks.clear();state.columnHistory=[];state.columnRedo=[];state.columnSelection=null;let done=0;
   const slidingIndex=opt.sliding?GlyphSliding.createCompactSeedIndex({maxTotal:6000000,keepPairs:240,retainAudit:true}):null;
   const consume=(i,result,sliding)=>{
    addResults(i,result);state.columnsByPage.set(i,result.columns);
    if(slidingIndex&&sliding)slidingIndex.ingest(i,sliding.seeds,sliding.stats);
    done++;$('progressBar').style.width=(done/state.pages.length*100).toFixed(1)+'%';
    $('progressText').textContent=`扫描 ${done}/${state.pages.length} 页 · ${state.groups.length.toLocaleString()} 种候选形状${slidingIndex?' · 整列滑动中':''}`;
   };
   const useWorker=(['http:','https:'].includes(location.protocol)||window.__NOVELGLYPH_WORKER_TEST===true)&&typeof Worker!=='undefined';
   if(useWorker){
     await new Promise((resolve,reject)=>{
       let worker;try{worker=new Worker('worker.js')}catch(e){reject(e);return}state.worker=worker;
       worker.onmessage=ev=>{const d=ev.data;if(d.type==='error'){worker.terminate();reject(new Error(`第${d.index+1}页：${d.error}`));return}
         consume(d.index,d.result,d.sliding);
         if(done===state.pages.length){worker.terminate();resolve();return}
         worker.postMessage({type:'analyze',index:done,file:state.pages[done].blob,options:opt});
       };
       worker.onerror=e=>{worker.terminate();reject(new Error(e.message||'Worker error'))};
       worker.postMessage({type:'analyze',index:0,file:state.pages[0].blob,options:opt});
     });
   }else{
     for(let i=0;i<state.pages.length;i++){
      const bm=await createImageBitmap(state.pages[i].blob),cn=document.createElement('canvas');cn.width=bm.width;cn.height=bm.height;const cx=cn.getContext('2d',{willReadFrequently:true});cx.drawImage(bm,0,0);bm.close();const p=cx.getImageData(0,0,cn.width,cn.height),gray=GlyphEngine.grayFromRGBA(p.data,cn.width,cn.height),result=GlyphEngine.analyzeGray(gray,cn.width,cn.height,opt);
      const sliding=slidingIndex?GlyphSliding.slidingSeeds(gray,cn.width,cn.height,result.columns,{stride:opt.stride,maxPerPage:24000}):null;
      consume(i,result,sliding);await new Promise(r=>setTimeout(r,0));
     }
   }
   for(const g of state.groups){g.pages=g.pageIds.size;delete g.pageIds;
      g.risk=g.risk?.length?g.risk:['SEGMENTATION_UNVERIFIED'];
   }
   resolveGapProposals();const groupProofIndex=new Map(state.groups.map(g=>[`${g.key}/${g.proof}`,g]));for(const g of state.groups)delete g.proof;
   state.groups.sort((a,b)=>b.count-a.count);state.index=new Map(state.groups.map(g=>[g.id,g]));
   if(slidingIndex){const finished=slidingIndex.finish();
     state.sliding={pairs:finished.pairs,stats:finished.stats};
     state.bulk=finished.audit?GlyphBulk.makeSession(finished.audit.words,state.pages.length):null;
     $('progressText').textContent='抽样核对跨页窗口（160 对）；全量核验请使用左侧独立按钮';
     await verifyTopSlidingPairs(160,groupProofIndex);
   }
   selectGroup(state.groups[0]?.id);applyFilter();updateCounts();updateBulkStatus();refreshPageSelect();renderOverlaps();renderAnchors();renderGapProposals();
   notify(`分析完成：${state.groups.length} 个未核验字形组；${state.sliding?.stats.exactVerified||0} 对窗口原像素核验通过`);
 }catch(e){notify('扫描失败：'+e.message);console.error(e)}finally{state.busy=false;$('analyze').disabled=false;state.worker=null;updateBulkStatus();updateCounts()}
}


function updateBulkStatus(){
 const b=state.bulk,el=$('bulkStatus');if(!el)return;
 $('bulkProgressBar').style.width=b?`${100*b.pageCursor/Math.max(1,b.pageCount)}%`:'0%';
 $('bulkAudit').disabled=!b||state.busy&&!state.bulkRunning;
 $('bulkAudit').textContent=state.bulkRunning?'暂停核验':b?.complete?'完整核验已完成':b?.pageCursor?'继续全量核验':'核验全部跨页指纹代表配对';
 if(state.geometryAuditStale)el.textContent='⚠ 已人工修改物理边界：旧完整字形证据对应的是编辑前几何，不能直接用于修改后的区段。原图局部像素证据仍有效。';
 else if(!b)el.textContent='请先分析原图，才可逐一核验全部指纹代表配对。';
 else if(b.complete){const m=b.summary;el.textContent=`已核验 ${m.checked.toLocaleString()}/${m.catalogPairs.toLocaleString()} 对：局部像素一致 ${m.pixelExact.toLocaleString()}，其中有双页完整形状候选证据 ${m.fullShapePairs.toLocaleString()} 对。全部仍需语义人工审核。`}
 else el.textContent=`逐页复核 ${b.pageCursor}/${b.pageCount}；当前仅缓存尚未配完的两页窗口证据，可暂停并保存工作区继续。`;
}
function appendBulkLinks(){
 const b=state.bulk;if(!b?.complete)return;
 // Rebuild only evidence scores; never modify human labels or confirmed state.
 for(const g of state.groups)g.bulkEvidence=0;
 const selected=[];
 for(const x of b.links){const g=state.index.get(x.groupId);if(!g)continue;g.bulkEvidence=x.pairs;
  for(const i of x.samples.slice(0,2)){
   if(selected.length>=1200)break;
   const a=GlyphBulk.loc(b.words,i,0),c=GlyphBulk.loc(b.words,i,1);
   const ra=state.pageRegions.get(a.page)?.find(r=>r.groupId===g.id&&r.column===a.column&&r.y0<=a.y&&r.y1>=a.y+24);
   const rb=state.pageRegions.get(c.page)?.find(r=>r.groupId===g.id&&r.column===c.column&&r.y0<=c.y&&r.y1>=c.y+24);
   if(!ra||!rb)continue;
   selected.push({groupId:g.id,first:{...a,rect:ra.rect},second:{...c,rect:rb.rect},risk:['INDEPENDENT_PROJECTION_BOUNDARIES','NOT_HUMAN_VERIFIED'],source:'EXHAUSTIVE_3_THRESHOLD_AUDIT',status:'PROVISIONAL_NOT_UNICODE'});
  }
 }
 state.anchors=selected;
}
async function runBulkAudit(){
 const b=state.bulk;if(!b||b.complete)return;
 if(state.bulkRunning){state.bulkPause=true;notify('将在当前原书页结束后暂停');return}
 if(state.busy)return;
 if(state.geometryAuditStale)return notify('边界已改变：旧全量配对不能直接关联新字位；请保留工作区，按修改后的原图重新核验');
 state.busy=true;state.bulkRunning=true;state.bulkPause=false;updateBulkStatus();
 try{
  const requests=GlyphBulk.makeRequests(b.words,b.pageCount);
  const groupIds=new Map(state.groups.map((g,i)=>[g.id,i+1]));
  for(let page=b.pageCursor;page<b.pageCount;page++){
   const src=await getGrayPage(page);
   if(!src)throw Error(`第 ${page+1} 页源扫描不可读取`);
   const report=GlyphBulk.ingestPage(b,page,src.gray,src.width,src.height,requests[page],state.pageRegions.get(page),state.columnsByPage.get(page),groupIds);
   if(page%8===0||page===b.pageCount-1){updateBulkStatus();updateCounts();await new Promise(resolve=>setTimeout(resolve,0))}
   if(state.bulkPause){notify(`已在第 ${page+1} 页暂停，可保存工作区并继续`);break}
  }
  if(b.pageCursor===b.pageCount){
   const summary=GlyphBulk.finalize(b,groupIds);
   state.sliding.stats.bulkExactVerified=summary.pixelExact;
   state.sliding.stats.bulkFullShapeCandidatePairs=summary.fullShapePairs;
   appendBulkLinks();applyFilter();renderAnchors();
   notify(`全量核验完成：${summary.checked.toLocaleString()} 对窗口代表，${summary.fullShapePairs.toLocaleString()} 对完整形状候选，未自动赋字`);
  }
 }catch(err){console.error(err);notify('全量核验暂停：'+err.message)}
 finally{state.bulkRunning=false;state.bulkPause=false;state.busy=false;updateBulkStatus();updateCounts()}
}
function applyFilter(){const f=$('filter').value,q=$('search').value.trim();state.filters=state.groups.filter(g=>{
 if(f==='unreviewed'&&g.status!=='unreviewed')return false;if(f==='confirmed'&&g.status!=='confirmed')return false;if(f==='risky'&&!(g.risk?.length))return false;if(f==='proposed'&&!g.proposal)return false;if(f==='repeated'&&g.pages<2)return false;if(f==='anchored'&&!(g.anchorEvidence>0||g.bulkEvidence>0))return false;
 return !q||g.id.includes(q)||(g.label||'').includes(q)||(g.proposal?.unicode||'').includes(q);
 });state.listPage=0;renderList()}
function selectGroup(id){if(!id)return;state.selected=id;const g=state.index.get(id);if(!g)return;renderSelected();renderList();updateCounts()}
function moveGroup(n){const a=state.filters.length?state.filters:state.groups,idx=a.findIndex(g=>g.id===state.selected);if(!a.length)return;selectGroup(a[(idx+n+a.length)%a.length].id)}
async function imageFromUrl(url){return new Promise((resolve,reject)=>{let im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('无法加载图像'));im.src=url})}
async function getBmp(page){if(blobCache.has(page)){let b=blobCache.get(page);blobCache.delete(page);blobCache.set(page,b);return b}
 const p=state.pages[page];if(!p)return null;const b=await createImageBitmap(p.blob);blobCache.set(page,b);while(blobCache.size>IMG_LIMIT){let [idx,old]=blobCache.entries().next().value;blobCache.delete(idx);old.close?.()}return b}
async function thumbFor(example){if(example.image)return example.image;const bmp=await getBmp(example.page);if(!bmp)return '';const [x0,y0,x1,y1]=example.rect;const w=Math.max(1,x1-x0),h=Math.max(1,y1-y0);const cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').drawImage(bmp,x0,y0,w,h,0,0,w,h);return cv.toDataURL('image/png')}
async function setThumb(img,example,token){try{const url=await thumbFor(example);if(img.isConnected&&img.dataset.token===token)img.src=url}catch(_){}}
function updateHeroImage(){const g=state.index.get(state.selected),img=$('heroImage');img.removeAttribute('src');$('heroEmpty').classList.toggle('hidden',!!g);
 if(g?.examples?.length){const token=g.id;img.dataset.token=token;setThumb(img,g.examples[0],token)}}
function renderSelected(){const g=state.index.get(state.selected);$('editorTitle').textContent=g?'当前同形组：'+g.id:'尚未选择字形组';$('glyphKey').textContent=g?(g.key||g.id):'—';$('glyphOccurrences').textContent=g?`${Number(g.count).toLocaleString()} 个关联位置`:'—';$('glyphPages').textContent=g?`${g.pages} 个不同扫描页`:'—';$('glyphWarning').textContent=g?`${g.bulkEvidence?`全量候选证据：${g.bulkEvidence.toLocaleString()} 对（非人工金标）。`:'`'}${g.risk?.length?`风险：${(Array.isArray(g.risk)?g.risk:[g.risk]).map(k=>riskNames[k]||k).join('；')}`:'图像一致但尚未独立确认完整字位'}`:'归组 ≠ 正确识字';
 $('groupState').className='state'+(g?.status==='confirmed'?' good':g?.status==='rejected'?' bad':'');$('groupState').textContent=g?(g.status==='confirmed'?'人工已确认':g.status==='rejected'?'已排除':'待审'):'未选择';
 $('inspectorSummary').textContent=g?`${Number(g.count).toLocaleString()} 次出现 · ${g.pages} 页 · ${g.source} · 未经 OCR`:'请先载入项目';
 $('unicode').value=g?.label||'';$('isWhole').checked=g?.status==='confirmed';$('noRuby').checked=g?.status==='confirmed';$('contextSafe').checked=g?.status==='confirmed';
 $('suggestion').textContent=g?.proposal?`AI 建议：${g.proposal.unicode} · 自报置信度 ${g.proposal.confidence??'未给出'} · 仅供复核`:'没有导入建议';
 $('examplesLabel').textContent=g?`${g.examples.length} 张真实原图示例`:'未选择';updateHeroImage();renderExamples();
}
function renderExamples(){const el=$('sampleGrid');el.replaceChildren();const g=state.index.get(state.selected);if(!g?.examples?.length){el.innerHTML='<div class="placeholder">暂无原图示例</div>';return}
 g.examples.slice(0,5).forEach((ex,i)=>{const card=document.createElement('div');card.className='sample-card';const pic=document.createElement('div');pic.className='sample-pic';const im=document.createElement('img');im.alt='真实原始灰度裁片';const token=`${g.id}-ex${i}`;im.dataset.token=token;pic.appendChild(im);card.appendChild(pic);const label=document.createElement('div');label.className='sample-label';label.textContent=`第 ${state.mode==='demo'?ex.page:ex.page+1} 页 · ${ex.column||'?'} 列 · 示例 ${i+1}`;card.appendChild(label);el.appendChild(card);setThumb(im,ex,token);
 if(ex.context){const ci=new Image();ci.className='sample-context';ci.src=ex.context;ci.alt='裁片所在原图上下文';card.appendChild(ci)} });}
function renderList(){const el=$('groupList');el.replaceChildren();const groups=state.filters,pg=Math.ceil(groups.length/36);state.listPage=Math.max(0,Math.min(state.listPage,Math.max(0,pg-1)));const subset=groups.slice(state.listPage*36,(state.listPage+1)*36);
 for(const g of subset){const b=document.createElement('button');b.className='glyph-card'+(g.id===state.selected?' current':'');b.type='button';b.addEventListener('click',()=>selectGroup(g.id));const im=document.createElement('img');im.alt='字形';const token=`list-${g.id}`;im.dataset.token=token;setThumb(im,g.examples[0],token);b.appendChild(im);const d=document.createElement('div');const name=document.createElement('strong');name.textContent=g.status==='confirmed'?`${g.label} · 已确认`:(g.status==='rejected'?'已排除':g.id.slice(0,8));d.appendChild(name);const sub=document.createElement('small');sub.textContent=`${Number(g.count).toLocaleString()} 次 · ${g.pages} 页${g.proposal?' · AI建议':''}`;d.appendChild(sub);b.appendChild(d);el.appendChild(b)}
 $('listStatus').textContent=`${groups.length.toLocaleString()} 组`; $('pageIndicator').textContent=`${groups.length?state.listPage+1:0} / ${pg}`;$('prevPage').disabled=state.listPage===0;$('nextPage').disabled=state.listPage>=pg-1;
}
function renderAll(){renderSelected();applyFilter();refreshPageSelect();updateCounts();}
function persistDemo(){if(state.mode!=='demo')return;const o={};for(const g of state.groups)if(g.status!=='unreviewed')o[g.id]={label:g.label,status:g.status,notes:g.notes};try{localStorage.setItem('novelglyph-demo-decisions-v01',JSON.stringify(o))}catch(_){}}
function confirmGroup(){const g=state.index.get(state.selected);if(!g)return;const u=$('unicode').value.trim();if(graphemes(u).length!==1){notify('仅允许确认一个 Unicode 字素；多字或混合符号请先修复切分');return}if(!$('isWhole').checked||!$('noRuby').checked||!$('contextSafe').checked){notify('需要先检查完整单字、Ruby 邻字及上下文码位三项');return}g.label=u;g.status='confirmed';g.notes=`HUMAN_CONFIRMED ${new Date().toISOString()}`;persistDemo();renderSelected();applyFilter();updateCounts();notify(`已确认 ${u} · 当前组 ${g.id}`)}
function rejectGroup(){const g=state.index.get(state.selected);if(!g)return;g.status='rejected';g.label='';g.notes=`HUMAN_REJECTED ${new Date().toISOString()}`;persistDemo();renderSelected();applyFilter();updateCounts();notify('已标记该组无效；不会进入训练或自动传播')}
function undoGroup(){const g=state.index.get(state.selected);if(!g)return;g.status='unreviewed';g.label='';g.notes='';persistDemo();renderSelected();applyFilter();updateCounts();notify('已撤销本组审核')}
function exportDecisions(){return {format:'NovelGlyph-Review-v1',project:state.projectName,createdAt:new Date().toISOString(),source:state.mode,summary:{groups:state.groups.length,pages:state.pages.length},occurrence_overrides:[...state.occurrenceOverrides],decisions:state.groups.filter(g=>g.status!=='unreviewed').map(g=>({group_id:g.id,unicode:g.label,status:g.status,notes:g.notes,verified_by:'human'})),unreviewed:state.groups.filter(g=>g.status==='unreviewed').length,automatic_unicode_writeback:false}}
function restoreDecisions(json){if(json.format!=='NovelGlyph-Review-v1'||!Array.isArray(json.decisions))throw Error('审核文件格式不正确');if(Array.isArray(json.occurrence_overrides))restoreOccurrenceEdits(json.occurrence_overrides);let n=0;for(const d of json.decisions){const g=state.index.get(d.group_id);if(!g)continue;if(!['confirmed','rejected'].includes(d.status))continue;if(d.status==='confirmed'&&graphemes(d.unicode).length!==1)continue;g.status=d.status;g.label=d.status==='confirmed'?d.unicode:'';g.notes=d.notes||'';n++}persistDemo();renderSelected();applyFilter();updateCounts();notify(`恢复了 ${n} 组可匹配的人工审核；其他组不受影响`)}
function downloadCSV(){const lines=['group_id,unicode,status,occurrences,pages,bulk_proof_pairs,sampled_proof_pairs,risk,source'];for(const g of state.groups)lines.push([g.id,g.status==='confirmed'?g.label:'',g.status,g.count,g.pages,g.bulkEvidence||0,g.anchorEvidence||0,(g.risk||[]).toString(),g.source].map(quoteCSV).join(','));download(new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),'novelglyph_unicode_map.csv')}
function downloadJSON(){jsonDownload({format:'NovelGlyph-GroupAudit-v1',createdAt:new Date().toISOString(),project:state.projectName,groups:state.groups.map(g=>({id:g.id,count:g.count,pages:g.pages,risk:g.risk,anchorEvidence:g.anchorEvidence||0,bulkEvidence:g.bulkEvidence||0,status:g.status,unicode:g.status==='confirmed'?g.label:null,proposal:g.proposal||null,examples:g.examples.map(e=>({page:e.page,column:e.column,rect:e.rect||null})),source:g.source})),no_ocr:true,grouping_not_ground_truth:true,fullAudit:state.bulk?.summary||null},'novelglyph_group_audit.json')}
async function contextFor(ex){
 if(ex.context){const resp=await fetch(ex.context);return await resp.blob()}
 const bmp=await getBmp(ex.page);if(!bmp)return null;
 const [x0,y0,x1,y1]=ex.rect;const padX=Math.max(18,(x1-x0)),padY=Math.max(40,(y1-y0)*2);
 const a=Math.max(0,Math.floor(x0-padX)),b=Math.max(0,Math.floor(y0-padY)),c=Math.min(bmp.width,Math.ceil(x1+padX)),d=Math.min(bmp.height,Math.ceil(y1+padY));
 const cv=document.createElement('canvas');cv.width=c-a;cv.height=d-b;const ctx=cv.getContext('2d');ctx.drawImage(bmp,a,b,c-a,d-b,0,0,c-a,d-b);
 ctx.lineWidth=1.5;ctx.strokeStyle='#df3d3d';ctx.strokeRect(x0-a,y0-b,x1-x0,y1-y0);
 return new Promise(res=>cv.toBlob(res,'image/png'));
}
async function exportAIBatch(){const n=Math.min(100,Math.max(1,Number($('batchSize').value)||20)),todo=state.groups.filter(g=>g.status==='unreviewed').sort((a,b)=>((b.bulkEvidence||b.anchorEvidence||0)-(a.bulkEvidence||a.anchorEvidence||0))||b.count-a.count).slice(0,n);if(!todo.length){notify('没有待审候选');return}const zip=new JSZip(),batch=[];
 for(let i=0;i<todo.length;i++){const g=todo[i],ex=g.examples[0],imgUrl=await thumbFor(ex);const data=imgUrl.startsWith('data:')?imgUrl.split(',')[1]:null;let fn=`evidence/${safe(g.id)}.png`;
  if(data)zip.file(fn,data,{base64:true});else{fn=`evidence/${safe(g.id)}.jpg`;const rr=await fetch(imgUrl);zip.file(fn,await rr.arrayBuffer())}
  const context=await contextFor(ex);if(context)zip.file(`context/${safe(g.id)}.png`,context);
  const matched=(state.geometryAuditStale?[]:state.anchors.filter(row=>row.groupId===g.id)).slice(0,2);
  const independentEvidence=[];
  for(let j=0;j<matched.length;j++){
   const loc=matched[j].second,url=await thumbFor(loc),out=`independent_page/${safe(g.id)}_${j+1}.png`;
   if(url.startsWith('data:'))zip.file(out,url.split(',')[1],{base64:true});
   else zip.file(out,await(await fetch(url)).arrayBuffer());
   const ctx=await contextFor(loc);if(ctx)zip.file(`independent_context/${safe(g.id)}_${j+1}.png`,ctx);
   independentEvidence.push({page:loc.page,column:loc.column,image:out,context_image:ctx?`independent_context/${safe(g.id)}_${j+1}.png`:null});
  }
  batch.push({group_id:g.id,count:g.count,different_pages:g.pages,risk:g.risk,full_shape_pair_evidence:state.geometryAuditStale?0:(g.bulkEvidence||g.anchorEvidence||0),independentEvidence,image:fn,context_image:context?`context/${safe(g.id)}.png`:null,examples:g.examples.slice(0,3).map(e=>({page:e.page,column:e.column,rect:e.rect||null}))});
 }
 zip.file('review-request.json',JSON.stringify({format:'NovelGlyph-AI-Request-v1',goal:'依赖视觉判断每张是否为完整独立日文字符或标点。仅输出确定的一个 Unicode 字素；无法确定时 unicode=null。不要按上下文猜测残缺笔画。',candidates:batch},null,2));
 zip.file('AI_PROMPT.txt','请逐张检查 evidence/ 下对应的图像是否完整、独立且没有 Ruby/邻字污染。若有 independent_page/，必须对照来自另一扫描页的完整字形图，警惕同形异码。没有原始图像上下文时，不要断言形似字的 Unicode。仅输出 JSON 数组，例如 [{"group_id":"...","unicode":"の","confidence":0.92}]。不能确认则 unicode=null。此结果会被人工再次审核，不自动写回。');
 const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE'});download(blob,`novelglyph_ai_batch_${todo.length}.zip`);notify(`已导出 ${todo.length} 组图片证据和 AI 输入说明`)
}
function importAI(){let src;try{src=JSON.parse($('aiInput').value)}catch(e){notify('无效 JSON：'+e.message);return}if(!Array.isArray(src))src=src?.results;if(!Array.isArray(src)){notify('AI 输出必须是 JSON 数组或 results 数组');return}let n=0;for(const row of src){const id=String(row.group_id??row.id??'');const g=state.index.get(id);if(!g||g.status==='confirmed'||g.status==='rejected')continue;const u=String(row.unicode??row.label??'').trim();if(graphemes(u).length!==1)continue;const conf=Number(row.confidence);g.proposal={unicode:u,confidence:Number.isFinite(conf)?Math.max(0,Math.min(1,conf)):null};n++}renderSelected();applyFilter();$('aiStatus').textContent=`导入 ${n} 条有效建议；均未自动确认`;notify(`导入 ${n} 条 AI 建议，待人工确认`)}
function adopt(){const g=state.index.get(state.selected);if(!g?.proposal)return notify('本组没有建议');$('unicode').value=g.proposal.unicode;notify('建议已填入，仍需人工检查三项条件')}
function changeTab(tab){state.view=tab;document.body.classList.toggle('discovery-mode',tab==='discovery');for(const el of document.querySelectorAll('.tabs button'))el.classList.toggle('on',el.dataset.view===tab);for(const t of ['group','page','manual','discovery','overlap','transcript','ai'])$(t+'View').classList.toggle('hidden',t!==tab);if(tab==='page')renderPage();if(tab==='manual')window.NovelManual?.render();if(tab==='discovery')window.NovelDiscovery?.render();if(tab==='transcript')renderTranscript();if(tab==='overlap'){renderOverlaps();renderAnchors();renderGapProposals()}}
function refreshPageSelect(){const el=$('pageSelect');el.replaceChildren();for(let i=0;i<state.pages.length;i++){const o=document.createElement('option');o.value=i;o.textContent=`${i+1} · ${state.pages[i].name.slice(-38)}`;el.appendChild(o)}if(!state.pages.length){const o=document.createElement('option');o.textContent='无已导入原图';el.appendChild(o)}}
async function renderPage(focus=null){const idx=Number($('pageSelect').value||0),cv=$('pageCanvas'),empty=$('pageCanvasEmpty');if(!state.pages[idx]){cv.classList.add('hidden');empty.classList.remove('hidden');return}const bm=await getBmp(idx);if(!bm)return;cv.classList.remove('hidden');empty.classList.add('hidden');cv.width=bm.width;cv.height=bm.height;const ctx=cv.getContext('2d');ctx.drawImage(bm,0,0);if($('showSegments').checked){const regs=state.pageRegions.get(idx)||[];ctx.lineWidth=1.3;for(const r of regs){ctx.strokeStyle=r.risk?.length?'#e09a28':'#c52e52';ctx.strokeRect(r.x0,r.y0,r.x1-r.x0,r.y1-r.y0)}}if(focus){const rect=Array.isArray(focus)?focus:focus.rect;ctx.lineWidth=4;ctx.strokeStyle='#13a388';ctx.strokeRect(rect[0],rect[1],rect[2]-rect[0],rect[3]-rect[1]);if(!Array.isArray(focus)&&Number.isFinite(focus.cutY)){ctx.lineWidth=3;ctx.strokeStyle='#16a34a';ctx.beginPath();ctx.moveTo(rect[0]-4,focus.cutY);ctx.lineTo(rect[2]+4,focus.cutY);ctx.stroke()}}drawColumnOverlays(ctx,idx);renderColumnPanel(idx)}
let savingWorkspace=false;
async function exportProject(){
 if(savingWorkspace){notify('工作区正在打包，请勿重复点击');return}
 savingWorkspace=true;
 const btn=$('exportProject'),label=btn.textContent;
 btn.disabled=true;btn.textContent='正在保存…';
 try{
 const zip=new JSZip();const manifest={format:'NovelGlyph-Project-v1',source:state.mode,name:state.projectName,groups:state.groups.map(g=>({id:g.id,count:g.count,pages:g.pages,status:g.status,unicode:g.label||'',risk:g.risk,source:g.source,examples:g.examples,key:g.key,anchorEvidence:g.anchorEvidence||0,bulkEvidence:g.bulkEvidence||0,proposal:g.proposal||null})),pageFiles:state.pages.map(p=>p.name),automatic_unicode_writeback:false};zip.file('occurrence-decisions.json',JSON.stringify([...state.occurrenceOverrides]));zip.file('geometry-history.json',JSON.stringify({format:'NovelGlyph-Geometry-Edits-v1',history:state.geometryHistory,redo:state.geometryRedo,serial:state.editSerial,auditStale:state.geometryAuditStale}));zip.file('column-marks.json',JSON.stringify([...state.columnMarks]));zip.file('column-history.json',JSON.stringify({history:state.columnHistory,redo:state.columnRedo}));zip.file('manifest.json',JSON.stringify(manifest));if(window.NovelManual)zip.file('manual-search.json',JSON.stringify(window.NovelManual.snapshot()));if(window.NovelDiscovery)zip.file('discovery.json',JSON.stringify(window.NovelDiscovery.snapshot()));zip.file('human-decisions.json',JSON.stringify(exportDecisions()));if(state.mode==='images')zip.file('intervals.json',JSON.stringify([...state.pageRegions]));if(state.sliding)zip.file('sliding.json',JSON.stringify(state.sliding));zip.file('anchors.json',JSON.stringify(state.anchors));zip.file('columns.json',JSON.stringify([...state.columnsByPage]));zip.file('gap-proposals.json',JSON.stringify({summary:state.gapSummary,proposals:state.gapProposals}));if(state.bulk){
 zip.file('bulk-index.bin',new Uint8Array(state.bulk.words.buffer));
 zip.file('bulk-status.bin',state.bulk.statuses);
 zip.file('bulk-meta.json',JSON.stringify({pageCount:state.bulk.pageCount,pageCursor:state.bulk.pageCursor,complete:state.bulk.complete,summary:state.bulk.summary,links:state.bulk.links}));
 if(!state.bulk.complete&&state.bulk.pageCursor){
  zip.file('bulk-proofs.bin',state.bulk.proofs);
  zip.file('bulk-valid.bin',state.bulk.valid);
  zip.file('bulk-regions.bin',new Uint8Array(state.bulk.regions.buffer));
 }
 }if(state.mode==='images')for(let i=0;i<state.pages.length;i++)zip.file(`original_pages/${String(i+1).padStart(5,'0')}_${safe(state.pages[i].name)}`,state.pages[i].blob,{compression:'STORE'});const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:3}},meta=>{$('progressText').textContent=`保存 ZIP ${meta.percent.toFixed(0)}%`});download(blob,'novelglyph_project.zip');notify('已保存含页面的项目 ZIP；可保存审核结果 JSON 单独恢复')
 }finally{savingWorkspace=false;btn.disabled=false;btn.textContent=label}
}

// Only explicitly verified per-occurrence decisions are imported. Invalid or stale
// keys are ignored at reconstruction time; group decisions cannot overwrite them.
function restoreOccurrenceEdits(entries){
 if(!Array.isArray(entries))return;
 const map=new Map();
 for(const pair of entries){if(!Array.isArray(pair)||pair.length!==2)continue;
  const [k,v]=pair;if(typeof k!=='string'||k.length>220||!k.startsWith('v1:')||!v||
     v.verified_by!=='human'||v.status!=='confirmed'||typeof v.groupId!=='string'||typeof v.shapeKey!=='string'||!GlyphTranscript.oneGlyph(v.unicode))continue;
  map.set(k,{verified_by:'human',status:'confirmed',groupId:v.groupId,shapeKey:v.shapeKey,unicode:v.unicode});
 }
 state.occurrenceOverrides=map;
}
function draftNow(){return GlyphColumns.compileTranscript(GlyphTranscript.reconstruct(state.pageRegions,state.index,state.occurrenceOverrides,state.pages.map(p=>p.name)),state.columnMarks)}
function fillTranscriptPages(){const select=$('transcriptPage'),prev=select.value;select.replaceChildren();
 for(let i=0;i<state.pages.length;i++){const opt=document.createElement('option');opt.value=i;opt.textContent=`${i+1} · ${state.pages[i].name.slice(-42)}`;select.appendChild(opt)}
 if([...select.options].some(o=>o.value===prev))select.value=prev;
}
function renderTranscript(){
 fillTranscriptPages();const draft=draftNow(),tot=draft.totals;
 $('transcriptCoverage').textContent=`人工已确认并可映射 ${tot.confirmed+tot.manualOverrides}/${tot.sourceIntervals} · 占位 ${tot.unresolvedAll}`;
 const ix=Number($('transcriptPage').value||0),p=draft.pages[ix],el=$('transcriptColumns');el.replaceChildren();
 $('transcriptStatus').textContent=tot.sourceIntervals?`第 ${ix+1} 页：${p?.counts.total||0} 个原始物理候选区段，其中 ${p?.counts.confirmed||0} 个有明确人工标签。全书同形异码阻止 ${tot.ambiguous}，重叠阻止 ${tot.overlap}，边界风险阻止 ${tot.risky}。`:'没有物理字位索引：演示样本只有同形图，不构成可重建正文。';
 if(!p||!p.columns.length){el.textContent='本页没有可还原的物理列。';return}
 // Render only the selected page: 407-page projects never add 100K controls to the DOM.
 for(const col of p.columns){const box=document.createElement('section');box.className='transcript-column';const head=document.createElement('h4');head.textContent=`物理列 ${col.number}`;box.appendChild(head);
  const glyphs=document.createElement('div');glyphs.className='transcript-glyphs';
  for(const seg of col.segments){const groupLabel=document.createElement('span');groupLabel.className='column-segment-label'+(seg.forced||seg.crossing?' warn':'');groupLabel.textContent=(GlyphColumns.TYPES[seg.kind]||seg.kind)+(seg.crossing?` · ${seg.crossing} 个跨段字位待核对`:'')+(seg.forced?' · 人工逻辑断段':'');glyphs.appendChild(groupLabel);
  for(const item of seg.items){const b=document.createElement('button');b.type='button';b.className='transcript-glyph'+(item.unicode?'':' unresolved')+(['overlap','risky','ambiguous'].includes(item.status)?' conflict':'')+(state.selectedOccurrence===item.key?' selected':'');b.textContent=item.unicode||'□';b.title=`第 ${item.page+1} 页 · 列 ${col.number} · ${item.status} · ${item.region.groupId||'缺失字形组'}`;
   b.addEventListener('click',()=>selectOccurrence(item));glyphs.appendChild(b)} }
  box.classList.toggle('category-excluded',col.category==='excluded');box.classList.toggle('category-ruby',col.category==='ruby');box.appendChild(glyphs);el.appendChild(box)
 }
}
function selectOccurrence(item){state.selectedOccurrence=item.key;const r=item.region,ed=state.occurrenceOverrides.get(item.key);
 $('occurrenceSummary').textContent=`页 ${item.page+1} · 列 ${r.column} · [${r.x0},${r.y0},${r.x1},${r.y1}] · ${item.status} · 形状组 ${r.groupId||'无'}`;
 $('occurrenceUnicode').value=ed?.unicode||item.unicode||'';
 for(const id of ['occurrenceWhole','occurrenceNoRuby','occurrenceContext'])$(id).checked=!!ed;
 renderTranscript();void refreshGeometryEditor(item);
}
function getSelectedOccurrence(){
 if(!state.selectedOccurrence)return null;
 const draft=draftNow();for(const p of draft.pages)for(const c of p.columns)for(const item of c.items){if(item.key===state.selectedOccurrence)return item}
 return null;
}
function approveOccurrence(){const item=getSelectedOccurrence();if(!item)return notify('请先从逐页文本中点选一个物理位置');
 const u=$('occurrenceUnicode').value.trim();if(!GlyphTranscript.oneGlyph(u))return notify('只允许一个 Unicode 字素；此处若有两字请先检查分割');
 if(!['occurrenceWhole','occurrenceNoRuby','occurrenceContext'].every(id=>$(id).checked))return notify('必须在原图核对完整字形、Ruby 邻字、所在上下文');
 state.occurrenceOverrides.set(item.key,{verified_by:'human',status:'confirmed',groupId:item.region.groupId||'',shapeKey:item.region.key,unicode:u});renderTranscript();notify(`只确认了第 ${item.page+1} 页当前字位：${u}，不会修改同形组`)
}
function undoOccurrence(){if(!state.selectedOccurrence)return;state.occurrenceOverrides.delete(state.selectedOccurrence);renderTranscript();notify('已撤销当前位置确认')}
function viewOccurrencePage(){const item=getSelectedOccurrence();if(!item)return notify('先选择字位');$('pageSelect').value=String(item.page);changeTab('page');renderPage([item.region.x0,item.region.y0,item.region.x1,item.region.y1])}
function viewOccurrenceGroup(){const item=getSelectedOccurrence();if(!item)return notify('先选择字位');if(!state.index.has(item.region.groupId))return notify('原始位置未关联有效形状组');selectGroup(item.region.groupId);changeTab('group')}
function downloadDraftText(){const d=draftNow();if(!d.totals.sourceIntervals)return notify('请先完成原图投影分析');download(new Blob(['\ufeff'+GlyphColumns.textDraft(d)],{type:'text/plain;charset=utf-8'}),'novelglyph_未确认全文草稿.txt')}
function downloadDraftJSON(){const d=draftNow();if(!d.totals.sourceIntervals)return notify('请先完成原图投影分析');jsonDownload(GlyphColumns.jsonDraft(d),'novelglyph_逐页字位审核草稿.json')}


// V0.6: Human-supervised physical layout edits. Every result comes from the
// original pixel array, never OCR text or fixed character count.
function geometryStatus(message=''){
 const e=$('geometryStatus');if(!e)return;
 e.textContent=(message?message+' · ':'')+`撤销记录 ${state.geometryHistory.length}，重做 ${state.geometryRedo.length}`+
   (state.geometryAuditStale?' · 旧完整轮廓组证据已标记过期':'');
 $('geometryUndo').disabled=!state.geometryHistory.length;
 $('geometryRedo').disabled=!state.geometryRedo.length;
}
async function refreshGeometryEditor(item=null){
 const split=$('geometrySplitY'),move=$('geometryMoveY');if(!split||!move)return;
 split.replaceChildren();move.replaceChildren();
 const placeholder=(el,text)=>{const o=document.createElement('option');o.value='';o.textContent=text;el.appendChild(o)};
 placeholder(split,'无可用内部真实投影空谷');placeholder(move,'无可用两字间空谷');
 if(!item)item=getSelectedOccurrence();
 if(!item||state.mode!=='images'){geometryStatus();return}
 try{
   const r=item.region,page=item.page,original=state.pageRegions.get(page),g=await getGrayPage(page);
   if(!g||state.selectedOccurrence!==item.key)return;
   for(const gap of GlyphGeometry.rows(g.gray,g.width,r.x0,r.x1,r.y0,r.y1)){
    if(gap.cut<=r.y0||gap.cut>=r.y1)continue;
    const option=document.createElement('option');option.value=gap.cut;option.textContent=`y=${gap.cut} · 空谷 ${gap.width}px`;
    split.appendChild(option);
   }
   const next=GlyphGeometry.neighboring(original,r);
   if(next){
    const entire={...r,y1:next.y1};
    for(const gap of GlyphGeometry.rows(g.gray,g.width,r.x0,r.x1,entire.y0,entire.y1)){
     if(gap.cut<=r.y0||gap.cut>=next.y1)continue;
     try{GlyphGeometry.move(g.gray,g.width,g.height,r,next,gap.cut)}catch(_){continue}
     const option=document.createElement('option');option.value=gap.cut;
     option.textContent=`y=${gap.cut} · 两字合并范围空谷 ${gap.width}px`;
     move.appendChild(option);
    }
   }
   geometryStatus(`原图第 ${page+1} 页 · 当前 y=${r.y0}..${r.y1}`);
 }catch(e){geometryStatus('候选空谷读取失败：'+e.message)}
}
function syncGeometryGroups(){
 // Keep all unchanged original group decisions; recalculate counts of edited
 // physical intervals, and discard empty edit-derived groups only.
 const positions=new Map();
 for(const [page,regs] of state.pageRegions)for(const r of regs){
  if(!r.groupId)continue;
  const item={page,column:r.column,rect:r.rect,risk:r.risk,width:r.w,height:r.h};
  let entry=positions.get(r.groupId);if(!entry){entry={count:0,examples:[],pageIds:new Set(),firstRegion:r};positions.set(r.groupId,entry)}
  entry.count++;entry.pageIds.add(page);if(entry.examples.length<5)entry.examples.push(item);
 }
 state.groups=state.groups.filter(g=>g.source!=='MANUAL_BOUNDARY_EDIT'||positions.has(g.id));
 state.index=new Map(state.groups.map(g=>[g.id,g]));
 for(const g of state.groups){const z=positions.get(g.id);if(!z)continue;
  g.count=z.count;g.pages=z.pageIds.size;g.examples=z.examples;
  if(g.source==='MANUAL_BOUNDARY_EDIT')g.risk=[GlyphGeometry.RISK];
 }
 // Newly derived physical regions always start UNREVIEWED even when they
 // happen to have the same image as a previously confirmed parent group.
 for(const [id,z] of positions){if(state.index.has(id))continue;
  const first=z.firstRegion;
  if(!first)continue;
  const g={id,key:first.key,source:'MANUAL_BOUNDARY_EDIT',risk:[GlyphGeometry.RISK],status:'unreviewed',label:'',
    count:z.count,pages:z.pageIds.size,examples:z.examples,locations:[],proof:first.proof,anchorEvidence:0,bulkEvidence:0};
  state.groups.push(g);state.index.set(id,g);
 }
}
function applyGeometryTransaction(tx,reverse){
 state.pageRegions.set(tx.page,reverse?tx.before:tx.after);
 for(const k of tx.oldKeys)state.occurrenceOverrides.delete(k);
 if(reverse)for(const [k,v] of tx.previousOverrides)state.occurrenceOverrides.set(k,v);
 state.selectedOccurrence=null;
 syncGeometryGroups();state.geometryAuditStale=true;
 for(const g of state.groups)if(g.source==='MANUAL_BOUNDARY_EDIT')g.bulkEvidence=0;
 renderTranscript();applyFilter();updateCounts();updateBulkStatus();
 geometryStatus(reverse?'已撤销边界修改':'已应用原像素边界修改');
}
async function performGeometryEdit(operation){
 if(state.busy||state.bulkRunning)return notify('当前正在处理，请先完成或暂停');
 const item=getSelectedOccurrence();if(!item)return notify('先在逐页文本选择要修复的字位');
 if(state.mode!=='images')return notify('边界操作需要原书图像，演示形状组不支持切分');
 const page=item.page,r=item.region;
 try{
  const original=state.pageRegions.get(page);if(!original?.includes(r))throw Error('选中的位置已变化，请重新选择');
  const img=await getGrayPage(page);if(!img)throw Error('无法打开源扫描');
  let victims=[r],replacement;
  if(operation==='SPLIT'){
   const y=Number($('geometrySplitY').value);if(!$('geometrySplitY').value)throw Error('没有可用的真实空谷');
   replacement=GlyphGeometry.split(img.gray,img.width,img.height,r,y);
  }else{
   const next=GlyphGeometry.neighboring(original,r);if(!next)throw Error('当前物理列已经没有下一个候选区段');
   victims=[r,next];
   if(operation==='MERGE')replacement=GlyphGeometry.merge(img.gray,img.width,img.height,r,next);
   else {const v=$('geometryMoveY').value;if(!v)throw Error('没有真实空谷可供移动边界');
    replacement=GlyphGeometry.move(img.gray,img.width,img.height,r,next,Number(v))}
  }
  // A new geometry-derived group is isolated from ALL existing approved groups.
  for(const n of replacement)n.groupId=`m-${page}-${++state.editSerial}`;
  const before=original.slice();const after=before.filter(x=>!victims.includes(x)).concat(replacement);
  after.sort((a,b)=>a.column-b.column||a.y0-b.y0||a.y1-b.y1);
  const oldKeys=victims.map(x=>GlyphTranscript.keyOf(page,x));
  const previousOverrides=oldKeys.filter(k=>state.occurrenceOverrides.has(k)).map(k=>[k,state.occurrenceOverrides.get(k)]);
  const tx={page,operation,before,after,oldKeys,previousOverrides,createdAt:new Date().toISOString()};
  applyGeometryTransaction(tx,false);state.geometryHistory.push(tx);state.geometryHistory=state.geometryHistory.slice(-80);state.geometryRedo=[];
  geometryStatus(`${operation}：新位置 ${replacement.length} 个；全部需重新确认`);
  notify('物理区段已修改：新字形未赋 Unicode。可撤销或保存项目 ZIP');
 }catch(e){notify('拒绝切分修改：'+e.message)}
}
function undoGeometry(){const tx=state.geometryHistory.pop();if(!tx)return;
 applyGeometryTransaction(tx,true);state.geometryRedo.push(tx);state.geometryAuditStale=state.geometryHistory.length>0;updateBulkStatus();geometryStatus('已恢复编辑前的源图位置与人工确认');}
function redoGeometry(){const tx=state.geometryRedo.pop();if(!tx)return;
 applyGeometryTransaction(tx,false);state.geometryHistory.push(tx);state.geometryAuditStale=true;updateBulkStatus();geometryStatus('已重做编辑，新增区段仍未审核');}



// V0.8: rank geometric anomalies without inferring Unicode or silently editing regions.
function advisePageColumns(page){
 return GlyphColumnAdvisor.summaries(state.columnsByPage.get(page)||[],state.pageRegions.get(page)||[]);
}
function priorityQueue(){
 const mode=$('columnPriorityMode')?.value||'risk';
 return GlyphColumnAdvisor.queue(state.columnsByPage,state.pageRegions,state.columnMarks,mode);
}
function priorityJump(direction){
 const rows=priorityQueue();
 if(!rows.length){notify('没有符合此队列的物理列');return}
 const cur=currentColumn(),ix=cur?rows.findIndex(x=>x.page===cur.page&&x.column===cur.col):-1;
 const next=ix<0?(direction<0?rows.length-1:0):(ix+direction+rows.length)%rows.length;
 const selected=rows[next];
 showColumn(selected.page,selected.column);
 columnMessage(`优先队列 ${next+1}/${rows.length}，几何风险 ${selected.score} 分；${selected.suggestedAction}`);
}
function renderPrioritySummary(){
 const el=$('columnPrioritySummary');if(!el)return;
 const rows=priorityQueue(),all=state.columnsByPage.size,cur=currentColumn();
 const ix=cur?rows.findIndex(x=>x.page===cur.page&&x.column===cur.col):-1;
 el.textContent=`${all} 页已检测物理列 · 当前队列 ${rows.length} 列`+
   (ix>=0?` · 当前第 ${ix+1}/${rows.length} 项`:' · 使用前后键跳到队列项')+
   '；分数只是人工审核顺序，不是识别置信度';
}
async function renderCutSuggestions(page,col){
 const out=$('columnSuggestionList');
 if(!out)return;
 const source=columnSource(page,col);
 if(!source){out.textContent='请选择有效物理列';return}
 out.textContent='读取原图、分析真实空谷…';
 try{
  const img=await getGrayPage(page);
  if(!img)return;
  const cur=currentColumn();
  if(!cur||cur.page!==page||cur.col!==col)return; // stale async result
  const regions=(state.pageRegions.get(page)||[]).filter(r=>r.column===col);
  const choices=GlyphColumnAdvisor.gaps(img.gray,img.width,img.height,source,regions,{column:col,maxResults:16});
  out.replaceChildren();
  if(!choices.length){out.textContent='没有满足安全像素要求的内部空谷，可人工标记逻辑断段';return}
  for(const choice of choices){
   const b=document.createElement('button');b.type='button';
   b.className='gap-choice'+(choice.crossing?' warn':'');
   b.title=`原始纵坐标 y=${choice.y}；空谷宽 ${choice.width}px；${choice.reason}`;
   b.textContent=`y=${choice.y} · ${choice.width}px 空谷${choice.crossing?' · ⚠ 跨旧区段':''}`;
   b.onclick=()=>{const now=currentColumn();if(!now||now.page!==page||now.col!==col)return;
    state.columnSelection.y=choice.y;$('columnCutY').value=String(choice.y);void renderPage();
    columnMessage(`已选择切线 y=${choice.y}，${choice.reason}。尚未实际切分，请检查后点击“拆分此列”`);
   };
   out.appendChild(b);
  }
 }catch(err){const cur=currentColumn();if(cur?.page===page&&cur?.col===col)out.textContent='切线候选分析失败：'+err.message}
}

// V0.7 manual column categorization and paragraph-like splits.
function columnSource(page,col){return state.columnsByPage.get(page)?.[col-1]||null}
function columnMark(page,col){const source=columnSource(page,col);if(!source)return null;const key=GlyphColumns.id(page,col),saved=state.columnMarks.get(key);return GlyphColumns.valid(saved,source)?saved:GlyphColumns.create(source)}
function currentColumn(){const x=state.columnSelection;return x&&x.page===Number($('pageSelect').value||0)&&columnSource(x.page,x.col)?x:null}
function columnMessage(msg){$('columnStatus').textContent=msg+` · 撤销 ${state.columnHistory.length} / 重做 ${state.columnRedo.length}`}
function showColumn(page,col,y=null){if(!columnSource(page,col))return;const source=columnSource(page,col);state.columnSelection={page,col,y:Number.isFinite(y)?Math.round(y):Math.floor((source.y0+source.y1)/2)};$('pageSelect').value=String(page);renderColumnPanel(page);renderPrioritySummary();void renderPage()}
function drawColumnOverlays(ctx,page){const cols=state.columnsByPage.get(page)||[];if(!cols.length)return;
 ctx.save();const selected=currentColumn();for(let c=1;c<=cols.length;c++){
  const source=cols[c-1],mark=columnMark(page,c),active=selected?.col===c;
  ctx.lineWidth=active?3:1;ctx.strokeStyle=active?'#087d9b':'rgba(50,95,132,.45)';ctx.strokeRect(source.x0,source.y0,source.x1-source.x0,source.y1-source.y0);
  if(active){ctx.fillStyle='rgba(18,150,167,.07)';ctx.fillRect(source.x0,source.y0,source.x1-source.x0,source.y1-source.y0)}
  for(let i=0;i<mark.segments.length-1;i++){
   const y=mark.segments[i].end;ctx.setLineDash([6,4]);ctx.strokeStyle=mark.segments[i+1].forced?'#e67e22':'#14a36a';ctx.lineWidth=active?3:2;ctx.beginPath();ctx.moveTo(source.x0-4,y);ctx.lineTo(source.x1+4,y);ctx.stroke();ctx.setLineDash([])
  }
 }
 if(selected){const source=cols[selected.col-1];ctx.strokeStyle='#2068cd';ctx.setLineDash([3,3]);ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(source.x0-7,selected.y);ctx.lineTo(source.x1+7,selected.y);ctx.stroke();}
 ctx.restore();
}
function columnRiskHints(page,col){const regs=(state.pageRegions.get(page)||[]).filter(r=>r.column===col);const narrow=regs.filter(r=>(r.risk||[]).some(x=>x==='NARROW_SYMBOL'||x==='SHORT_REGION')).length,internal=regs.filter(r=>(r.risk||[]).includes('INTERNAL_REAL_GAP')).length;return {narrow,internal,label:narrow||internal?` · 疑似窄符号 ${narrow} / 内部空谷 ${internal}`:''}}
function jumpColumn(direction){const filter=$('columnFilter').value,all=[];for(let p=0;p<state.pages.length;p++){const cols=state.columnsByPage.get(p)||[];for(let c=1;c<=cols.length;c++)if(filter==='all'||columnMark(p,c).segments.some(s=>s.kind===filter))all.push({page:p,col:c})}if(!all.length)return notify('当前分类下没有匹配物理列');const cur=currentColumn(),ix=cur?all.findIndex(x=>x.page===cur.page&&x.col===cur.col):-1;const n=(ix<0?(direction<0?all.length-1:0):(ix+direction+all.length)%all.length);showColumn(all[n].page,all[n].col)}
function renderColumnPanel(page){const cols=state.columnsByPage.get(page)||[];const selected=currentColumn();
 $('colStats').textContent=cols.length?`${cols.length} 列 · 已分类 ${cols.filter((_,i)=>state.columnMarks.has(GlyphColumns.id(page,i+1))).length} 列`:'本页尚无物理列';
 const list=$('columnSelect'),prev=selected?.col||null;list.replaceChildren();for(let c=1;c<=cols.length;c++){const mark=columnMark(page,c);const o=document.createElement('option');o.value=c;o.textContent=`第 ${c} 列 · ${mark.segments.length} 段`;list.appendChild(o)}if(prev)list.value=String(prev);
 const tiles=$('columnTiles');tiles.replaceChildren();const filter=$('columnFilter').value;
 cols.forEach((_,i)=>{const c=i+1,mark=columnMark(page,c),types=[...new Set(mark.segments.map(s=>s.kind))];if(filter!=='all'&&!types.includes(filter))return;const b=document.createElement('button');b.type='button';b.className='column-tile'+(selected?.col===c?' on':'');b.innerHTML=`<b>第 ${c} 列</b>`;b.appendChild(document.createTextNode(types.map(k=>GlyphColumns.TYPES[k]).join(' / ')+` · ${mark.segments.length} 段`+columnRiskHints(page,c).label));b.addEventListener('click',()=>showColumn(page,c));tiles.appendChild(b)});
 if(!selected){$('columnSummary').textContent=cols.length?'请点击页面上的单列或选择列号':'请先导入扫描页并运行投影分析';$('columnAdvisorReasons').textContent='请选择物理列查看风险提示';$('columnSuggestionList').textContent='选择一列后显示空谷';renderPrioritySummary();return}
 const advice=advisePageColumns(page)[selected.col-1];$('columnAdvisorReasons').textContent=advice?(`几何审核优先级 ${advice.score}/100 · ${advice.suggestedAction} · `+(advice.reasons.length?advice.reasons.map(r=>`${r.label} ${r.count}`).join('，'):'当前没有明显的投影异常；依然需要人工确认')):'没有审核数据';
 const mark=columnMark(page,selected.col);$('columnSummary').textContent=`第 ${page+1} 页 · 第 ${selected.col} 列 · 原图 X=${mark.x0}..${mark.x1}，Y=${mark.y0}..${mark.y1} · 共 ${mark.segments.length} 个独立列段`;
 const segIndex=GlyphColumns.segmentAt(mark,selected.y),segment=$('columnSegment');segment.replaceChildren();mark.segments.forEach((seg,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`第 ${i+1} 段 · y=${seg.start}..${seg.end} · ${GlyphColumns.TYPES[seg.kind]}`;segment.appendChild(o)});segment.value=String(Math.max(0,segIndex));
 $('columnType').value=mark.segments[0].kind;$('columnSegmentType').value=mark.segments[Math.max(0,segIndex)]?.kind||'body';$('columnCutKind').value=$('columnCutKind').value||'punctuation';$('columnCutY').value=String(selected.y);$('columnNote').value=mark.note||'';
 void renderCutSuggestions(page,selected.col);
}
function storeColumnChange(page,col,after,op){const source=columnSource(page,col),key=GlyphColumns.id(page,col);if(!source||!GlyphColumns.valid(after,source))throw Error('新列段超出原始扫描的物理列边界');const before=state.columnMarks.has(key)?structuredClone(state.columnMarks.get(key)):null;const next=structuredClone(after);state.columnMarks.set(key,next);state.columnHistory.push({key,before,after:structuredClone(next),op});state.columnHistory=state.columnHistory.slice(-150);state.columnRedo=[];columnMessage('已修改单列：'+op);renderPrioritySummary();void renderPage();if(state.view==='transcript')renderTranscript()}
async function manualColumnCut(){if(state.busy||state.bulkRunning)return notify('分析过程中不能修改列段');const cur=currentColumn();if(!cur)return notify('请先从原图选择一列');const source=columnSource(cur.page,cur.col),mark=columnMark(cur.page,cur.col);let y=Math.round(Number($('columnCutY').value));if(!Number.isFinite(y))return notify('请输入有效的原图 y 坐标');let forced=false;
 try{
  const img=await getGrayPage(cur.page);if(!img)throw Error('没有对应的原始扫描');
  const gap=GlyphColumns.nearestGap(img.gray,img.width,img.height,source,y,14);
  if(gap)y=gap.y;else if($('columnForceLogical').checked)forced=true;else throw Error('附近没有连续 2 行的原图无墨迹空谷；可在原图选择其他位置，或明确勾选“仅逻辑断段”');
  const result=GlyphColumns.split(mark,y,$('columnCutKind').value,forced);
  const crossing=(state.pageRegions.get(cur.page)||[]).filter(r=>r.column===cur.col&&r.y0<y&&r.y1>y).length;
  result.note=$('columnNote').value.slice(0,300);storeColumnChange(cur.page,cur.col,result,forced?'人工逻辑断段':'原图空谷断段');state.columnSelection.y=y+1;
  const warning=crossing?`；${crossing} 个原有候选字位跨过断段线，请另外使用“字位边界修复”核对`:'，没有跨线候选字位';
  columnMessage(`已在 y=${y} 保存列段${forced?'（非无墨迹切线）':''}${warning}`);void renderPage();
 }catch(e){notify('拒绝单列拆分：'+e.message)}
}
function changeColumnKind(which){const cur=currentColumn();if(!cur)return notify('请先选择物理列');const mark=columnMark(cur.page,cur.col),i=Number($('columnSegment').value||0);try{let after;if(which==='all')after=GlyphColumns.classifyAll(mark,$('columnType').value);else after=GlyphColumns.classify(mark,i,$('columnSegmentType').value);after.note=$('columnNote').value.slice(0,300);storeColumnChange(cur.page,cur.col,after,'分类'+(which==='all'?'整列':'当前段'))}catch(e){notify(e.message)}}
function removeColumnCut(){const cur=currentColumn();if(!cur)return notify('请先选择列');const mark=columnMark(cur.page,cur.col);try{const i=Number($('columnSegment').value||0),after=GlyphColumns.joinAt(mark,i);storeColumnChange(cur.page,cur.col,after,'合并两个相邻列段')}catch(e){notify('无法合并：'+e.message)}}
function columnHistoryStep(reverse){const source=reverse?state.columnHistory:state.columnRedo,target=reverse?state.columnRedo:state.columnHistory,tx=source.pop();if(!tx)return notify('没有更多列段修改记录');const [page,col]=tx.key.split(':').map(Number),actual=columnSource(page,col);if(!actual){notify('历史列坐标已失效');return}const value=reverse?tx.before:tx.after;if(value&&!GlyphColumns.valid(value,actual)){notify('历史列坐标已变化，拒绝恢复');return}if(value)state.columnMarks.set(tx.key,structuredClone(value));else state.columnMarks.delete(tx.key);target.push(tx);state.columnSelection={page,col,y:actual.y0+10};$('pageSelect').value=String(page);void renderPage();if(state.view==='transcript')renderTranscript();columnMessage(reverse?'已撤销单列修改':'已重做单列修改')}
function wireColumnEditor(){const kinds=Object.entries(GlyphColumns.TYPES);
 $('columnPriorityMode').onchange=renderPrioritySummary;
 $('columnPriorityPrev').onclick=()=>priorityJump(-1);
 $('columnPriorityNext').onclick=()=>priorityJump(1);
 $('columnMarkReview').onclick=()=>{const cur=currentColumn();if(!cur)return notify('先选中一列');const next=GlyphColumns.classifyAll(columnMark(cur.page,cur.col),'review');storeColumnChange(cur.page,cur.col,next,'人工标记待复核');renderColumnPanel(cur.page)};for(const id of ['columnFilter','columnType','columnSegmentType','columnCutKind']){const el=$(id);if(id==='columnFilter')for(const [key,label] of kinds){const o=document.createElement('option');o.value=key;o.textContent=label;el.appendChild(o)}else for(const [key,label] of kinds){const o=document.createElement('option');o.value=key;o.textContent=label;el.appendChild(o)}}
 $('columnCutKind').value='punctuation';$('columnNote').onchange=()=>{const cur=currentColumn();if(!cur)return;const mark=structuredClone(columnMark(cur.page,cur.col));mark.note=$('columnNote').value.slice(0,300);storeColumnChange(cur.page,cur.col,mark,'保存列备注')};$('columnFilter').onchange=()=>renderColumnPanel(Number($('pageSelect').value||0));$('columnPrev').onclick=()=>jumpColumn(-1);$('columnNext').onclick=()=>jumpColumn(1);$('columnSelect').onchange=e=>showColumn(Number($('pageSelect').value||0),Number(e.target.value));$('columnSegment').onchange=()=>{const cur=currentColumn();if(!cur)return;const mark=columnMark(cur.page,cur.col),seg=mark.segments[Number($('columnSegment').value)];if(!seg)return;state.columnSelection.y=Math.floor((seg.start+seg.end)/2);$('columnSegmentType').value=seg.kind;$('columnCutY').value=String(state.columnSelection.y);void renderPage()};
 $('columnCutY').onchange=()=>{const cur=currentColumn();if(!cur)return;state.columnSelection.y=Math.round(Number($('columnCutY').value));void renderPage()};$('columnSetType').onclick=()=>changeColumnKind('all');$('columnSetSegmentType').onclick=()=>changeColumnKind('segment');$('columnCut').onclick=()=>void manualColumnCut();$('columnRemoveCut').onclick=removeColumnCut;$('columnUndo').onclick=()=>columnHistoryStep(true);$('columnRedo').onclick=()=>columnHistoryStep(false);
 $('columnExport').onclick=()=>jsonDownload({format:'NovelGlyph-Column-Annotations-v1',warning:'仅为人工阅读结构与审阅分类，不代表已识别 Unicode',columns:GlyphColumns.exportColumnRows(state.columnMarks)},'novelglyph_单列分类与分段.json');
 const pickColumnAt=(ev)=>{const canvas=$('pageCanvas'),box=canvas.getBoundingClientRect();if(!box.width||!box.height)return;const x=Math.round((ev.clientX-box.left)*canvas.width/box.width),y=Math.round((ev.clientY-box.top)*canvas.height/box.height),page=Number($('pageSelect').value||0),cols=state.columnsByPage.get(page)||[];let best=-1,distance=Infinity;for(let i=0;i<cols.length;i++){const c=cols[i];if(y<c.y0||y>=c.y1)continue;const d=x<c.x0?c.x0-x:x>=c.x1?x-c.x1+1:0;if(d<distance){distance=d;best=i}}if(best<0||distance>12)return;showColumn(page,best+1,y)};
 $('pageCanvas').addEventListener('click',pickColumnAt);
 let dragging=false;$('pageCanvas').addEventListener('pointerdown',ev=>{if(ev.button!==0)return;dragging=true;$('pageCanvas').setPointerCapture?.(ev.pointerId)});
 $('pageCanvas').addEventListener('pointermove',ev=>{if(!dragging)return;const canvas=$('pageCanvas'),box=canvas.getBoundingClientRect();if(!box.height)return;const y=Math.round((ev.clientY-box.top)*canvas.height/box.height);$('columnCutY').value=String(y)});
 $('pageCanvas').addEventListener('pointerup',ev=>{if(!dragging)return;dragging=false;pickColumnAt(ev)});
 $('pageCanvas').addEventListener('pointercancel',()=>{dragging=false});

}

function wire(){
 $('dropArea').onclick=()=>$('fileInput').click();$('dropArea').onkeydown=e=>{if(e.key==='Enter'||e.key===' ')$('fileInput').click()};
 for(const ev of ['dragenter','dragover'])$('dropArea').addEventListener(ev,e=>{e.preventDefault();$('dropArea').classList.add('drag')});$('dropArea').addEventListener('dragleave',()=>$('dropArea').classList.remove('drag'));
 $('dropArea').addEventListener('drop',async e=>{e.preventDefault();$('dropArea').classList.remove('drag');try{await ingest([...e.dataTransfer.files])}catch(err){notify(err.message)}});
 $('fileInput').onchange=async e=>{try{await ingest([...e.target.files])}catch(err){notify(err.message)}e.target.value=''};
 $('importWorkspaceBtn').onclick=()=>$('workspaceInput').click();
 $('workspaceInput').onchange=async e=>{
  try{const file=e.target.files?.[0];if(!file)return;
   if(!/\.zip$/i.test(file.name))throw Error('请选择 NovelGlyph 保存的项目 ZIP');
   const zip=await JSZip.loadAsync(file);
   if(!zip.file('manifest.json'))throw Error('此 ZIP 不含项目 manifest.json；普通书页包请使用上方上传入口');
   await loadProjectZip(zip);
  }catch(err){notify('导入工作区失败：'+err.message)}finally{e.target.value=''}
 };
 $('folderBtn').onclick=()=>$('folderInput').click();$('folderInput').onchange=async e=>{try{await ingest([...e.target.files])}catch(err){notify(err.message)}e.target.value=''};
 $('demoBtn').onclick=loadDemo;$('analyze').onclick=analyze;$('bulkAudit').onclick=()=>void runBulkAudit();$('filter').onchange=applyFilter;$('search').oninput=applyFilter;
 $('prevGroup').onclick=()=>moveGroup(-1);$('nextGroup').onclick=()=>moveGroup(1);
 $('prevPage').onclick=()=>{state.listPage--;renderList()};$('nextPage').onclick=()=>{state.listPage++;renderList()};
 $('confirm').onclick=confirmGroup;$('reject').onclick=rejectGroup;$('undo').onclick=undoGroup;$('adoptProposal').onclick=adopt;
 $('exportReview').onclick=()=>jsonDownload(exportDecisions(),'novelglyph_human_decisions.json');$('exportCSV').onclick=downloadCSV;$('exportJSON').onclick=downloadJSON;
 $('exportProject').onclick=()=>void exportProject().catch(e=>notify('导出失败：'+e.message));
 $('aiFileButton').onclick=()=>$('aiFileInput').click();$('aiFileInput').onchange=async e=>{try{if(!e.target.files?.length)return;$('aiInput').value=await e.target.files[0].text();importAI()}catch(err){notify('导入 AI JSON 失败：'+err.message)}finally{e.target.value=''}};
 $('exportAI').onclick=()=>void exportAIBatch().catch(e=>notify('导出 AI 包失败：'+e.message));$('importAI').onclick=importAI;
 $('importSnapshot').onclick=()=>$('snapshotInput').click();$('snapshotInput').onchange=async e=>{try{restoreDecisions(JSON.parse(await e.target.files[0].text()))}catch(err){notify(err.message)}e.target.value=''};
 $('reset').onclick=()=>{if(confirm('确定清空当前页面内的工作区？已保存的 ZIP 和 JSON 文件不会受影响。')){clearState();notify('已清空当前项目')}};
 for(const el of document.querySelectorAll('[data-view]'))el.onclick=()=>changeTab(el.dataset.view);
 $('pageSelect').onchange=()=>{state.columnSelection=null;void renderPage()};$('showSegments').onchange=()=>void renderPage();wireColumnEditor();
 $('transcriptPage').onchange=()=>{state.selectedOccurrence=null;renderTranscript();void refreshGeometryEditor()};$('occurrenceApprove').onclick=approveOccurrence;$('occurrenceUndo').onclick=undoOccurrence;$('occurrenceShowPage').onclick=viewOccurrencePage;$('occurrenceShowGroup').onclick=viewOccurrenceGroup;$('exportTranscriptTXT').onclick=downloadDraftText;$('exportTranscriptJSON').onclick=downloadDraftJSON;
 $('geometrySplit').onclick=()=>void performGeometryEdit('SPLIT');$('geometryMerge').onclick=()=>void performGeometryEdit('MERGE');$('geometryMove').onclick=()=>void performGeometryEdit('MOVE');$('geometryUndo').onclick=undoGeometry;$('geometryRedo').onclick=redoGeometry;geometryStatus();
 $('prevOverlap').onclick=()=>{state.overlapPage--;renderOverlaps()};$('nextOverlap').onclick=()=>{state.overlapPage++;renderOverlaps()};
 document.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;if(e.key==='ArrowRight')moveGroup(1);if(e.key==='ArrowLeft')moveGroup(-1)});
}
wire();renderAll();
