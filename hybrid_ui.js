/* NovelGlyph 1.2, OCR evidence reviewer. All files are parsed locally. */
(function(){'use strict';
const H=window.GlyphHybrid, G=window.GlyphDiscovery, $=id=>document.getElementById(id);
let lastImport='';
function getBook(){return window.NovelDiscovery.book()}
function render(){if(!$('hybridCounters'))return;
 const a=H.review(getBook()),t=a.totals;
 $('hybridCounters').replaceChildren();
 for(const [label,num] of [['已关联字位',t.positionsWithEvidence],['跨模型一致位置',t.multiModelAgreement],['读法分歧位置',t.multiModelDisagreement],['需人工审核的候选组',t.reviewSuggestions]]){
  const d=document.createElement('div'),n=document.createElement('strong'),s=document.createElement('small');n.textContent=num.toLocaleString();s.textContent=label;d.append(n,s);$('hybridCounters').append(d);
 }
 if(lastImport)$('hybridStatus').textContent=lastImport;
 else $('hybridStatus').textContent=`来源 ${a.sources.map(s=>s.name+' '+s.observations).join(' / ')||'尚无'}。潜在减少的逐字审核次数上限 ${t.theoreticalUpperBoundSavedPositionReviews}（不是时间或准确率）`;
 const queue=$('hybridQueue');queue.replaceChildren();const needs=a.queue.filter(g=>g.disagreements||g.manualConflicts||g.suggested);
 for(const g of needs.slice(0,48)){
  const b=document.createElement('button');b.type='button';b.className='hybrid-entry '+(g.disagreements||g.manualConflicts?'conflict':'suggestion');
  const h=document.createElement('strong');h.textContent=`${g.id} · ${g.count} 处 / ${g.pages} 页`;
  const c=document.createElement('small');c.textContent=g.suggested?`OCR候选「${g.suggested}」· 2模型同意 ${g.support} 处 / ${g.independentPages} 页`:'必须逐位置审核，不能整组批量赋字';
  const f=document.createElement('small');f.textContent=g.flags.join('；')||'无已发现的几何风险（仍需人工确认）';
  b.append(h,c,f);b.onclick=()=>{window.NovelDiscovery.selectGroup(g.id);if(g.suggested){$('discoveryLabel').value=g.suggested;$('discoveryApprove').checked=false;} $('discoverySelected').textContent=`${g.id} · OCR建议不是人工确认。检查跨页样例和完整字界后，再决定是否批准。`;document.querySelector('.discovery-dual')?.scrollIntoView({block:'start',behavior:'smooth'})};queue.append(b);
 }
 if(!needs.length){const p=document.createElement('p');p.className='muted';p.textContent=a.sources.length?'暂无跨模型建议或分歧；可能因样本不足、字形不一致或坐标无法配准。':'导入带原图逐字坐标的 OCR JSON 后显示冲突和复核队列。';queue.append(p)}
}
$('hybridImport').onchange=async()=>{const files=[...$('hybridImport').files];if(!files.length)return;
 if(!getBook().pages.length){lastImport='请先点击「遍历整书发现候选字位」';render();return}
 let messages=[];for(const f of files){try{
  const data=JSON.parse(await f.text()),s=H.importOCR(getBook(),data);
  messages.push(`${s.source}：${s.stored}/${s.records} 条存入候选；歧义 ${s.ambiguous}，无匹配 ${s.unmatched}，同来源重复 ${s.duplicates}，无效 ${s.invalid}`);
 }catch(e){messages.push(`${f.name} 导入失败：${e.message}`)}}
 lastImport=messages.join('；');$('hybridImport').value='';window.NovelDiscovery.render();
};
$('hybridTemplate').onclick=()=>{
 const example={format:'NovelGlyph-OCR-Evidence-v1',source:'Hayai',coordinate_system:'original_image_pixels',page_index_base:0,items:[{page:0,rect:[100,200,129,231],unicode:'の',confidence:.96}]};
 jsonDownload(example,'novelglyph_ocr_evidence_example.json');
};
$('hybridAuditExport').onclick=()=>jsonDownload(H.review(getBook()),'novelglyph_v12_ocr_shape_audit.json');
$('hybridClear').onclick=()=>{if(!confirm('确定清空全部 OCR 导入证据？人工逐字确认和人工组标签不受影响。'))return;
 const n=H.clear(getBook());lastImport=`已清空 ${n} 条 OCR 证据；人工确认、手框证据和字位库仍保留。`;window.NovelDiscovery.render()};
window.NovelHybrid={render};render();
})();
