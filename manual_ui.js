/* 1.0 manual-box-first workflow. Original pages only; does not require OCR,
 * column projection, the existing segmentation map, or Unicode inference. */
(function(){
'use strict';
const ui={items:[],selectedId:'',page:0,drag:null,rect:null,worker:null,running:false,cancelled:false,seq:0,resultOffset:0,pageFilter:'all',displayRect:null,runEpoch:0,coverageRevision:0,auditRunning:false,auditCancel:false,auditRows:null};
const $=id=>document.getElementById(id);
const m=()=>ui.items.find(x=>x.id===ui.selectedId);
const int=(x,a,b)=>Math.max(a,Math.min(b,Math.round(x)));
const fileName=(i)=>state.pages[i]?.name||String(i+1);
function toast(msg){$('manualStatus').textContent=msg;notify(msg)}
function reset(){invalidateCoverage();stop();ui.items=[];ui.selectedId='';$('manualResume').disabled=true;ui.page=0;ui.rect=null;ui.drag=null;ui.resultOffset=0;ui.displayRect=null;fillPages();fillTemplates();renderMatches();renderSource()}
function snapshot(){return {format:'NovelGlyph-Manual-Search-v1',items:ui.items.map(t=>({id:t.id,sourcePage:t.sourcePage,rect:t.rect,threshold:t.threshold,scoreMin:t.scoreMin,scope:t.scope,sourceName:t.sourceName,unicode:t.unicode||'',matches:t.matches,complete:!!t.complete,scanPages:t.scanPages||0})),selectedId:ui.selectedId};}
function restore(v){if(!v||v.format!=='NovelGlyph-Manual-Search-v1'||!Array.isArray(v.items))return;
 ui.items=v.items.slice(0,100).filter(t=>Number.isInteger(t.sourcePage)&&t.sourcePage>=0&&t.sourcePage<state.pages.length&&Array.isArray(t.rect)&&t.rect.length===4)
  .map(t=>({...t,template:null,matches:Array.isArray(t.matches)?t.matches.filter(a=>Number.isInteger(a.page)&&a.page>=0&&a.page<state.pages.length).slice(0,100000):[],complete:!!t.complete}));
 ui.selectedId=ui.items.some(x=>x.id===v.selectedId)?v.selectedId:ui.items[0]?.id||'';invalidateCoverage();ui.resultOffset=0;fillPages();fillTemplates();renderMatches();renderSource();
}
function fillPages(){const el=$('manualPageSelect'),prev=el.value;el.replaceChildren();state.pages.forEach((p,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=`${i+1} · ${p.name.slice(-45)}`;el.append(o)});if(!state.pages.length){let o=document.createElement('option');o.textContent='请先导入书页';el.append(o)}else{ui.page=Number.isInteger(+prev)&&+prev<state.pages.length?+prev:Math.min(ui.page,state.pages.length-1);el.value=String(ui.page)}}
function fillTemplates(){const el=$('manualTemplateSelect');el.replaceChildren();for(const t of ui.items){const o=document.createElement('option');o.value=t.id;o.textContent=`${t.id} · 第${t.sourcePage+1}页 · ${t.matches.length} 命中${t.complete?'':' · 未完成'}`;el.append(o)}if(!ui.items.length){const o=document.createElement('option');o.textContent='尚未选框搜索';el.append(o)}else if(ui.selectedId)el.value=ui.selectedId;
 $('manualResume').disabled=!m()||m().complete||ui.running;}
function point(ev){const canvas=$('manualCanvas'),box=canvas.getBoundingClientRect();if(!box.width||!box.height)return null;
 return [int((ev.clientX-box.left)/box.width*canvas.width,0,canvas.width),int((ev.clientY-box.top)/box.height*canvas.height,0,canvas.height)];}
async function renderSource(){const canvas=$('manualCanvas'),empty=$('manualNoPage');const epoch=++ui.runEpoch;
 if(!state.pages[ui.page]){canvas.classList.add('hidden');empty.classList.remove('hidden');return}
 const bmp=await getBmp(ui.page);if(epoch!==ui.runEpoch)return;canvas.classList.remove('hidden');empty.classList.add('hidden');canvas.width=bmp.width;canvas.height=bmp.height;
 const ctx=canvas.getContext('2d');ctx.drawImage(bmp,0,0);
 if($('coverageOverlay').checked){try{
  const g=await getGrayPage(ui.page);if(epoch!==ui.runEpoch)return;
  const ledger=pageCoverage(ui.page,g);const rgba=ctx.createImageData(bmp.width,bmp.height);
  for(let k=0;k<ledger.mask.length;k++){
   const label=ledger.mask[k],j=k*4;
   if(label===2){rgba.data[j]=0;rgba.data[j+1]=165;rgba.data[j+2]=111;rgba.data[j+3]=100}
   else if(label===1){rgba.data[j]=245;rgba.data[j+1]=174;rgba.data[j+2]=42;rgba.data[j+3]=120}
   else if(label===3){rgba.data[j]=225;rgba.data[j+1]=66;rgba.data[j+2]=57;rgba.data[j+3]=95}
  }
  const layer=document.createElement('canvas');layer.width=bmp.width;layer.height=bmp.height;layer.getContext('2d').putImageData(rgba,0,0);ctx.drawImage(layer,0,0);
 }catch(e){$('coverageStatus').textContent='覆盖层生成失败：'+e.message}}

 if($('manualShowHits').checked){const current=m();if(current){for(const hit of current.matches){if(hit.page!==ui.page||hit.decision==='rejected')continue;
  ctx.lineWidth=Math.max(1.5,bmp.width/650);ctx.strokeStyle=hit.decision==='accepted'?'#078f65':hit.decision==='proposed'?'#3288cb':'#d97706';
  ctx.strokeRect(hit.x,hit.y,hit.w,hit.h);
 }}}const rect=ui.drag?ui.drag[0].concat(ui.drag[1]):ui.rect;
 if(rect){const [ax,ay,bx,by]=rect;ctx.lineWidth=Math.max(2,bmp.width/500);ctx.strokeStyle='#13a388';ctx.setLineDash([6,3]);ctx.strokeRect(Math.min(ax,bx),Math.min(ay,by),Math.abs(bx-ax),Math.abs(by-ay));ctx.setLineDash([])}
 if(ui.displayRect&&ui.displayRect.page===ui.page){const r=ui.displayRect;ctx.strokeStyle='#d97706';ctx.lineWidth=Math.max(3,bmp.width/400);ctx.strokeRect(r.x,r.y,r.w,r.h)}
 $('manualSelection').textContent=rect?`选框：(${Math.min(rect[0],rect[2])},${Math.min(rect[1],rect[3])}) 至 (${Math.max(rect[0],rect[2])},${Math.max(rect[1],rect[3])})，采用原图坐标`:'按住鼠标左键，在原图上框出一个完整单字或标点';
}
function stop(){ui.cancelled=true;if(ui.cancelPending){ui.cancelPending();ui.cancelPending=null}ui.running=false;if(ui.worker){ui.worker.terminate();ui.worker=null}$('manualSearch').disabled=false;$('manualCancel').disabled=true}
async function scanWorker(w,gray,template,roi,scoreMin){return new Promise((resolve,reject)=>{
 const seq=++ui.seq,handler=ev=>{if(ev.data?.seq!==seq)return;w.removeEventListener('message',handler);w.removeEventListener('error',onError);ui.cancelPending=null;if(ev.data.error)reject(Error(ev.data.error));else resolve(ev.data.result);};
 const onError=err=>{w.removeEventListener('message',handler);w.removeEventListener('error',onError);ui.cancelPending=null;reject(Error(err.message||'后台搜索失败'))};
 w.addEventListener('message',handler);w.addEventListener('error',onError);ui.cancelPending=()=>{w.removeEventListener('message',handler);w.removeEventListener('error',onError);reject(Error('用户已取消'));};
 w.postMessage({seq,gray:gray.slice(),width:gray.length?template.scanW:0,height:template.scanH,template,roi,scoreMin},[ ]);
 });}
function updateProgress(done,total,found){$('manualProgressBar').style.width=(100*done/Math.max(1,total)).toFixed(1)+'%';$('manualStatus').textContent=`全书像素重合：${done}/${total} 页，当前发现 ${found} 个去重命中；不代表已确认单字`}
async function search(resume=false){if(ui.running)return;if(!state.pages.length)return toast('先导入整书图片，无需执行自动分字');
 let item,t,done=0;
 if(resume){item=m();if(!item||item.complete)return toast('没有可续扫的任务');
  done=Math.min(state.pages.length,item.scanPages||0);
  try{const p=await getGrayPage(item.sourcePage);t=GlyphManualMatch.makeTemplate(p.gray,p.width,p.height,item.rect,{threshold:item.threshold})}
  catch(err){return toast('无法恢复模板：'+err.message)}
 }else{
  const rect=ui.rect;if(!rect)return toast('先在左侧原图拖动一个完整字形选框');
  let source=ui.page;try{const p=await getGrayPage(source);t=GlyphManualMatch.makeTemplate(p.gray,p.width,p.height,rect,{threshold:Number($('manualThreshold').value)||185})}catch(e){return toast(e.message)}
  const cut=t.rect,sourceName=fileName(source),id='M'+String(Date.now()).slice(-9)+'_'+(ui.items.length+1),scope=$('manualScope').value;
  item={id,sourcePage:source,sourceName,rect:cut,threshold:t.threshold,scoreMin:Number($('manualScore').value)/100||.86,scope,unicode:'',matches:[],complete:false,scanPages:0,template:t};
  if(ui.items.length>=100)return toast('最多保留 100 个手工模板，请先导出旧模板结果');
  ui.items.push(item);invalidateCoverage();ui.selectedId=id;fillTemplates();
 }
 ui.running=true;ui.cancelled=false;$('manualSearch').disabled=true;$('manualResume').disabled=true;$('manualCancel').disabled=false;
 ui.worker=new Worker('manual_search_worker.js');const worker=ui.worker;let total=state.pages.length;
 try{
  for(let page=done;page<total;page++){
   if(ui.cancelled)break;
   const g=await getGrayPage(page);if(ui.cancelled)break;
   // Worker gets an independent copy, to preserve cached original-gray pages.
   t.scanW=g.width;t.scanH=g.height;
   const result=await scanWorker(worker,g.gray,t,item.scope==='roi'?options().roi:[0,0,1,1],item.scoreMin);
   if(ui.cancelled)break;
   for(const a of result.matches)item.matches.push({...a,page,decision:'pending'});
   done++;item.scanPages=done;updateProgress(done,total,item.matches.length);
   // Browser can redraw while the Worker searches the next source image.
   if((page&7)===7){fillTemplates();await new Promise(r=>requestAnimationFrame(r))}
  }
  item.complete=done===total&&!ui.cancelled;
  item.matches.sort((a,b)=>a.page-b.page||a.y-b.y||b.x-a.x);
  $('manualStatus').textContent=`模板 ${item.id}：扫描 ${done}/${total} 页，找到 ${item.matches.length} 个候选；其中边缘邻字风险 ${item.matches.filter(x=>x.touchesOthers).length} 个。${item.complete?'全部完成':'中途停止：仅为部分书页结果'}。`;
 }catch(err){if(!ui.cancelled)toast('搜索中断：'+err.message+'；已扫描结果保留')}finally{
  invalidateCoverage();if(ui.worker===worker){worker.terminate();ui.worker=null}ui.running=false;$('manualSearch').disabled=false;$('manualCancel').disabled=true;fillTemplates();ui.resultOffset=0;renderMatches();$('manualResume').disabled=!m()||m().complete;void renderSource();
 }
}
function renderMatches(){const item=m(),list=$('manualResults');list.replaceChildren();const status=$('manualResultStatus');
 if(!item){status.textContent='先框一个完整字并搜索全书。';return}
 $('manualUnicode').value=item.unicode||'';
 const filter=$('manualMatchFilter').value;
 const matches=filter==='all'?item.matches:item.matches.filter(x=>filter==='risk'?x.touchesOthers:x.decision===filter);
 const offset=int(ui.resultOffset,0,Math.max(0,matches.length-1));ui.resultOffset=Math.floor(offset/24)*24;
 const pageMatches=matches.slice(ui.resultOffset,ui.resultOffset+24);
 status.textContent=`${item.id} · 命中 ${item.matches.length}；当前筛选 ${matches.length}；${item.complete?'全书已扫描':'部分页已扫描'}；已人工通过 ${item.matches.filter(x=>x.decision==='accepted').length}；已排除 ${item.matches.filter(x=>x.decision==='rejected').length}。`;
 $('manualPagination').textContent=`${matches.length?ui.resultOffset+1:0}–${Math.min(ui.resultOffset+24,matches.length)} / ${matches.length}`;
 for(const a of pageMatches){const card=document.createElement('div');card.className='manual-hit';const im=document.createElement('canvas');im.width=95;im.height=100;
 const title=document.createElement('strong');title.textContent=`第 ${a.page+1} 页 · ${a.score.toFixed(3)}${a.touchesOthers?' · 邻字风险':''}`;
 const subtitle=document.createElement('small');subtitle.textContent=`原图 (${a.x},${a.y}) · ${a.w}×${a.h} · ${a.decision==='accepted'?'已人工通过':a.decision==='rejected'?'已排除':'待复核'}`;
 const actions=document.createElement('div');actions.className='manual-actions';
 for(const [caption,action] of [['定位原图','view'],['人工通过','accepted'],['排除此处','rejected'],['撤销','pending']]){
  const btn=document.createElement('button');btn.type='button';btn.className='btn';btn.textContent=caption;
  btn.onclick=()=>{if(action==='view'){ui.page=a.page;$('manualPageSelect').value=String(a.page);ui.rect=null;ui.displayRect={page:a.page,x:a.x,y:a.y,w:a.w,h:a.h};void renderSource();$('manualCanvas').scrollIntoView({block:'center',behavior:'smooth'})}else{a.decision=action;invalidateCoverage();renderMatches();void renderSource()}};actions.append(btn);
 }
 const meta=document.createElement('div');meta.className='manual-hit-meta';meta.append(title,subtitle,actions);card.append(im,meta);list.append(card);
 void getBmp(a.page).then(bm=>{if(!im.isConnected)return;const ctx=im.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,95,100);const pad=Math.max(4,Math.round(Math.max(a.w,a.h)*.38));const sx=Math.max(0,a.x-pad),sy=Math.max(0,a.y-pad),sw=Math.min(bm.width-sx,a.w+2*pad),sh=Math.min(bm.height-sy,a.h+2*pad);
 const sc=Math.min(93/sw,96/sh);ctx.drawImage(bm,sx,sy,sw,sh,(95-sw*sc)/2,(100-sh*sc)/2,sw*sc,sh*sc);ctx.strokeStyle='#0c9d92';ctx.lineWidth=1.5;ctx.strokeRect((95-sw*sc)/2+(a.x-sx)*sc,(100-sh*sc)/2+(a.y-sy)*sc,a.w*sc,a.h*sc)}).catch(()=>{});
 }
}
function exportJSON(){const data=snapshot();const file='novelglyph_manual_fullbook_matches.json';jsonDownload({...data,warning:'只有人工单位置确认是人工确认；图形相似不能保证 Unicode 相同。'},file)}
function bulkProposal(){const item=m();if(!item)return toast('没有可确认的模板');const label=$('manualUnicode').value.trim();
 if(!GlyphTranscript.oneGlyph(label))return toast('批量赋字只允许输入一个 Unicode 字素');
 if(!$('manualReviewed').checked)return toast('请先检查不同页样本，并勾选人工复核声明');
 item.unicode=label;
 // Deliberately suggestion-only to avoid propagating ambiguous codepoints.
 for(const a of item.matches)if(a.decision==='pending'&&!a.touchesOthers)a.decision='proposed';
 $('manualReviewed').checked=false;invalidateCoverage();toast('已将无边缘风险的待审命中标成建议，仍需按位置人工确认');renderMatches();
}

// A page is re-accounted from the original scan when required. Nothing here
// runs an OCR model, and a matched rectangle is never assumed to be a glyph.
function invalidateCoverage(){ui.coverageRevision++;ui.auditRows=null;ui.auditCancel=true;
 const b=$('coverageExport');if(b)b.disabled=true;
 const p=$('coveragePages');if(p)p.replaceChildren();
 const st=$('coverageStatus');if(st)st.textContent='模板／人工判定已更新，整书统计需重新运行。';
}
function coverageRoi(){return $('coverageScope').value==='roi'?options().roi:[0,0,1,1]}
function allMatchesFor(page){const out=[];for(const t of ui.items)for(const hit of t.matches)if(hit.page===page)out.push(hit);return out}
function pageCoverage(page,g){return GlyphCoverage.tally(g.gray,g.width,g.height,allMatchesFor(page),{roi:coverageRoi()})}
function fmt(n){return n.toLocaleString('zh-CN')}
function showCounters(v){$('coverageAccepted').textContent=fmt(v.accepted);$('coveragePending').textContent=fmt(v.candidate);
 $('coverageUncovered').textContent=fmt(v.uncovered);$('coverageTotal').textContent=fmt(v.total)}
function suggestedSizes(){const dims=ui.items.map(i=>[i.rect[2]-i.rect[0],i.rect[3]-i.rect[1]]).filter(([w,h])=>w>=8&&h>=8&&w<=190&&h<=240);
 if(!dims.length)return [[24,24],[32,32],[44,44]];
 dims.sort((a,b)=>a[0]*a[1]-b[0]*b[1]);const mid=dims[Math.floor(dims.length/2)];
 return [mid,[Math.max(8,Math.round(mid[0]*.8)),Math.max(8,Math.round(mid[1]*.8))],[Math.min(190,Math.round(mid[0]*1.2)),Math.min(240,Math.round(mid[1]*1.2))]];
}
async function analyzeCoveragePage(){if(ui.auditRunning)return toast('正在遍历全书，请先完成或中止');if(!state.pages.length)return toast('先导入扫描书页');
 const page=ui.page,g=await getGrayPage(page);if(page!==ui.page)return;
 const ledger=pageCoverage(page,g),recs=GlyphCoverage.recommend(ledger,{sizes:suggestedSizes(),limit:8,step:5});
 showCounters(ledger);const panel=$('coverageSuggestions');panel.replaceChildren();
 $('coverageStatus').textContent=`第 ${page+1} 页：人工覆盖 ${(ledger.ratio*100).toFixed(2)}%，连同未审核候选 ${(ledger.candidateRatio*100).toFixed(2)}%。${$('coverageScope').value==='roi'?'仅统计正文 ROI；其他区域未计入。':'统计全页墨迹（包含 Ruby、插图、页码及污点）。'} 推荐区域只是复查起点，不代表完整单字。`;
 if(!recs.length){panel.textContent=ledger.uncovered?'没有符合当前窗口密度条件的推荐框；请手动框选剩余墨迹。':'当前统计范围中没有未解释墨迹。';return}
 for(const [i,r] of recs.entries()){
  const btn=document.createElement('button');btn.className='coverage-choice';btn.type='button';
  const title=document.createElement('b');title.textContent=`建议 ${i+1} · ${fmt(r.ink)} 个未覆盖像素`;
  const small=document.createElement('small');small.textContent=`${r.rect[0]},${r.rect[1]} → ${r.rect[2]},${r.rect[3]} · 可调整选框`;
  btn.append(title,small);btn.onclick=()=>{ui.rect=r.rect;ui.displayRect={page:ui.page,x:r.rect[0],y:r.rect[1],w:r.rect[2]-r.rect[0],h:r.rect[3]-r.rect[1]};void renderSource();$('manualCanvas').scrollIntoView({behavior:'smooth',block:'center'});};panel.append(btn);
 }
 void renderSource();
}
async function auditBookCoverage(){if(ui.auditRunning)return;if(!state.pages.length)return toast('先导入整书图片');
 ui.auditCancel=false;ui.auditRunning=true;const revision=ui.coverageRevision,scope=$('coverageScope').value,rows=[];
 $('coverageAudit').disabled=true;$('coverageCancel').disabled=false;$('coverageExport').disabled=true;$('coveragePages').replaceChildren();
 try{
  for(let page=0;page<state.pages.length;page++){
   if(ui.auditCancel||ui.coverageRevision!==revision)break;
   const g=await getGrayPage(page);if(ui.auditCancel||ui.coverageRevision!==revision)break;
   const v=pageCoverage(page,g);
   rows.push({page,name:fileName(page),total:v.total,accepted:v.accepted,candidate:v.candidate,uncovered:v.uncovered});
   if(page%4===0||page===state.pages.length-1){const sums=GlyphCoverage.summarize(rows);
    $('coverageStatus').textContent=`整书墨迹统计：${rows.length}/${state.pages.length} 页 · 已人工覆盖 ${(sums.acceptedRatio*100).toFixed(2)}%，候选覆盖 ${(100*sums.coveredRatio).toFixed(2)}%；数据仅按当前统计范围。`;
    await new Promise(r=>requestAnimationFrame(r));
   }
  }
  if(rows.length===state.pages.length&&ui.coverageRevision===revision&&!ui.auditCancel&&scope===$('coverageScope').value){
   ui.auditRows=rows;$('coverageExport').disabled=false;
   const totals=GlyphCoverage.summarize(rows);
   $('coverageStatus').textContent=`已核算 ${fmt(totals.total)} 个原图墨迹像素：人工确认范围 ${fmt(totals.accepted)} (${(totals.acceptedRatio*100).toFixed(2)}%)，待审候选 ${fmt(totals.candidate)}，未解释 ${fmt(totals.uncovered)}。统计 ${rows.length} 页。墨迹像素≠汉字数量；${scope==='roi'?'范围是正文 ROI':'范围是全页'}。`;
   const worst=[...rows].filter(x=>x.uncovered>0).sort((a,b)=>(b.uncovered/(b.total||1))-(a.uncovered/(a.total||1))).slice(0,12);
   const panel=$('coveragePages');panel.replaceChildren();for(const r of worst){
    const btn=document.createElement('button');btn.className='coverage-choice';btn.type='button';
    const title=document.createElement('b');title.textContent=`第 ${r.page+1} 页 · 未覆盖 ${(r.uncovered/(r.total||1)*100).toFixed(1)}%`;
    const small=document.createElement('small');small.textContent=`${fmt(r.uncovered)} / ${fmt(r.total)} 像素 · 点击查看`;
    btn.append(title,small);btn.onclick=()=>{ui.page=r.page;$('manualPageSelect').value=String(r.page);ui.rect=null;void analyzeCoveragePage()};panel.append(btn)
   }
  }else $('coverageStatus').textContent=`已中止统计：${rows.length}/${state.pages.length} 页。未完成的统计不会用于整书覆盖率或导出。`;
 }catch(e){$('coverageStatus').textContent='统计中断：'+e.message+'；整书结果未保存。'}
 finally{ui.auditRunning=false;$('coverageAudit').disabled=false;$('coverageCancel').disabled=true;}
}
function exportCoverage(){if(!ui.auditRows||ui.auditRows.length!==state.pages.length)return toast('先完成整书统计，模板或判定发生变化后必须重算');
 const sums=GlyphCoverage.summarize(ui.auditRows);
 jsonDownload({format:'NovelGlyph-Ink-Coverage-v1',version:'1.0',project:state.projectName,scope:$('coverageScope').value,
  threshold:210,unit:'original grayscale source pixels',manual_accepted_is_unicode_proof:false,
  warning:'仅为原图墨迹像素的框内覆盖，不表示完整单字、Unicode 已确认，且候选未经过人工审核；Ruby、插图与页码可能仍被统计。',
  summary:sums,pages:ui.auditRows},'novelglyph_全书墨迹覆盖账本.json');
}
function wire(){
 $('coverageScope').onchange=()=>{invalidateCoverage();$('coverageSuggestions').replaceChildren();void renderSource()};
 $('coverageOverlay').onchange=()=>void renderSource();
 $('coverageRecommend').onclick=()=>void analyzeCoveragePage().catch(e=>toast('分析失败：'+e.message));
 $('coverageAudit').onclick=()=>void auditBookCoverage();
 $('coverageCancel').onclick=()=>{ui.auditCancel=true};$('coverageExport').onclick=exportCoverage;
 $('manualPageSelect').onchange=()=>{ui.page=Number($('manualPageSelect').value);ui.rect=null;ui.displayRect=null;void renderSource()};
 $('manualTemplateSelect').onchange=()=>{ui.selectedId=$('manualTemplateSelect').value;ui.resultOffset=0;renderMatches();$('manualResume').disabled=!m()||m().complete;void renderSource()};
 $('manualDemoBtn').onclick=async()=>{if(ui.running)return toast('请先停止正在进行的搜索');try{
  const resp=await fetch('manual_demo/novelglyph_manual_demo_4pages.zip');if(!resp.ok)throw Error('演示素材不存在');
  const blob=await resp.blob();await ingest([new File([blob],'manual_demo.zip',{type:'application/zip'})]);
  changeTab('manual');toast('已导入原创演示图，可直接框出「の」进行重复图形搜索');
 }catch(err){toast('演示加载失败：'+err.message+'。也可自行导入图片或 ZIP。')}};
 $('manualSearch').onclick=()=>void search();$('manualResume').onclick=()=>void search(true);$('manualShowHits').onchange=()=>void renderSource();$('manualCancel').onclick=()=>{stop();$('manualStatus').textContent='搜索已取消；只保留此前已完成页面的结果。';};
 $('manualExport').onclick=exportJSON;$('manualProposal').onclick=bulkProposal;
 $('manualMatchFilter').onchange=()=>{ui.resultOffset=0;renderMatches()};
 $('manualPrev').onclick=()=>{ui.resultOffset=Math.max(0,ui.resultOffset-24);renderMatches()};
 $('manualNext').onclick=()=>{ui.resultOffset+=24;renderMatches()};
 $('manualCanvas').addEventListener('pointerdown',e=>{if(e.button!==0||ui.running)return;let p=point(e);if(!p)return;ui.drag=[p,p];ui.rect=null;ui.displayRect=null;try{$('manualCanvas').setPointerCapture(e.pointerId)}catch(_){}void renderSource()});
 $('manualCanvas').addEventListener('pointermove',e=>{if(!ui.drag)return;let p=point(e);if(!p)return;ui.drag[1]=p;void renderSource()});
 $('manualCanvas').addEventListener('pointerup',e=>{if(!ui.drag)return;let p=point(e);if(p)ui.drag[1]=p;ui.rect=[...ui.drag[0],...ui.drag[1]];ui.drag=null;void renderSource()});
 $('manualCanvas').addEventListener('pointercancel',()=>{ui.drag=null;void renderSource()});
 fillPages();fillTemplates();renderMatches();renderSource();
}
window.NovelManual={reset,restore,snapshot,getSelection:()=>({page:ui.page,rect:ui.rect?[...ui.rect]:null}),showRect:(page,rect)=>{ui.page=page;$('manualPageSelect').value=String(page);ui.rect=rect;ui.displayRect={page,x:rect[0],y:rect[1],w:rect[2]-rect[0],h:rect[3]-rect[1]};void renderSource()},refresh:()=>{fillPages();void renderSource()},render:()=>{fillPages();void renderSource();renderMatches()}};
wire();
})();
