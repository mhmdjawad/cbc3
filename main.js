// Big refactor main.js implementing turn-based logic, UI, aiming mode, projectiles, destructibles
// Keeps single-file vanilla JS so demo remains runnable without a build step

(function () {
  // CONFIG
  const GRID_SIZE = 13; // tiles (13x13)
  const TILE_SIZE = 1;
  const STARTING_COINS = 200;
  const LOG_MAX = 12;
  const GRAVITY = -9.8; // world units per second^2 (scaled)

  // Tank classes
  const TANK_CLASSES = {
    S: { name: 'Scout', cost: 50, speed: 3, range: 3, durability: 50, strength: 20, color: '#3cb371' },
    A: { name: 'Assault', cost: 100, speed: 2, range: 4, durability: 100, strength: 40, color: '#1e90ff' },
    H: { name: 'Heavy', cost: 200, speed: 1, range: 5, durability: 200, strength: 80, color: '#ff4500' }
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
    state.logs.unshift(txt);
    if (state.logs.length > LOG_MAX) state.logs.pop();
    renderLogs();
    console.log(txt);
  }

  function key(x, z) { return x + '_' + z; }

  // THREE setup
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc4ff);

  // Camera: fixed angled top-down, no auto-rotation
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 14, 14);
  camera.lookAt(0, 0, 0);

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
  ground.position.y = -0.501;
  scene.add(ground);

  const gridHelper = new THREE.GridHelper(GRID_SIZE * TILE_SIZE, GRID_SIZE, 0x222222, 0x444444);
  scene.add(gridHelper);

  // Helpers: group for entities
  const entitiesGroup = new THREE.Group();
  scene.add(entitiesGroup);

  // Movement overlay group
  const overlayGroup = new THREE.Group();
  scene.add(overlayGroup);

  // Base for player
  const base = createBox(1.6, 1.6, 1.6, 0xffcc00);
  setEntityPos(base.mesh, 0, -6);
  base.hp = 300;
  scene.add(base.mesh);

  // --- Texture helpers (generate pixel-like glyph textures at runtime) ---
  function createGlyphTexture(letter, bgColor = '#333', size = 64) {
    const canv = document.createElement('canvas');
    canv.width = size; canv.height = size;
    const ctx = canv.getContext('2d');
    // pixelated background
    ctx.fillStyle = bgColor; ctx.fillRect(0, 0, size, size);
    // draw letter in center
    ctx.fillStyle = '#fff';
    ctx.font = Math.floor(size * 0.7) + 'px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, size/2, size/2 + 2);
    const tex = new THREE.CanvasTexture(canv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  // simple box creator for tanks/obstacles
  function createBox(w, h, d, color, texture) {
    const geom = new THREE.BoxGeometry(w, h, d);
    const mat = texture ? new THREE.MeshStandardMaterial({ map: texture }) : new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = h/2;
    return { mesh, mat };
  }

  function setEntityPos(mesh, gx, gz) {
    mesh.position.x = gx * TILE_SIZE;
    mesh.position.z = gz * TILE_SIZE;
  }

  // Create player's starting tanks
  function spawnPlayerTank(classKey, gx, gz) {
    const cls = TANK_CLASSES[classKey];
    const tex = createGlyphTexture(classKey, cls.color, 64);
    const t = createBox(0.9, 0.9, 0.9, 0x999999, tex);
    t.tile = { x: gx, z: gz };
    t.classKey = classKey;
    t.hp = cls.durability;
    t.maxHp = cls.durability;
    t.speed = cls.speed;
    t.range = cls.range;
    t.strength = cls.strength;
    t.cost = cls.cost;
    t.isPlayer = true;
    entitiesGroup.add(t.mesh);
    setEntityPos(t.mesh, gx, gz);
    const id = 'P' + (state.playerTanks.length + 1);
    state.playerTanks.push({ id, mesh: t.mesh, meta: t });
    return id;
  }

  function spawnEnemyTank(classKey, gx, gz) {
    const cls = TANK_CLASSES[classKey];
    const tex = createGlyphTexture(classKey, '#880000', 64);
    const t = createBox(0.9, 0.9, 0.9, 0x999999, tex);
    t.tile = { x: gx, z: gz };
    t.classKey = classKey;
    t.hp = cls.durability;
    t.maxHp = cls.durability;
    t.speed = cls.speed;
    t.range = cls.range;
    t.strength = cls.strength;
    t.cost = cls.cost;
    t.isPlayer = false;
    entitiesGroup.add(t.mesh);
    setEntityPos(t.mesh, gx, gz);
    const id = 'E' + (state.enemyTanks.length + 1);
    state.enemyTanks.push({ id, mesh: t.mesh, meta: t });
    return id;
  }

  // Obstacles
  function placeObstacle(type, gx, gz) {
    // types: wall, rock, tree
    let hp = 50; let color = 0x8b4513; let destructible = true; let slows = false;
    if (type === 'wall') { hp = 40; color = 0x8b4513; }
    if (type === 'rock') { hp = 120; color = 0x666666; }
    if (type === 'tree') { hp = 20; color = 0x228B22; slows = true; }
    const b = createBox(0.98, 0.98, 0.98, color);
    setEntityPos(b.mesh, gx, gz);
    entitiesGroup.add(b.mesh);
    state.map[key(gx, gz)] = { type, hp, slows, mesh: b.mesh };
  }

  // Initialize sample map
  function initMap() {
    // place some obstacles around center
    placeObstacle('wall', 0, -2);
    placeObstacle('wall', 1, -2);
    placeObstacle('rock', 3, -1);
    placeObstacle('tree', -2, 2);
    placeObstacle('tree', -3, 3);
    // enemy spawn
    spawnEnemyTank('S', 5, 5);
    spawnEnemyTank('A', 4, 4);
    // player spawn
    spawnPlayerTank('S', -4, -4);
    spawnPlayerTank('A', -3, -4);
  }

  initMap();

  // UI references
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

  function renderUI() {
    coinsVal.textContent = state.coins;
    turnVal.textContent = state.turn === 'player' ? 'Player' : 'Enemy';
    // tank list
    tankList.innerHTML = '';
    state.playerTanks.forEach(t => {
      const btn = document.createElement('button');
      btn.textContent = t.id + ' (' + t.meta.classKey + ') HP:' + Math.round(t.meta.hp) + '/' + t.meta.maxHp;
      btn.onclick = () => selectTank(t.id);
      if (state.selectedTankId === t.id) btn.style.background = '#444';
      tankList.appendChild(btn);
    });
    // shop
    shopEl.innerHTML = '';
    Object.keys(TANK_CLASSES).forEach(k => {
      const c = TANK_CLASSES[k];
      const b = document.createElement('button');
      b.textContent = `${c.name} (${k}) - ${c.cost}`;
      b.onclick = () => purchaseTank(k);
      shopEl.appendChild(b);
    });
  }

  function renderLogs() {
    logEl.innerHTML = '';
    state.logs.slice(0, LOG_MAX).forEach(l => {
      const d = document.createElement('div'); d.textContent = l; logEl.appendChild(d);
    });
  }

  renderUI(); renderLogs();

  // Selection & overlays
  let movementOverlay = [];
  function clearOverlay() { overlayGroup.clear(); movementOverlay = []; }

  function showMovementRange(meta) {
    clearOverlay();
    const range = meta.speed;
    const cx = meta.tile.x, cz = meta.tile.z;
    for (let dx = -range; dx <= range; dx++) {
      for (let dz = -range; dz <= range; dz++) {
        const tx = cx + dx, tz = cz + dz;
        if (Math.abs(dx) + Math.abs(dz) <= range) {
          const geo = new THREE.PlaneGeometry(1,1);
          const mat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent:true, opacity:0.3, side:THREE.DoubleSide });
          const p = new THREE.Mesh(geo, mat);
          p.rotation.x = -Math.PI/2; p.position.set(tx, 0.01, tz);
          overlayGroup.add(p); movementOverlay.push(p);
        }
      }
    }
  }

  function selectTank(id) {
    state.selectedTankId = id;
    // highlight selected tank
    entitiesGroup.children.forEach(m => { if (m.material) m.material.emissive && (m.material.emissive.setHex ? m.material.emissive.setHex(0x000000) : null); });
    const entry = state.playerTanks.find(t => t.id === id);
    if (!entry) return;
    // highlight by tinting material if possible
    if (entry.meta && entry.meta.mesh && entry.meta.mesh.material) {
      entry.meta.mesh.material.emissive = new THREE.Color(0x333333);
    }
    showMovementRange(entry.meta);
    renderUI();
    log(`Selected ${id} at (${entry.meta.tile.x},${entry.meta.tile.z})`);
  }

  // movement: move selected tank to clicked tile if within range
  renderer.domElement.addEventListener('click', (ev) => {
    if (state.turn !== 'player') return;
    if (!state.selectedTankId) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    const mouse = new THREE.Vector2(x, y);
    const ray = new THREE.Raycaster(); ray.setFromCamera(mouse, camera);
    // intersect plane y=0
    const plane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
    const intersect = new THREE.Vector3(); ray.ray.intersectPlane(plane, intersect);
    const gx = Math.round(intersect.x), gz = Math.round(intersect.z);
    const tank = state.playerTanks.find(t => t.id === state.selectedTankId);
    const meta = tank.meta;
    const dist = Math.abs(gx - meta.tile.x) + Math.abs(gz - meta.tile.z);
    if (dist <= meta.speed) {
      // move
      const old = { x: meta.tile.x, z: meta.tile.z };
      meta.tile.x = gx; meta.tile.z = gz;
      setEntityPos(meta.mesh, gx, gz);
      log(`${tank.id} moved from (${old.x},${old.z}) to (${gx},${gz})`);
      clearOverlay();
      renderUI();
    }
  });

  // purchase
  function purchaseTank(classKey) {
    const cls = TANK_CLASSES[classKey];
    if (state.coins < cls.cost) { alert('Not enough coins'); return; }
    // find a spawn tile near base
    const spawnX = -4 - state.playerTanks.length;
    const spawnZ = -5;
    state.coins -= cls.cost;
    spawnPlayerTank(classKey, spawnX, spawnZ);
    renderUI(); log(`Purchased ${cls.name} at (${spawnX},${spawnZ}) for ${cls.cost}`);
  }

  // ACTIONS
  let inAimMode = false;
  let aimingTank = null;

  moveBtn.addEventListener('click', () => { if (!state.selectedTankId) { alert('Select a tank first'); return; } showMovementRange(state.playerTanks.find(t=>t.id===state.selectedTankId).meta); });
  aimBtn.addEventListener('click', () => {
    if (!state.selectedTankId) { alert('Select a tank first'); return; }
    enterAimMode(state.selectedTankId);
  });

  endTurnBtn.addEventListener('click', () => { if (state.turn === 'player') { endPlayerTurn(); } });

  function enterAimMode(tankId) {
    const tankEntry = state.playerTanks.find(t => t.id === tankId);
    if (!tankEntry) return;
    inAimMode = true; aimingTank = tankEntry;
    aimPanel.classList.remove('hidden');
    // setup aim camera: position slightly behind tank
    const p = aimingTank.meta.tile;
    // store previous camera
    camera.position.set(p.x, 3, p.z + 1.8);
    camera.lookAt(p.x, 0, p.z);
    log(`${tankId} entered aiming mode`);
  }

  cancelAim.addEventListener('click', () => { exitAimMode(); });

  fireBtn.addEventListener('click', () => {
    if (!inAimMode || !aimingTank) return;
    const angleDeg = parseFloat(angleInput.value); const power = parseFloat(powerInput.value);
    performFire(aimingTank, angleDeg, power);
    exitAimMode();
    // After firing, end player turn action and let enemy move
    setTimeout(() => { endPlayerTurn(); }, 500);
  });

  function exitAimMode() {
    aimPanel.classList.add('hidden'); inAimMode = false; aimingTank = null;
    // restore camera to fixed overview
    camera.position.set(0, 14, 14); camera.lookAt(0,0,0);
  }

  // perform fire: spawn a projectile and simulate trajectory
  function performFire(tankEntry, angleDeg, power) {
    const p = tankEntry.meta.tile; const cls = TANK_CLASSES[tankEntry.meta.classKey];
    const angle = THREE.MathUtils.degToRad(angleDeg);
    // compute initial velocity in world units; scale power
    const speed = power / 10; // arbitrary scaling
    const vx = Math.sin(angle) * speed;
    const vz = 0; // we'll aim forward along -z from tank orientation for demo
    const vy = Math.cos(angle) * speed;
    // spawn projectile at tank position
    const geom = new THREE.SphereGeometry(0.12, 8, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffff00 });
    const proj = new THREE.Mesh(geom, mat);
    proj.position.set(p.x, 0.5, p.z - 0.6);
    scene.add(proj);
    // world velocity vector: shoot towards -z (forward)
    let vel = new THREE.Vector3(0, vy, -vx);
    const dt = 1/60;
    const projInterval = setInterval(() => {
      // integrate
      vel.y += GRAVITY * dt * 0.2; // scaled gravity
      proj.position.addScaledVector(vel, dt);
      // check ground collision
      if (proj.position.y <= 0.1) {
        // hit ground at tile
        const gx = Math.round(proj.position.x);
        const gz = Math.round(proj.position.z);
        resolveProjectileHit(gx, gz, cls.strength * (power/100), tankEntry.id);
        scene.remove(proj); clearInterval(projInterval);
      } else {
        // check collision with obstacles or tanks by proximity
        // obstacles
        const gx = Math.round(proj.position.x);
        const gz = Math.round(proj.position.z);
        const m = state.map[key(gx, gz)];
        if (m) {
          resolveProjectileHit(gx, gz, cls.strength * (power/100), tankEntry.id);
          scene.remove(proj); clearInterval(projInterval);
        }
        // tanks
        [...state.enemyTanks, ...state.playerTanks].forEach(t => {
          const tx = Math.round(t.meta.tile.x); const tz = Math.round(t.meta.tile.z);
          if (Math.abs(tx - proj.position.x) < 0.5 && Math.abs(tz - proj.position.z) < 0.5 && proj.position.y < 2) {
            // hit tank
            applyDamageToTank(t, cls.strength * (power/100));
            scene.remove(proj); clearInterval(projInterval);
          }
        });
      }
    }, dt * 1000);
    log(`${tankEntry.id} fired angle ${angleDeg} power ${power}`);
  }

  function resolveProjectileHit(gx, gz, damage, sourceId) {
    const m = state.map[key(gx, gz)];
    if (m) {
      m.hp -= damage;
      if (m.hp <= 0) {
        // remove
        scene.remove(m.mesh); delete state.map[key(gx, gz)];
        log(`${sourceId} destroyed ${m.type} at (${gx},${gz})`);
      } else {
        log(`${sourceId} damaged ${m.type} at (${gx},${gz}) (hp ${Math.round(m.hp)})`);
      }
    } else {
      log(`${sourceId} impacted at (${gx},${gz})`);
    }
  }

  function applyDamageToTank(t, dmg) {
    t.meta.hp -= dmg;
    log(`${t.id} took ${Math.round(dmg)} damage (hp ${Math.max(0, Math.round(t.meta.hp))})`);
    if (t.meta.hp <= 0) {
      // remove
      scene.remove(t.meta.mesh);
      if (t.isPlayer) state.playerTanks = state.playerTanks.filter(x => x.id !== t.id);
      else state.enemyTanks = state.enemyTanks.filter(x => x.id !== t.id);
      log(`${t.id} was destroyed`);
      renderUI();
    }
  }

  // End of player turn -> enemy actions
  function endPlayerTurn() {
    state.turn = 'enemy'; renderUI(); log('Player turn ended. Enemy turn starts.');
    // simple enemy AI actions: move one step toward base or nearest player tank then possibly shoot
    setTimeout(() => {
      enemyAct();
      state.turn = 'player'; renderUI(); log('Enemy turn ended. Player turn starts.');
    }, 800);
  }

  function enemyAct() {
    state.enemyTanks.forEach(e => {
      const meta = e.meta;
      // find nearest player tank
      if (state.playerTanks.length === 0) return;
      let nearest = null; let nd = 1e9;
      state.playerTanks.forEach(p => { const d = Math.abs(p.meta.tile.x - meta.tile.x) + Math.abs(p.meta.tile.z - meta.tile.z); if (d < nd) { nd = d; nearest = p; } });
      if (!nearest) return;
      // move towards nearest by up to speed
      const sx = Math.sign(nearest.meta.tile.x - meta.tile.x);
      const sz = Math.sign(nearest.meta.tile.z - meta.tile.z);
      const mx = meta.tile.x + (sx !== 0 ? sx : 0);
      const mz = meta.tile.z + (sz !== 0 ? sz : 0);
      meta.tile.x = mx; meta.tile.z = mz;
      setEntityPos(meta.mesh, mx, mz);
      log(`${e.id} moved to (${mx},${mz})`);
      // if in range, shoot
      const dist = Math.abs(nearest.meta.tile.x - meta.tile.x) + Math.abs(nearest.meta.tile.z - meta.tile.z);
      if (dist <= meta.range) {
        // simple fire: immediate damage
        applyDamageToTank(nearest, meta.strength);
        log(`${e.id} shot ${nearest.id} for ${meta.strength}`);
      }
    });
  }

  // Resize
  window.addEventListener('resize', () => { renderer.setSize(window.innerWidth, window.innerHeight); camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); });

  // Render loop
  function animate() { requestAnimationFrame(animate); renderer.render(scene, camera); }
  animate();

  // Initial UI adjustments
  renderUI();

  // Expose state for debugging
  window._cbc3 = state;

})();
