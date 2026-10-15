'use strict';
const $=id=>document.getElementById(id);
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const decode=async src=>{const im=new Image();im.src=`${src}?v=4`;await im.decode();return im;};
// A broad timing field for the dehazing display, not a haze estimate.
function localFade(stage, images){
 if(!CSS.supports('mask-image','linear-gradient(black,transparent)'))return null;
 const canvas=document.createElement('canvas');canvas.width=64;canvas.height=Math.round(64*images[0].naturalHeight/images[0].naturalWidth);
 const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return null;
 const w=canvas.width,h=canvas.height;
 const luminance=im=>{ctx.drawImage(im,0,0,w,h);const rgba=ctx.getImageData(0,0,w,h).data;return Float32Array.from({length:w*h},(_,i)=>(rgba[i*4]*.2126+rgba[i*4+1]*.7152+rgba[i*4+2]*.0722)/255);};
 const a=luminance(images[0]),b=luminance(images[1]);let field=a.map((v,i)=>Math.max(0,v-b[i]));
 // Repeated broad box blur with clamped edges; no noise or moving boundary.
 for(let pass=0;pass<3;pass++){
  const next=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   let sum=0;for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++)sum+=field[Math.max(0,Math.min(h-1,y+dy))*w+Math.max(0,Math.min(w-1,x+dx))];
   next[y*w+x]=sum/121;
  }field=next;
 }
 const mean=field.reduce((x,y)=>x+y,0)/field.length;
 const deviation=Math.sqrt(field.reduce((x,y)=>x+(y-mean)**2,0)/field.length);
 const timing=field.map(v=>-Math.tanh((v-mean)/Math.max(.025,deviation*1.5)));
 const pixels=ctx.createImageData(w,h),output=stage.querySelector('.restored');
 output.style.maskSize='100% 100%';output.style.maskRepeat='no-repeat';
 return value=>{
  if(value<=0||value>=1){output.style.maskImage='none';output.style.opacity=String(value);return;}
  for(let i=0;i<timing.length;i++){
   // Monotonic everywhere; the whole image changes on every frame.
   const alpha=value**Math.exp(-.65*timing[i]);
   pixels.data[i*4+3]=Math.round(Math.max(0,Math.min(1,alpha))*255);
  }
  ctx.putImageData(pixels,0,0);output.style.maskImage=`url("${canvas.toDataURL()}")`;output.style.opacity='1';
 };
}
class Carousel{
 constructor(root,items,kind){
  this.root=root;this.items=items;this.kind=kind;this.index=0;this.slides=[];this.pages=[];this.pageSize=2;
  root.innerHTML=`<div class="carousel-window"><div class="carousel-track"></div><button class="previous gallery-step" aria-label="Previous ${kind} pair">‹</button><button class="next gallery-step" aria-label="Next ${kind} pair">›</button></div><div class="carousel-navigation"><span class="carousel-caption">${kind==='manual'?'Drag to compare':'Click to dehaze'}</span><div class="carousel-dots" aria-label="Select a scene"></div><span class="carousel-count" aria-live="polite"></span></div>`;
  this.track=root.querySelector('.carousel-track');this.window=root.querySelector('.carousel-window');this.dots=root.querySelector('.carousel-dots');
  items.forEach((item,i)=>{
   if(i%this.pageSize===0){const page=document.createElement('div');page.className='carousel-page';this.pages.push(page);this.track.append(page);}
   const el=document.createElement('article');el.className='slide '+kind;el.setAttribute('aria-label',`${item.dataset}, scene ${item.sample}`);
   el.innerHTML=`<div class="image-area"><div class="image-stage" style="--split:50%;--fade:0" aria-busy="true"><img class="input-image" alt="Hazy input, ${item.dataset} scene ${item.sample}" draggable="false"><img class="restored" alt="Hihaze output, ${item.dataset} scene ${item.sample}" draggable="false"><span class="image-tag left">HAZY INPUT</span><span class="image-tag right" ${kind==='fade'?'hidden':''}>HIHAZE RESULT</span>${kind==='manual'?'<div class="divider"><span class="knob">‹ ›</span></div><input class="scrubber" type="range" min="0" max="100" step="0.1" value="50" aria-label="Compare hazy input and Hihaze result" disabled>':'<button class="fade-trigger" disabled><span class="play-icon">▶</span><span class="trigger-text">Loading scene…</span></button><span class="fade-state" hidden>Hazy <span>→</span> Hihaze</span>'}</div></div><div class="slide-bottom"><p class="slide-status" role="status">Preparing this scene…</p><div class="slide-actions">${kind==='fade'?'<button class="playback" hidden disabled aria-label="Pause transition">Ⅱ Pause</button><button class="replay" disabled>↻ Replay</button>':''}<button class="reset" disabled>${kind==='manual'?'↶ Center handle':'↶ Hazy input'}</button></div></div>`;
   const slide={el,item,stage:el.querySelector('.image-stage'),ready:false,promise:null,frame:0,duration:4800,elapsed:0,playState:'idle'};this.slides.push(slide);this.pages[this.pages.length-1].append(el);
   if(i%this.pageSize===0){const pageIndex=this.pages.length-1,dot=document.createElement('button');dot.setAttribute('aria-label',`Show scenes ${i+1} and ${Math.min(i+this.pageSize,items.length)}`);dot.addEventListener('click',()=>this.go(pageIndex));this.dots.append(dot);}
   el.querySelector('.reset').addEventListener('click',()=>this.reset(slide));
   if(kind==='manual')el.querySelector('.scrubber').addEventListener('input',e=>this.split(slide,e.target.value));
   else{
    el.querySelector('.fade-trigger').addEventListener('click',e=>{e.stopPropagation();this.play(slide);});
    el.querySelector('.replay').addEventListener('click',()=>this.play(slide));
    el.querySelector('.playback').addEventListener('click',()=>this.toggle(slide));
    slide.stage.addEventListener('click',()=>{if(!this.swiped){if(slide.playState==='playing'||slide.playState==='paused')this.toggle(slide);else this.play(slide);}});
   }
   let start=null;el.addEventListener('pointerdown',e=>{this.swiped=false;if(e.target.matches('.scrubber')||e.target.closest('button'))return;start={x:e.clientX,y:e.clientY};});
   el.addEventListener('pointerup',e=>{if(!start)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;start=null;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.4){this.swiped=true;this.go(this.index+(dx<0?1:-1));}});
   el.addEventListener('pointercancel',()=>{start=null;});
  });
  root.querySelector('.previous').addEventListener('click',()=>this.go(this.index-1));root.querySelector('.next').addEventListener('click',()=>this.go(this.index+1));
  root.addEventListener('keydown',e=>{if(e.target.matches('input'))return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();this.go(this.index+(e.key==='ArrowRight'?1:-1));}});
  this.observer=new ResizeObserver(()=>this.height());this.pages.forEach(page=>this.observer.observe(page));this.go(0);
 }
 height(){const page=this.pages[this.index],h=page.getBoundingClientRect().height;if(h>0)this.window.style.height=`${h}px`;const rect=page.querySelector('.image-stage').getBoundingClientRect();this.root.style.setProperty('--arrow-y',`${rect.top-this.window.getBoundingClientRect().top+rect.height/2}px`);}
 stop(slide){for(const s of slide?[slide]:this.slides){cancelAnimationFrame(s.frame);s.frame=0;}}
 split(s,value){const p=Math.max(0,Math.min(100,Number(value)));s.stage.style.setProperty('--split',`${p}%`);s.el.querySelector('.scrubber').value=p;s.el.querySelector('.scrubber').setAttribute('aria-valuetext',`${Math.round(p)} percent hazy input, ${Math.round(100-p)} percent Hihaze`);s.el.querySelector('.left').hidden=p<15;s.el.querySelector('.right').hidden=p>85;}
 fade(s,value){if(s.renderFade)s.renderFade(value);s.stage.style.setProperty('--fade',value);s.el.querySelector('.left').hidden=value>0;s.el.querySelector('.right').hidden=value<1;s.el.querySelector('.fade-state').hidden=value<=0||value>=1;}
 reset(s){this.stop(s);if(this.kind==='manual')this.split(s,50);else{this.fade(s,0);s.elapsed=0;s.playState='idle';s.stage.dataset.playState='idle';s.el.querySelector('.fade-trigger').hidden=false;s.el.querySelector('.playback').hidden=true;}if(s.ready)s.el.querySelector('.slide-status').textContent='';}
 async load(s){
  if(s.ready)return;if(s.promise)return s.promise;
  s.promise=(async()=>{try{const ims=await Promise.all([decode(s.item.hazy),decode(s.item.ours)]);if(ims[0].naturalWidth!==ims[1].naturalWidth||ims[0].naturalHeight!==ims[1].naturalHeight)throw Error('Pair dimensions do not match');s.el.querySelector('.input-image').src=ims[0].src;s.el.querySelector('.restored').src=ims[1].src;if(this.kind==='fade'){try{s.renderFade=localFade(s.stage,ims);}catch{ /* Default crossfade remains available. */ }}s.ready=true;s.stage.setAttribute('aria-busy','false');s.el.querySelectorAll('button,input').forEach(x=>x.disabled=false);if(this.kind==='fade')s.el.querySelector('.trigger-text').textContent='Click to dehaze';this.reset(s);this.height();}catch(error){s.stage.setAttribute('aria-busy','false');s.el.querySelector('.slide-status').textContent='This scene could not load. Select it again to retry.';console.error(error);}finally{s.promise=null;}})();return s.promise;
 }
 go(next){
  this.stop();this.slides.forEach(s=>this.reset(s));this.index=(next+this.pages.length)%this.pages.length;
  this.pages.forEach((page,i)=>{page.inert=i!==this.index;page.setAttribute('aria-hidden',String(i!==this.index));});
  Array.from(this.dots.children).forEach((d,i)=>d.setAttribute('aria-current',String(i===this.index)));
  this.track.style.transform=`translateX(-${this.index*100}%)`;this.root.querySelector('.carousel-count').textContent=`${String(this.index+1).padStart(2,'0')} / ${String(this.pages.length).padStart(2,'0')}`;
  this.slides.slice(this.index*this.pageSize,(this.index+1)*this.pageSize).forEach(s=>this.load(s));this.height();
 }
 play(s){
  if(!s.ready||this.kind!=='fade')return;
  this.stop(s);s.elapsed=0;this.fade(s,0);this.run(s);
 }
 toggle(s){
  if(!s.ready)return;
  if(s.playState==='playing'){
   s.elapsed=Math.min(s.duration,performance.now()-s.startedAt);this.stop(s);s.playState='paused';s.stage.dataset.playState='paused';
   const button=s.el.querySelector('.playback');button.textContent='▶ Continue';button.setAttribute('aria-label','Continue transition');s.el.querySelector('.slide-status').textContent='Paused';
  }else if(s.playState==='paused')this.run(s);
 }
 run(s){
  this.stop(s);s.playState='playing';s.stage.dataset.playState='playing';s.el.querySelector('.fade-trigger').hidden=true;
  const button=s.el.querySelector('.playback');button.hidden=false;button.textContent='Ⅱ Pause';button.setAttribute('aria-label','Pause transition');
  s.el.querySelector('.slide-status').textContent='Hazy → Hihaze';
  const finish=()=>{this.fade(s,1);s.frame=0;s.elapsed=s.duration;s.playState='complete';s.stage.dataset.playState='complete';button.hidden=true;s.el.querySelector('.slide-status').textContent='Hihaze result';};
  if(reduced()){finish();return;}
  s.startedAt=performance.now()-s.elapsed;
  const tick=now=>{const t=Math.min((now-s.startedAt)/s.duration,1);s.elapsed=t*s.duration;this.fade(s,(1-Math.cos(Math.PI*t))/2);if(t<1)s.frame=requestAnimationFrame(tick);else finish();};
  s.frame=requestAnimationFrame(tick);
 }

}
const displayNames={NHHAZE:'NH-HAZE',DENSEHAZE:'Dense-Haze',OHAZE:'O-HAZE',IHAZE:'I-HAZE'};
function makeTabs(root,labels,select){root.replaceChildren();labels.forEach((label,i)=>{const button=document.createElement('button');button.textContent=label;button.setAttribute('aria-pressed',String(i===0));button.addEventListener('click',()=>{Array.from(root.children).forEach((b,j)=>b.setAttribute('aria-pressed',String(i===j)));select(i);});root.append(button);});}
const dialog=$('image-dialog');
function zoom(src,caption){$('dialog-image').src=src;$('dialog-image').alt=caption;$('dialog-caption').textContent=caption;dialog.showModal();}
$('close-dialog').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog){const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)dialog.close();}});
document.querySelectorAll('[data-zoom]').forEach(el=>el.addEventListener('click',()=>zoom(el.dataset.zoom,el.dataset.caption)));
function benchmarks(data){const datasets=Object.keys(data.benchmarks),metrics=['PSNR','SSIM','LPIPS','DISTS','FID','Q-Align'];
 const render=index=>{const name=datasets[index],rows=data.benchmarks[name],rank={};for(const metric of metrics){const lower=['LPIPS','DISTS','FID'].includes(metric);rank[metric]=[...new Set(rows[metric])].sort((a,b)=>lower?a-b:b-a);}
 const body=$('benchmark-table').querySelector('tbody');body.replaceChildren();data.methods.forEach((method,i)=>{const row=document.createElement('tr');if(method==='Hihaze')row.className='ours-row';const label=document.createElement('th');label.scope='row';label.textContent=method;row.append(label);for(const metric of metrics){const v=rows[metric][i],cell=document.createElement('td');cell.textContent=v.toFixed(['PSNR','FID'].includes(metric)?2:4);if(v===rank[metric][0]){cell.className='best';cell.setAttribute('aria-label',`${cell.textContent}, best`);}else if(v===rank[metric][1]){cell.className='second';cell.setAttribute('aria-label',`${cell.textContent}, second best`);}row.append(cell);}body.append(row);});$('benchmark-table').querySelector('caption').textContent=`${name}: quantitative comparisons from manuscript Table 1`;};
 makeTabs($('benchmark-tabs'),datasets,render);render(0);
}
$('copy-citation').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('citation-text').textContent);$('copy-status').textContent='Placeholder citation copied.';}catch{const range=document.createRange();range.selectNodeContents($('citation-text'));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);$('copy-status').textContent='Select and copy the highlighted citation.';}});
(async()=>{try{const response=await fetch('data.json?v=4');if(!response.ok)throw Error(`Data load failed: ${response.status}`);const data=await response.json();new Carousel($('manual-gallery'),data.manual,'manual');const fadeGallery=new Carousel($('fade-gallery'),data.fade,'fade');const scene=new URLSearchParams(location.search).get('scene');if(scene){const index=data.fade.findIndex(item=>item.key===scene);if(index>=0)fadeGallery.go(Math.floor(index/fadeGallery.pageSize));}benchmarks(data);document.body.dataset.ready='true';if(new URLSearchParams(location.search).get('mode')==='fade')$('fade-results').scrollIntoView();}catch(error){console.error(error);document.querySelectorAll('.loading').forEach(el=>el.textContent='The gallery could not load. Please refresh to retry.');}})();
