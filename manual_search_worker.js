'use strict';
importScripts('manual_match.js');
self.onmessage=e=>{
 const {seq,gray,width,height,template,roi,scoreMin}=e.data;
 try{
  const result=GlyphManualMatch.searchPage(gray,width,height,template,{roi,scoreMin});
  self.postMessage({seq,result});
 }catch(err){self.postMessage({seq,error:String(err?.message||err)})}
};
