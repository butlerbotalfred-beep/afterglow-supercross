import * as THREE from 'three';
import {Track} from './track';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

/** Seeded scenery stays clear of the racing corridor and follows the ground elevation. */
export function addScenery(scene:THREE.Scene,track:Track,random:()=>number){
  const b=track.bounds,theme=track.course.id;
  const objects:THREE.Mesh[]=[];
  const materials=new Map<string,THREE.MeshStandardMaterial>();
  const material=(color:string)=>{if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({color,roughness:.94}));return materials.get(color)!;};
  function mesh(g:THREE.BufferGeometry,color:string,x:number,y:number,z:number,sx=1,sy=1,sz=1){
    const m=new THREE.Mesh(g,material(color));m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;m.receiveShadow=true;objects.push(m);return m;
  }
  if(theme==='coast'){
    const water=new THREE.Mesh(new THREE.PlaneGeometry(1600,1800,1,1),new THREE.MeshStandardMaterial({color:'#428eaa',metalness:.35,roughness:.28}));
    water.rotation.x=-Math.PI/2;water.position.set(b.maxX+840,3,0);scene.add(water);
    for(let i=0;i<12;i++){const line=new THREE.Mesh(new THREE.PlaneGeometry(2,1200),new THREE.MeshBasicMaterial({color:'#b7e7e5',transparent:true,opacity:.22}));line.rotation.x=-Math.PI/2;line.position.set(b.maxX+50+i*23,3.05,0);scene.add(line);}
  }
  for(let i=0;i<(theme==='alpine'?300:theme==='dusk'?65:95);i++){
    const x=b.minX-65+random()*(b.maxX-b.minX+130),z=b.minZ-75+random()*(b.maxZ-b.minZ+150);
    if(track.project(x,z).distance<13)continue;
    const y=track.baseHeight(x,z),h=4+random()*12;
    if(theme==='alpine'){
      mesh(new THREE.CylinderGeometry(.25,.5,h*.6,6),'#605448',x,y+h*.3,z);
      for(let k=0;k<3;k++)mesh(new THREE.ConeGeometry(h*(.23-k*.04),h*.55,9),['#284f43','#345c4a','#49735a'][k],x,y+h*(.4+k*.21),z);
    }else if(theme==='canyon'){
      mesh(new THREE.CylinderGeometry(3+random()*4,6+random()*5,h*1.5,7),'#a85a3d',x,y+h*.75,z);
      mesh(new THREE.CylinderGeometry(4,6,1.3,7),'#d29864',x,y+h*1.45,z);
    }else if(theme==='coast'){
      if(i%3===0){mesh(new THREE.CylinderGeometry(.2,.35,h,7),'#8d7960',x,y+h/2,z);
        for(let k=0;k<6;k++){const leaf=mesh(new THREE.SphereGeometry(1,6,4),'#527452',x+Math.cos(k)*2,y+h,z+Math.sin(k)*2,3,.18,.7);leaf.rotation.y=-k;}}
      else mesh(new THREE.DodecahedronGeometry(1,0),'#b1a18a',x,y+.5,z,1+random()*2,.9,2);
    }else if(theme==='quarry'){
      mesh(new THREE.DodecahedronGeometry(1,0),i%2?'#5a6066':'#8a8176',x,y+h*.22,z,h*.7,h*.4,h*.6);
      if(i%12===0){mesh(new THREE.CylinderGeometry(2,2,12,12),'#a3957a',x,y+6,z);mesh(new THREE.ConeGeometry(2.2,2,12),'#545b64',x,y+13,z);}
    }
  }
  if(theme==='dusk'){
    // A distant lit city, framed below the mountain silhouette like the concept.
    for(let i=0;i<36;i++){
      const x=b.minX-60+i*13,z=b.maxZ+90+random()*40,h=9+random()*33;
      mesh(new THREE.BoxGeometry(8,h,7),i%2?'#45475f':'#535365',x,h/2,z);
      const windows=new THREE.InstancedMesh(new THREE.PlaneGeometry(.6,1),new THREE.MeshBasicMaterial({color:'#ffe7ac'}),Math.floor(h/3)*3);
      const dummy=new THREE.Object3D();let n=0;
      for(let row=0;row<Math.floor(h/3);row++)for(let col=0;col<3;col++){dummy.position.set(x-2+col*2,2+row*3,z-3.53);dummy.rotation.y=Math.PI;dummy.updateMatrix();windows.setMatrixAt(n++,dummy.matrix);}scene.add(windows);
    }
  }
  if(theme==='quarry'){
    const x=b.maxX+20,z=b.minZ+30,y=track.baseHeight(x,z);
    mesh(new THREE.CylinderGeometry(.65,.9,42,8),'#c49b4f',x,y+21,z);
    mesh(new THREE.BoxGeometry(60,1.3,1.3),'#c49b4f',x-15,y+41,z);
    mesh(new THREE.CylinderGeometry(.06,.06,25,4),'#333942',x-40,y+28,z);
  }
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  for(const m of objects){m.updateMatrix();const g=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();g.applyMatrix4(m.matrix);const mat=m.material as THREE.Material;if(!batches.has(mat))batches.set(mat,[]);batches.get(mat)!.push(g);m.geometry.dispose();}
  for(const [mat,parts]of batches){const m=new THREE.Mesh(mergeGeometries(parts),mat);m.castShadow=true;m.receiveShadow=true;scene.add(m);parts.forEach(g=>g.dispose());}
}

export function disposeWorld(scene:THREE.Scene){
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  scene.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();const m=o as THREE.Mesh;if(m.geometry)geometries.add(m.geometry);if(m.material)for(const mat of Array.isArray(m.material)?m.material:[m.material])materials.add(mat);if(o instanceof THREE.Light&&'shadow' in o)(o as THREE.DirectionalLight).shadow?.map?.dispose();});
  materials.forEach(mat=>{for(const v of Object.values(mat))if(v instanceof THREE.Texture)textures.add(v);if(mat instanceof THREE.ShaderMaterial)for(const u of Object.values(mat.uniforms))if(u.value instanceof THREE.Texture)textures.add(u.value);mat.dispose();});
  if(scene.background instanceof THREE.Texture)textures.add(scene.background);textures.forEach(t=>{if(!t.userData.persistent)t.dispose();});geometries.forEach(g=>g.dispose());scene.clear();
}
