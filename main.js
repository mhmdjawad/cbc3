// Minimal Chess Battle City demo (no build required)
// - grid-based movement (discrete 1-unit moves)
// - simple turn toggle: player -> enemy
// - enemy moves one step toward base
(function () {
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio ? window.devicePixelRatio : 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fbcd4);

  // Camera (angled top-down)
  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 1000);
  camera.position.set(12, 18, 12);
  camera.lookAt(0, 0, 0);

  // Light
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(5, 10, 7);
  scene.add(dir);

  // Grid helper (visual grid)
  const grid = new THREE.GridHelper(20, 20, 0x222222, 0x444444);
  scene.add(grid);

  // Ground (simple plane)
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a6b2f });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.51;
  scene.add(ground);

  // Helper to create tanks (boxes for demo)
  function createTank(color) {
    const geom = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    const mat = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    return mesh;
  }

  // Player tank
  const player = createTank(0x00aa00);
  player.position.set(-4, 0.45, -4);
  scene.add(player);

  // Enemy tank
  const enemy = createTank(0xaa0000);
  enemy.position.set(4, 0.45, 4);
  scene.add(enemy);

  // Base to defend (yellow cube)
  const baseGeom = new THREE.BoxGeometry(1.6, 1.6, 1.6);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0xffcc00 });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.position.set(0, 0.8, -8);
  scene.add(base);

  // Turn & HUD
  let turn = 'player';
  const turnEl = document.getElementById('turn');
  const fpsEl = document.getElementById('fpsVal');

  function setTurn(t) {
    turn = t;
    turnEl.textContent = 'Turn: ' + (t === 'player' ? 'Player' : 'Enemy');
  }

  setTurn('player');

  // Discrete grid movement helper (clamp inside +/-9)
  function moveEntity(entity, dx, dz) {
    entity.position.x = Math.max(-9, Math.min(9, Math.round(entity.position.x + dx)));
    entity.position.z = Math.max(-9, Math.min(9, Math.round(entity.position.z + dz)));
  }

  // Simple enemy AI: move 1 step toward base each enemy turn
  function enemyAct() {
    const tx = Math.round(base.position.x);
    const tz = Math.round(base.position.z);
    const ex = Math.round(enemy.position.x);
    const ez = Math.round(enemy.position.z);
    const dx = tx - ex;
    const dz = tz - ez;
    if (Math.abs(dx) > Math.abs(dz)) {
      moveEntity(enemy, Math.sign(dx), 0);
    } else if (dz !== 0) {
      moveEntity(enemy, 0, Math.sign(dz));
    }
    // if enemy reaches base or player, we could resolve combat here (demo: console)
    if (Math.round(enemy.position.x) === Math.round(base.position.x) &&
        Math.round(enemy.position.z) === Math.round(base.position.z)) {
      alert('Enemy reached the base — demo over.');
      setTurn('player');
    } else {
      setTurn('player');
    }
  }

  // Keyboard input for player (only during player turn)
  window.addEventListener('keydown', (e) => {
    if (turn !== 'player') return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }
    if (e.key === 'ArrowUp') moveEntity(player, 0, -1);
    if (e.key === 'ArrowDown') moveEntity(player, 0, 1);
    if (e.key === 'ArrowLeft') moveEntity(player, -1, 0);
    if (e.key === 'ArrowRight') moveEntity(player, 1, 0);
    if (e.key === ' ') {
      // end player turn — enemy moves
      setTurn('enemy');
      // tiny delay for clarity in demo
      setTimeout(enemyAct, 300);
    }
  });

  // Resize handling
  function resizeRendererToDisplaySize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const needResize = canvas.width !== Math.floor(w * window.devicePixelRatio) ||
                       canvas.height !== Math.floor(h * window.devicePixelRatio);
    if (needResize) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    return needResize;
  }

  // Animation loop + FPS counter
  let lastTime = performance.now();
  let frames = 0;
  let lastFpsTime = performance.now();

  function render(time) {
    time *= 0.001;
    resizeRendererToDisplaySize();
    renderer.render(scene, camera);

    // simple camera orbit slowly for demo
    camera.position.x = 12 * Math.cos(time * 0.2);
    camera.position.z = 12 * Math.sin(time * 0.2);
    camera.lookAt(0, 0, 0);

    frames++;
    const now = performance.now();
    if (now - lastFpsTime > 500) {
      const fps = Math.round((frames * 1000) / (now - lastFpsTime));
      fpsEl.textContent = fps;
      frames = 0;
      lastFpsTime = now;
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  // Expose some state for debugging
  window._cbc3demo = { player, enemy, base, setTurn };
})();
