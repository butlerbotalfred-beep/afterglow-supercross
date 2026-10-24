import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Track} from './track';

/** Layered crowd cards and batched architecture keep the stadium affordable in four views. */
export function addStadium(scene:THREE.Scene,track:Track){
  if(track.course.id!=='dusk')return;
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const concrete=new THREE.MeshStandardMaterial({color:'#55586b',roughness:.95});
  const steel=new THREE.MeshStandardMaterial({color:'#788092',metalness:.6,roughness:.42});
  const fascia=new THREE.MeshStandardMaterial({color:'#252a41',roughness:.7});
  const roof=new THREE.MeshStandardMaterial({color:'#34394c',metalness:.35,roughness:.65,side:THREE.DoubleSide});
  const light=new THREE.MeshBasicMaterial({color:'#ffe9ba',toneMapped:false});
  const crowdTexture=new THREE.TextureLoader().load('/art/crowd-v2.png');crowdTexture.colorSpace=THREE.SRGBColorSpace;crowdTexture.wrapS=THREE.RepeatWrapping;crowdTexture.anisotropy=8;
  const crowdMaterial=new THREE.MeshBasicMaterial({map:crowdTexture,color:'#bfc4db',side:THREE.DoubleSide});
  const dummy=new THREE.Object3D();
  const ribbonCanvas=document.createElement('canvas');ribbonCanvas.width=1024;ribbonCanvas.height=128;const rc=ribbonCanvas.getContext('2d')!;
  rc.fillStyle='#262c42';rc.fillRect(0,0,1024,128);rc.fillStyle='#efb74d';rc.font='italic 900 42px Arial';rc.textAlign='center';rc.fillText('AFTERGLOW  /  SUPERCROSS',512,84);
  rc.fillStyle='#7483b1';for(const x of [22,960]){rc.beginPath();rc.moveTo(x,15);rc.lineTo(x+26,15);rc.lineTo(x+50,64);rc.lineTo(x+26,113);rc.lineTo(x,113);rc.lineTo(x+24,64);rc.fill();}
  const ribbonMap=new THREE.CanvasTexture(ribbonCanvas);ribbonMap.colorSpace=THREE.SRGBColorSpace;ribbonMap.wrapS=THREE.RepeatWrapping;ribbonMap.anisotropy=8;
  const ribbon=new THREE.MeshBasicMaterial({map:ribbonMap,color:'#bdc7ea',side:THREE.DoubleSide});
  function add(g:THREE.BufferGeometry,material:THREE.Material,matrix:THREE.Matrix4){g.applyMatrix4(matrix);if(!batches.has(material))batches.set(material,[]);batches.get(material)!.push(g);}
  function stand(x:number,z:number,angle:number,length:number,rows:number,spacing=.7,covered=false){
    const base=track.baseHeight(x,z),transform=new THREE.Matrix4().makeRotationY(angle);transform.setPosition(x,base,z);
    const local=(x:number,y:number,z:number,sx:number,sy:number,sz:number,mat:THREE.Material)=>{dummy.position.set(x,y,z);dummy.scale.set(1,1,1);dummy.rotation.set(0,0,0);dummy.updateMatrix();add(new THREE.BoxGeometry(sx,sy,sz),mat,transform.clone().multiply(dummy.matrix));};
    const tierRow=Math.floor(rows/2),tierGap=2.1;
    for(let row=0;row<rows;row++){
      const depth=row*spacing+(row>=tierRow?tierGap:0),h=2.1+row*.66+(row>=tierRow?.6:0);
      local(depth,h-.28,0,spacing+.1,.55,length,concrete);
      // Break seating into bays with physical stair aisles. A concourse splits both tiers.
      const bays=Math.ceil(length/14),bayLength=length/bays;
      for(let bay=0;bay<bays;bay++){
        const from=-length/2+bay*bayLength+.75,to=from+bayLength-1.5;
        const p=[depth-.35,h+.05,from,depth-.35,h+.05,to,depth-.35,h+1.02,from,depth-.35,h+1.02,to];
        const rowV=(row%9)/9,offset=(row%3)*.23;
        const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute([offset,rowV,offset+(to-from)/36,rowV,offset,rowV+1/9,offset+(to-from)/36,rowV+1/9],2));g.setIndex([0,2,1,1,2,3]);g.computeVertexNormals();add(g,crowdMaterial,transform);
        local(depth-.3,h+.03,from-.45,.1,.06,.55,light);
      }
      if(row===tierRow||row===rows-1){
        local(depth-.4,h+1.04,0,.06,.06,length,steel);
        for(let j=-length/2;j<=length/2;j+=3)local(depth-.4,h+.55,j,.06,1.1,.06,steel);
      }
      if(row===tierRow){
        local(depth-1.35,h-.52,0,2.0,.35,length,concrete);
        local(depth-2.25,h-.16,0,.18,.8,length,fascia);
        for(let j=-length/2+1;j<length/2;j+=3){local(depth-2.4,h-.1,j,.08,.25,.5,light);local(depth-2.4,h+.46,j,.06,1.1,.06,steel);}
        local(depth-2.4,h+1,0,.07,.07,length,steel);
        const g=new THREE.PlaneGeometry(length,.75);g.rotateY(-Math.PI/2);g.translate(depth-2.36,h-.18,0);const uv=g.attributes.uv;for(let v=0;v<uv.count;v++)uv.setX(v,uv.getX(v)*length/32);add(g,ribbon,transform);
      }
    }
    const height=2.7+rows*.66;
    if(length<100){
      // Enclose the reverse of infield stands; riders see service facades on the return lane.
      const back=rows*spacing+tierGap;
      local(back+.15,height*.5,0,.22,height,length,concrete);
      local(back+.31,height*.6,0,.08,2.2,length,fascia);
      for(let j=-length/2+1;j<length/2;j+=6){
        local(back+.34,height*.5,j,.12,height,.15,steel);
        local(back+.38,2.1,j,.09,2.4,1.7,fascia);
        local(back+.41,3.6,j,.08,.18,1.1,light);
      }
    }
    local(-.50,1.1,0,.3,2.2,length,fascia);
    local(-.68,2.3,0,.08,.08,length,steel);
    for(let j=-length/2;j<length/2;j+=3){local(-.68,1.7,j,.07,1.2,.07,steel);local(-.73,1.68,j+.8,.06,.19,.32,light);}
    // Upper hospitality deck with a continuous dark fascia and warm practical lights.
    local(rows*spacing+tierGap+.4,height+.2,0,1.8,.3,length+1,concrete);
    local(rows*spacing+tierGap-.45,height+.6,0,.15,.7,length+1,fascia);
    for(let j=-length/2+2;j<length/2;j+=4)local(rows*spacing+tierGap-.55,height+.8,j,.08,.2,.55,light);
    if(covered){
      local(rows*spacing*.84+tierGap,height+3.4,0,rows*spacing*.4,.2,length+3,roof);
      local(rows*spacing*.55,height+3.2,-length/2,rows*spacing+4,.35,.18,steel);
      for(let j=-length/2;j<=length/2;j+=12){local(rows*spacing,height/2+1.7,j,.18,height+3.4,.18,steel);local(rows*spacing*.84+tierGap,height+3.1,j,rows*spacing*.4,.15,.14,steel);}
    }
  }
  const b=track.bounds,mid=(b.minZ+b.maxZ)/2;
  for(const side of [-1,1])stand(side*(Math.max(Math.abs(b.minX),Math.abs(b.maxX))+12),mid,side===1?0:Math.PI,b.maxZ-b.minZ+50,28,.8,true);
  // Trackside stands sit in the safe gaps between straights, bringing spectators into the chase view.
  for(const s of [48,475,1320])for(const side of [-1,1]){
    const p=track.at(s,side*9.8),heading=Math.atan2(p.tx,p.tz)+(side<0?Math.PI:0);
    let clear=true;
    for(const along of [-39,0,39])for(const out of [0,7.8]){
      const xx=p.x+Math.cos(heading)*out+Math.sin(heading)*along,zz=p.z-Math.sin(heading)*out+Math.cos(heading)*along;
      if(track.project(xx,zz).distance<8)clear=false;
    }
    if(clear)stand(p.x,p.z,heading,78,6,.7,false);
  }
  // End stands close the stadium bowl across the horizon.
  stand(0,b.maxZ+14,-Math.PI/2,b.maxX-b.minX+30,25,.8,true);
  stand(0,b.minZ-15,Math.PI/2,b.maxX-b.minX+20,22,.8,true);
  for(const [mat,parts]of batches){const m=new THREE.Mesh(mergeGeometries(parts),mat);m.receiveShadow=mat!==crowdMaterial;m.castShadow=mat!==crowdMaterial;scene.add(m);parts.forEach(g=>g.dispose());}
}
