/* NovelGlyph Web 0.7 — manual physical-column classification and layout segmentation.
 * A column cut is a *logical reading-order break*, never a glyph crop or Unicode label.
 * All coordinates are taken in the source page's native pixel system.
 */
(function(root){
'use strict';
const TYPES={body:'正文',punctuation:'标点／断句',ruby:'Ruby 注音干扰',heading:'标题／短列',note:'页眉／页码／注释',review:'待人工复核',excluded:'非正文／插图'};
const KIND_KEYS=new Set(Object.keys(TYPES));
function id(page,column){if(!Number.isInteger(page)||!Number.isInteger(column)||column<1)throw Error('无效的页或列编号');return `${page}:${column}`}
function checkCol(col){if(!col||![col.x0,col.x1,col.y0,col.y1].every(Number.isInteger)||col.x0>=col.x1||col.y0>=col.y1)throw Error('物理列坐标无效')}
function create(col){checkCol(col);return {x0:col.x0,x1:col.x1,y0:col.y0,y1:col.y1,segments:[{start:col.y0,end:col.y1,kind:'body',forced:false}],note:''}}
function valid(mark,col){try{checkCol(col);if(!mark||!['x0','x1','y0','y1'].every(k=>mark[k]===col[k]))return false;let y=col.y0;for(const s of mark.segments){if(!Number.isInteger(s.start)||!Number.isInteger(s.end)||s.start!==y||s.end>col.y1||s.end-s.start<5||!KIND_KEYS.has(s.kind))return false;y=s.end}return y===col.y1}catch(_){return false}}
function segmentAt(mark,y){return mark.segments.findIndex(s=>s.start<=y&&y<s.end)}
function nearestGap(gray,W,H,col,y,radius=14){checkCol(col);if(!gray||gray.length!==W*H||col.x0<0||col.x1>W||col.y0<0||col.y1>H)throw Error('必须读取原始扫描像素');if(!Number.isFinite(y))throw Error('请输入真实原图纵坐标');y=Math.round(y);let best=null;
 for(let a=Math.max(col.y0+5,y-radius);a<=Math.min(col.y1-5,y+radius);a++){
  // At least two adjacent completely blank rows (threshold 210) across the ENTIRE physical column.
  let blank=true;for(let r=a-1;r<=a;r++)for(let x=col.x0;x<col.x1;x++)if(gray[r*W+x]<210){blank=false;break}
  if(!blank)continue;const d=Math.abs(a-y);if(!best||d<best.distance)best={y:a,distance:d,threshold:210};
 }return best;
}
function split(mark,y,rightKind,forced=false){if(!valid(mark,mark))throw Error('列段结构损坏');if(!Number.isInteger(y)||y<=mark.y0+4||y>=mark.y1-4)throw Error('切线必须在列内部，且两段至少 5px');if(!KIND_KEYS.has(rightKind))throw Error('未知列段分类');const i=segmentAt(mark,y);if(i<0)throw Error('切线不在任何列段内');const old=mark.segments[i];if(y-old.start<5||old.end-y<5)throw Error('切线距离既有列段边界太近');const out=structuredClone(mark);out.segments.splice(i,1,{start:old.start,end:y,kind:old.kind,forced:old.forced||false},{start:y,end:old.end,kind:rightKind,forced:!!forced});return out}
function classify(mark,index,kind){if(!KIND_KEYS.has(kind)||!mark.segments[index])throw Error('未知分类或段号');const out=structuredClone(mark);out.segments[index].kind=kind;return out}
function classifyAll(mark,kind){if(!KIND_KEYS.has(kind))throw Error('未知单列分类');const out=structuredClone(mark);for(const s of out.segments)s.kind=kind;return out}
function joinAt(mark,index){if(index<0||index>=mark.segments.length-1)throw Error('此处没有可删除的分段线');const out=structuredClone(mark);const a=out.segments[index],b=out.segments[index+1];out.segments.splice(index,2,{start:a.start,end:b.end,kind:a.kind,forced:a.forced||b.forced});return out}
function validateRestore(entries,columnsByPage){const out=new Map();if(!Array.isArray(entries)||entries.length>25000)throw Error('列标注数据格式不正确');for(const pair of entries){if(!Array.isArray(pair)||pair.length!==2)continue;const [key,val]=pair;if(typeof key!=='string'||!/^\d+:\d+$/.test(key))continue;const [page,col]=key.split(':').map(Number);const source=columnsByPage.get(page)?.[col-1];if(!source||!valid(val,source))continue;if(val.segments.length>300)continue;out.set(key,{...structuredClone(val),note:String(val.note||'').slice(0,300)})}return out}
function compileTranscript(draft,marks){
 for(const p of draft.pages)for(const col of p.columns){const mark=marks.get(id(p.page,col.number));const segments=mark?.segments||[{start:-Infinity,end:Infinity,kind:'body',forced:false}];const out=segments.map((s,i)=>({index:i,start:s.start,end:s.end,kind:s.kind,forced:!!s.forced,text:'',items:[],crossing:0}));
  for(const it of col.items){const r=it.region,y=(r.y0+r.y1)/2;const i=out.findIndex(s=>y>=s.start&&y<s.end);const target=out[i<0?0:i];
   const crossing=r.y0<target.start||r.y1>target.end;
   if(crossing){
    target.crossing++;
    // A logical line must never silently carry a previously verified Unicode
    // across a physical glyph interval. Only this derived draft is modified;
    // the underlying human-approved group/occurrence remains intact.
    const oldStatus=it.status;
    if(draft.totals[oldStatus]>0)draft.totals[oldStatus]--;
    draft.totals.risky=(draft.totals.risky||0)+1;
    if(it.unicode)draft.totals.unresolvedAll=(draft.totals.unresolvedAll||0)+1;
    it.unicode=null;it.status='risky';it.source='COLUMN_CUT_CROSSES_GLYPH';
   }
   target.items.push(it);target.text+=it.unicode||'□';
  }
  col.segments=out;col.category=out.length===1?out[0].kind:'mixed';col.text=out.map(x=>x.text).join('\n');
 }
 for(const p of draft.pages){p.text=p.columns.map(c=>c.text).join('\n');p.counts.confirmed=p.columns.reduce((n,c)=>n+c.items.filter(x=>x.unicode).length,0)}
 draft.totals.coverage=draft.totals.sourceIntervals?(draft.totals.confirmed+draft.totals.manualOverrides)/draft.totals.sourceIntervals:0;
 return draft;
}
function textDraft(draft){
 return draft.pages.map(p=>`〔第 ${p.page+1} 页｜${p.name}〕\n`+p.columns.map(c=>{
  const lines=(c.segments||[]).map(seg=>{
   const note=seg.kind==='body'?'':`〔${TYPES[seg.kind]}〕`;
   const conflict=seg.crossing?'〔跨断段候选待核对〕':'';
   return note+conflict+seg.text;
  });return lines.length?lines.join('\n'):c.text;
 }).join('\n')).join('\n\n')
}
function jsonDraft(draft){
 const result=root.GlyphTranscript.jsonDraft(draft);
 for(const page of result.pages){const source=draft.pages[page.page];for(let i=0;i<page.columns.length;i++){
  page.columns[i].category=source.columns[i]?.category||'body';
  page.columns[i].segments=(source.columns[i]?.segments||[]).map(s=>({start:s.start,end:s.end,kind:s.kind,forced:s.forced,crossing:s.crossing,text:s.text,keys:s.items.map(it=>it.key)}))
 }}return result;
}
function exportColumnRows(marks){return [...marks].map(([key,v])=>({page:Number(key.split(':')[0])+1,column:Number(key.split(':')[1]),x0:v.x0,x1:v.x1,segments:v.segments.map(s=>({...s})),note:v.note||''}))}
root.GlyphColumns={TYPES,id,create,valid,segmentAt,nearestGap,split,classify,classifyAll,joinAt,validateRestore,compileTranscript,exportColumnRows,textDraft,jsonDraft};
if(typeof module!=='undefined'&&module.exports)module.exports=root.GlyphColumns;
})(typeof self!=='undefined'?self:globalThis);
