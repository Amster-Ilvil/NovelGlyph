/* NovelGlyph 1.2 UI — built on original image bytes; separate from old OCR/projection review. */
(function(){'use strict';
const G=window.GlyphDiscovery,$=id=>document.getElementById(id);
let book=G.create(),running=false,cancel=false,selectedGroup='',selectedRegion='',groupOffset=0,pageOffset=0;
const getPage=()=>book.pages.find(p=>p.page===Number($('discoveryPage').value));
const alertText=m=>{$('discoveryStatus').textContent=m;notify(m)};
function reset(){cancel=true;book=G.create();selectedGroup='';selectedRegion='';groupOffset=0;pageOffset=0;render();}
function snapshot(){return G.snapshot(book)}
function restore(data){book=G.restore(data,state.pages.length);selectedGroup='';selectedRegion='';groupOffset=0;pageOffset=0;render()}
function pageOptions(){const old=$('discoveryPage').value;$('discoveryPage').replaceChildren();for(const p of book.pages){const o=document.createElement('option');o.value=String(p.page);o.textContent=`第${p.page+1}页 · ${p.occurrences.length} 个候选`; $('discoveryPage').append(o)}if(book.pages.some(p=>String(p.page)===old))$('discoveryPage').value=old;}
function status(){const c=G.counts(book);$('discoveryStats').textContent=`已索引 ${c.pages}/${state.pages.length} 页 · 候选字位 ${c.occurrences.toLocaleString()} · 唯一形状 ${c.groups.toLocaleString()} · Ruby 风险 ${c.rubySuspects.toLocaleString()}。同形归类是形状证据，不保证一字一格。`;return c}
function thumbnail(page,rect,canvas){if(!rect)return;void getBmp(page).then(bmp=>{if(!canvas.isConnected)return;const ctx=canvas.getContext('2d');const [x0,y0,x1,y1]=rect;canvas.width=65;canvas.height=65;ctx.fillStyle='#fff';ctx.fillRect(0,0,65,65);const w=x1-x0,h=y1-y0;const scale=Math.min(59/w,59/h);ctx.drawImage(bmp,x0,y0,w,h,(65-w*scale)/2,(65-h*scale)/2,w*scale,h*scale)}).catch(()=>{})}
function selectGroup(id){selectedGroup=id;const g=book.groups.find(g=>g.id===id);$('discoveryLabel').value=g?.unicode||'';$('discoveryApprove').checked=!!g?.approved;renderGroups();renderRegions();}
function renderGroups(){const c=G.counts(book),filter=$('discoveryGroupFilter').value;let groups=c.groupList;
 if(filter==='unlabeled')groups=groups.filter(g=>!g.approved);if(filter==='repeated')groups=groups.filter(g=>g.count>1);if(filter==='approved')groups=groups.filter(g=>g.approved);
 groupOffset=Math.min(groupOffset,Math.max(0,Math.floor((groups.length-1)/24)*24));const list=$('discoveryGroups');list.replaceChildren();
 for(const g of groups.slice(groupOffset,groupOffset+24)){
  const b=document.createElement('button');b.type='button';b.className='discovery-group'+(g.id===selectedGroup?' on':'');
  const cv=document.createElement('canvas');cv.width=65;cv.height=65;thumbnail(g.example?.page,g.example?.rect,cv);
  const s=document.createElement('span');s.textContent=`${g.id} · ${g.count} 次 / ${g.pages} 页${g.unicode?' · '+g.unicode+(g.approved?' ✓':'（建议）'):''}`;b.append(cv,s);b.onclick=()=>selectGroup(g.id);list.append(b);
 }
 $('discoveryGroupPages').textContent=`${groups.length?groupOffset+1:0}–${Math.min(groupOffset+24,groups.length)} / ${groups.length}`;
}
function renderRegions(){const p=getPage(),list=$('discoveryRegions');list.replaceChildren();if(!p){$('discoveryRegionStatus').textContent='先运行候选字位发现。';return}
 const col=$('discoveryColumn').value,filter=$('discoveryRegionFilter').value;
 const groupIndex=new Map(book.groups.map(g=>[g.id,g]));let occ=p.occurrences.filter(o=>col==='all'||String(o.column)===col);
 if(filter==='unresolved')occ=occ.filter(o=>G.reconstruct({pages:[{...p,occurrences:[o]}],groups:book.groups},[]).totals.unresolved>0);
 if(filter==='ruby')occ=occ.filter(o=>o.risk.includes('POSSIBLE_RUBY')||o.kind==='ruby');
 if(filter==='group')occ=occ.filter(o=>o.groupId===selectedGroup);
 occ.sort((a,b)=>a.column-b.column||a.span[1]-b.span[1]);pageOffset=Math.min(pageOffset,Math.max(0,Math.floor((occ.length-1)/40)*40));
 $('discoveryRegionStatus').textContent=`第${p.page+1}页：候选 ${p.occurrences.length}；当前筛选 ${occ.length}；表内可标为 Ruby／排除、人工单字确认、切分或合并。`;
 for(const o of occ.slice(pageOffset,pageOffset+40)){
  const b=document.createElement('button');b.type='button';b.className='discovery-region'+(o.id===selectedRegion?' on':'');
  const cv=document.createElement('canvas');cv.width=65;cv.height=65;thumbnail(p.page,o.rect,cv);
  const d=document.createElement('span');const g=groupIndex.get(o.groupId);const glyph=o.verified?o.unicode:(g?.approved&&!o.risk.length?g.unicode:'□');const proposal=o.manualEvidence?.labels?.length===1?' · ≈'+o.manualEvidence.labels[0]+(o.manualEvidence.humanAccepted?'〔框位已认可〕':'〔待审〕'):o.manualEvidence?.labels?.length>1?' · ⚠手框标签冲突':'';d.textContent=`${o.id} · 列${o.column} · ${glyph||'□'} · ${o.kind} · ${o.rect[2]-o.rect[0]}×${o.rect[3]-o.rect[1]}${proposal}${o.risk.length?' · ⚠ '+o.risk.slice(0,2).join(','):''}`;
  b.append(cv,d);b.onclick=()=>{selectedRegion=o.id;selectedGroup=o.groupId;$('discoveryLabel').value=g?.unicode||'';$('discoveryApprove').checked=!!g?.approved;$('discoveryPositionLabel').value=o.verified?o.unicode:(o.manualEvidence?.labels?.length===1?o.manualEvidence.labels[0]:'');$('discoverySplitY').value=Math.round((o.span[1]+o.span[3])/2);$('discoverySelected').textContent=`选择 ${o.id} · 第${p.page+1}页 · 原图 [${o.rect.join(', ')}] · ${o.risk.join(' / ')||'未标风险'}`;renderRegions();renderGroups();};list.append(b)
 }
 $('discoveryRegionPages').textContent=`${occ.length?pageOffset+1:0}–${Math.min(pageOffset+40,occ.length)} / ${occ.length}`;
}
function render(){pageOptions();status();renderGroups();renderColumns();renderRegions();window.NovelHybrid?.render();$('discoveryExport').disabled=!book.pages.length;$('discoveryExportJSON').disabled=!book.pages.length;}
function renderColumns(){const p=getPage(),sel=$('discoveryColumn'),old=sel.value;sel.replaceChildren();const all=document.createElement('option');all.value='all';all.textContent='全部物理列';sel.append(all);if(p)for(let c=1;c<=p.columns.length;c++){const o=document.createElement('option');o.value=String(c);o.textContent=`第${c}列（从右往左）`;sel.append(o)}sel.value=[...sel.options].some(o=>o.value===old)?old:'all';}
async function scan(){if(running)return;if(!state.pages.length)return alertText('先导入整书扫描图');if(book.pages.length){if(!confirm('重新发现会清空旧字位库的逐位标注。建议先保存项目 ZIP，确定重新扫描吗？'))return;book=G.create()}
 running=true;cancel=false;$('discoveryScan').disabled=true;$('discoveryCancel').disabled=false;const opt=options();const pageCount=state.pages.length;
 try{for(let i=0;i<pageCount&&!cancel;i++){
  const page=await getGrayPage(i);if(cancel)break;G.addPage(book,i,page.gray,page.width,page.height,{roi:opt.roi,threshold:opt.threshold,colGap:opt.colGap});
  if((i%3)===0||i===pageCount-1){$('discoveryStatus').textContent=`字位发现 ${i+1}/${pageCount} 页 · 当前唯一形状 ${book.groups.length}。长区段、Ruby 仍待人工核查。`;await new Promise(r=>requestAnimationFrame(r));}
 }
 alertText(`字位发现 ${book.pages.length}/${pageCount} 页；未自动认可任何 Unicode 字位。`);}
 catch(e){alertText('停止于已完成的页面：'+e.message)}finally{running=false;$('discoveryScan').disabled=false;$('discoveryCancel').disabled=true;render()}
}
function changeKind(kind){if(!selectedRegion)return alertText('先点选一个字位');try{G.kindOf(book,selectedRegion,kind);render()}catch(e){alertText(e.message)}}
function confirmPosition(){if(!selectedRegion)return alertText('先点选一个字位');try{G.setOccurrenceUnicode(book,selectedRegion,$('discoveryPositionLabel').value.trim());render()}catch(e){alertText(e.message)}}
function confirmGroup(){if(!selectedGroup)return alertText('先选择一个相同形状组');try{G.groupLabel(book,selectedGroup,$('discoveryLabel').value.trim(),$('discoveryApprove').checked);render();$('discoveryStatus').textContent='组标签已保存。相似形状不自动处理 Ruby、边界编辑、同形异码。'}catch(e){alertText(e.message)}}
function edit(mode){if(!selectedRegion)return alertText('先选择一个字位');const {page:p,occ:o}=G.getOccurrence(book,selectedRegion);void getGrayPage(p.page).then(g=>{
  let peer=null;if(mode==='merge'){
   // Merge with closest adjacent interval in same physical column, never across columns.
   const peers=p.occurrences.filter(v=>v.column===o.column&&v.id!==o.id).sort((a,b)=>a.span[1]-b.span[1]);peer=peers.find(v=>v.span[1]>=o.span[3])||peers.at(-1);if(!peer)return alertText('没有可合并的同列邻接区段');
  }
  const a=G.resegment(book,o.id,Number($('discoverySplitY').value),g.gray,g.width,g.height,mode,peer?.id);selectedRegion=a[0].id;render();$('discoveryStatus').textContent=`${mode==='split'?'拆成两个待审区段':'已合并为待审区段'}；原有 Unicode 不会被继承，必须重新审核。`;
 }).catch(e=>alertText('编辑失败：'+e.message));}
function exportDraft(json){const draft=G.reconstruct(book,state.pages.map(p=>p.name));if(json)jsonDownload(draft,'novelglyph_v12_整书字位草稿.json');else download(new Blob([G.draftText(draft)],{type:'text/plain;charset=utf-8'}),'novelglyph_v12_整书文字草稿.txt');$('discoveryStatus').textContent=`导出 ${draft.totals.positions} 个候选字位：${draft.totals.resolved} 已有人工证据，${draft.totals.unresolved} 未知；注意不能代表真实全书完整性。`}
function jump(){if(!selectedRegion)return alertText('先选一个字位');const {page:p,occ:o}=G.getOccurrence(book,selectedRegion);changeTab('manual');window.NovelManual?.showRect(p.page,o.rect);$('manualCanvas').scrollIntoView({behavior:'smooth',block:'center'});}
$('discoveryAuditInk').onclick=()=>void (async()=>{
 if(!book.pages.length)return alertText('先运行候选字位发现');if(running)return alertText('正在扫描候选，请先完成');
 $('discoveryAuditInk').disabled=true;const startRevision=book.revision,rows=[];
 try{for(let i=0;i<book.pages.length;i++){
  if(startRevision!==book.revision)throw Error('字位数据已更改，请重新核算');
  const p=book.pages[i],g=await getGrayPage(p.page);
  const hits=p.occurrences.map(o=>({x:o.rect[0],y:o.rect[1],w:o.rect[2]-o.rect[0],h:o.rect[3]-o.rect[1],decision:'pending'}));
  // All categories remain tentative spatial coverage, even excluded/ruby.
  const t=GlyphCoverage.tally(g.gray,g.width,g.height,hits,{roi:options().roi,includeMask:false});
  rows.push({page:p.page,total:t.total,claimed:t.candidate,uncovered:t.uncovered});
  if((i%3)===0||i===book.pages.length-1){$('discoveryInkStatus').textContent=`原图漏覆盖检查 ${i+1}/${book.pages.length} 页`;await new Promise(r=>requestAnimationFrame(r));}
 }
 const sums=rows.reduce((a,r)=>({total:a.total+r.total,claimed:a.claimed+r.claimed,uncovered:a.uncovered+r.uncovered}),{total:0,claimed:0,uncovered:0});
 const ratio=sums.total?100*sums.claimed/sums.total:0;
 $('discoveryInkStatus').textContent=`候选物理框解释 ${sums.claimed.toLocaleString()}/${sums.total.toLocaleString()} 墨迹像素（${ratio.toFixed(2)}%），还有 ${sums.uncovered.toLocaleString()} 像素未覆盖。只按正文 ROI 统计，不是完整单字的识别率。`;
 const panel=$('discoveryInkPages');panel.replaceChildren();for(const r of rows.filter(x=>x.uncovered).sort((a,b)=>b.uncovered-a.uncovered).slice(0,8)){
  const b=document.createElement('button');b.type='button';b.className='coverage-choice';b.textContent=`第${r.page+1}页漏覆盖 ${r.uncovered.toLocaleString()} 像素`;
  b.onclick=()=>{$('discoveryPage').value=String(r.page);pageOffset=0;renderColumns();renderRegions();};panel.append(b);
 }
 }catch(e){$('discoveryInkStatus').textContent='覆盖核算未完成：'+e.message}finally{$('discoveryAuditInk').disabled=false}
})();
$('discoveryRecommend').onclick=()=>void (async()=>{
 const p=getPage();if(!p)return alertText('先扫描当前页再推荐遗漏墨迹');
 try{const g=await getGrayPage(p.page),hits=p.occurrences.map(o=>({x:o.rect[0],y:o.rect[1],w:o.rect[2]-o.rect[0],h:o.rect[3]-o.rect[1],decision:'pending'}));
  const ledger=GlyphCoverage.tally(g.gray,g.width,g.height,hits,{roi:options().roi});
  const dims=p.occurrences.map(o=>[o.rect[2]-o.rect[0],o.rect[3]-o.rect[1]]).filter(([w,h])=>w>=6&&h>=6).sort((a,b)=>a[0]*a[1]-b[0]*b[1]);
  const med=dims[Math.floor(dims.length/2)]||[26,30];const sizes=[med,[Math.max(8,Math.round(med[0]*.8)),Math.max(8,Math.round(med[1]*.8))]];
  const recs=GlyphCoverage.recommend(ledger,{sizes,limit:8,step:4,minInk:5});const panel=$('discoveryMissed');panel.replaceChildren();
  for(const [i,r] of recs.entries()){
   const b=document.createElement('button');b.className='coverage-choice';b.type='button';b.textContent=`漏框 ${i+1} · ${r.ink} 像素 · 原图 ${r.rect.join(',')}`;
   b.onclick=()=>{changeTab('manual');window.NovelManual?.showRect(p.page,r.rect);$('manualCanvas').scrollIntoView({block:'center',behavior:'smooth'});};panel.append(b);
  }
  $('discoveryStatus').textContent=`第${p.page+1}页还有 ${ledger.uncovered} 个 ROI 墨迹像素未落入候选框；${recs.length} 个建议只用于辅助人工补录，不能保证是完整单字。`;
 }catch(e){alertText('未覆盖推荐失败：'+e.message)}
})();
$('discoveryAddSelected').onclick=()=>void (async()=>{
 const selection=window.NovelManual?.getSelection();if(!selection?.rect)return alertText('先在原图选框，或点击遗漏墨迹推荐选框');
 try{const g=await getGrayPage(selection.page);const o=G.addManualRegion(book,selection.page,g.gray,g.width,g.height,selection.rect);
  $('discoveryPage').value=String(selection.page);selectedRegion=o.id;selectedGroup=o.groupId;render();
  $('discoveryStatus').textContent=`已新增字位 ${o.id}：${o.rect.join(',')}。默认待审，不沿用已有字符标签；请再定位检查、人工赋字。`;
 }catch(e){alertText('补录失败：'+e.message)}
})();
$('discoveryLinkManual').onclick=()=>{if(!book.pages.length)return alertText('先运行全书候选字位发现');
 try{const stats=G.linkManualProposals(book,window.NovelManual?.snapshot());renderRegions();
 $('discoveryStatus').textContent=`已关联 ${stats.linked}/${stats.hits} 个框选命中，其中 ${stats.conflicts} 个位置存在不同标签冲突；仅是建议，不计入已确认 Unicode。`;
 }catch(e){alertText(e.message)}};
$('discoveryScan').onclick=()=>void scan();$('discoveryCancel').onclick=()=>{cancel=true};$('discoveryGroupFilter').onchange=()=>{groupOffset=0;renderGroups()};$('discoveryGroupPrev').onclick=()=>{groupOffset=Math.max(0,groupOffset-24);renderGroups()};$('discoveryGroupNext').onclick=()=>{groupOffset+=24;renderGroups()};$('discoverySaveGroup').onclick=confirmGroup;
$('discoveryPage').onchange=()=>{selectedRegion='';pageOffset=0;renderColumns();renderRegions()};$('discoveryColumn').onchange=()=>{pageOffset=0;renderRegions()};$('discoveryRegionFilter').onchange=()=>{pageOffset=0;renderRegions()};$('discoveryRegionPrev').onclick=()=>{pageOffset=Math.max(0,pageOffset-40);renderRegions()};$('discoveryRegionNext').onclick=()=>{pageOffset+=40;renderRegions()};
$('discoveryPositionConfirm').onclick=confirmPosition;$('discoveryPositionUndo').onclick=()=>{if(selectedRegion){G.clearOccurrenceUnicode(book,selectedRegion);render()}};
for(const k of ['body','ruby','excluded','review'])$('discoveryKind_'+k).onclick=()=>changeKind(k);
$('discoverySplit').onclick=()=>edit('split');$('discoveryMerge').onclick=()=>edit('merge');$('discoveryGo').onclick=jump;
$('discoveryExport').onclick=()=>exportDraft(false);$('discoveryExportJSON').onclick=()=>exportDraft(true);
window.NovelDiscovery={reset,restore,snapshot,render,selectGroup,book:()=>book};render();
})();
