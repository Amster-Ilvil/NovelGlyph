importScripts('engine.js','sliding.js');
self.onmessage=async ({data})=>{
 if(data.type!=='analyze')return;
 const {file,index,options}=data;
 try{
   const bmp=await createImageBitmap(file,{imageOrientation:'from-image'});
   const canvas=new OffscreenCanvas(bmp.width,bmp.height),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bmp,0,0);bmp.close();
   const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   const gray=GlyphEngine.grayFromRGBA(rgba,canvas.width,canvas.height);
   const result=GlyphEngine.analyzeGray(gray,canvas.width,canvas.height,options);
   const sliding=options.sliding?GlyphSliding.slidingSeeds(gray,canvas.width,canvas.height,result.columns,{stride:options.stride,maxPerPage:24000}):null;
   self.postMessage({type:'page',index,result,sliding});
 }catch(e){self.postMessage({type:'error',index,error:String(e.message||e)})}
};
