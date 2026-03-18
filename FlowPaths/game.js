"use strict";

// ==================== CONSTANTS ====================
const BOARD_SIZE = 9;
const CELL_SIZE = 1;
const PAWN_RADIUS = 0.3;
const PAWN_HEIGHT = 0.5;
const ARROW_HEIGHT = 0.06;
const MAX_ARROWS_PER_PLAYER = 10;

// Direction vectors
const DIR_VECTORS = {
    up:    { dx: 0, dy: -1 },
    down:  { dx: 0, dy:  1 },
    left:  { dx: -1, dy: 0 },
    right: { dx:  1, dy: 0 }
};

const DIR_OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

// ==================== GAME STATE ====================
let currentPlayer = 1;
let pawns = {
    1: { x: 4, y: 8 },  // Player 1 starts at bottom (y=8), goal is top (y=0)
    2: { x: 4, y: 0 }   // Player 2 starts at top (y=0), goal is bottom (y=8)
};
let arrows = {};          // key "x,y" → { dir: 'up'|'down'|'left'|'right', player: 1|2 }
let arrowCounts = { 1: MAX_ARROWS_PER_PLAYER, 2: MAX_ARROWS_PER_PLAYER };
let gameOver = false;
let undoHistory = [];

// UI mode is implicit: move highlights always show; arrow placement via drag & drop

// AI state
let aiEnabled = true;
let aiThinking = false;
const AI_THINK_DELAY = 400; // ms delay before AI "thinks" (visual feedback)
const ASSIST_STORAGE_KEY = 'flowpaths_assistEnabled';
let aiTurnToken = 0;
let assistCalcToken = 0;


// Assist state
let assistEnabled = false;

// Drag & Drop state
let isDragging = false;
let dragDir = null;               // 'up'|'down'|'left'|'right'
let dragSourceElement = null;     // the DOM tile being dragged from
let dragPreviewEl = null;         // the floating preview DOM element
let dragBoardPreview = null;      // THREE.Group shown on the board (green/red)
let dragHoveredCell = null;       // { x, y } or null
let dragCanPlace = false;         // whether current hover position is valid

// View
let viewMode = '3d';
let isAnimatingView = false;
let animationStartTime = 0;
const VIEW_ANIMATION_DURATION = 600;

// Three.js objects
let scene, camera, renderer, controls;
let boardGroup, pawnsGroup, arrowsGroup, highlightsGroup;
let assistPreviewGroup;
let calcIndicatorGroup;
let pawn1Mesh, pawn2Mesh;
const playerCalcRing = { 1: null, 2: null };
const playerCalcCount = { 1: 0, 2: 0 };
let raycaster, mouse;
let cellMeshes = [];   // flat array of cell planes for raycasting

// Flow animation
let flowAnimating = false;
let flowPath = [];
let flowPawnPlayer = 0;
let flowStepIndex = 0;
let flowStepStart = 0;
const FLOW_STEP_DURATION = 120; // ms per step

// ==================== INIT ====================
init();
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 8, 8);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = true;
    controls.minDistance = 8;
    controls.maxDistance = 28;
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.enablePan = false;
    controls.target.set(0, 0, 0);

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    boardGroup = new THREE.Group();
    pawnsGroup = new THREE.Group();
    arrowsGroup = new THREE.Group();
    highlightsGroup = new THREE.Group();
    assistPreviewGroup = new THREE.Group();
    calcIndicatorGroup = new THREE.Group();
    scene.add(boardGroup);
    scene.add(pawnsGroup);
    scene.add(arrowsGroup);
    scene.add(highlightsGroup);
    scene.add(assistPreviewGroup);
    scene.add(calcIndicatorGroup);

    // Drag board preview group (green/red tile on board while dragging)
    dragBoardPreview = new THREE.Group();
    scene.add(dragBoardPreview);

    setupLighting();
    createBoard();
    createPawns();
    updateHighlights();
    updateHUD();

    // Event listeners
    window.addEventListener('resize', onWindowResize);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // Drag & Drop from arrow tiles
    setupDragAndDrop();

    // UI buttons
    setupUI();

    initAIWorker();

    // Load AI preference
    const savedAI = localStorage.getItem('flowpaths_aiEnabled');
    if (savedAI !== null) {
        aiEnabled = savedAI === 'true';
    }

    const savedAssist = localStorage.getItem(ASSIST_STORAGE_KEY);
    if (savedAssist !== null) {
        assistEnabled = savedAssist === 'true';
    }

    // Apply AI state to UI
    const aiBtn = document.getElementById('btn-ai');
    const p2Name = document.getElementById('p2-name');
    const assistBtn = document.getElementById('btn-assist');
    if (aiEnabled) {
        aiBtn.textContent = '🤖 AI On';
        aiBtn.classList.add('active');
        p2Name.textContent = 'AI';
    } else {
        aiBtn.textContent = '🤖 AI';
        aiBtn.classList.remove('active');
        p2Name.textContent = 'Player 2';
    }

    if (assistEnabled) {
        assistBtn.textContent = '💡 Assist On';
        assistBtn.classList.add('active');
    } else {
        assistBtn.textContent = '💡 Assist';
        assistBtn.classList.remove('active');
    }

    updateHUD();

    // Initial view
    set3DView();
}

// ==================== LIGHTING ====================
function setupLighting() {
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(8, 18, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 2048;
    dir.shadow.mapSize.height = 2048;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 50;
    dir.shadow.camera.left = -12;
    dir.shadow.camera.right = 12;
    dir.shadow.camera.top = 12;
    dir.shadow.camera.bottom = -12;
    scene.add(dir);

    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-8, 10, -8);
    scene.add(fill);
}

// ==================== BOARD ====================
function boardOffset() {
    return -(BOARD_SIZE * CELL_SIZE) / 2 + CELL_SIZE / 2;
}

function cellToWorld(x, y) {
    const off = boardOffset();
    return new THREE.Vector3(off + x * CELL_SIZE, 0, off + y * CELL_SIZE);
}

function getGameStateSnapshot() {
    return {
        pawns: { 1: { ...pawns[1] }, 2: { ...pawns[2] } },
        arrows: Object.fromEntries(Object.entries(arrows).map(([k, v]) => [k, { ...v }])),
        arrowCounts: { ...arrowCounts },
        currentPlayer,
        gameOver
    };
}


function ensureCalcRing(player) {
    if (playerCalcRing[player]) return playerCalcRing[player];
    const color = 0x00ff00;
    const geo = new THREE.RingGeometry(PAWN_RADIUS - 0.02, PAWN_RADIUS + 0.03, 40);
    const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    calcIndicatorGroup.add(mesh);
    playerCalcRing[player] = mesh;
    return mesh;
}

function setPlayerCalculating(player, isCalculating) {
    if (!player || (player !== 1 && player !== 2)) return;

    if (isCalculating) {
        playerCalcCount[player]++;
    } else {
        playerCalcCount[player] = Math.max(0, playerCalcCount[player] - 1);
    }

    const active = playerCalcCount[player] > 0;
    const hud = document.getElementById(player === 1 ? 'hud-player1' : 'hud-player2');
    hud.classList.toggle('calculating', active);

    const ring = ensureCalcRing(player);
    ring.visible = active;
}

function clearAllCalculatingIndicators() {
    playerCalcCount[1] = 0;
    playerCalcCount[2] = 0;
    document.getElementById('hud-player1').classList.remove('calculating');
    document.getElementById('hud-player2').classList.remove('calculating');
    document.getElementById('hud-player2').classList.remove('ai-thinking');
    if (playerCalcRing[1]) playerCalcRing[1].visible = false;
    if (playerCalcRing[2]) playerCalcRing[2].visible = false;
}

function createBoard() {
    const off = boardOffset();

    // Base platform
    const baseGeo = new THREE.BoxGeometry(BOARD_SIZE * CELL_SIZE + 0.6, 0.2, BOARD_SIZE * CELL_SIZE + 0.6);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2d2d44 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = -0.15;
    base.receiveShadow = true;
    boardGroup.add(base);

    cellMeshes = [];

    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            const isGoalP1 = (y === 0);    // Player 1 goal row (top)
            const isGoalP2 = (y === 8);    // Player 2 goal row (bottom)

            let color;
            if (isGoalP1) {
                color = (x + y) % 2 === 0 ? 0x5e3a3a : 0x4e2d2d; // reddish for P1 goal
            } else if (isGoalP2) {
                color = (x + y) % 2 === 0 ? 0x2d4e4a : 0x233f3b; // greenish for P2 goal
            } else {
                color = (x + y) % 2 === 0 ? 0x3a3a5c : 0x2e2e4a;
            }

            const geo = new THREE.BoxGeometry(CELL_SIZE * 0.95, 0.08, CELL_SIZE * 0.95);
            const mat = new THREE.MeshStandardMaterial({ color });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(off + x * CELL_SIZE, 0, off + y * CELL_SIZE);
            mesh.receiveShadow = true;
            mesh.userData = { cellX: x, cellY: y };
            boardGroup.add(mesh);
            cellMeshes.push(mesh);
        }
    }

    // Goal row edge indicators
    const edgeWidth = BOARD_SIZE * CELL_SIZE;
    const edgeThickness = 0.08;
    const edgeHeight = 0.12;

    // Player 1 goal (top, y=0) — red glow line
    const p1EdgeGeo = new THREE.BoxGeometry(edgeWidth, edgeHeight, edgeThickness);
    const p1EdgeMat = new THREE.MeshStandardMaterial({
        color: 0xff4444, emissive: 0xff2222, emissiveIntensity: 0.6,
        transparent: true, opacity: 0.8
    });
    const p1Edge = new THREE.Mesh(p1EdgeGeo, p1EdgeMat);
    p1Edge.position.set(0, edgeHeight / 2, off + 0 * CELL_SIZE - CELL_SIZE * 0.5 - edgeThickness / 2);
    boardGroup.add(p1Edge);

    // Player 2 goal (bottom, y=8) — teal glow line
    const p2EdgeGeo = new THREE.BoxGeometry(edgeWidth, edgeHeight, edgeThickness);
    const p2EdgeMat = new THREE.MeshStandardMaterial({
        color: 0x44ccbb, emissive: 0x22aa99, emissiveIntensity: 0.6,
        transparent: true, opacity: 0.8
    });
    const p2Edge = new THREE.Mesh(p2EdgeGeo, p2EdgeMat);
    p2Edge.position.set(0, edgeHeight / 2, off + 8 * CELL_SIZE + CELL_SIZE * 0.5 + edgeThickness / 2);
    boardGroup.add(p2Edge);
}

// ==================== PAWNS ====================
function createPawns() {
    const geo = new THREE.CylinderGeometry(PAWN_RADIUS * 0.7, PAWN_RADIUS, PAWN_HEIGHT, 24);

    // Player 1 – red
    const mat1 = new THREE.MeshStandardMaterial({ color: 0xff4444, emissive: 0x441111, metalness: 0.3, roughness: 0.6 });
    pawn1Mesh = new THREE.Mesh(geo, mat1);
    pawn1Mesh.castShadow = true;
    pawnsGroup.add(pawn1Mesh);

    // Player 2 – teal
    const mat2 = new THREE.MeshStandardMaterial({ color: 0x44ccbb, emissive: 0x114433, metalness: 0.3, roughness: 0.6 });
    pawn2Mesh = new THREE.Mesh(geo, mat2);
    pawn2Mesh.castShadow = true;
    pawnsGroup.add(pawn2Mesh);

    updatePawnPositions();
}

function updatePawnPositions() {
    const p1 = cellToWorld(pawns[1].x, pawns[1].y);
    pawn1Mesh.position.set(p1.x, PAWN_HEIGHT / 2 + 0.04, p1.z);

    const p2 = cellToWorld(pawns[2].x, pawns[2].y);
    pawn2Mesh.position.set(p2.x, PAWN_HEIGHT / 2 + 0.04, p2.z);
}

// ==================== ARROW TILE RENDERING ====================
function rebuildArrowMeshes() {
    // Clear existing
    while (arrowsGroup.children.length) {
        const c = arrowsGroup.children[0];
        arrowsGroup.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
    }

    for (const key of Object.keys(arrows)) {
        const [x, y] = key.split(',').map(Number);
        const arrow = arrows[key];
        const wpos = cellToWorld(x, y);

        // Base tile — neutral stone/brown
        const tileGeo = new THREE.BoxGeometry(CELL_SIZE * 0.85, ARROW_HEIGHT, CELL_SIZE * 0.85);
        const tileMat = new THREE.MeshStandardMaterial({
            color: 0xc9a66b, transparent: true, opacity: 0.75, metalness: 0.1, roughness: 0.9
        });
        const tileMesh = new THREE.Mesh(tileGeo, tileMat);
        tileMesh.position.set(wpos.x, ARROW_HEIGHT / 2 + 0.04, wpos.z);
        tileMesh.receiveShadow = true;
        arrowsGroup.add(tileMesh);

        // Arrow indicator (triangle head + stem)
        const triShape = new THREE.Shape();
        triShape.moveTo(0, 0.32);
        triShape.lineTo(-0.22, -0.05);
        triShape.lineTo(-0.08, -0.05);
        triShape.lineTo(-0.08, -0.28);
        triShape.lineTo(0.08, -0.28);
        triShape.lineTo(0.08, -0.05);
        triShape.lineTo(0.22, -0.05);
        triShape.closePath();

        const triGeo = new THREE.ShapeGeometry(triShape);
        const triMat = new THREE.MeshStandardMaterial({
            color: 0xf0e6d3, emissive: 0xd4c4a8, emissiveIntensity: 0.35,
            side: THREE.DoubleSide
        });
        const triMesh = new THREE.Mesh(triGeo, triMat);

        // Rotate to point in the correct direction
        triMesh.rotation.x = -Math.PI / 2; // lay flat
        switch (arrow.dir) {
            case 'up':    triMesh.rotation.z = 0; break;
            case 'down':  triMesh.rotation.z = Math.PI; break;
            case 'left':  triMesh.rotation.z = Math.PI / 2; break;
            case 'right': triMesh.rotation.z = -Math.PI / 2; break;
        }

        triMesh.position.set(wpos.x, ARROW_HEIGHT + 0.05, wpos.z);
        arrowsGroup.add(triMesh);
    }
}

// ==================== HIGHLIGHTS ====================
function clearHighlights() {
    while (highlightsGroup.children.length) {
        const c = highlightsGroup.children[0];
        highlightsGroup.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
    }
}

function updateHighlights() {
    clearHighlights();
    // Hide move markers during AI-controlled player 2 turns.
    if (gameOver || flowAnimating || isDragging || (aiEnabled && currentPlayer === 2)) return;

    const moves = getValidMoves(currentPlayer);
    const color = currentPlayer === 1 ? 0xff6666 : 0x66ddcc;
    const markSize = CELL_SIZE * 0.82;

    for (const m of moves) {
        const wpos = cellToWorld(m.x, m.y);

        // Filled square marker
        const geo = new THREE.PlaneGeometry(markSize, markSize);
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(wpos.x, 0.14, wpos.z);
        mesh.userData = { moveX: m.x, moveY: m.y };
        highlightsGroup.add(mesh);
    }
}

// ==================== VALID MOVES ====================
function getValidMoves(player) {
    const px = pawns[player].x;
    const py = pawns[player].y;
    const other = player === 1 ? 2 : 1;
    const moves = [];

    for (const dir of ['up', 'down', 'left', 'right']) {
        const d = DIR_VECTORS[dir];
        const nx = px + d.dx;
        const ny = py + d.dy;
        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;

        // Can't move directly onto the other pawn (unless jump)
        if (nx === pawns[other].x && ny === pawns[other].y) {
            // Jump: continue past other pawn if possible
            const jx = nx + d.dx;
            const jy = ny + d.dy;
            if (jx >= 0 && jx < BOARD_SIZE && jy >= 0 && jy < BOARD_SIZE) {
                moves.push({ x: jx, y: jy });
            }
            // Diagonal jumps if straight jump is blocked
            // (simplified: side-steps)
            continue;
        }

        moves.push({ x: nx, y: ny });
    }
    return moves;
}

// ==================== ARROW PLACEMENT VALIDATION ====================
function arrowKey(x, y) { return x + ',' + y; }

function canPlaceArrow(x, y, dir, player) {
    if (arrowCounts[player] <= 0) return false;
    const key = arrowKey(x, y);

    // Must be empty (no arrow, no pawn)
    if (arrows[key]) return false;
    if (pawns[1].x === x && pawns[1].y === y) return false;
    if (pawns[2].x === x && pawns[2].y === y) return false;

    const d = DIR_VECTORS[dir];

    // Arrow must point to a valid square
    const tx = x + d.dx;
    const ty = y + d.dy;
    if (tx < 0 || tx >= BOARD_SIZE || ty < 0 || ty >= BOARD_SIZE) return false;

    // No 2-cycle: target must not point back at this cell
    const targetKey = arrowKey(tx, ty);
    if (arrows[targetKey] && arrows[targetKey].dir === DIR_OPPOSITE[dir]) return false;


    // No loops
    if (createsLoop(x, y, dir)) return false;

    // Reachability check: both players must still be able to reach their goal
    // Temporarily place arrow and check
    arrows[key] = { dir, player };
    const reachable = canBothPlayersReachGoal();
    delete arrows[key];
    if (!reachable) return false;

    return true;
}


function createsLoop(x, y, dir) {
    // Simulate placing the arrow and follow the chain from (x,y)
    // If we visit (x,y) again → loop
    const tempKey = arrowKey(x, y);
    const visited = new Set();
    visited.add(tempKey);

    let cx = x + DIR_VECTORS[dir].dx;
    let cy = y + DIR_VECTORS[dir].dy;

    while (cx >= 0 && cx < BOARD_SIZE && cy >= 0 && cy < BOARD_SIZE) {
        const ck = arrowKey(cx, cy);
        if (visited.has(ck)) return true;
        visited.add(ck);

        const a = arrows[ck];
        if (!a) break;
        cx += DIR_VECTORS[a.dir].dx;
        cy += DIR_VECTORS[a.dir].dy;
    }

    // Also check: any arrow that points TO (x,y) — follow chain backward from those
    // This catches loops formed by arrows entering the new tile
    for (const otherDir of ['up', 'down', 'left', 'right']) {
        const od = DIR_VECTORS[otherDir];
        const srcX = x - od.dx;
        const srcY = y - od.dy;
        if (srcX < 0 || srcX >= BOARD_SIZE || srcY < 0 || srcY >= BOARD_SIZE) continue;
        const srcKey = arrowKey(srcX, srcY);
        const srcArrow = arrows[srcKey];
        if (srcArrow && srcArrow.dir === otherDir) {
            // There's an arrow pointing at (x,y). Follow chain from (x,y) with new arrow.
            const visited2 = new Set();
            visited2.add(tempKey);
            let fx = x + DIR_VECTORS[dir].dx;
            let fy = y + DIR_VECTORS[dir].dy;
            while (fx >= 0 && fx < BOARD_SIZE && fy >= 0 && fy < BOARD_SIZE) {
                const fk = arrowKey(fx, fy);
                if (fk === srcKey) return true; // Would loop back
                if (visited2.has(fk)) return true;
                visited2.add(fk);
                const fa = arrows[fk];
                if (!fa) break;
                fx += DIR_VECTORS[fa.dir].dx;
                fy += DIR_VECTORS[fa.dir].dy;
            }
        }
    }

    return false;
}

// BFS reachability: can player reach goal row considering arrows redirect movement?
function canBothPlayersReachGoal() {
    return canPlayerReachGoal(1) && canPlayerReachGoal(2);
}

function canPlayerReachGoal(player) {
    const goalRow = player === 1 ? 0 : 8;
    const start = pawns[player];

    // BFS: from current position, explore all reachable cells
    // Movement: one step in any orthogonal direction, then follow flow
    const visited = new Set();
    const queue = [arrowKey(start.x, start.y)];
    visited.add(queue[0]);

    while (queue.length > 0) {
        const cur = queue.shift();
        const [cx, cy] = cur.split(',').map(Number);

        if (cy === goalRow) return true;

        // Try all 4 directions for one-step move
        for (const dir of ['up', 'down', 'left', 'right']) {
            const d = DIR_VECTORS[dir];
            let nx = cx + d.dx;
            let ny = cy + d.dy;
            if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;

            // Follow flow from (nx, ny)
            const dest = resolveFlow(nx, ny, player);
            const dk = arrowKey(dest.x, dest.y);
            // Check if any cell in the flow path crosses the goal row
            if (flowPassesGoalRow(nx, ny, goalRow, player)) return true;

            if (!visited.has(dk)) {
                visited.add(dk);
                queue.push(dk);
            }
        }
    }
    return false;
}

// Check if the flow path from (sx,sy) crosses the goal row
function flowPassesGoalRow(sx, sy, goalRow, player) {
    let cx = sx, cy = sy;
    const visited = new Set();
    while (true) {
        if (cy === goalRow) return true;
        const key = arrowKey(cx, cy);
        if (visited.has(key)) break;
        visited.add(key);
        const a = arrows[key];
        if (!a) break;
        const d = DIR_VECTORS[a.dir];
        const nx = cx + d.dx;
        const ny = cy + d.dy;
        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) break;
        cx = nx;
        cy = ny;
    }
    return false;
}

// Resolve flow: follow arrow chain from (x,y) and return final position
function resolveFlow(x, y, movingPlayer) {
    let cx = x, cy = y;
    const other = movingPlayer === 1 ? 2 : 1;
    const visited = new Set();

    while (true) {
        // Win check: if we're on the goal row, stop here
        const goalRow = movingPlayer === 1 ? 0 : 8;
        if (cy === goalRow) return { x: cx, y: cy };

        const key = arrowKey(cx, cy);
        if (visited.has(key)) break; // Safety: prevent infinite loop
        visited.add(key);

        const a = arrows[key];
        if (!a) break; // No arrow → stop

        const d = DIR_VECTORS[a.dir];
        const nx = cx + d.dx;
        const ny = cy + d.dy;

        // Board edge
        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) break;

        // Other pawn blocks
        if (nx === pawns[other].x && ny === pawns[other].y) break;

        cx = nx;
        cy = ny;
    }
    return { x: cx, y: cy };
}

// Build flow path (list of cells) for animation
function buildFlowPath(x, y, movingPlayer) {
    const path = [{ x, y }];
    let cx = x, cy = y;
    const other = movingPlayer === 1 ? 2 : 1;
    const visited = new Set();

    while (true) {
        const goalRow = movingPlayer === 1 ? 0 : 8;
        if (cy === goalRow) break;

        const key = arrowKey(cx, cy);
        if (visited.has(key)) break;
        visited.add(key);

        const a = arrows[key];
        if (!a) break;

        const d = DIR_VECTORS[a.dir];
        const nx = cx + d.dx;
        const ny = cy + d.dy;

        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) break;
        if (nx === pawns[other].x && ny === pawns[other].y) break;

        cx = nx;
        cy = ny;
        path.push({ x: cx, y: cy });
    }
    return path;
}

// ==================== GAME ACTIONS ====================
function doMove(player, x, y) {
    // Save undo state
    undoHistory.push({
        currentPlayer,
        pawns: JSON.parse(JSON.stringify(pawns)),
        arrows: JSON.parse(JSON.stringify(arrows)),
        arrowCounts: { ...arrowCounts },
        gameOver
    });

    // Move pawn to (x,y) first
    pawns[player].x = x;
    pawns[player].y = y;

    // Check if there's an arrow chain to follow
    const path = buildFlowPath(x, y, player);

    if (path.length > 1) {
        // Animate the flow
        startFlowAnimation(player, path);
    } else {
        // No flow — finalize move immediately
        finalizeMoveAt(player, x, y);
    }
}

function finalizeMoveAt(player, x, y) {
    pawns[player].x = x;
    pawns[player].y = y;
    updatePawnPositions();

    // Win check
    const goalRow = player === 1 ? 0 : 8;
    if (y === goalRow) {
        gameOver = true;
        showWinner(player);
        clearHighlights();
        updateHUD();
        return;
    }

    // Switch turns
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    updateHighlights();
    updateHUD();

    // Trigger AI if it's AI's turn
    if (aiEnabled && currentPlayer === 2 && !gameOver) {
        scheduleAIMove();
    }
}

function doPlaceArrow(player, x, y, dir) {
    undoHistory.push({
        currentPlayer,
        pawns: JSON.parse(JSON.stringify(pawns)),
        arrows: JSON.parse(JSON.stringify(arrows)),
        arrowCounts: { ...arrowCounts },
        gameOver
    });

    arrows[arrowKey(x, y)] = { dir, player };
    arrowCounts[player]--;

    rebuildArrowMeshes();

    // Switch turns
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    updateHighlights();
    updateHUD();

    // Trigger AI if it's AI's turn
    if (aiEnabled && currentPlayer === 2 && !gameOver) {
        scheduleAIMove();
    }
}

// ==================== FLOW ANIMATION ====================
function startFlowAnimation(player, path) {
    flowAnimating = true;
    flowPath = path;
    flowPawnPlayer = player;
    flowStepIndex = 0;
    flowStepStart = performance.now();
    clearHighlights();
}

function updateFlowAnimation(now) {
    if (!flowAnimating) return;

    const elapsed = now - flowStepStart;
    const t = Math.min(elapsed / FLOW_STEP_DURATION, 1);

    const from = flowPath[flowStepIndex];
    const to = flowPath[Math.min(flowStepIndex + 1, flowPath.length - 1)];

    const fromW = cellToWorld(from.x, from.y);
    const toW = cellToWorld(to.x, to.y);

    // Ease
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    const mesh = flowPawnPlayer === 1 ? pawn1Mesh : pawn2Mesh;
    mesh.position.x = fromW.x + (toW.x - fromW.x) * ease;
    mesh.position.z = fromW.z + (toW.z - fromW.z) * ease;
    // Slight bounce
    mesh.position.y = PAWN_HEIGHT / 2 + 0.04 + Math.sin(ease * Math.PI) * 0.12;

    if (t >= 1) {
        flowStepIndex++;
        flowStepStart = now;

        // Check for win mid-flow
        const goalRow = flowPawnPlayer === 1 ? 0 : 8;
        if (to.y === goalRow) {
            flowAnimating = false;
            finalizeMoveAt(flowPawnPlayer, to.x, to.y);
            return;
        }

        if (flowStepIndex >= flowPath.length - 1) {
            // Flow complete
            flowAnimating = false;
            const final = flowPath[flowPath.length - 1];
            finalizeMoveAt(flowPawnPlayer, final.x, final.y);
        }
    }
}

// ==================== POINTER INPUT ====================
let pointerDownPos = null;
const CLICK_THRESHOLD = 8; // pixels

function onPointerDown(event) {
    pointerDownPos = { x: event.clientX, y: event.clientY };
}

function onPointerMove(event) {
    if (!pointerDownPos) return;
    const dx = event.clientX - pointerDownPos.x;
    const dy = event.clientY - pointerDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > CLICK_THRESHOLD) {
        pointerDownPos = null; // dragged — cancel click
    }
}

function onPointerUp(event) {
    if (!pointerDownPos) return;
    pointerDownPos = null;

    if (gameOver || flowAnimating || isDragging || aiThinking) return;
    // Block interaction when it's AI's turn
    if (aiEnabled && currentPlayer === 2) return;
    if (event.target !== renderer.domElement) return;

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Check highlight discs/rings for move
    const hIntersects = raycaster.intersectObjects(highlightsGroup.children);
    if (hIntersects.length > 0) {
        const obj = hIntersects[0].object;
        if (obj.userData.moveX !== undefined) {
            doMove(currentPlayer, obj.userData.moveX, obj.userData.moveY);
            return;
        }
    }
}

// ==================== UI ====================
function setupUI() {

    // AI toggle
    document.getElementById('btn-ai').addEventListener('click', toggleAI);

    // Assist toggle
    document.getElementById('btn-assist').addEventListener('click', toggleAssist);

    // View toggle
    document.getElementById('btn-view').addEventListener('click', toggleView);

    // Undo
    document.getElementById('btn-undo').addEventListener('click', undoLastMove);

    // Restart
    const restartBtn = document.getElementById('btn-restart');
    const restartModal = document.getElementById('restart-modal');
    restartBtn.addEventListener('click', () => {
        restartModal.classList.remove('hidden');
        restartBtn.classList.add('active');
    });
    document.getElementById('restart-p1').addEventListener('click', () => {
        restartModal.classList.add('hidden');
        restartBtn.classList.remove('active');
        restartGame(1);
    });
    document.getElementById('restart-p2').addEventListener('click', () => {
        restartModal.classList.add('hidden');
        restartBtn.classList.remove('active');
        restartGame(2);
    });
    document.getElementById('restart-close').addEventListener('click', () => {
        restartModal.classList.add('hidden');
        restartBtn.classList.remove('active');
    });
    restartModal.addEventListener('click', (e) => {
        if (e.target.id === 'restart-modal') {
            restartModal.classList.add('hidden');
            restartBtn.classList.remove('active');
        }
    });

    // Winner modal
    document.getElementById('winner-p1').addEventListener('click', () => {
        document.getElementById('winner-modal').classList.add('hidden');
        restartGame(1);
    });
    document.getElementById('winner-p2').addEventListener('click', () => {
        document.getElementById('winner-modal').classList.add('hidden');
        restartGame(2);
    });
    document.getElementById('winner-close').addEventListener('click', () => {
        document.getElementById('winner-modal').classList.add('hidden');
    });
}


function updateHUD() {
    document.getElementById('hud-player1').classList.toggle('active', currentPlayer === 1);
    document.getElementById('hud-player2').classList.toggle('active', currentPlayer === 2);

    document.getElementById('p1-arrows').textContent = '🏹 ' + arrowCounts[1] + ' / ' + MAX_ARROWS_PER_PLAYER;
    document.getElementById('p2-arrows').textContent = '🏹 ' + arrowCounts[2] + ' / ' + MAX_ARROWS_PER_PLAYER;


    // Enable/disable arrow tiles: disabled when no arrows, game over, or it's AI's turn
    const isAITurn = aiEnabled && currentPlayer === 2;
    const noArrows = arrowCounts[currentPlayer] <= 0;
    document.querySelectorAll('.arrow-tile-draggable').forEach(el => {
        el.classList.toggle('disabled', noArrows || gameOver || isAITurn);
    });

    // Update undo button with step count
    const undoBtn = document.getElementById('btn-undo');
    const steps = undoHistory.length;
    // When AI is on and it's player 1's turn, show pair count
    const displaySteps = (aiEnabled && currentPlayer === 1 && steps >= 2)
        ? Math.floor(steps / 2)
        : steps;
    // Keep undo clickable during active turns for both players.
    undoBtn.disabled = flowAnimating || gameOver;
    undoBtn.classList.toggle('active', steps > 0);
    undoBtn.textContent = displaySteps > 0 ? '↩️ Undo ' + displaySteps : '↩️ Undo';

    updateAssistPreview();
}

function showWinner(player) {
    const text = document.getElementById('winner-text');
    const icon = player === 1 ? '🔴' : '🟢';
    text.textContent = `?? ${icon} Player ${player} Wins!`;
    document.getElementById('winner-modal').classList.remove('hidden');
}

// ==================== AI ====================

function scheduleAIMove() {
    if (aiThinking || gameOver || flowAnimating) return;
    aiThinking = true;
    const turnToken = ++aiTurnToken;

    // Disable interaction during AI turn
    clearHighlights();
    clearAssistPreview();

    // Brief delay so user sees the thinking state
    setTimeout(() => {
        if (turnToken !== aiTurnToken || !aiEnabled || gameOver || currentPlayer !== 2) {
            aiThinking = false;
            updateHighlights();
            return;
        }
        executeAIMove(turnToken);
    }, AI_THINK_DELAY);
}

async function executeAIMove(turnToken) {
    setPlayerCalculating(2, true);

    try {
        const state = getGameStateSnapshot();
        const bestMove = await requestBestMoveFromWorker(state);

        if (turnToken !== aiTurnToken || !aiEnabled || gameOver || currentPlayer !== 2) {
            return;
        }

        if (bestMove) {
            if (bestMove.type === 'move') {
                doMove(2, bestMove.x, bestMove.y);
            } else if (bestMove.type === 'arrow') {
                doPlaceArrow(2, bestMove.x, bestMove.y, bestMove.dir);
            }
        }
    } catch (e) {
        console.error('AI error:', e);
    } finally {
        setPlayerCalculating(2, false);
        if (turnToken === aiTurnToken) {
            aiThinking = false;
            updateHUD();
            updateHighlights();
        }
    }
}

function toggleAI() {
    aiEnabled = !aiEnabled;

    const btn = document.getElementById('btn-ai');
    const p2Name = document.getElementById('p2-name');

    if (aiEnabled) {
        btn.textContent = '🤖 AI On';
        btn.classList.add('active');
        p2Name.textContent = 'AI';

        // If it's currently Player 2's turn, trigger AI
        if (currentPlayer === 2 && !gameOver && !flowAnimating && !aiThinking) {
            scheduleAIMove();
        }
    } else {
        btn.textContent = '🤖 AI';
        btn.classList.remove('active');
        p2Name.textContent = 'Player 2';

        // Cancel any pending AI
        aiTurnToken++;
        aiThinking = false;
        setPlayerCalculating(2, false);

        // Restore highlights if it's P2's turn
        if (currentPlayer === 2) {
            updateHighlights();
        }
    }

    localStorage.setItem('flowpaths_aiEnabled', aiEnabled);
    updateHUD();
}

function toggleAssist() {
    assistEnabled = !assistEnabled;

    const btn = document.getElementById('btn-assist');
    if (assistEnabled) {
        btn.textContent = '💡 Assist On';
        btn.classList.add('active');
    } else {
        btn.textContent = '💡 Assist';
        btn.classList.remove('active');
    }

    localStorage.setItem(ASSIST_STORAGE_KEY, assistEnabled);
    updateAssistPreview();
}

// ==================== ASSIST PREVIEW ====================
function clearAssistPreview() {
    while (assistPreviewGroup.children.length) {
        const c = assistPreviewGroup.children[0];
        assistPreviewGroup.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
        else if (c.material) c.material.dispose();
    }
}

function mirrorDirVertical(dir) {
    if (dir === 'up') return 'down';
    if (dir === 'down') return 'up';
    return dir;
}

function mirrorY(y) {
    return BOARD_SIZE - 1 - y;
}

function transformStateForPlayer1Assist(state) {
    const transformedArrows = {};
    for (const [key, arrow] of Object.entries(state.arrows)) {
        const [x, y] = key.split(',').map(Number);
        const ny = mirrorY(y);
        transformedArrows[arrowKey(x, ny)] = {
            dir: mirrorDirVertical(arrow.dir),
            player: arrow.player === 1 ? 2 : 1
        };
    }

    return {
        pawns: {
            1: { x: state.pawns[2].x, y: mirrorY(state.pawns[2].y) },
            2: { x: state.pawns[1].x, y: mirrorY(state.pawns[1].y) }
        },
        arrows: transformedArrows,
        arrowCounts: { 1: state.arrowCounts[2], 2: state.arrowCounts[1] },
        currentPlayer: 2,
        gameOver: state.gameOver
    };
}

function transformMoveFromPlayer1Assist(move) {
    if (!move) return null;
    if (move.type === 'move') {
        return { type: 'move', x: move.x, y: mirrorY(move.y) };
    }
    return {
        type: 'arrow',
        x: move.x,
        y: mirrorY(move.y),
        dir: mirrorDirVertical(move.dir)
    };
}

async function getAssistSuggestion() {
    const state = getGameStateSnapshot();

    if (currentPlayer === 2) {
        return await requestBestMoveFromWorker(state);
    }

    const transformed = transformStateForPlayer1Assist(state);
    const mirroredMove = await requestBestMoveFromWorker(transformed);
    return transformMoveFromPlayer1Assist(mirroredMove);
}

async function updateAssistPreview() {
    const requestToken = ++assistCalcToken;
    clearAssistPreview();

    if (!assistEnabled) return;
    if (gameOver || flowAnimating || isDragging || aiThinking) return;

    const player = currentPlayer;
    setPlayerCalculating(player, true);

    let suggestion = null;
    try {
        suggestion = await getAssistSuggestion();
    } catch (e) {
        console.error('Assist error:', e);
        setPlayerCalculating(player, false);
        return;
    }

    setPlayerCalculating(player, false);

    if (requestToken !== assistCalcToken) return;
    if (!assistEnabled || gameOver || flowAnimating || isDragging || aiThinking) return;

    if (!suggestion) return;

    if (suggestion.type === 'move') {
        const wpos = cellToWorld(suggestion.x, suggestion.y);

        const discGeo = new THREE.CircleGeometry(0.34, 32);
        const discMat = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide
        });
        const disc = new THREE.Mesh(discGeo, discMat);
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(wpos.x, 0.115, wpos.z);
        assistPreviewGroup.add(disc);

        const ringGeo = new THREE.RingGeometry(0.26, 0.38, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(wpos.x, 0.125, wpos.z);
        assistPreviewGroup.add(ring);
        return;
    }

    const wpos = cellToWorld(suggestion.x, suggestion.y);
    const tileGeo = new THREE.BoxGeometry(CELL_SIZE * 0.82, ARROW_HEIGHT * 1.35, CELL_SIZE * 0.82);
    const tileMat = new THREE.MeshStandardMaterial({
        color: 0x00ff00,
        emissive: 0x00cc00,
        emissiveIntensity: 0.45,
        transparent: true,
        opacity: 0.5,
        metalness: 0.1,
        roughness: 0.85
    });
    const tileMesh = new THREE.Mesh(tileGeo, tileMat);
    tileMesh.position.set(wpos.x, ARROW_HEIGHT + 0.04, wpos.z);
    assistPreviewGroup.add(tileMesh);

    const triShape = new THREE.Shape();
    triShape.moveTo(0, 0.32);
    triShape.lineTo(-0.22, -0.05);
    triShape.lineTo(-0.08, -0.05);
    triShape.lineTo(-0.08, -0.28);
    triShape.lineTo(0.08, -0.28);
    triShape.lineTo(0.08, -0.05);
    triShape.lineTo(0.22, -0.05);
    triShape.closePath();

    const triGeo = new THREE.ShapeGeometry(triShape);
    const triMat = new THREE.MeshStandardMaterial({
        color: 0x00ff00,
        emissive: 0x00ff00,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide
    });
    const triMesh = new THREE.Mesh(triGeo, triMat);
    triMesh.rotation.x = -Math.PI / 2;
    switch (suggestion.dir) {
        case 'up':
            triMesh.rotation.z = 0;
            break;
        case 'down':
            triMesh.rotation.z = Math.PI;
            break;
        case 'left':
            triMesh.rotation.z = Math.PI / 2;
            break;
        case 'right':
            triMesh.rotation.z = -Math.PI / 2;
            break;
    }
    triMesh.position.set(wpos.x, ARROW_HEIGHT * 2 + 0.06, wpos.z);
    assistPreviewGroup.add(triMesh);
}

// ==================== UNDO ====================
function undoLastMove() {
    if (undoHistory.length === 0 || flowAnimating) return;

    // Allow manual undo to interrupt AI think delay/indicator.
    if (aiThinking) {
        aiTurnToken++;
        aiThinking = false;
        clearAllCalculatingIndicators();
    }

    // If AI is enabled and the last move was AI's, undo both AI + player moves
    if (aiEnabled && undoHistory.length >= 2 && currentPlayer === 1) {
        // Undo AI's move
        undoHistory.pop();
        // Undo player's move
        const state = undoHistory.pop();
        currentPlayer = state.currentPlayer;
        pawns = state.pawns;
        arrows = state.arrows;
        arrowCounts = state.arrowCounts;
        gameOver = state.gameOver;
    } else {
        const state = undoHistory.pop();
        currentPlayer = state.currentPlayer;
        pawns = state.pawns;
        arrows = state.arrows;
        arrowCounts = state.arrowCounts;
        gameOver = state.gameOver;
    }

    updatePawnPositions();
    rebuildArrowMeshes();
    updateHighlights();
    updateHUD();
}

// ==================== RESTART ====================
function restartGame(startingPlayer) {
    aiTurnToken++;
    assistCalcToken++;
    currentPlayer = startingPlayer || 1;
    pawns = {
        1: { x: 4, y: 8 },
        2: { x: 4, y: 0 }
    };
    arrows = {};
    arrowCounts = { 1: MAX_ARROWS_PER_PLAYER, 2: MAX_ARROWS_PER_PLAYER };
    gameOver = false;
    undoHistory = [];
    flowAnimating = false;
    aiThinking = false;

    // Clear any active calculation indicator
    clearAllCalculatingIndicators();

    updatePawnPositions();
    rebuildArrowMeshes();
    updateHighlights();
    updateHUD();

    document.getElementById('winner-modal').classList.add('hidden');

    // Trigger AI if it starts
    if (aiEnabled && currentPlayer === 2) {
        scheduleAIMove();
    }
}

// ==================== VIEW ====================
function toggleView() {
    if (isAnimatingView) return;
    const btn = document.getElementById('btn-view');

    if (viewMode === '3d') {
        viewMode = 'top';
        btn.textContent = '👁️ Top View';
        btn.classList.add('active');
        animateToTopView();
    } else {
        viewMode = '3d';
        btn.textContent = '👁️ 3D View';
        btn.classList.remove('active');
        animateTo3DView();
    }
}

function getTopViewDistance() {
    const size = BOARD_SIZE * CELL_SIZE + 0.6;
    const aspect = window.innerWidth / window.innerHeight;
    const fov = camera.fov * (Math.PI / 180);
    if (aspect >= 1) return (size / 2) / Math.tan(fov / 2) * 1.02;
    return (size / 2) / (Math.tan(fov / 2) * aspect) * 1.02;
}

function get3DPos() {
    const size = BOARD_SIZE * CELL_SIZE + 0.6;
    const aspect = window.innerWidth / window.innerHeight;
    const fov = camera.fov * (Math.PI / 180);
    const hFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    const dw = (size / 2) / Math.tan(hFov / 2) * 1.15;
    const dh = (size * 0.7 + 1.5) / Math.tan(fov / 2) * 1.1;
    const dist = Math.max(dw, dh);
    const angle = Math.PI / 4;
    return { x: 0, y: dist * Math.sin(angle), z: dist * Math.cos(angle) };
}

function animateToTopView() {
    isAnimatingView = true;
    controls.enabled = false;
    const startPos = camera.position.clone();
    const startUp = camera.up.clone();
    const endPos = new THREE.Vector3(0, getTopViewDistance(), 0);
    const endUp = new THREE.Vector3(0, 0, -1);
    animationStartTime = Date.now();

    function step() {
        const p = Math.min((Date.now() - animationStartTime) / VIEW_ANIMATION_DURATION, 1);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        camera.position.lerpVectors(startPos, endPos, e);
        camera.up.lerpVectors(startUp, endUp, e).normalize();
        controls.target.set(0, 0, 0);
        camera.lookAt(0, 0, 0);
        controls.update();
        if (p < 1) requestAnimationFrame(step);
        else { isAnimatingView = false; }
    }
    step();
}

function animateTo3DView() {
    isAnimatingView = true;
    const startPos = camera.position.clone();
    const startUp = camera.up.clone();
    const pos = get3DPos();
    const endPos = new THREE.Vector3(pos.x, pos.y, pos.z);
    const endUp = new THREE.Vector3(0, 1, 0);
    animationStartTime = Date.now();

    function step() {
        const p = Math.min((Date.now() - animationStartTime) / VIEW_ANIMATION_DURATION, 1);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        camera.position.lerpVectors(startPos, endPos, e);
        camera.up.lerpVectors(startUp, endUp, e).normalize();
        controls.target.set(0, 0, 0);
        camera.lookAt(0, 0, 0);
        controls.update();
        if (p < 1) requestAnimationFrame(step);
        else { isAnimatingView = false; controls.enabled = true; }
    }
    step();
}

function set3DView() {
    const pos = get3DPos();
    camera.up.set(0, 1, 0);
    camera.position.set(pos.x, pos.y, pos.z);
    camera.lookAt(0, 0, 0);
    controls.enabled = true;
    controls.enableZoom = true;
    controls.target.set(0, 0, 0);
    controls.update();
}

function setTopView() {
    camera.up.set(0, 0, -1);
    camera.position.set(0, getTopViewDistance(), 0);
    camera.lookAt(0, 0, 0);
    controls.enabled = false;
    controls.enableZoom = false;
    controls.target.set(0, 0, 0);
    controls.update();
}

// ==================== DRAG & DROP ====================

const DIR_SYMBOLS = { up: '⬆', down: '⬇', left: '⬅', right: '➡' };

function setupDragAndDrop() {
    dragPreviewEl = document.getElementById('drag-preview');

    document.querySelectorAll('.arrow-tile-draggable').forEach(tile => {
        // Pointer-based drag (works for both mouse and touch)
        tile.addEventListener('pointerdown', onTileDragStart);
    });

    // Global move/up listeners (capture phase to work everywhere)
    window.addEventListener('pointermove', onTileDragMove);
    window.addEventListener('pointerup', onTileDragEnd);
    window.addEventListener('pointercancel', onTileDragCancel);
}

function onTileDragStart(e) {
    if (gameOver || flowAnimating || aiThinking) return;
    if (aiEnabled && currentPlayer === 2) return;
    if (arrowCounts[currentPlayer] <= 0) return;

    e.preventDefault();
    e.stopPropagation();

    const tile = e.currentTarget;
    const dir = tile.dataset.dir;
    if (!dir) return;

    // Capture pointer for reliable tracking
    tile.setPointerCapture(e.pointerId);
    // But we need move/up on window, so release after a tick
    // Actually, let's NOT capture — we want window-level events
    try { tile.releasePointerCapture(e.pointerId); } catch (_) {}

    isDragging = true;
    dragDir = dir;
    dragSourceElement = tile;
    dragHoveredCell = null;
    dragCanPlace = false;

    // Disable orbit controls during drag
    controls.enabled = false;

    // Visual feedback on source tile
    tile.classList.add('dragging');

    // Show DOM drag preview
    dragPreviewEl.textContent = DIR_SYMBOLS[dir] || '?';
    dragPreviewEl.className = 'visible neutral';
    dragPreviewEl.style.left = e.clientX + 'px';
    dragPreviewEl.style.top = e.clientY + 'px';

    // Hide move highlights while dragging
    clearHighlights();
}

function onTileDragMove(e) {
    if (!isDragging) return;
    e.preventDefault();

    // Update DOM preview position
    dragPreviewEl.style.left = e.clientX + 'px';
    dragPreviewEl.style.top = e.clientY + 'px';

    // Raycast to find hovered board cell
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(cellMeshes);

    if (hits.length > 0) {
        const cell = hits[0].object.userData;
        const cx = cell.cellX;
        const cy = cell.cellY;

        // Only update if cell changed
        if (!dragHoveredCell || dragHoveredCell.x !== cx || dragHoveredCell.y !== cy) {
            dragHoveredCell = { x: cx, y: cy };
            dragCanPlace = canPlaceArrow(cx, cy, dragDir, currentPlayer);
            updateDragBoardPreview(cx, cy, dragDir, dragCanPlace);
        }

        // Update DOM preview color
        dragPreviewEl.className = 'visible ' + (dragCanPlace ? 'can-place' : 'cannot-place');
    } else {
        // Not over board
        if (dragHoveredCell !== null) {
            dragHoveredCell = null;
            dragCanPlace = false;
            clearDragBoardPreview();
        }
        dragPreviewEl.className = 'visible neutral';
    }
}

function onTileDragEnd(e) {
    if (!isDragging) return;
    e.preventDefault();

    if (dragCanPlace && dragHoveredCell) {
        // Place the arrow!
        doPlaceArrow(currentPlayer, dragHoveredCell.x, dragHoveredCell.y, dragDir);
    }

    finishDrag();
}

function onTileDragCancel(e) {
    if (!isDragging) return;
    finishDrag();
}

function finishDrag() {
    isDragging = false;

    // Restore orbit controls
    if (viewMode === '3d') controls.enabled = true;

    // Hide DOM preview
    dragPreviewEl.className = '';

    // Remove dragging class from source
    if (dragSourceElement) {
        dragSourceElement.classList.remove('dragging');
        dragSourceElement = null;
    }

    // Clear 3D board preview
    clearDragBoardPreview();

    dragDir = null;
    dragHoveredCell = null;
    dragCanPlace = false;

    // Restore move highlights
    updateHighlights();
    updateAssistPreview();
}

// ==================== 3D DRAG BOARD PREVIEW ====================

function clearDragBoardPreview() {
    while (dragBoardPreview.children.length) {
        const c = dragBoardPreview.children[0];
        dragBoardPreview.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
    }
}

function updateDragBoardPreview(cx, cy, dir, valid) {
    clearDragBoardPreview();

    const wpos = cellToWorld(cx, cy);
    const tileColor = valid ? 0x00ff00 : 0xe74c3c;
    const emissiveColor = valid ? 0x00cc00 : 0xc0392b;

    // Semi-transparent tile
    const tileGeo = new THREE.BoxGeometry(CELL_SIZE * 0.88, ARROW_HEIGHT * 1.5, CELL_SIZE * 0.88);
    const tileMat = new THREE.MeshStandardMaterial({
        color: tileColor,
        emissive: emissiveColor,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.55,
        metalness: 0.1,
        roughness: 0.8
    });
    const tileMesh = new THREE.Mesh(tileGeo, tileMat);
    tileMesh.position.set(wpos.x, ARROW_HEIGHT + 0.04, wpos.z);
    tileMesh.renderOrder = 5;
    dragBoardPreview.add(tileMesh);

    // Arrow indicator (same shape as placed arrows)
    const triShape = new THREE.Shape();
    triShape.moveTo(0, 0.32);
    triShape.lineTo(-0.22, -0.05);
    triShape.lineTo(-0.08, -0.05);
    triShape.lineTo(-0.08, -0.28);
    triShape.lineTo(0.08, -0.28);
    triShape.lineTo(0.08, -0.05);
    triShape.lineTo(0.22, -0.05);
    triShape.closePath();

    const triGeo = new THREE.ShapeGeometry(triShape);
    const arrowColor = valid ? 0x00ff00 : 0xff7675;
    const triMat = new THREE.MeshStandardMaterial({
        color: arrowColor,
        emissive: arrowColor,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide
    });
    const triMesh = new THREE.Mesh(triGeo, triMat);

    triMesh.rotation.x = -Math.PI / 2; // lay flat
    switch (dir) {
        case 'up':    triMesh.rotation.z = 0; break;
        case 'down':  triMesh.rotation.z = Math.PI; break;
        case 'left':  triMesh.rotation.z = Math.PI / 2; break;
        case 'right': triMesh.rotation.z = -Math.PI / 2; break;
    }

    triMesh.position.set(wpos.x, ARROW_HEIGHT * 2 + 0.06, wpos.z);
    triMesh.renderOrder = 6;
    dragBoardPreview.add(triMesh);

    // Glowing ring outline
    const ringGeo = new THREE.RingGeometry(0.42, 0.48, 4);
    const ringMat = new THREE.MeshBasicMaterial({
        color: tileColor,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    // Rotate the square ring 45° so corners align with cell edges
    ringMesh.rotation.z = Math.PI / 4;
    ringMesh.position.set(wpos.x, 0.13, wpos.z);
    ringMesh.renderOrder = 5;
    dragBoardPreview.add(ringMesh);
}

// ==================== RESIZE ====================
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    if (viewMode === 'top') setTopView();
}

// ==================== ANIMATION LOOP ====================
function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();

    updateFlowAnimation(now);

    // Pulse drag board preview
    if (isDragging && dragBoardPreview.children.length > 0) {
        const dp = 0.45 + Math.sin(now * 0.006) * 0.15;
        for (const child of dragBoardPreview.children) {
            if (child.material && child.material.transparent) {
                child.material.opacity = dp;
            }
        }
    }

    // Pulse per-player calculation rings while worker is evaluating.
    for (const player of [1, 2]) {
        const ring = playerCalcRing[player];
        if (!ring || !ring.visible) continue;

        const mesh = player === 1 ? pawn1Mesh : pawn2Mesh;
        ring.position.set(mesh.position.x, 0.07, mesh.position.z);

        const pulse = 1.0 + Math.sin(now * 0.01 + (player === 1 ? 0 : Math.PI * 0.3)) * 0.12;
        ring.scale.set(pulse, pulse, 1);
        if (ring.material) {
            ring.material.opacity = 0.45 + Math.sin(now * 0.01) * 0.25;
        }
    }

    controls.update();
    renderer.render(scene, camera);
}

