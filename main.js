// main.js — update: movement once per turn, camera views, turret orientation, proper 3D firing

(function () {
  // CONFIG
  const GRID_SIZE = 13; // tiles (13x13)
  const TILE_SIZE = 1;
  const STARTING_COINS = 200;
  const LOG_MAX = 12;
  const GRAVITY = -9.8; // world units per second^2 (scaled)

  // Tank classes
  const TANK_CLASSES = {
    S: { name: 'Scout', cost: 50, speed: 3, range: 3, durability: 50, strength: 20, color: '#c26f3c' },
    A: { name: 'Assault', cost: 100, speed: 2, range: 4, durability: 100, strength: 40, color: '#c26f3c' },
    H: { name: 'Heavy', cost: 200, speed: 1, range: 5, durability: 200, strength: 80, color: '#c26f3c' }
  };

  // Game state
  const state = {
    coins: STARTING_COINS,
    turn: 'player',
    playerTanks: [],
    enemyTanks: [],
    selectedTankId: null,
    map: {}, // obstacles keyed by x_z
    logs: []
  };

  // Utilities
  function log(txt) {
    const time = new Date().toLocaleTimeString();
    state.logs.unshift({ t: time, text: txt });
    if (state.logs.length > LOG_MAX) state.logs.pop();
    renderLogs();
    console.log(`[${time}] ${txt}`);
  }

  function key(x, z) { return x + '_' + z; }

  // THREE setup
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc4ff);

  // Camera: default angled top-down
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  const CAMERA_PRESETS = {
    overview: { pos: new THREE.Vector3(0, 14, 14), look: new THREE.Vector3(0,0,0) },
    top: { pos: new THREE.Vector3(0, 25, 0.01), look: new THREE.Vector3(0,0,0) },
    side: { pos: new THREE.Vector3(0, 6.5, 18), look: new THREE.Vector3(0,0,0) }
  };
  let currentCamera = 'overview';
  camera.position.copy(CAMERA_PRESETS.overview.pos);
  camera.lookAt(CAMERA_PRESETS.overview.look);

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(5, 10, 7);
  scene.add(dir);

  // Ground + grid
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x2f7d32 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GRID_SIZE * TILE_SIZE, GRID_SIZE * TILE_SIZE), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.001;
  scene.add(ground);

  const gridHelper = new THREE.GridHelper(GRID_SIZE * TILE_SIZE, GRID_SIZE, 0x222222, 0x444444);
  scene.add(gridHelper);

  // Groups
  const entitiesGroup = new THREE.Group(); scene.add(entitiesGroup);
  const overlayGroup = new THREE.Group(); scene.add(overlayGroup);

  // Base (thin)
  const base = createBox(1.6, 0.12, 1.6, 0xffcc00);
  setEntityPos(base.mesh, 0, -6);
  base.hp = 300;
  scene.add(base.mesh);

  // Create glyph canvas for sprites
  function createGlyphCanvas(letter, bgColor = '#333', size = 128) {
    const canv = document.createElement('canvas'); canv.width = size; canv.height = size;
    const ctx = canv.getContext('2d');
    // pixelated bg
    ctx.fillStyle = bgColor; ctx.fillRect(0,0,size,size);
    // outline
    ctx.strokeStyle = 'rgba(0,0,0,0.24)'; ctx.lineWidth = 4; ctx.strokeRect(6,6,size-12,size-12);
    ctx.fillStyle='#fff'; ctx.font = Math.floor(size*0.5) + 'px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(letter, size/2, size/2 + 4);
    return canv;
  }

  function createSpritePlane(letter, colorHex, tintIndex = 0) {
    // tintIndex used to slightly vary color between tanks
    const tintFactor = 0.05 * tintIndex;
    const bg = colorHex; // we'll keep same base
    const canv = createGlyphCanvas(letter, bg, 128);
    const tex = new THREE.CanvasTexture(canv); tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent:true, alphaTest:0.1 });
    const geom = new THREE.PlaneGeometry(0.95, 0.95);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = 0.06; // very thin cardboard piece lifted slightly
    mesh.userData.isSprite = true;
    return { mesh, tex };
  }

  // thin box helper
  function createBox(w,h,d,color){ const geom=new THREE.BoxGeometry(w,h,d); const mat=new THREE.MeshStandardMaterial({color}); const mesh=new THREE.Mesh(geom,mat); mesh.position.y=h/2; return {mesh,mat}; }
  function setEntityPos(mesh, gx, gz){ mesh.position.x = gx * TILE_SIZE; mesh.position.z = gz * TILE_SIZE; }

  // spawn player tank with tiny turret object to show yaw
  function spawnPlayerTank(classKey, gx, gz) {
    const cls = TANK_CLASSES[classKey];
    const tintIndex = state.playerTanks.length;
    const { mesh } = createSpritePlane(classKey, cls.color, tintIndex);
    // turret: thin arrow using box
    const turret = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.6), new THREE.MeshStandardMaterial({color:0x222222}));
    turret.position.y = 0.12; // slightly above sprite
    turret.rotation.x = 0; // keep aligned
    const group = new THREE.Group(); group.add(mesh); group.add(turret);
    group.tile = { x: gx, z: gz };
    group.classKey = classKey;
    group.hp = cls.durability; group.maxHp = cls.durability;
    group.speed = cls.speed; group.range = cls.range; group.strength = cls.strength; group.cost = cls.cost; group.isPlayer = true;
    group.moved = false; // movement flag
    group.turret = turret; group.turretYaw = 0; group.aimTarget = null;
    entitiesGroup.add(group);
    setEntityPos(group, gx, gz);
    const id = 'P' + (state.playerTanks.length + 1);
    state.playerTanks.push({ id, mesh: group, meta: group });
    return id;
  }

  function spawnEnemyTank(classKey, gx, gz) {
    const cls = TANK_CLASSES[classKey];
    const tintIndex = state.enemyTanks.length;
    const { mesh } = createSpritePlane(classKey, '#880000', tintIndex);
    const turret = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.6), new THREE.MeshStandardMaterial({color:0x111111}));
    turret.position.y = 0.12;
    const group = new THREE.Group(); group.add(mesh); group.add(turret);
    group.tile = { x: gx, z: gz };
    group.classKey = classKey; group.hp = cls.durability; group.maxHp = cls.durability;
    group.speed = cls.speed; group.range = cls.range; group.strength = cls.strength; group.cost = cls.cost; group.isPlayer = false;
    group.moved = false; group.turret = turret; group.turretYaw = 0; group.aimTarget = null;
    entitiesGroup.add(group);
    setEntityPos(group, gx, gz);
    const id = 'E' + (state.enemyTanks.length + 1);
    state.enemyTanks.push({ id, mesh: group, meta: group });
    return id;
  }

  function placeObstacle(type, gx, gz) {
    let hp = 50; let color = 0x8b4513; let slows = false;
    if (type === 'wall') { hp = 40; color = 0x8b4513; }
    if (type === 'rock') { hp = 120; color = 0x666666; }
    if (type === 'tree') { hp = 20; color = 0x228B22; slows = true; }
    const b = createBox(0.98, 0.98, 0.98, color);
    setEntityPos(b.mesh, gx, gz); entitiesGroup.add(b.mesh);
    state.map[key(gx,gz)] = { type, hp, slows, mesh: b.mesh };
  }

  // init
  function initMap(){ placeObstacle('wall',0,-2); placeObstacle('wall',1,-2); placeObstacle('rock',3,-1); placeObstacle('tree',-2,2); placeObstacle('tree',-3,3); spawnEnemyTank('S',5,5); spawnEnemyTank('A',4,4); spawnPlayerTank('S',-4,-4); spawnPlayerTank('A',-3,-4); }
  initMap();

  // UI refs
  const coinsVal = document.getElementById('coinsVal');
  const turnVal = document.getElementById('turnVal');
  const tankList = document.getElementById('tankList');
  const shopEl = document.getElementById('shop');
  const logEl = document.getElementById('log');
  const endTurnBtn = document.getElementById('endTurn');
  const moveBtn = document.getElementById('moveBtn');
  const aimBtn = document.getElementById('aimBtn');
  const aimPanel = document.getElementById('aimPanel');
  const angleInput = document.getElementById('angle');
  const powerInput = document.getElementById('power');
  const fireBtn = document.getElementById('fireBtn');
  const cancelAim = document.getElementById('cancelAim');
  const helpBtn = document.getElementById('helpBtn');
  const helpOverlay = document.getElementById('helpOverlay');
  const closeHelp = document.getElementById('closeHelp');
  const viewTop = document.getElementById('viewTop');
  const viewSide = document.getElementById('viewSide');

  function renderUI(){ coinsVal.textContent = state.coins; turnVal.textContent = state.turn === 'player' ? 'Player' : 'Enemy';
    tankList.innerHTML=''; state.playerTanks.forEach((t,idx)=>{
      const div=document.createElement('div'); div.className='tank-card'+(state.selectedTankId===t.id?' selected':''); div.tabIndex=0; div.title=`${t.id} — ${t.meta.classKey} — Speed ${t.meta.speed}`; div.onclick=()=>selectTank(t.id);
      const glyph=document.createElement('div'); glyph.className='tank-glyph'; glyph.textContent=t.meta.classKey; glyph.style.background=getTintColor(TANK_CLASSES[t.meta.classKey].color, idx);
      const meta=document.createElement('div'); meta.className='tank-meta'; const name=document.createElement('div'); name.className='name'; name.textContent=`${t.id} (${t.meta.classKey})`;
      const hpBar=document.createElement('div'); hpBar.className='hpbar'; const hpInner=document.createElement('i'); const hpPercent=Math.max(0,Math.min(100,Math.round((t.meta.hp/t.meta.maxHp)*100))); hpInner.style.width=hpPercent+'%'; hpBar.appendChild(hpInner);
      const movedNote=document.createElement('div'); movedNote.style.fontSize='12px'; movedNote.style.color='rgba(255,255,255,0.6)'; movedNote.textContent = t.meta.moved ? 'Moved' : '';
      meta.appendChild(name); meta.appendChild(hpBar); meta.appendChild(movedNote);
      const hint=document.createElement('div'); hint.style.marginLeft='8px'; hint.style.color='rgba(255,255,255,0.6)'; hint.textContent=idx<9?(idx+1):'';
      div.appendChild(glyph); div.appendChild(meta); div.appendChild(hint); tankList.appendChild(div);
    });
    shopEl.innerHTML=''; Object.keys(TANK_CLASSES).forEach(k=>{ const c=TANK_CLASSES[k]; const item=document.createElement('div'); item.className='shop-item'; item.innerHTML=`<div style="font-weight:700">${c.name} (${k})</div><div class="price">${c.cost}</div>`; const buy=document.createElement('button'); buy.className='btn shop-buy'; buy.textContent='Buy'; buy.onclick=()=>purchaseTank(k); item.appendChild(buy); shopEl.appendChild(item); });
  }

  function renderLogs(){ logEl.innerHTML=''; state.logs.slice(0,LOG_MAX).forEach(l=>{ const d=document.createElement('div'); d.className='log-item'; d.innerHTML=`<div>${l.text}</div><small>${l.t}</small>`; logEl.appendChild(d); }); }
  function getClassColor(k){ return (TANK_CLASSES[k] && TANK_CLASSES[k].color)?TANK_CLASSES[k].color:'#666'; }
  function getTintColor(hex, idx){ // simple tint: lighten by small amount
    // convert hex to rgb
    const c = hex.replace('#',''); const r=parseInt(c.substr(0,2),16); const g=parseInt(c.substr(2,2),16); const b=parseInt(c.substr(4,2),16);
    const f = 1 + (idx * 0.04);
    const nr=Math.min(255,Math.round(r*f)); const ng=Math.min(255,Math.round(g*f)); const nb=Math.min(255,Math.round(b*f)); return `rgb(${nr},${ng},${nb})`; }

  renderUI(); renderLogs();

  // overlays
  let movementOverlay=[]; function clearOverlay(){ overlayGroup.clear(); movementOverlay=[]; }
  function showMovementRange(meta){ if (meta.moved) { log(`${meta.isPlayer ? 'Player' : 'Enemy'} tank already moved this turn`); return; } clearOverlay(); const range=meta.speed; const cx=meta.tile.x, cz=meta.tile.z; for(let dx=-range;dx<=range;dx++){ for(let dz=-range;dz<=range;dz++){ const tx=cx+dx, tz=cz+dz; if(Math.abs(dx)+Math.abs(dz)<=range){ const geo=new THREE.PlaneGeometry(1,1); const mat=new THREE.MeshBasicMaterial({color:0x00ffcc,transparent:true,opacity:0.18,side:THREE.DoubleSide}); const p=new THREE.Mesh(geo,mat); p.rotation.x=-Math.PI/2; p.position.set(tx,0.01,tz); overlayGroup.add(p); movementOverlay.push(p); } } } }

  function selectTank(id){ state.selectedTankId=id; state.playerTanks.forEach(t=>{ if(t.meta && t.meta.scale) t.meta.scale.set(1,1,1); }); const entry=state.playerTanks.find(t=>t.id===id); if(!entry) return; if(entry.meta && entry.meta.scale) entry.meta.scale.set(1.05,1.05,1.05); showMovementRange(entry.meta); renderUI(); log(`Selected ${id} at (${entry.meta.tile.x},${entry.meta.tile.z})`); }

  // movement: allow once per turn
  renderer.domElement.addEventListener('click',(ev)=>{
    const rect = renderer.domElement.getBoundingClientRect(); const x = ((ev.clientX-rect.left)/rect.width)*2-1; const y = -((ev.clientY-rect.top)/rect.height)*2+1; const mouse=new THREE.Vector2(x,y); const ray=new THREE.Raycaster(); ray.setFromCamera(mouse,camera);
    const plane=new THREE.Plane(new THREE.Vector3(0,1,0),0); const intersect=new THREE.Vector3(); ray.ray.intersectPlane(plane,intersect); const gx=Math.round(intersect.x), gz=Math.round(intersect.z);
    if (inAimMode) {
      // set aim target horizontally
      if (!aimingTank) return; aimingTank.meta.aimTarget = { x: intersect.x, z: intersect.z }; // store precise
      // compute yaw
      const dx = aimingTank.meta.aimTarget.x - aimingTank.meta.tile.x; const dz = aimingTank.meta.aimTarget.z - aimingTank.meta.tile.z; const yaw = Math.atan2(dx, dz); aimingTank.meta.turretYaw = yaw; aimingTank.meta.turret.rotation.y = yaw; log(`${aimingTank.id} aim direction set to (${gx},${gz})`); return;
    }

    if (state.turn !== 'player') return; if (!state.selectedTankId) return;
    const tank = state.playerTanks.find(t=>t.id===state.selectedTankId); const meta = tank.meta;
    if (meta.moved) { log(`${tank.id} already moved this turn`); return; }
    const dist = Math.abs(gx-meta.tile.x)+Math.abs(gz-meta.tile.z);
    if (dist <= meta.speed) { const old={x:meta.tile.x,z:meta.tile.z}; meta.tile.x=gx; meta.tile.z=gz; setEntityPos(meta,gx,gz); meta.moved = true; log(`${tank.id} moved from (${old.x},${old.z}) to (${gx},${gz})`); clearOverlay(); renderUI(); } else { /* not in range */ }
  });

  // purchase
  function purchaseTank(classKey){ const cls=TANK_CLASSES[classKey]; if(state.coins<cls.cost){ alert('Not enough coins'); return; } const spawnX=-4-state.playerTanks.length; const spawnZ=-5; state.coins-=cls.cost; spawnPlayerTank(classKey,spawnX,spawnZ); renderUI(); log(`Purchased ${cls.name} at (${spawnX},${spawnZ}) for ${cls.cost}`); }

  // actions
  let inAimMode=false; let aimingTank=null;
  moveBtn.addEventListener('click',()=>{ if(!state.selectedTankId){ alert('Select a tank first'); return; } const t=state.playerTanks.find(tt=>tt.id===state.selectedTankId); t && showMovementRange(t.meta); });
  aimBtn.addEventListener('click',()=>{ if(!state.selectedTankId){ alert('Select a tank first'); return; } enterAimMode(state.selectedTankId); });
  endTurnBtn.addEventListener('click',()=>{ if(state.turn==='player') endPlayerTurn(); });
  viewTop.addEventListener('click',()=>{ setCamera('top'); }); viewSide.addEventListener('click',()=>{ setCamera('side'); });

  function enterAimMode(tankId){ const tankEntry=state.playerTanks.find(t=>t.id===tankId); if(!tankEntry) return; inAimMode=true; aimingTank=tankEntry; aimPanel.classList.remove('hidden'); const p=aimingTank.meta.tile; camera.position.set(p.x,3.8,p.z+2.2); camera.lookAt(p.x,0,p.z); angleInput.focus(); log(`${tankId} entered aiming mode`); }
  cancelAim.addEventListener('click',()=>{ exitAimMode(); });

  fireBtn.addEventListener('click',()=>{ if(!inAimMode||!aimingTank) return; const angleDeg=parseFloat(angleInput.value); const power=parseFloat(powerInput.value); performFire(aimingTank, angleDeg, power); exitAimMode(); setTimeout(()=>{ endPlayerTurn(); },500); });
  function exitAimMode(){ aimPanel.classList.add('hidden'); inAimMode=false; aimingTank=null; camera.position.copy(CAMERA_PRESETS.overview.pos); camera.lookAt(CAMERA_PRESETS.overview.look); }

  // compute and fire projectile with 3D vector based on aimTarget
  function performFire(tankEntry, angleDeg, power){ const meta = tankEntry.meta; const cls = TANK_CLASSES[meta.classKey]; const angle = THREE.MathUtils.degToRad(angleDeg); const speedMag = power/10; // overall speed
    // horizontal direction: use aimTarget if set, otherwise forward (-z)
    let dir = new THREE.Vector3(0,0,-1);
    if (meta.aimTarget) { dir = new THREE.Vector3(meta.aimTarget.x - meta.tile.x, 0, meta.aimTarget.z - meta.tile.z); if (dir.length() === 0) dir.set(0,0,-1); dir.normalize(); }
    // horizontal speed
    const h = Math.cos(angle) * speedMag; const vy = Math.sin(angle) * speedMag;
    const vx = dir.x * h; const vz = dir.z * h;
    const projGeom = new THREE.SphereGeometry(0.12,8,8); const projMat = new THREE.MeshStandardMaterial({color:0xffff66}); const proj = new THREE.Mesh(projGeom, projMat);
    // spawn slightly above the sprite
    proj.position.set(meta.tile.x, 0.35, meta.tile.z);
    scene.add(proj);
    let vel = new THREE.Vector3(vx, vy, vz);
    const dt = 1/60;
    const projInterval = setInterval(()=>{
      vel.y += GRAVITY * dt * 0.2;
      proj.position.addScaledVector(vel, dt);
      // ground hit
      if (proj.position.y <= 0.08) {
        const gx=Math.round(proj.position.x), gz=Math.round(proj.position.z);
        resolveProjectileHit(gx,gz,cls.strength*(power/100), tankEntry.id);
        scene.remove(proj); clearInterval(projInterval); return;
      }
      // mid-air collision with obstacles (if projectile passes over obstacle tile and is low enough)
      const gx=Math.round(proj.position.x), gz=Math.round(proj.position.z);
      const m = state.map[key(gx,gz)];
      if (m && proj.position.y < 1.0) { resolveProjectileHit(gx,gz,cls.strength*(power/100), tankEntry.id); scene.remove(proj); clearInterval(projInterval); return; }
      // collision with tanks — check 3D distance to each tank (allow hits in air)
      [...state.enemyTanks, ...state.playerTanks].forEach(t=>{
        const tx=t.meta.tile.x, tz=t.meta.tile.z; const dist = Math.sqrt((tx - proj.position.x)**2 + (tz - proj.position.z)**2 + (0.25 - proj.position.y)**2);
        if (dist < 0.6) { applyDamageToTank(t, cls.strength*(power/100)); scene.remove(proj); clearInterval(projInterval); }
      });
    }, dt*1000);
    log(`${tankEntry.id} fired angle ${angleDeg} power ${power}`);
  }

  function resolveProjectileHit(gx,gz,damage,sourceId){ const m = state.map[key(gx,gz)]; if (m){ m.hp -= damage; if (m.hp<=0){ scene.remove(m.mesh); delete state.map[key(gx,gz)]; log(`${sourceId} destroyed ${m.type} at (${gx},${gz})`); } else { log(`${sourceId} damaged ${m.type} at (${gx},${gz}) (hp ${Math.round(m.hp)})`); } } else { log(`${sourceId} impacted at (${gx},${gz})`); } }

  function applyDamageToTank(t,dmg){ t.meta.hp -= dmg; log(`${t.id} took ${Math.round(dmg)} damage (hp ${Math.max(0,Math.round(t.meta.hp))})`); if (t.meta.hp<=0){ scene.remove(t.meta); if (t.isPlayer) state.playerTanks = state.playerTanks.filter(x=>x.id!==t.id); else state.enemyTanks = state.enemyTanks.filter(x=>x.id!==t.id); log(`${t.id} was destroyed`); renderUI(); } else { renderUI(); } }

  function endPlayerTurn(){ state.turn='enemy'; renderUI(); log('Player turn ended. Enemy turn starts.'); setTimeout(()=>{ enemyAct(); state.turn='player'; // reset movement flags for player's tanks
    state.playerTanks.forEach(t=>{ t.meta.moved = false; }); renderUI(); log('Enemy turn ended. Player turn starts.'); }, 800); }

  function enemyAct(){ state.enemyTanks.forEach(e=>{ const meta=e.meta; if (state.playerTanks.length===0) return; let nearest=null; let nd=1e9; state.playerTanks.forEach(p=>{ const d=Math.abs(p.meta.tile.x - meta.tile.x) + Math.abs(p.meta.tile.z - meta.tile.z); if (d < nd){ nd = d; nearest = p; } }); if (!nearest) return; // enemy moves one step toward nearest
    const sx = Math.sign(nearest.meta.tile.x - meta.tile.x); const sz = Math.sign(nearest.meta.tile.z - meta.tile.z); const mx = meta.tile.x + (sx !== 0 ? sx : 0); const mz = meta.tile.z + (sz !== 0 ? sz : 0); meta.tile.x = mx; meta.tile.z = mz; setEntityPos(meta, mx, mz); log(`${e.id} moved to (${mx},${mz})`); const dist = Math.abs(nearest.meta.tile.x - meta.tile.x) + Math.abs(nearest.meta.tile.z - meta.tile.z); if (dist <= meta.range){ // orient turret toward target
      const dx = nearest.meta.tile.x - meta.tile.x; const dz = nearest.meta.tile.z - meta.tile.z; const yaw = Math.atan2(dx, dz); meta.turret.rotation.y = yaw; meta.turretYaw = yaw; applyDamageToTank(nearest, meta.strength); log(`${e.id} shot ${nearest.id} for ${meta.strength}`); } }); }

  // Keyboard & help & camera toggles
  window.addEventListener('keydown',(e)=>{ const tag = document.activeElement && document.activeElement.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA') return; if (e.key >= '1' && e.key <= '9'){ const idx = parseInt(e.key,10)-1; if (state.playerTanks[idx]) selectTank(state.playerTanks[idx].id); } else if (e.key === 'm' || e.key === 'M'){ if (state.selectedTankId){ const t = state.playerTanks.find(x=>x.id===state.selectedTankId); t && showMovementRange(t.meta); } } else if (e.key === 'a' || e.key === 'A'){ if (state.selectedTankId) enterAimMode(state.selectedTankId); } else if (e.code === 'Space'){ e.preventDefault(); if (state.turn === 'player') endPlayerTurn(); } else if (e.key === 'Escape'){ if (inAimMode) exitAimMode(); else clearOverlay(); } else if ((e.key === 'f' || e.key === 'F') && inAimMode){ fireBtn.click(); } else if (e.key === 'h' || e.key === 'H'){ toggleHelp(); } else if (e.key === 'v' || e.key === 'V'){ // toggle camera
    setCamera(currentCamera === 'top' ? 'side' : 'top'); }
  });

  helpBtn && helpBtn.addEventListener('click', toggleHelp); closeHelp && closeHelp.addEventListener('click', toggleHelp); function toggleHelp(){ helpOverlay.classList.toggle('hidden'); }

  function setCamera(name){ currentCamera = name; const p = CAMERA_PRESETS[name] || CAMERA_PRESETS.overview; camera.position.copy(p.pos); camera.lookAt(p.look); }

  // Basic gamepad (unchanged minimal)
  let gpIndex = null; window.addEventListener('gamepadconnected',(e)=>{ gpIndex = e.gamepad.index; log('Gamepad connected'); }); window.addEventListener('gamepaddisconnected',(e)=>{ if (gpIndex === e.gamepad.index) gpIndex = null; log('Gamepad disconnected'); });
  function pollGamepad(){ if (gpIndex == null) return; const gp = navigator.getGamepads()[gpIndex]; if (!gp) return; if (gp.buttons[0].pressed){ if (inAimMode) fireBtn.click(); } if (gp.buttons[1].pressed){ if (inAimMode) exitAimMode(); } if (gp.buttons[9] && gp.buttons[9].pressed){ if (state.turn === 'player') endPlayerTurn(); } }

  // Resize & render loop
  window.addEventListener('resize',()=>{ renderer.setSize(window.innerWidth, window.innerHeight); camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); });

  function animate(){ requestAnimationFrame(animate);
    // orient sprite planes to camera yaw while keeping them flat
    entitiesGroup.children.forEach(child=>{
      if (child.userData && child.userData.isSprite){ // nothing
      }
      // if child has turret, ensure turret faces turretYaw
      if (child.turret){ child.turret.rotation.y = child.turretYaw || child.turret.rotation.y; }
    });
    pollGamepad(); renderer.render(scene, camera);
  }
  animate();

  // Initial UI update
  renderUI();

  // Expose for debugging
  window._cbc3 = state;

})();