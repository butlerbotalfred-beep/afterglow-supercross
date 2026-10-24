import {Track} from './track';
import {TrackPreview} from './track-preview';
import {courseById} from './courses';
import {validateLayout,layoutWarnings,layoutFromTrack,OBSTACLE_TYPES,obstacleType,obstacleCount,obstacleLength,replaceObstacle,obstacleSpacing,moveObstacleToGap,type ObstacleType,type TrackLayout} from './track-layout';
const copy=(v:TrackLayout)=>structuredClone(v);
type Selection={kind:'jump'|'turn';index:number};
export class TrackEditor {
  private root=document.createElement('section');
  private svg!:SVGSVGElement;
  private draft!:TrackLayout;
  private preview!:Track;
  private selected:Selection={kind:'jump',index:0};
  private mode='select';
  private undo:TrackLayout[]=[];
  private redo:TrackLayout[]=[];
  private view={x:0,y:0,w:500,h:500};
  private drag:{pointer:number;selection:Selection;before:TrackLayout;offset:number}|null=null;
  private valid=true;
  private preview3D:TrackPreview|null=null;
  private liveTimer:number|undefined;
  private pan:{pointer:number;x:number;y:number;scale:number;view:{x:number;y:number;w:number;h:number}}|null=null;
  constructor(private onSave:(layout:TrackLayout,ride:boolean)=>void,private onClose:()=>void){
    this.root.id='track-editor';this.root.className='hidden';this.root.setAttribute('aria-label','Track editor');document.body.append(this.root);
  }
  controller(action:string,scale=1){
    if(!this.isOpen)return;
    if(action==='previous'||action==='next'){
      const count=this.selected.kind==='jump'?this.draft.jumps.length:this.draft.points.length;
      if(count){this.selected.index=(this.selected.index+(action==='next'?1:-1)+count)%count;this.refresh();}
    }else if(action==='kind'){this.selected={kind:this.selected.kind==='jump'?'turn':'jump',index:0};this.refresh();}
    else if(action==='highlight'&&this.selected.kind==='jump'&&this.draft.jumps[this.selected.index])this.change(()=>{const j=this.draft.jumps[this.selected.index];j.highlight=!j.highlight;});
    else if(action.startsWith('move')){
      const sign=action==='moveLeft'||action==='moveDown'?-1:1;
      this.change(()=>{
        if(this.selected.kind==='jump'){
          const j=this.draft.jumps[this.selected.index];if(j)j.position=((j.position+sign*scale/this.preview.length)%1+1)%1;
        }else{
          const p=this.draft.points[this.selected.index],axis=action==='moveLeft'||action==='moveRight'?0:1;
          p[axis]=Math.max(-1000,Math.min(1000,p[axis]+(axis===1?-sign:sign)*scale));
        }
      });
    }
  }
  get isOpen(){return !this.root.classList.contains('hidden');}
  open(layout:TrackLayout){
    this.releasePreview();
    this.draft=copy(layout);this.undo=[];this.redo=[];this.selected={kind:'jump',index:0};this.mode='select';
    this.root.innerHTML=`<header class="editor-header"><div><span class="eyebrow">YOUR LINE. YOUR RHYTHM.</span><h2>TRACK EDITOR</h2></div><button data-action="close">DISCARD & CLOSE</button></header>
      <div class="editor-toolbar" role="toolbar" aria-label="Map tools"><button data-mode="select" class="active">Select / move</button><button data-mode="jump">Place obstacle</button><button data-mode="turn">Add turn point</button><button data-action="undo">Undo</button><button data-action="redo">Redo</button><button data-action="zoom-in" aria-label="Zoom in">＋</button><button data-action="zoom-out" aria-label="Zoom out">−</button><button data-action="fit">Fit track</button></div>
      <div class="editor-workspace"><div class="editor-views"><div class="editor-map-wrap"><svg id="editor-map" role="group" aria-label="Overhead circuit map. Drag orange jump markers or blue turn points." preserveAspectRatio="xMidYMid meet"></svg><p class="editor-map-hint" id="editor-hint"></p></div><section class="editor-3d" aria-label="Live 3D track preview"><div class="editor-3d-heading"><span class="eyebrow">LIVE 3D PREVIEW</span><span id="preview-3d-status" role="status">Loading preview…</span></div><div class="editor-3d-canvas"><canvas id="editor-3d-canvas" aria-label="Live 3D view of the edited track"></canvas><p>Drag to orbit · scroll or pinch to zoom · right-drag to pan</p></div><div class="editor-3d-tools"><button data-action="3d-focus">Focus selected</button><button data-action="3d-whole">Whole track</button><button data-action="3d-side">Side view</button><button data-action="3d-in" aria-label="Zoom 3D in">＋</button><button data-action="3d-out" aria-label="Zoom 3D out">−</button></div></section></div>
      <aside class="editor-inspector"><label>LAYOUT NAME<input id="layout-name" maxlength="48"></label><p id="editor-stats"></p><div class="editor-tabs"><button data-kind="jump">Obstacles</button><button data-kind="turn">Turns</button></div><label>SELECT OBJECT<select id="editor-object"></select></label><div id="editor-fields"></div><p id="editor-spacing-status" class="editor-storage"></p><div class="button-row"><button data-action="add-jump">Add obstacle</button><button data-action="add-turn">Add turn</button></div><div class="button-row"><button data-action="duplicate">Duplicate obstacle</button><button data-action="delete">Delete selected</button></div><div class="editor-profile"><span id="editor-profile-title">OBSTACLE SIDE PROFILE</span><svg id="jump-profile" viewBox="0 0 280 90" aria-label="Selected jump side profile"></svg></div><div id="editor-status" role="status" aria-live="polite"></div><p class="editor-storage">Saved in this browser, one layout per circuit. Export a file to back up or move a layout to another device.</p><div class="button-row"><button data-action="export">Export JSON</button><button data-action="import">Import JSON</button><input id="layout-import" type="file" accept="application/json,.json" hidden></div><button data-action="reset">Reset draft to original</button></aside></div>
      <footer class="editor-footer"><span>Xbox: ↑/↓ focus · ←/→ adjust · A select · LB/RB object · X obstacles/turns · Y highlight · right stick move · LT fine / RT fast · B exit button</span><button data-action="save">SAVE & RETURN</button><button class="primary" data-action="ride">SAVE & TEST RIDE ↗</button></footer>`;
    this.svg=this.root.querySelector('#editor-map')!;
    this.root.classList.remove('hidden');
    try{this.preview3D=new TrackPreview(this.element<HTMLCanvasElement>('#editor-3d-canvas'),this.element('#preview-3d-status'));}
    catch{this.element('#preview-3d-status').textContent='3D preview unavailable. Reopen the editor to retry.';}

    const name=this.root.querySelector<HTMLInputElement>('#layout-name')!;name.value=this.draft.name;
    name.oninput=()=>{this.undo.push(copy(this.draft));this.trim();this.redo=[];this.draft.name=name.value;this.rebuild(true);};
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b=>b.onclick=()=>{this.mode=b.dataset.mode!;this.updateTools();});
    this.root.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(b=>b.onclick=()=>{this.selected={kind:b.dataset.kind as Selection['kind'],index:0};this.refresh();});
    this.root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(b=>b.onclick=()=>this.action(b.dataset.action!));
    this.root.querySelector<HTMLSelectElement>('#editor-object')!.onchange=e=>{this.selected.index=Number((e.target as HTMLSelectElement).value);this.refresh();};
    this.root.querySelector<HTMLInputElement>('#layout-import')!.onchange=async e=>{
      const input=e.target as HTMLInputElement,file=input.files?.[0];if(!file)return;
      try{if(file.size>100000)throw new Error('Use a layout file smaller than 100 KB.');const imported=validateLayout(JSON.parse(await file.text()));if(imported.courseId!==this.draft.courseId)throw new Error('Choose the matching circuit in race setup before importing this layout.');new Track(courseById(imported.courseId),imported);this.change(()=>{this.draft=imported;this.selected.index=0;});this.fit();}catch(error){this.message(String((error as Error).message),true);}input.value='';
    };
    this.svg.onpointerdown=e=>this.pointerDown(e);
    this.svg.onkeydown=e=>{if(e.key!=='Enter'&&e.key!==' ')return;const marker=(e.target as Element).closest('[data-index]');if(!marker)return;e.preventDefault();this.selected={kind:marker.getAttribute('data-kind') as Selection['kind'],index:Number(marker.getAttribute('data-index'))};this.refresh();};
    this.svg.onpointermove=e=>{
      if(this.pan&&e.pointerId===this.pan.pointer){const p=this.pan;this.view={...p.view,x:p.view.x-(e.clientX-p.x)/p.scale,y:p.view.y-(e.clientY-p.y)/p.scale};this.draw();return;}
      if(!this.drag||e.pointerId!==this.drag.pointer)return;
      const p=this.mapPoint(e),s=this.drag.selection;
      if(s.kind==='turn')this.draft.points[s.index]=[Math.max(-1000,Math.min(1000,p.x)),Math.max(-1000,Math.min(1000,p.y))];
      else this.draft.jumps[s.index].position=Math.min(.999999,((this.preview.project(p.x,p.y).s-this.drag.offset+this.preview.length)%this.preview.length)/this.preview.length);
      this.draw();this.fields();this.queueLiveRebuild();
    };
    this.svg.onpointerup=e=>{if(this.pan){this.pan=null;return;}if(!this.drag||e.pointerId!==this.drag.pointer)return;if(JSON.stringify(this.drag.before)!==JSON.stringify(this.draft)){this.undo.push(this.drag.before);this.trim();this.redo=[];}this.drag=null;this.rebuild();};
    this.svg.onpointercancel=()=>{this.pan=null;if(this.drag){this.draft=this.drag.before;this.drag=null;this.rebuild();}};
    this.rebuild();this.fit();
  }
  close(){this.releasePreview();this.root.classList.add('hidden');this.onClose();}
  private releasePreview(){window.clearTimeout(this.liveTimer);this.liveTimer=undefined;this.preview3D?.dispose();this.preview3D=null;}
  private queueLiveRebuild(){if(this.liveTimer===undefined)this.liveTimer=window.setTimeout(()=>{this.liveTimer=undefined;if(this.isOpen)this.rebuild();},60);}

  private element<T extends Element=HTMLElement>(selector:string){return this.root.querySelector<T>(selector)!;}
  private message(text:string,error=false){const node=this.element('#editor-status');node.textContent=text;node.classList.toggle('editor-error',error);}
  private trim(){if(this.undo.length>50)this.undo.shift();}
  private change(fn:()=>void){this.undo.push(copy(this.draft));this.trim();this.redo=[];fn();this.rebuild();}
  private rebuild(keepFields=false){
    window.clearTimeout(this.liveTimer);this.liveTimer=undefined;
    try{this.preview=new Track(courseById(this.draft.courseId),this.draft);this.valid=true;this.preview3D?.updateTrack(this.preview);const warnings=layoutWarnings(this.preview);this.message(warnings.length?warnings.join(' '):'Layout ready. Test your jump spacing and landing angles before racing.');}
    catch(error){this.valid=false;this.message((error as Error).message,true);}
    this.refresh(keepFields);
  }
  private refresh(keepFields=false){
    this.element<HTMLInputElement>('#layout-name').value=this.draft.name;
    const list=this.selected.kind==='jump'?this.draft.jumps:this.draft.points;
    this.selected.index=Math.max(0,Math.min(this.selected.index,list.length-1));
    const select=this.element<HTMLSelectElement>('#editor-object');select.replaceChildren(...list.map((_,i)=>new Option(`${this.selected.kind==='jump'?`O${i+1} · ${obstacleType(this.draft.jumps[i])}${this.draft.jumps[i].highlight?' ★':''}`:`T${i+1} · Turn${i===0?' / START':''}`}`,String(i))));select.value=String(this.selected.index);select.disabled=!list.length;
    if(!keepFields)this.fields();this.profile();this.draw();this.updateTools();
    this.preview3D?.select(this.selected,this.valid);
    this.element('#editor-stats').textContent=`${Math.round(this.preview?.length||0)} m · ${this.draft.points.length} turn points · ${this.draft.jumps.length} obstacles · ${this.draft.jumps.filter(j=>j.highlight).length} marked for test`;
    for(const a of ['save','ride'])this.element<HTMLButtonElement>(`[data-action="${a}"]`).disabled=!this.valid;
    this.element<HTMLButtonElement>('[data-action="undo"]').disabled=!this.undo.length;
    this.element<HTMLButtonElement>('[data-action="redo"]').disabled=!this.redo.length;
    this.element<HTMLButtonElement>('[data-action="duplicate"]').disabled=this.selected.kind!=='jump'||!this.draft.jumps.length||this.draft.jumps.length>=120;
    this.element<HTMLButtonElement>('[data-action="delete"]').disabled=this.selected.kind==='turn'?this.draft.points.length<=4:!this.draft.jumps.length;
    this.root.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(b=>b.classList.toggle('active',b.dataset.kind===this.selected.kind));
  }
  private updateTools(){
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===this.mode));
    this.element('#editor-hint').textContent=this.mode==='jump'?'Click the track to place a jump. Drag orange markers to move them.':this.mode==='turn'?'Click near the route to insert a turn point. Blue points drag freely.':'Drag orange jumps or blue turns. Drag empty map space to pan; use + / − to zoom. Both views update while you drag.';
  }
  private fields(){
    const host=this.element('#editor-fields'),{kind,index}=this.selected;
    const j=this.draft.jumps[index],p=this.draft.points[index];
    const field=(label:string,key:string,value:number,min:number,max:number,step=.1)=>`<label>${label}<input type="number" data-field="${key}" min="${min}" max="${max}" step="${step}" value="${Number((Math.round(value/step)*step).toFixed(2))}"></label>`;
    const spacing=kind==='jump'&&j?obstacleSpacing(this.draft.jumps,index,this.preview.length):null;
    const berm=this.draft.bermHeights?.[index]??null;
    host.innerHTML=kind==='turn'?`<label class="editor-wide">Turn berm<select id="turn-berm">${[['auto','Automatic / original'],['0','Flat / no berm'],['0.75','Low / 0.75 m'],['1.5','Medium / 1.5 m'],['3','High / 3 m'],['custom','Custom height']].map(([value,label])=>`<option value="${value}" ${String(berm)===value||(berm===null&&value==='auto')||(berm!==null&&![0,.75,1.5,3].includes(berm)&&value==='custom')?'selected':''}>${label}</option>`).join('')}</select></label>`+(berm!==null?field('Berm height (m)','berm',berm,0,5,.05):'')+`<p class="editor-storage editor-wide">Height at the outside track edge, above the centerline at this point. Blends smoothly into neighbouring track sections. Automatic preserves the original banking.</p>`+field('East / west (m)','x',p[0],-1000,1000)+field('North / south (m)','z',p[1],-1000,1000):j?
      `<label class="editor-wide">Replace obstacle<select id="obstacle-type">${OBSTACLE_TYPES.map(type=>`<option value="${type}" ${obstacleType(j)===type?'selected':''}>${type[0].toUpperCase()+type.slice(1)}</option>`).join('')}</select></label><label class="editor-check editor-wide"><input id="test-highlight" type="checkbox" ${j.highlight?'checked':''}>★ Highlight in test ride</label>`+
      field('Position along lap (m)','position',j.position*this.preview.length,0,Math.floor(this.preview.length-1))+field('Height (m)','height',j.height,.3,8)+field('Takeoff length (m)','rise',j.rise,4,40)+field('Tabletop length (m)','flat',j.flat,0,40)+field('Landing length (m)','fall',j.fall,6,60)+
      (obstacleCount(j)>1?field('Between mounds (m)','gap',j.gap||0,0,60)+`<p class="editor-storage">${obstacleCount(j)} mounds · dimensions apply to each mound.</p>`:'')+
      (spacing?`<div class="editor-wide editor-spacing"><strong>Clear ground spacing</strong><p>Moves this obstacle; neighbours stay fixed. Changing one gap updates the other.</p>${field(`After O${spacing.previous+1} (m)`,'before',spacing.before,0,this.preview.length)}${field(`Before O${spacing.next+1} (m)`,'after',spacing.after,0,this.preview.length)}</div>`:'<p class="editor-storage editor-wide">Add another obstacle to adjust spacing.</p>'):'<p>No obstacles yet. Choose Place obstacle, then click the track.</p>';
    this.element('#editor-spacing-status').textContent='';
    const bermSelect=host.querySelector<HTMLSelectElement>('#turn-berm');if(bermSelect)bermSelect.onchange=()=>this.change(()=>{
      this.draft.bermHeights??=this.draft.points.map(()=>null);
      this.draft.bermHeights[index]=bermSelect.value==='auto'?null:bermSelect.value==='custom'?(berm??1.5):Number(bermSelect.value);
    });
    const type=host.querySelector<HTMLSelectElement>('#obstacle-type');if(type)type.onchange=()=>this.change(()=>{this.draft.jumps[index]=replaceObstacle(j,type.value as ObstacleType);});
    const highlight=host.querySelector<HTMLInputElement>('#test-highlight');if(highlight)highlight.onchange=()=>this.change(()=>{j.highlight=highlight.checked;});
    host.querySelectorAll<HTMLInputElement>('input[data-field]').forEach(input=>{
      let recorded=false;
      input.oninput=()=>{
        if(!input.checkValidity()||input.value===''){
          this.valid=false;this.message('Enter a number within the displayed limits.',true);
          for(const action of ['save','ride'])this.element<HTMLButtonElement>(`[data-action="${action}"]`).disabled=true;
          return;
        }
        if(!recorded){this.undo.push(copy(this.draft));this.trim();this.redo=[];recorded=true;}
        const value=Number(input.value),key=input.dataset.field!;
        if(key==='before'||key==='after'){
          try{j.position=moveObstacleToGap(this.draft.jumps,index,this.preview.length,key,value);}
          catch(error){this.element('#editor-spacing-status').textContent=(error as Error).message;this.valid=false;for(const action of ['save','ride'])this.element<HTMLButtonElement>(`[data-action="${action}"]`).disabled=true;return;}
        }else if(kind==='turn'){if(key==='berm'){this.draft.bermHeights??=this.draft.points.map(()=>null);this.draft.bermHeights[index]=value;const select=host.querySelector<HTMLSelectElement>('#turn-berm')!;select.value=[0,.75,1.5,3].includes(value)?String(value):'custom';}else this.draft.points[index][key==='x'?0:1]=value;}
        else if(key==='position')this.draft.jumps[index].position=Math.min(.999999,value/this.preview.length);
        else (this.draft.jumps[index] as unknown as Record<string,number>)[key]=value;
        this.element('#editor-spacing-status').textContent='';this.rebuild(true);
        const updated=kind==='jump'?obstacleSpacing(this.draft.jumps,index,this.preview.length):null;
        for(const other of ['before','after','position']){const node=host.querySelector<HTMLInputElement>(`[data-field="${other}"]`);if(node&&node!==input&&j)node.value=(other==='position'?j.position*this.preview.length:updated?.[other as 'before'|'after']||0).toFixed(1);}
      };
      input.onblur=()=>{recorded=false;if(!this.valid||!input.checkValidity()||input.value==='')this.rebuild();};
    });
  }
  private profile(){
    const {kind,index}=this.selected,j=this.draft.jumps[index];
    const profile=this.element<SVGSVGElement>('#jump-profile');
    this.element('#editor-profile-title').textContent=kind==='turn'?'TURN CROSS SECTION':'OBSTACLE SIDE PROFILE';
    if(kind==='turn'){
      const p=this.draft.points[index],s=this.preview.project(...p).s,center=this.preview.height(s),points=[];
      for(let n=0;n<=40;n++){const lateral=(n/40*2-1)*this.preview.halfWidth;points.push(`${10+n/40*260},${78-(this.preview.height(s,lateral)-center)/6*60}`);}
      const height=this.draft.bermHeights?.[index];
      profile.innerHTML=`<path d="M10 78 L${points.join(' L')} L270 78Z" fill="#5fc8f044" stroke="#5fc8f0" stroke-width="2"/><text x="10" y="14" fill="#d9dce6" font-size="12">${height===null||height===undefined?'Automatic banking':height===0?'Flat turn':height+' m outside berm'}</text>`;return;
    }
    if(!j){profile.innerHTML='';return;}
    const total=obstacleLength(j),mound=j.rise+j.flat+j.fall,points=[];
    for(let n=0;n<=240;n++){const d=n/240*total,local=d%(mound+(j.gap||0));const h=local>=mound?0:local<j.rise?j.height*(.5-.5*Math.cos(Math.PI*local/j.rise)):local<j.rise+j.flat?j.height:j.height*(.5+.5*Math.cos(Math.PI*(local-j.rise-j.flat)/j.fall));points.push(`${10+d/total*260},${78-h/8*65}`);}
    profile.innerHTML=`<path d="M10 78 L${points.join(' L')} L270 78Z" fill="#ff794b44" stroke="#ff794b" stroke-width="2"/><text x="10" y="14" fill="#d9dce6" font-size="12">${total.toFixed(1)} m long · ${j.height.toFixed(1)} m high</text>`;
  }
  private fit(){const b=this.preview.bounds;this.view={x:b.minX-35,y:b.minZ-35,w:b.maxX-b.minX+70,h:b.maxZ-b.minZ+70};this.draw();}
  private draw(){
    if(!this.preview)return;
    this.svg.setAttribute('viewBox',`${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`);
    const line=this.preview.samples.filter((_,i)=>i%8===0).map(p=>`${p.x},${p.z}`).join(' '),scale=Math.min((this.svg.clientWidth||400)/this.view.w,(this.svg.clientHeight||400)/this.view.h),r=6/scale;
    let html=`<defs><marker id="editor-direction" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#a3f6d4"/></marker></defs><polyline points="${line}" fill="none" stroke="#101725" stroke-width="16" stroke-linejoin="round"/><polyline points="${line}" fill="none" stroke="#b79b76" stroke-width="9.6" stroke-linejoin="round"/>`;
    const markers:string[]=[];
    this.draft.jumps.forEach((j,i)=>{
      const s=j.position*this.preview.length,p=this.preview.at(s+obstacleLength(j)/2),total=obstacleLength(j),band=Array.from({length:32},(_,n)=>{const q=this.preview.at(s+n/31*total);return `${q.x},${q.z}`;}).join(' ');
      const selected=this.selected.kind==='jump'&&this.selected.index===i;
      html+=`<polyline data-kind="jump" data-index="${i}" points="${band}" fill="none" stroke="${selected?'#ffef9b':j.highlight?'#ffdc69':'#ff794b'}" stroke-width="${selected?12:8}" opacity=".75"/>`;
      markers.push(`<g data-kind="jump" data-index="${i}" role="button" tabindex="0" aria-label="O${i+1} ${obstacleType(j)}${j.highlight?' highlighted for test':''}" aria-pressed="${selected}"><title>O${i+1} · ${obstacleType(j)} · select and drag</title><rect x="${p.x-r*2}" y="${p.z-r}" width="${r*4}" height="${r*2}" rx="${r*.4}" fill="${selected?'#fff2c7':'#572e22'}" stroke="${j.highlight?'#ffdc69':'#ff956e'}" stroke-width="${r*.25}"/><text x="${p.x}" y="${p.z+r*.5}" text-anchor="middle" fill="${selected?'#181b26':'#fff2c7'}" font-size="${r*1.5}">O${i+1}${j.highlight?'★':''}</text></g>`);
    });
    this.draft.points.forEach(([x,z],i)=>{const selected=this.selected.kind==='turn'&&this.selected.index===i;html+=`<g data-kind="turn" data-index="${i}" role="button" tabindex="0" aria-label="T${i+1} turn${i===0?' start point':''}" aria-pressed="${selected}"><title>T${i+1} · select and drag turn</title><circle cx="${x}" cy="${z}" r="${r*.85}" fill="${selected?'#e1f9ff':'#243d55'}" stroke="#7fddff" stroke-width="${r*.25}"/><text x="${x+r}" y="${z+r*1.5}" fill="#a7e9ff" stroke="#111723" stroke-width="${r*.25}" paint-order="stroke" font-size="${r*1.4}">T${i+1}</text></g>`;});
    html+=markers.join('');
    const start=this.preview.at(0),a=this.preview.at(0,-9),b=this.preview.at(0,9),direction=this.preview.at(25),label=this.preview.at(0,28);
    html+=`<g pointer-events="none"><line x1="${a.x}" y1="${a.z}" x2="${b.x}" y2="${b.z}" stroke="#101725" stroke-width="6"/><line x1="${a.x}" y1="${a.z}" x2="${b.x}" y2="${b.z}" stroke="#fff" stroke-width="4" stroke-dasharray="2 2"/><line x1="${start.x}" y1="${start.z}" x2="${direction.x}" y2="${direction.z}" stroke="#a3f6d4" stroke-width="${r*.5}" marker-end="url(#editor-direction)"/><text x="${label.x}" y="${label.z-r*2}" fill="#a3f6d4" stroke="#111723" stroke-width="${r*.6}" paint-order="stroke" font-size="${r*2}" font-weight="bold" text-anchor="middle">START / FINISH</text></g>`;
    this.svg.innerHTML=html;
  }
  private mapPoint(e:PointerEvent){const p=this.svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform(this.svg.getScreenCTM()!.inverse());}
  private pointerDown(e:PointerEvent){
    if(e.button!==0)return;e.preventDefault();const p=this.mapPoint(e),target=(e.target as Element).closest('[data-index]');
    if(this.mode==='select'&&target){this.selected={kind:target.getAttribute('data-kind') as Selection['kind'],index:Number(target.getAttribute('data-index'))};this.drag={pointer:e.pointerId,selection:{...this.selected},before:copy(this.draft),offset:this.selected.kind==='jump'?((this.preview.project(p.x,p.y).s-this.draft.jumps[this.selected.index].position*this.preview.length+this.preview.length*1.5)%this.preview.length)-this.preview.length*.5:0};this.svg.setPointerCapture(e.pointerId);this.refresh();return;}
    if(this.mode==='select'&&!target){this.pan={pointer:e.pointerId,x:e.clientX,y:e.clientY,scale:this.svg.getScreenCTM()!.a,view:{...this.view}};this.svg.setPointerCapture(e.pointerId);return;}
    if(this.mode==='jump'){
      if(this.draft.jumps.length>=120){this.message('The maximum is 120 jumps.');return;}
      const at=this.preview.project(p.x,p.y);if(at.distance>25){this.message('Click closer to the track to place a jump.');return;}
      this.change(()=>{this.draft.jumps.push({position:Math.min(.999999,at.s/this.preview.length),height:3.2,rise:12,flat:0,fall:20});this.selected={kind:'jump',index:this.draft.jumps.length-1};});this.mode='select';this.updateTools();
    }else if(this.mode==='turn'){
      if(this.draft.points.length>=120){this.message('The maximum is 120 turn points.');return;}
      let best=Infinity,index=0;
      this.draft.points.forEach((a,i)=>{const b=this.draft.points[(i+1)%this.draft.points.length],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.y-a[1])*dz)/(dx*dx+dz*dz)));const d=Math.hypot(p.x-a[0]-t*dx,p.y-a[1]-t*dz);if(d<best){best=d;index=i+1;}});
      this.change(()=>{this.draft.points.splice(index,0,[p.x,p.y]);this.draft.bermHeights?.splice(index,0,null);this.selected={kind:'turn',index};});this.mode='select';this.updateTools();
    }
  }
  private action(action:string){
    if(action.startsWith('3d-')){
      if(action==='3d-focus')this.preview3D?.focus();
      if(action==='3d-whole')this.preview3D?.overview();
      if(action==='3d-side')this.preview3D?.sideView();
      if(action==='3d-in')this.preview3D?.zoom(.8);
      if(action==='3d-out')this.preview3D?.zoom(1.25);
      return;
    }
    if(action==='close'){this.close();return;}
    if(action==='undo'||action==='redo'){const from=action==='undo'?this.undo:this.redo,to=action==='undo'?this.redo:this.undo;if(from.length){to.push(copy(this.draft));this.draft=from.pop()!;this.rebuild();}return;}
    if(action==='fit'){this.fit();return;}
    if(action.startsWith('zoom-')){const factor=action==='zoom-in'?.8:1.25;if(this.view.w*factor<40||this.view.w*factor>3000)return;this.view.x+=this.view.w*(1-factor)/2;this.view.y+=this.view.h*(1-factor)/2;this.view.w*=factor;this.view.h*=factor;this.draw();return;}
    if(action==='add-jump'||action==='add-turn'){
      const kind=action==='add-jump'?'jump':'turn';
      if((kind==='jump'?this.draft.jumps:this.draft.points).length>=120){this.message('Maximum 120 objects of each kind.');return;}
      this.change(()=>{
        const j=this.draft.jumps[this.selected.index];
        if(kind==='jump'){
          const s=this.selected.kind==='jump'&&j?j.position*this.preview.length+obstacleLength(j)+4:this.preview.project(...this.draft.points[this.selected.kind==='turn'?this.selected.index:0]).s;
          this.draft.jumps.push({position:(s%this.preview.length)/this.preview.length,height:3.2,rise:12,flat:0,fall:20});this.selected={kind:'jump',index:this.draft.jumps.length-1};
        }else{
          const i=this.selected.kind==='turn'?this.selected.index:0,a=this.draft.points[i],b=this.draft.points[(i+1)%this.draft.points.length];
          this.draft.points.splice(i+1,0,[(a[0]+b[0])/2,(a[1]+b[1])/2]);this.draft.bermHeights?.splice(i+1,0,null);this.selected={kind:'turn',index:i+1};
        }
      });return;
    }
    if(action==='delete'){this.change(()=>{if(this.selected.kind==='jump')this.draft.jumps.splice(this.selected.index,1);else if(this.draft.points.length>4){this.draft.points.splice(this.selected.index,1);this.draft.bermHeights?.splice(this.selected.index,1);}});return;}
    if(action==='duplicate'){const j=this.draft.jumps[this.selected.index];if(!j)return;this.change(()=>{this.draft.jumps.push({...j,position:(j.position+(obstacleLength(j)+4)/this.preview.length)%1});this.selected.index=this.draft.jumps.length-1;});return;}
    if(action==='reset'){this.change(()=>{this.draft=layoutFromTrack(new Track(courseById(this.draft.courseId)));this.selected.index=0;});this.fit();return;}
    if(action==='import'){this.element<HTMLInputElement>('#layout-import').click();return;}
    if(action==='export'){
      try{const data=validateLayout(this.draft);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`afterglow-${data.courseId}-layout.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);this.message('Layout exported. Keep this file as a backup.');}catch(error){this.message((error as Error).message,true);}return;
    }
    if(action==='save'||action==='ride'){
      try{const layout=validateLayout(this.draft);this.onSave(layout,action==='ride');this.releasePreview();this.root.classList.add('hidden');}catch(error){this.message(`Could not save: ${(error as Error).message}`,true);}
    }
  }
}
