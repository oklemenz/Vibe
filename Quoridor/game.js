// Three.js wird global über Script-Tag geladen
// THREE und THREE.OrbitControls sind global verfügbar

// Game constants
const BOARD_SIZE = 9;
const CELL_SIZE = 1;
const FENCE_THICKNESS = 0.1;
const FENCE_HEIGHT = 0.5;
const FENCE_LENGTH = 2;
const PAWN_RADIUS = 0.3;
const PAWN_HEIGHT = 0.6;

// Game state
let currentPlayer = 1;
let fences = { 1: 10, 2: 10 };
let pawns = {
    1: { x: 4, y: 0 },
    2: { x: 4, y: 8 }
};
let placedFences = []; // { x, y, orientation: 'h' | 'v' }
let gameOver = false;

// AI state
let aiEnabled = false;
let aiPlayer = 2; // AI plays as Player 2
let aiThinking = false;

// Training mode state
let trainEnabled = false;
let trainProposalGroup = null;

// Drag & Drop state
let isDragging = false;
let dragOrientation = 'h';
let dragPlayer = 1;
let lastDragX = 0;
let lastDragY = 0;

// Three.js objects
let scene, camera, renderer, controls;
let boardGroup, pawnsGroup, fencesGroup, highlightsGroup, previewGroup;
let pawn1Mesh, pawn2Mesh;
let raycaster, mouse;
let validMoves = [];

// Initialize game
init();
animate();

function init() {
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    // Camera setup
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 10, -10);
    camera.lookAt(0, 0, 1);

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('game-container').appendChild(renderer.domElement);

    // Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 8;
    controls.maxDistance = 30;
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.target.set(0, 0, -0.5);

    // Raycaster for mouse interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Create groups
    boardGroup = new THREE.Group();
    pawnsGroup = new THREE.Group();
    fencesGroup = new THREE.Group();
    highlightsGroup = new THREE.Group();
    previewGroup = new THREE.Group();
    trainProposalGroup = new THREE.Group();
    scene.add(boardGroup);
    scene.add(pawnsGroup);
    scene.add(fencesGroup);
    scene.add(highlightsGroup);
    scene.add(previewGroup);
    scene.add(trainProposalGroup);

    // Lighting
    setupLighting();

    // Create board
    createBoard();

    // Create pawns
    createPawns();

    // Update highlights
    updateValidMoves();

    // Event listeners
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('click', onClick);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('keydown', onKeyDown);

    // Touch event listeners for mobile
    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: false });
    renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    renderer.domElement.addEventListener('touchend', onTouchEnd, { passive: false });

    // Drag & Drop event listeners
    setupDragAndDrop();

    // UI buttons
    document.getElementById('restart-btn').addEventListener('click', restartGame);

    // AI toggle button
    document.getElementById('ai-btn').addEventListener('click', toggleAI);

    // Train toggle button
    document.getElementById('train-btn').addEventListener('click', toggleTrain);

    // Initialize UI state (including fence panel transparency)
    updateUI();
}

function setupLighting() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    // Main directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -15;
    directionalLight.shadow.camera.right = 15;
    directionalLight.shadow.camera.top = 15;
    directionalLight.shadow.camera.bottom = -15;
    scene.add(directionalLight);

    // Fill light
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-10, 10, -10);
    scene.add(fillLight);
}

function createBoard() {
    const boardOffset = -(BOARD_SIZE * CELL_SIZE) / 2 + CELL_SIZE / 2;

    // Board base
    const baseGeometry = new THREE.BoxGeometry(BOARD_SIZE * CELL_SIZE + 0.5, 0.2, BOARD_SIZE * CELL_SIZE + 0.5);
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x2d2d44 });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.y = -0.15;
    base.receiveShadow = true;
    boardGroup.add(base);

    // Create cells
    for (let x = 0; x < BOARD_SIZE; x++) {
        for (let y = 0; y < BOARD_SIZE; y++) {
            const cellGeometry = new THREE.BoxGeometry(CELL_SIZE * 0.9, 0.1, CELL_SIZE * 0.9);
            const isGoalRow1 = y === 8;
            const isGoalRow2 = y === 0;
            let cellColor = 0x3d3d5c;
            if (isGoalRow1) cellColor = 0x4a3d5c;
            if (isGoalRow2) cellColor = 0x5c3d3d;

            const cellMaterial = new THREE.MeshStandardMaterial({ color: cellColor });
            const cell = new THREE.Mesh(cellGeometry, cellMaterial);
            cell.position.set(
                boardOffset + x * CELL_SIZE,
                0,
                boardOffset + y * CELL_SIZE
            );
            cell.receiveShadow = true;
            cell.userData = { type: 'cell', x, y };
            boardGroup.add(cell);
        }
    }

    // Create fence slots (for visual reference and interaction)
    for (let x = 0; x < BOARD_SIZE - 1; x++) {
        for (let y = 0; y < BOARD_SIZE - 1; y++) {
            // Horizontal fence slot
            const hSlotGeometry = new THREE.BoxGeometry(FENCE_LENGTH, 0.02, FENCE_THICKNESS);
            const hSlotMaterial = new THREE.MeshBasicMaterial({ color: 0x222244, transparent: true, opacity: 0.3 });
            const hSlot = new THREE.Mesh(hSlotGeometry, hSlotMaterial);
            hSlot.position.set(
                boardOffset + x * CELL_SIZE + CELL_SIZE / 2,
                0.02,
                boardOffset + y * CELL_SIZE + CELL_SIZE / 2
            );
            hSlot.userData = { type: 'fenceSlot', x, y, orientation: 'h' };
            boardGroup.add(hSlot);

            // Vertical fence slot
            const vSlotGeometry = new THREE.BoxGeometry(FENCE_THICKNESS, 0.02, FENCE_LENGTH);
            const vSlotMaterial = new THREE.MeshBasicMaterial({ color: 0x222244, transparent: true, opacity: 0.3 });
            const vSlot = new THREE.Mesh(vSlotGeometry, vSlotMaterial);
            vSlot.position.set(
                boardOffset + x * CELL_SIZE + CELL_SIZE / 2,
                0.02,
                boardOffset + y * CELL_SIZE + CELL_SIZE / 2
            );
            vSlot.userData = { type: 'fenceSlot', x, y, orientation: 'v' };
            boardGroup.add(vSlot);
        }
    }
}

function createPawns() {
    const boardOffset = -(BOARD_SIZE * CELL_SIZE) / 2 + CELL_SIZE / 2;

    // Player 1 pawn (red)
    const pawn1Geometry = new THREE.CylinderGeometry(PAWN_RADIUS * 0.7, PAWN_RADIUS, PAWN_HEIGHT, 32);
    const pawn1Material = new THREE.MeshStandardMaterial({
        color: 0xff6b6b,
        metalness: 0.3,
        roughness: 0.4
    });
    pawn1Mesh = new THREE.Mesh(pawn1Geometry, pawn1Material);
    pawn1Mesh.position.set(
        boardOffset + pawns[1].x * CELL_SIZE,
        PAWN_HEIGHT / 2 + 0.05,
        boardOffset + pawns[1].y * CELL_SIZE
    );
    pawn1Mesh.castShadow = true;
    pawn1Mesh.userData = { type: 'pawn', player: 1 };
    pawnsGroup.add(pawn1Mesh);

    // Player 2 pawn (cyan)
    const pawn2Geometry = new THREE.CylinderGeometry(PAWN_RADIUS * 0.7, PAWN_RADIUS, PAWN_HEIGHT, 32);
    const pawn2Material = new THREE.MeshStandardMaterial({
        color: 0x4ecdc4,
        metalness: 0.3,
        roughness: 0.4
    });
    pawn2Mesh = new THREE.Mesh(pawn2Geometry, pawn2Material);
    pawn2Mesh.position.set(
        boardOffset + pawns[2].x * CELL_SIZE,
        PAWN_HEIGHT / 2 + 0.05,
        boardOffset + pawns[2].y * CELL_SIZE
    );
    pawn2Mesh.castShadow = true;
    pawn2Mesh.userData = { type: 'pawn', player: 2 };
    pawnsGroup.add(pawn2Mesh);
}

function updatePawnPositions() {
    const boardOffset = -(BOARD_SIZE * CELL_SIZE) / 2 + CELL_SIZE / 2;

    pawn1Mesh.position.set(
        boardOffset + pawns[1].x * CELL_SIZE,
        PAWN_HEIGHT / 2 + 0.05,
        boardOffset + pawns[1].y * CELL_SIZE
    );

    pawn2Mesh.position.set(
        boardOffset + pawns[2].x * CELL_SIZE,
        PAWN_HEIGHT / 2 + 0.05,
        boardOffset + pawns[2].y * CELL_SIZE
    );
}

function isFenceBlocking(x1, y1, x2, y2) {
    // Check if there's a fence between two adjacent cells
    const dx = x2 - x1;
    const dy = y2 - y1;

    for (const fence of placedFences) {
        if (fence.orientation === 'h') {
            // Horizontal fence blocks vertical movement
            if (dy !== 0) {
                const fenceY = fence.y + 1;
                if ((y1 === fenceY - 1 && y2 === fenceY) || (y1 === fenceY && y2 === fenceY - 1)) {
                    if (x1 >= fence.x && x1 <= fence.x + 1) {
                        return true;
                    }
                }
            }
        } else {
            // Vertical fence blocks horizontal movement
            if (dx !== 0) {
                const fenceX = fence.x + 1;
                if ((x1 === fenceX - 1 && x2 === fenceX) || (x1 === fenceX && x2 === fenceX - 1)) {
                    if (y1 >= fence.y && y1 <= fence.y + 1) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

function getValidMoves(player) {
    const moves = [];
    const pos = pawns[player];
    const opponent = player === 1 ? 2 : 1;
    const opponentPos = pawns[opponent];

    const directions = [
        { dx: 0, dy: 1 },  // forward (relative)
        { dx: 0, dy: -1 }, // backward
        { dx: 1, dy: 0 },  // right
        { dx: -1, dy: 0 }  // left
    ];

    for (const dir of directions) {
        const newX = pos.x + dir.dx;
        const newY = pos.y + dir.dy;

        // Check bounds
        if (newX < 0 || newX >= BOARD_SIZE || newY < 0 || newY >= BOARD_SIZE) continue;

        // Check fence blocking
        if (isFenceBlocking(pos.x, pos.y, newX, newY)) continue;

        // Check if opponent is there
        if (newX === opponentPos.x && newY === opponentPos.y) {
            // Face to face - try to jump over
            const jumpX = newX + dir.dx;
            const jumpY = newY + dir.dy;

            // Check if we can jump straight over
            if (jumpX >= 0 && jumpX < BOARD_SIZE && jumpY >= 0 && jumpY < BOARD_SIZE &&
                !isFenceBlocking(newX, newY, jumpX, jumpY)) {
                moves.push({ x: jumpX, y: jumpY });
            } else {
                // Can't jump straight, try diagonal
                const sideDirs = dir.dx === 0
                    ? [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }]
                    : [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }];

                for (const sideDir of sideDirs) {
                    const sideX = newX + sideDir.dx;
                    const sideY = newY + sideDir.dy;
                    if (sideX >= 0 && sideX < BOARD_SIZE && sideY >= 0 && sideY < BOARD_SIZE &&
                        !isFenceBlocking(newX, newY, sideX, sideY)) {
                        moves.push({ x: sideX, y: sideY });
                    }
                }
            }
        } else {
            moves.push({ x: newX, y: newY });
        }
    }

    return moves;
}

function updateValidMoves() {
    // Clear existing highlights
    while (highlightsGroup.children.length > 0) {
        highlightsGroup.remove(highlightsGroup.children[0]);
    }

    if (isDragging || gameOver) return;

    validMoves = getValidMoves(currentPlayer);
    const boardOffset = -(BOARD_SIZE * CELL_SIZE) / 2 + CELL_SIZE / 2;

    for (const move of validMoves) {
        const highlightGeometry = new THREE.BoxGeometry(CELL_SIZE * 0.8, 0.05, CELL_SIZE * 0.8);
        const highlightMaterial = new THREE.MeshBasicMaterial({
            color: currentPlayer === 1 ? 0xff6b6b : 0x4ecdc4,
            transparent: true,
            opacity: 0.5
        });
        const highlight = new THREE.Mesh(highlightGeometry, highlightMaterial);
        highlight.position.set(
            boardOffset + move.x * CELL_SIZE,
            0.1,
            boardOffset + move.y * CELL_SIZE
        );
        highlight.userData = { type: 'moveHighlight', x: move.x, y: move.y };
        highlightsGroup.add(highlight);
    }
}

function canPlaceFence(x, y, orientation) {
    // Check bounds
    if (x < 0 || x >= BOARD_SIZE - 1 || y < 0 || y >= BOARD_SIZE - 1) return false;

    // Check if fence overlaps with existing fences
    for (const fence of placedFences) {
        // Same position, same orientation
        if (fence.x === x && fence.y === y && fence.orientation === orientation) {
            return false;
        }

        // Crossing fences
        if (fence.x === x && fence.y === y && fence.orientation !== orientation) {
            return false;
        }

        // Overlapping horizontal fences
        if (orientation === 'h' && fence.orientation === 'h') {
            if (fence.y === y && Math.abs(fence.x - x) === 1) {
                return false;
            }
        }

        // Overlapping vertical fences
        if (orientation === 'v' && fence.orientation === 'v') {
            if (fence.x === x && Math.abs(fence.y - y) === 1) {
                return false;
            }
        }
    }

    // Check if fence blocks all paths to goal (using BFS)
    // Temporarily add the fence
    placedFences.push({ x, y, orientation });

    const player1HasPath = hasPathToGoal(1);
    const player2HasPath = hasPathToGoal(2);

    // Remove temporary fence
    placedFences.pop();

    return player1HasPath && player2HasPath;
}

function hasPathToGoal(player) {
    const goalY = player === 1 ? 8 : 0;
    const start = { x: pawns[player].x, y: pawns[player].y };
    const visited = new Set();
    const queue = [start];

    while (queue.length > 0) {
        const current = queue.shift();
        const key = `${current.x},${current.y}`;

        if (visited.has(key)) continue;
        visited.add(key);

        if (current.y === goalY) return true;

        const directions = [
            { dx: 0, dy: 1 },
            { dx: 0, dy: -1 },
            { dx: 1, dy: 0 },
            { dx: -1, dy: 0 }
        ];

        for (const dir of directions) {
            const newX = current.x + dir.dx;
            const newY = current.y + dir.dy;

            if (newX >= 0 && newX < BOARD_SIZE && newY >= 0 && newY < BOARD_SIZE &&
                !isFenceBlocking(current.x, current.y, newX, newY)) {
                queue.push({ x: newX, y: newY });
            }
        }
    }

    return false;
}

function placeFence(x, y, orientation) {
    if (!canPlaceFence(x, y, orientation)) return false;
    if (fences[currentPlayer] <= 0) return false;

    placedFences.push({ x, y, orientation });
    fences[currentPlayer]--;

    const boardOffset = -(BOARD_SIZE * CELL_SIZE) / 2 + CELL_SIZE / 2;

    let fenceGeometry;
    if (orientation === 'h') {
        fenceGeometry = new THREE.BoxGeometry(FENCE_LENGTH, FENCE_HEIGHT, FENCE_THICKNESS);
    } else {
        fenceGeometry = new THREE.BoxGeometry(FENCE_THICKNESS, FENCE_HEIGHT, FENCE_LENGTH);
    }

    const fenceMaterial = new THREE.MeshStandardMaterial({
        color: 0xc9a66b,  // Neutral wood/brown color for all fences
        metalness: 0.2,
        roughness: 0.6
    });
    const fenceMesh = new THREE.Mesh(fenceGeometry, fenceMaterial);
    fenceMesh.position.set(
        boardOffset + x * CELL_SIZE + CELL_SIZE / 2,
        FENCE_HEIGHT / 2,
        boardOffset + y * CELL_SIZE + CELL_SIZE / 2
    );
    fenceMesh.castShadow = true;
    fencesGroup.add(fenceMesh);

    return true;
}

function movePawn(x, y) {
    const isValid = validMoves.some(m => m.x === x && m.y === y);
    if (!isValid) return false;

    pawns[currentPlayer] = { x, y };
    updatePawnPositions();

    return true;
}

function checkWin() {
    if (pawns[1].y === 8) {
        endGame(1);
        return true;
    }
    if (pawns[2].y === 0) {
        endGame(2);
        return true;
    }
    return false;
}

function endGame(winner) {
    gameOver = true;
    document.getElementById('winner-text').textContent = `Player ${winner} Wins!`;
    document.getElementById('winner-modal').style.display = 'flex';
}

function switchPlayer() {
    currentPlayer = currentPlayer === 1 ? 2 : 1;

    // Clear training proposal when player changes
    clearTrainProposal();

    updateUI();
    updateValidMoves();

    // Check if AI should make a move
    if (aiEnabled && currentPlayer === aiPlayer && !gameOver && !aiThinking) {
        aiThinking = true;
        // Small delay to allow UI to update and show it's AI's turn
        setTimeout(() => {
            makeAIMove();
            aiThinking = false;
            // Show training proposal after AI move if it's now Player 1's turn
            if (trainEnabled && currentPlayer === 1 && !gameOver) {
                showTrainProposal();
            }
        }, 500);
    } else if (trainEnabled && currentPlayer === 1 && !gameOver) {
        // Show training proposal for Player 1
        setTimeout(() => {
            showTrainProposal();
        }, 100);
    }
}

function updateUI() {
    const playerIndicator = document.getElementById('current-player');
    const playerEmoji = currentPlayer === 1 ? '🔴' : '🟢';
    playerIndicator.textContent = `${playerEmoji} Player ${currentPlayer}'s Turn`;
    playerIndicator.className = currentPlayer === 1 ? 'player1-turn' : 'player2-turn';

    document.getElementById('player1-fences').textContent = `🔴 Player 1 (Fences: ${fences[1]})`;
    document.getElementById('player2-fences').textContent = `🟢 Player 2 (Fences: ${fences[2]})`;

    // Update fence panel counts
    document.getElementById('p1-fence-count').textContent = `${fences[1]} remaining`;
    document.getElementById('p2-fence-count').textContent = `${fences[2]} remaining`;

    // Enable/disable fence elements based on current player and fence count
    updateFencePanelState();
}

function updateFencePanelState() {
    const p1Fences = document.querySelectorAll('.player1-fence');
    const p2Fences = document.querySelectorAll('.player2-fence');
    const p1Section = document.getElementById('player1-section');
    const p2Section = document.getElementById('player2-section');

    p1Fences.forEach(fence => {
        if (currentPlayer !== 1 || fences[1] <= 0 || gameOver) {
            fence.classList.add('disabled');
        } else {
            fence.classList.remove('disabled');
        }
    });

    p2Fences.forEach(fence => {
        if (currentPlayer !== 2 || fences[2] <= 0 || gameOver) {
            fence.classList.add('disabled');
        } else {
            fence.classList.remove('disabled');
        }
    });

    // Make entire section transparent for inactive player
    if (p1Section) {
        p1Section.style.opacity = (currentPlayer === 1 && fences[1] > 0 && !gameOver) ? '1' : '0.3';
    }
    if (p2Section) {
        p2Section.style.opacity = (currentPlayer === 2 && fences[2] > 0 && !gameOver) ? '1' : '0.3';
    }
}

function setupDragAndDrop() {
    const draggableFences = document.querySelectorAll('.draggable-fence');
    const dragPreview = document.getElementById('drag-preview');
    const dropHint = document.getElementById('drop-hint');

    // Use custom mouse-based drag instead of HTML5 drag API
    // This allows keyboard events to work during drag

    draggableFences.forEach(fence => {
        // Disable native drag
        fence.setAttribute('draggable', 'false');

        // Mouse events
        fence.addEventListener('mousedown', (e) => {
            startFenceDrag(fence, e.clientX, e.clientY);
            e.preventDefault();
        });

        // Touch events for mobile
        fence.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            if (startFenceDrag(fence, touch.clientX, touch.clientY)) {
                e.preventDefault();
            }
        }, { passive: false });
    });

    // Helper function to start fence drag
    function startFenceDrag(fence, clientX, clientY) {
        const player = parseInt(fence.dataset.player);
        const orientation = fence.dataset.orientation;

        // Only allow dragging if it's the player's turn and they have fences
        if (player !== currentPlayer || fences[player] <= 0 || gameOver) {
            return false;
        }

        isDragging = true;
        dragPlayer = player;
        dragOrientation = orientation;
        lastDragX = clientX;
        lastDragY = clientY;

        // Hide the original element during drag
        fence.style.opacity = '0.3';

        // Show drop hint
        dropHint.classList.add('active');

        // Hide move highlights during fence placement
        updateValidMoves();

        // Show initial preview
        updateDragPreviewHTML(clientX, clientY);
        dragPreview.style.display = 'block';

        return true;
    }

    // Track mouse movement
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        lastDragX = e.clientX;
        lastDragY = e.clientY;

        updateDragPreviewHTML(e.clientX, e.clientY);
        updateDragPreview3D(e.clientX, e.clientY);
    });

    // Track touch movement
    document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        e.preventDefault();

        const touch = e.touches[0];
        lastDragX = touch.clientX;
        lastDragY = touch.clientY;

        updateDragPreviewHTML(touch.clientX, touch.clientY);
        updateDragPreview3D(touch.clientX, touch.clientY);
    }, { passive: false });

    // Handle mouse up (drop)
    document.addEventListener('mouseup', (e) => {
        if (!isDragging) return;
        endFenceDrag(e.clientX, e.clientY);
    });

    // Handle touch end (drop)
    document.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        endFenceDrag(lastDragX, lastDragY);
    }, { passive: false });

    // Helper function to end fence drag
    function endFenceDrag(clientX, clientY) {
        // Try to place fence at current position
        const boardPos = getBoardPositionFromMouse(clientX, clientY);

        if (boardPos && placeFence(boardPos.x, boardPos.y, dragOrientation)) {
            clearPreview();
            if (!checkWin()) {
                switchPlayer();
            }
        }

        // Reset drag state
        isDragging = false;
        dragPreview.style.display = 'none';
        dropHint.classList.remove('active');
        clearPreview();
        updateValidMoves();

        // Reset fence element opacity
        document.querySelectorAll('.draggable-fence').forEach(f => {
            f.style.opacity = '1';
        });
    }

    // Keyboard rotation during drag - this now works!
    document.addEventListener('keydown', (e) => {
        if (isDragging && (e.key === ' ' || e.key === 'r' || e.key === 'R')) {
            e.preventDefault();
            rotateCurrentFence();
        }
    });
}

function updateDragPreviewHTML(clientX, clientY) {
    const dragPreview = document.getElementById('drag-preview');
    const previewWidth = dragOrientation === 'h' ? 80 : 15;
    const previewHeight = dragOrientation === 'h' ? 15 : 80;

    dragPreview.style.width = previewWidth + 'px';
    dragPreview.style.height = previewHeight + 'px';
    dragPreview.style.left = (clientX - previewWidth / 2) + 'px';
    dragPreview.style.top = (clientY - previewHeight / 2) + 'px';
    dragPreview.style.background = '#c9a66b';
}

function getBoardPositionFromMouse(clientX, clientY) {
    mouse.x = (clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const boardIntersects = raycaster.intersectObjects(boardGroup.children);

    if (boardIntersects.length > 0) {
        const point = boardIntersects[0].point;
        const boardOffset = -(BOARD_SIZE * CELL_SIZE) / 2 + CELL_SIZE / 2;

        const fx = Math.floor((point.x - boardOffset + CELL_SIZE / 2) / CELL_SIZE);
        const fy = Math.floor((point.z - boardOffset + CELL_SIZE / 2) / CELL_SIZE);

        if (fx >= 0 && fx < BOARD_SIZE - 1 && fy >= 0 && fy < BOARD_SIZE - 1) {
            return { x: fx, y: fy };
        }
    }

    return null;
}

function updateDragPreview3D(clientX, clientY) {
    const boardPos = getBoardPositionFromMouse(clientX, clientY);

    if (boardPos) {
        showFencePreview(boardPos.x, boardPos.y, dragOrientation);
    } else {
        clearPreview();
    }
}

function clearPreview() {
    while (previewGroup.children.length > 0) {
        previewGroup.remove(previewGroup.children[0]);
    }
}

function showFencePreview(x, y, orientation) {
    clearPreview();

    const boardOffset = -(BOARD_SIZE * CELL_SIZE) / 2 + CELL_SIZE / 2;

    let fenceGeometry;
    if (orientation === 'h') {
        fenceGeometry = new THREE.BoxGeometry(FENCE_LENGTH, FENCE_HEIGHT, FENCE_THICKNESS);
    } else {
        fenceGeometry = new THREE.BoxGeometry(FENCE_THICKNESS, FENCE_HEIGHT, FENCE_LENGTH);
    }

    const canPlace = canPlaceFence(x, y, orientation) && fences[currentPlayer] > 0;
    const fenceMaterial = new THREE.MeshStandardMaterial({
        color: canPlace ? 0x00ff00 : 0xff0000,
        transparent: true,
        opacity: 0.5
    });
    const fenceMesh = new THREE.Mesh(fenceGeometry, fenceMaterial);
    fenceMesh.position.set(
        boardOffset + x * CELL_SIZE + CELL_SIZE / 2,
        FENCE_HEIGHT / 2,
        boardOffset + y * CELL_SIZE + CELL_SIZE / 2
    );
    previewGroup.add(fenceMesh);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onClick(event) {
    if (gameOver || isDragging) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Check for move highlight clicks
    const highlightIntersects = raycaster.intersectObjects(highlightsGroup.children);
    if (highlightIntersects.length > 0) {
        const target = highlightIntersects[0].object.userData;
        if (movePawn(target.x, target.y)) {
            if (!checkWin()) {
                switchPlayer();
            }
        }
    }
}

function onMouseMove() {
    // No preview needed when not dragging - drag events handle that
}

// Touch event handlers for mobile
let touchStartTime = 0;
let touchMoved = false;

function onTouchStart(event) {
    if (gameOver) return;
    touchStartTime = Date.now();
    touchMoved = false;
}

function onTouchMove(event) {
    touchMoved = true;
}

function onTouchEnd(event) {
    if (gameOver || isDragging) return;

    // Only treat as tap if touch was short and didn't move much
    const touchDuration = Date.now() - touchStartTime;
    if (touchDuration > 300 || touchMoved) return;

    event.preventDefault();

    const touch = event.changedTouches[0];
    mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Check for move highlight clicks
    const highlightIntersects = raycaster.intersectObjects(highlightsGroup.children);
    if (highlightIntersects.length > 0) {
        const target = highlightIntersects[0].object.userData;
        if (movePawn(target.x, target.y)) {
            if (!checkWin()) {
                switchPlayer();
            }
        }
    }
}

function onKeyDown(event) {
    // This might not work during drag, so we also add listener in setupDragAndDrop
    if ((event.key === 'r' || event.key === 'R' || event.key === ' ') && isDragging) {
        event.preventDefault();
        rotateCurrentFence();
    }
}

function rotateCurrentFence() {
    // Toggle fence orientation during drag
    dragOrientation = dragOrientation === 'h' ? 'v' : 'h';

    // Update the HTML drag preview size
    const dragPreview = document.getElementById('drag-preview');
    const previewWidth = dragOrientation === 'h' ? 80 : 15;
    const previewHeight = dragOrientation === 'h' ? 15 : 80;
    dragPreview.style.width = previewWidth + 'px';
    dragPreview.style.height = previewHeight + 'px';
    dragPreview.style.left = (lastDragX - previewWidth / 2) + 'px';
    dragPreview.style.top = (lastDragY - previewHeight / 2) + 'px';

    // Update the 3D preview on the board
    updateDragPreview3D(lastDragX, lastDragY);
}

function restartGame() {
    // Reset game state
    currentPlayer = 1;
    fences = { 1: 10, 2: 10 };
    pawns = {
        1: { x: 4, y: 0 },
        2: { x: 4, y: 8 }
    };
    placedFences = [];
    isDragging = false;
    gameOver = false;
    aiThinking = false;

    // Clear fences
    while (fencesGroup.children.length > 0) {
        fencesGroup.remove(fencesGroup.children[0]);
    }

    // Clear training proposal
    clearTrainProposal();

    // Reset pawn positions
    updatePawnPositions();

    // Update UI
    updateUI();
    updateValidMoves();

    // Hide winner modal
    document.getElementById('winner-modal').style.display = 'none';

    // Show training proposal if train mode is active and it's Player 1's turn
    if (trainEnabled && currentPlayer === 1) {
        setTimeout(() => {
            showTrainProposal();
        }, 100);
    }
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// ==================== AI IMPLEMENTATION ====================

function toggleAI() {
    aiEnabled = !aiEnabled;
    const btn = document.getElementById('ai-btn');

    if (aiEnabled) {
        btn.textContent = '🤖 AI: On';
        btn.classList.add('active');

        // If it's already AI's turn, start thinking
        if (currentPlayer === aiPlayer && !gameOver && !aiThinking) {
            aiThinking = true;
            setTimeout(() => {
                makeAIMove();
                aiThinking = false;
            }, 500);
        }
    } else {
        btn.textContent = '🤖 AI';
        btn.classList.remove('active');
    }
}

// Calculate shortest path distance to goal using BFS
function getShortestPathDistance(player, testPawns, testFences) {
    const goalY = player === 1 ? 8 : 0;
    const start = { x: testPawns[player].x, y: testPawns[player].y };
    const visited = new Set();
    const queue = [{ ...start, dist: 0 }];

    while (queue.length > 0) {
        const current = queue.shift();
        const key = `${current.x},${current.y}`;

        if (visited.has(key)) continue;
        visited.add(key);

        if (current.y === goalY) return current.dist;

        const directions = [
            { dx: 0, dy: 1 },
            { dx: 0, dy: -1 },
            { dx: 1, dy: 0 },
            { dx: -1, dy: 0 }
        ];

        for (const dir of directions) {
            const newX = current.x + dir.dx;
            const newY = current.y + dir.dy;

            if (newX >= 0 && newX < BOARD_SIZE && newY >= 0 && newY < BOARD_SIZE &&
                !isFenceBlockingTest(current.x, current.y, newX, newY, testFences)) {
                queue.push({ x: newX, y: newY, dist: current.dist + 1 });
            }
        }
    }

    return 999; // No path found
}

// Test fence blocking with custom fence array
function isFenceBlockingTest(x1, y1, x2, y2, testFences) {
    const dx = x2 - x1;
    const dy = y2 - y1;

    for (const fence of testFences) {
        if (fence.orientation === 'h') {
            if (dy !== 0) {
                const fenceY = fence.y + 1;
                if ((y1 === fenceY - 1 && y2 === fenceY) || (y1 === fenceY && y2 === fenceY - 1)) {
                    if (x1 >= fence.x && x1 <= fence.x + 1) {
                        return true;
                    }
                }
            }
        } else {
            if (dx !== 0) {
                const fenceX = fence.x + 1;
                if ((x1 === fenceX - 1 && x2 === fenceX) || (x1 === fenceX && x2 === fenceX - 1)) {
                    if (y1 >= fence.y && y1 <= fence.y + 1) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

// Check if path exists with test state
function hasPathToGoalTest(player, testPawns, testFences) {
    const goalY = player === 1 ? 8 : 0;
    const start = { x: testPawns[player].x, y: testPawns[player].y };
    const visited = new Set();
    const queue = [start];

    while (queue.length > 0) {
        const current = queue.shift();
        const key = `${current.x},${current.y}`;

        if (visited.has(key)) continue;
        visited.add(key);

        if (current.y === goalY) return true;

        const directions = [
            { dx: 0, dy: 1 },
            { dx: 0, dy: -1 },
            { dx: 1, dy: 0 },
            { dx: -1, dy: 0 }
        ];

        for (const dir of directions) {
            const newX = current.x + dir.dx;
            const newY = current.y + dir.dy;

            if (newX >= 0 && newX < BOARD_SIZE && newY >= 0 && newY < BOARD_SIZE &&
                !isFenceBlockingTest(current.x, current.y, newX, newY, testFences)) {
                queue.push({ x: newX, y: newY });
            }
        }
    }

    return false;
}

// Check if fence can be placed with test state
function canPlaceFenceTest(x, y, orientation, testFences, testPawns) {
    if (x < 0 || x >= BOARD_SIZE - 1 || y < 0 || y >= BOARD_SIZE - 1) return false;

    for (const fence of testFences) {
        if (fence.x === x && fence.y === y && fence.orientation === orientation) return false;
        if (fence.x === x && fence.y === y && fence.orientation !== orientation) return false;

        if (orientation === 'h' && fence.orientation === 'h') {
            if (fence.y === y && Math.abs(fence.x - x) === 1) return false;
        }
        if (orientation === 'v' && fence.orientation === 'v') {
            if (fence.x === x && Math.abs(fence.y - y) === 1) return false;
        }
    }

    // Test if both players still have path to goal
    const newFences = [...testFences, { x, y, orientation }];
    return hasPathToGoalTest(1, testPawns, newFences) && hasPathToGoalTest(2, testPawns, newFences);
}

// Get valid moves for a player with test state
function getValidMovesTest(player, testPawns, testFences) {
    const moves = [];
    const pos = testPawns[player];
    const opponent = player === 1 ? 2 : 1;
    const opponentPos = testPawns[opponent];

    const directions = [
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 }
    ];

    for (const dir of directions) {
        const newX = pos.x + dir.dx;
        const newY = pos.y + dir.dy;

        if (newX < 0 || newX >= BOARD_SIZE || newY < 0 || newY >= BOARD_SIZE) continue;
        if (isFenceBlockingTest(pos.x, pos.y, newX, newY, testFences)) continue;

        if (newX === opponentPos.x && newY === opponentPos.y) {
            const jumpX = newX + dir.dx;
            const jumpY = newY + dir.dy;

            if (jumpX >= 0 && jumpX < BOARD_SIZE && jumpY >= 0 && jumpY < BOARD_SIZE &&
                !isFenceBlockingTest(newX, newY, jumpX, jumpY, testFences)) {
                moves.push({ x: jumpX, y: jumpY });
            } else {
                const sideDirs = dir.dx === 0
                    ? [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }]
                    : [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }];

                for (const sideDir of sideDirs) {
                    const sideX = newX + sideDir.dx;
                    const sideY = newY + sideDir.dy;
                    if (sideX >= 0 && sideX < BOARD_SIZE && sideY >= 0 && sideY < BOARD_SIZE &&
                        !isFenceBlockingTest(newX, newY, sideX, sideY, testFences)) {
                        moves.push({ x: sideX, y: sideY });
                    }
                }
            }
        } else {
            moves.push({ x: newX, y: newY });
        }
    }

    return moves;
}

// Evaluate board state (positive = good for AI, negative = good for opponent)
function evaluateState(testPawns, testFences, testFencesCounts) {
    const aiDist = getShortestPathDistance(aiPlayer, testPawns, testFences);
    const oppPlayer = aiPlayer === 1 ? 2 : 1;
    const oppDist = getShortestPathDistance(oppPlayer, testPawns, testFences);

    // Check for immediate wins
    if (aiPlayer === 1 && testPawns[1].y === 8) return 10000;
    if (aiPlayer === 2 && testPawns[2].y === 0) return 10000;
    if (oppPlayer === 1 && testPawns[1].y === 8) return -10000;
    if (oppPlayer === 2 && testPawns[2].y === 0) return -10000;

    // Main evaluation: path distance difference
    // We want our path to be shorter than opponent's
    let score = (oppDist - aiDist) * 10;

    // Bonus for having more fences available
    score += (testFencesCounts[aiPlayer] - testFencesCounts[oppPlayer]) * 2;

    // Bonus for being closer to goal
    if (aiPlayer === 1) {
        score += testPawns[1].y * 3;
    } else {
        score += (8 - testPawns[2].y) * 3;
    }

    return score;
}

// Generate all possible fence placements (smart subset)
function generateFenceMoves(player, testFences, testPawns, testFencesCounts) {
    if (testFencesCounts[player] <= 0) return [];

    const moves = [];
    const oppPlayer = player === 1 ? 2 : 1;
    const oppPos = testPawns[oppPlayer];

    // Focus on fences near opponent's path
    // Check fences in a wider area around opponent
    for (let x = Math.max(0, oppPos.x - 3); x <= Math.min(BOARD_SIZE - 2, oppPos.x + 3); x++) {
        for (let y = Math.max(0, oppPos.y - 3); y <= Math.min(BOARD_SIZE - 2, oppPos.y + 3); y++) {
            for (const orientation of ['h', 'v']) {
                if (canPlaceFenceTest(x, y, orientation, testFences, testPawns)) {
                    moves.push({ type: 'fence', x, y, orientation });
                }
            }
        }
    }

    return moves;
}

// Minimax with alpha-beta pruning
function minimax(testPawns, testFences, testFencesCounts, depth, alpha, beta, isMaximizing) {
    // Check terminal conditions
    if (testPawns[1].y === 8) {
        return aiPlayer === 1 ? 10000 + depth : -10000 - depth;
    }
    if (testPawns[2].y === 0) {
        return aiPlayer === 2 ? 10000 + depth : -10000 - depth;
    }

    if (depth === 0) {
        return evaluateState(testPawns, testFences, testFencesCounts);
    }

    const currentPlayer = isMaximizing ? aiPlayer : (aiPlayer === 1 ? 2 : 1);

    // Generate moves
    const moveMoves = getValidMovesTest(currentPlayer, testPawns, testFences);
    const fenceMoves = generateFenceMoves(currentPlayer, testFences, testPawns, testFencesCounts);

    if (isMaximizing) {
        let maxEval = -Infinity;

        // Evaluate pawn moves first (usually better)
        for (const move of moveMoves) {
            const newPawns = {
                1: { ...testPawns[1] },
                2: { ...testPawns[2] }
            };
            newPawns[currentPlayer] = { x: move.x, y: move.y };

            const evalScore = minimax(newPawns, testFences, testFencesCounts, depth - 1, alpha, beta, false);
            maxEval = Math.max(maxEval, evalScore);
            alpha = Math.max(alpha, evalScore);
            if (beta <= alpha) break;
        }

        // Then evaluate fence moves (limit for performance)
        const limitedFenceMoves = fenceMoves.slice(0, 10);
        for (const move of limitedFenceMoves) {
            const newFences = [...testFences, { x: move.x, y: move.y, orientation: move.orientation }];
            const newCounts = { ...testFencesCounts };
            newCounts[currentPlayer]--;

            const evalScore = minimax(testPawns, newFences, newCounts, depth - 1, alpha, beta, false);
            maxEval = Math.max(maxEval, evalScore);
            alpha = Math.max(alpha, evalScore);
            if (beta <= alpha) break;
        }

        return maxEval;
    } else {
        let minEval = Infinity;

        for (const move of moveMoves) {
            const newPawns = {
                1: { ...testPawns[1] },
                2: { ...testPawns[2] }
            };
            newPawns[currentPlayer] = { x: move.x, y: move.y };

            const evalScore = minimax(newPawns, testFences, testFencesCounts, depth - 1, alpha, beta, true);
            minEval = Math.min(minEval, evalScore);
            beta = Math.min(beta, evalScore);
            if (beta <= alpha) break;
        }

        const limitedFenceMoves = fenceMoves.slice(0, 10);
        for (const move of limitedFenceMoves) {
            const newFences = [...testFences, { x: move.x, y: move.y, orientation: move.orientation }];
            const newCounts = { ...testFencesCounts };
            newCounts[currentPlayer]--;

            const evalScore = minimax(testPawns, newFences, newCounts, depth - 1, alpha, beta, true);
            minEval = Math.min(minEval, evalScore);
            beta = Math.min(beta, evalScore);
            if (beta <= alpha) break;
        }

        return minEval;
    }
}

// Find the best move for AI
function findBestMove() {
    const testPawns = {
        1: { ...pawns[1] },
        2: { ...pawns[2] }
    };
    const testFences = [...placedFences];
    const testFencesCounts = { ...fences };

    let bestMove = null;
    let bestScore = -Infinity;
    const depth = 3; // Search depth

    // Evaluate pawn moves
    const moveMoves = getValidMovesTest(aiPlayer, testPawns, testFences);
    for (const move of moveMoves) {
        const newPawns = {
            1: { ...testPawns[1] },
            2: { ...testPawns[2] }
        };
        newPawns[aiPlayer] = { x: move.x, y: move.y };

        // Check for immediate win
        if ((aiPlayer === 1 && move.y === 8) || (aiPlayer === 2 && move.y === 0)) {
            return { type: 'move', x: move.x, y: move.y };
        }

        const score = minimax(newPawns, testFences, testFencesCounts, depth - 1, -Infinity, Infinity, false);

        if (score > bestScore) {
            bestScore = score;
            bestMove = { type: 'move', x: move.x, y: move.y };
        }
    }

    // Evaluate fence moves (strategic subset)
    if (testFencesCounts[aiPlayer] > 0) {
        const fenceMoves = generateFenceMoves(aiPlayer, testFences, testPawns, testFencesCounts);

        // Score and sort fence moves by immediate impact
        const scoredFences = fenceMoves.map(move => {
            const newFences = [...testFences, { x: move.x, y: move.y, orientation: move.orientation }];
            const oppPlayer = aiPlayer === 1 ? 2 : 1;
            const oppDistBefore = getShortestPathDistance(oppPlayer, testPawns, testFences);
            const oppDistAfter = getShortestPathDistance(oppPlayer, testPawns, newFences);
            return { ...move, impact: oppDistAfter - oppDistBefore };
        });

        // Sort by impact and take top candidates
        scoredFences.sort((a, b) => b.impact - a.impact);
        const topFences = scoredFences.slice(0, 15);

        for (const move of topFences) {
            const newFences = [...testFences, { x: move.x, y: move.y, orientation: move.orientation }];
            const newCounts = { ...testFencesCounts };
            newCounts[aiPlayer]--;

            const score = minimax(testPawns, newFences, newCounts, depth - 1, -Infinity, Infinity, false);

            if (score > bestScore) {
                bestScore = score;
                bestMove = { type: 'fence', x: move.x, y: move.y, orientation: move.orientation };
            }
        }
    }

    return bestMove;
}

// Execute the AI's move
function makeAIMove() {
    if (gameOver || currentPlayer !== aiPlayer) return;

    const bestMove = findBestMove();

    if (!bestMove) {
        console.error('AI could not find a valid move!');
        return;
    }

    if (bestMove.type === 'move') {
        // Make the pawn move
        pawns[aiPlayer] = { x: bestMove.x, y: bestMove.y };
        updatePawnPositions();

        if (!checkWin()) {
            switchPlayer();
        }
    } else if (bestMove.type === 'fence') {
        // Place the fence
        if (placeFence(bestMove.x, bestMove.y, bestMove.orientation)) {
            if (!checkWin()) {
                switchPlayer();
            }
        } else {
            // Fallback: just move if fence placement fails
            const moves = getValidMoves(aiPlayer);
            if (moves.length > 0) {
                const move = moves[0];
                pawns[aiPlayer] = { x: move.x, y: move.y };
                updatePawnPositions();
                if (!checkWin()) {
                    switchPlayer();
                }
            }
        }
    }
}

// ==================== TRAINING MODE ====================

function toggleTrain() {
    trainEnabled = !trainEnabled;
    const btn = document.getElementById('train-btn');

    if (trainEnabled) {
        btn.textContent = '🎓 Train: On';
        btn.classList.add('active');
        // Show proposal for current player if it's Player 1's turn
        if (currentPlayer === 1 && !gameOver) {
            showTrainProposal();
        }
    } else {
        btn.textContent = '🎓 Train';
        btn.classList.remove('active');
        clearTrainProposal();
    }
}

function showTrainProposal() {
    if (!trainEnabled || currentPlayer !== 1 || gameOver) {
        clearTrainProposal();
        return;
    }

    // Clear previous proposal
    clearTrainProposal();

    // Find the best move for Player 1 using the same AI logic
    const bestMove = findBestMoveForPlayer(1);

    if (!bestMove) return;

    const boardOffset = -(BOARD_SIZE * CELL_SIZE) / 2 + CELL_SIZE / 2;

    if (bestMove.type === 'move') {
        // Show outlined/transparent highlight for the suggested move position
        const geometry = new THREE.RingGeometry(0.25, 0.4, 32);
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(geometry, material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(
            boardOffset + bestMove.x * CELL_SIZE,
            0.15,
            boardOffset + bestMove.y * CELL_SIZE
        );
        trainProposalGroup.add(ring);

        // Add pulsing animation indicator (a second ring)
        const outerGeometry = new THREE.RingGeometry(0.35, 0.45, 32);
        const outerMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        const outerRing = new THREE.Mesh(outerGeometry, outerMaterial);
        outerRing.rotation.x = -Math.PI / 2;
        outerRing.position.set(
            boardOffset + bestMove.x * CELL_SIZE,
            0.14,
            boardOffset + bestMove.y * CELL_SIZE
        );
        trainProposalGroup.add(outerRing);

    } else if (bestMove.type === 'fence') {
        // Show transparent fence preview
        let fenceGeometry;
        if (bestMove.orientation === 'h') {
            fenceGeometry = new THREE.BoxGeometry(FENCE_LENGTH, FENCE_HEIGHT, FENCE_THICKNESS);
        } else {
            fenceGeometry = new THREE.BoxGeometry(FENCE_THICKNESS, FENCE_HEIGHT, FENCE_LENGTH);
        }

        const fenceMaterial = new THREE.MeshStandardMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.4,
            emissive: 0x00ff00,
            emissiveIntensity: 0.2
        });

        const fenceMesh = new THREE.Mesh(fenceGeometry, fenceMaterial);
        fenceMesh.position.set(
            boardOffset + bestMove.x * CELL_SIZE + CELL_SIZE / 2,
            FENCE_HEIGHT / 2,
            boardOffset + bestMove.y * CELL_SIZE + CELL_SIZE / 2
        );
        fenceMesh.castShadow = true;
        trainProposalGroup.add(fenceMesh);

        // Add wireframe outline
        const wireGeometry = new THREE.EdgesGeometry(fenceGeometry);
        const wireMaterial = new THREE.LineBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.8
        });
        const wireframe = new THREE.LineSegments(wireGeometry, wireMaterial);
        wireframe.position.copy(fenceMesh.position);
        trainProposalGroup.add(wireframe);
    }
}

function clearTrainProposal() {
    while (trainProposalGroup.children.length > 0) {
        trainProposalGroup.remove(trainProposalGroup.children[0]);
    }
}

// Find best move for a specific player (used for training mode)
function findBestMoveForPlayer(player) {
    const testPawns = {
        1: { ...pawns[1] },
        2: { ...pawns[2] }
    };
    const testFences = [...placedFences];
    const testFencesCounts = { ...fences };

    let bestMove = null;
    let bestScore = -Infinity;
    const depth = 3;

    // Evaluate pawn moves
    const moveMoves = getValidMovesTest(player, testPawns, testFences);
    for (const move of moveMoves) {
        const newPawns = {
            1: { ...testPawns[1] },
            2: { ...testPawns[2] }
        };
        newPawns[player] = { x: move.x, y: move.y };

        // Check for immediate win
        const goalY = player === 1 ? 8 : 0;
        if (move.y === goalY) {
            return { type: 'move', x: move.x, y: move.y };
        }

        const score = minimaxForPlayer(player, newPawns, testFences, testFencesCounts, depth - 1, -Infinity, Infinity, false);

        if (score > bestScore) {
            bestScore = score;
            bestMove = { type: 'move', x: move.x, y: move.y };
        }
    }

    // Evaluate fence moves
    if (testFencesCounts[player] > 0) {
        const fenceMoves = generateFenceMovesForPlayer(player, testFences, testPawns, testFencesCounts);

        const scoredFences = fenceMoves.map(move => {
            const newFences = [...testFences, { x: move.x, y: move.y, orientation: move.orientation }];
            const oppPlayer = player === 1 ? 2 : 1;
            const oppDistBefore = getShortestPathDistance(oppPlayer, testPawns, testFences);
            const oppDistAfter = getShortestPathDistance(oppPlayer, testPawns, newFences);
            return { ...move, impact: oppDistAfter - oppDistBefore };
        });

        scoredFences.sort((a, b) => b.impact - a.impact);
        const topFences = scoredFences.slice(0, 15);

        for (const move of topFences) {
            const newFences = [...testFences, { x: move.x, y: move.y, orientation: move.orientation }];
            const newCounts = { ...testFencesCounts };
            newCounts[player]--;

            const score = minimaxForPlayer(player, testPawns, newFences, newCounts, depth - 1, -Infinity, Infinity, false);

            if (score > bestScore) {
                bestScore = score;
                bestMove = { type: 'fence', x: move.x, y: move.y, orientation: move.orientation };
            }
        }
    }

    return bestMove;
}

// Minimax for any player (for training mode)
function minimaxForPlayer(player, testPawns, testFences, testFencesCounts, depth, alpha, beta, isMaximizing) {
    const oppPlayer = player === 1 ? 2 : 1;

    // Check for terminal states
    if (testPawns[player].y === (player === 1 ? 8 : 0)) {
        return 1000 + depth;
    }
    if (testPawns[oppPlayer].y === (oppPlayer === 1 ? 8 : 0)) {
        return -1000 - depth;
    }

    if (depth === 0) {
        const playerDist = getShortestPathDistance(player, testPawns, testFences);
        const oppDist = getShortestPathDistance(oppPlayer, testPawns, testFences);
        return oppDist - playerDist;
    }

    const currentTurnPlayer = isMaximizing ? player : oppPlayer;
    const moves = getValidMovesTest(currentTurnPlayer, testPawns, testFences);

    if (isMaximizing) {
        let maxEval = -Infinity;
        for (const move of moves) {
            const newPawns = {
                1: { ...testPawns[1] },
                2: { ...testPawns[2] }
            };
            newPawns[currentTurnPlayer] = { x: move.x, y: move.y };
            const evalScore = minimaxForPlayer(player, newPawns, testFences, testFencesCounts, depth - 1, alpha, beta, false);
            maxEval = Math.max(maxEval, evalScore);
            alpha = Math.max(alpha, evalScore);
            if (beta <= alpha) break;
        }
        return maxEval;
    } else {
        let minEval = Infinity;
        for (const move of moves) {
            const newPawns = {
                1: { ...testPawns[1] },
                2: { ...testPawns[2] }
            };
            newPawns[currentTurnPlayer] = { x: move.x, y: move.y };
            const evalScore = minimaxForPlayer(player, newPawns, testFences, testFencesCounts, depth - 1, alpha, beta, true);
            minEval = Math.min(minEval, evalScore);
            beta = Math.min(beta, evalScore);
            if (beta <= alpha) break;
        }
        return minEval;
    }
}

// Generate fence moves for a specific player
function generateFenceMovesForPlayer(player, testFences, testPawns, testFencesCounts) {
    const fenceMoves = [];
    const oppPlayer = player === 1 ? 2 : 1;
    const oppPath = getPathToGoal(oppPlayer, testPawns, testFences);

    for (let x = 0; x < BOARD_SIZE - 1; x++) {
        for (let y = 0; y < BOARD_SIZE - 1; y++) {
            for (const orientation of ['h', 'v']) {
                if (canPlaceFenceTest(x, y, orientation, testFences, testPawns)) {
                    let isNearPath = false;
                    if (oppPath) {
                        for (const cell of oppPath) {
                            if (Math.abs(cell.x - x) <= 1 && Math.abs(cell.y - y) <= 1) {
                                isNearPath = true;
                                break;
                            }
                        }
                    }

                    const nearOpp = Math.abs(testPawns[oppPlayer].x - x) <= 2 &&
                                   Math.abs(testPawns[oppPlayer].y - y) <= 2;

                    if (isNearPath || nearOpp) {
                        fenceMoves.push({ x, y, orientation });
                    }
                }
            }
        }
    }

    if (fenceMoves.length === 0) {
        for (let x = 0; x < BOARD_SIZE - 1; x++) {
            for (let y = 0; y < BOARD_SIZE - 1; y++) {
                for (const orientation of ['h', 'v']) {
                    if (canPlaceFenceTest(x, y, orientation, testFences, testPawns)) {
                        fenceMoves.push({ x, y, orientation });
                    }
                }
            }
        }
    }

    return fenceMoves;
}

// Get path to goal for a player (for fence placement strategy)
function getPathToGoal(player, testPawns, testFences) {
    const goalY = player === 1 ? 8 : 0;
    const start = { x: testPawns[player].x, y: testPawns[player].y };
    const visited = new Set();
    const queue = [{ ...start, path: [start] }];

    while (queue.length > 0) {
        const current = queue.shift();
        const key = `${current.x},${current.y}`;

        if (visited.has(key)) continue;
        visited.add(key);

        if (current.y === goalY) return current.path;

        const directions = [
            { dx: 0, dy: player === 1 ? 1 : -1 }, // Prefer forward
            { dx: 1, dy: 0 },
            { dx: -1, dy: 0 },
            { dx: 0, dy: player === 1 ? -1 : 1 }
        ];

        for (const dir of directions) {
            const newX = current.x + dir.dx;
            const newY = current.y + dir.dy;

            if (newX >= 0 && newX < BOARD_SIZE && newY >= 0 && newY < BOARD_SIZE &&
                !isFenceBlockingTest(current.x, current.y, newX, newY, testFences)) {
                queue.push({ x: newX, y: newY, path: [...current.path, { x: newX, y: newY }] });
            }
        }
    }

    return null;
}
