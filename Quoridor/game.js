"use strict";

// Game constants
const BOARD_SIZE = 9;
const CELL_SIZE = 1;
const FENCE_THICKNESS = 0.1;
const FENCE_HEIGHT = 0.5;
const FENCE_LENGTH = 1.85; // Slightly shorter than 2 cells to show gaps between fences
const PAWN_RADIUS = 0.3;
const PAWN_HEIGHT = 0.6;

// Local Storage Keys
const STORAGE_KEYS = {
    VIEW_MODE: 'quoridor_viewMode',
    AI_ENABLED: 'quoridor_aiEnabled',
    TRAIN_ENABLED: 'quoridor_trainEnabled',
    INTRO_SHOWN: 'quoridor_introShown',
    PANEL_LEFT_OPEN: 'quoridor_panelLeftOpen',
    PANEL_RIGHT_OPEN: 'quoridor_panelRightOpen',
    PANEL_TOP_OPEN: 'quoridor_panelTopOpen'
};

// Load settings from Local Storage
function loadSettings() {
    const savedViewMode = localStorage.getItem(STORAGE_KEYS.VIEW_MODE);
    if (savedViewMode) {
        viewMode = savedViewMode;
    }

    const savedAiEnabled = localStorage.getItem(STORAGE_KEYS.AI_ENABLED);
    if (savedAiEnabled !== null) {
        aiEnabled = savedAiEnabled === 'true';
    }

    const savedTrainEnabled = localStorage.getItem(STORAGE_KEYS.TRAIN_ENABLED);
    if (savedTrainEnabled !== null) {
        trainEnabled = savedTrainEnabled === 'true';
    }
}

// Save a setting to Local Storage
function saveSetting(key, value) {
    localStorage.setItem(key, value);
}

// Check if intro should be shown
function shouldShowIntro() {
    return localStorage.getItem(STORAGE_KEYS.INTRO_SHOWN) !== 'true';
}

// Mark intro as shown
function markIntroAsShown() {
    localStorage.setItem(STORAGE_KEYS.INTRO_SHOWN, 'true');
}

// Game state
let currentPlayer = 1;
let fences = {1: 10, 2: 10};
let pawns = {
    1: {x: 4, y: 0}, 2: {x: 4, y: 8}
};
let placedFences = []; // { x, y, orientation: 'h' | 'v' }
let gameOver = false;

// Position history to prevent back-and-forth movement
let positionHistory = {
    1: [{x: 4, y: 0}],  // Player 1 starts at y=0
    2: [{x: 4, y: 8}]   // Player 2 starts at y=8
};

// AI state
let aiEnabled = false;
let aiPlayer = 2; // AI plays as Player 2
let aiThinking = false;
let aiWorker = null; // Web Worker for AI calculations
let assistWorker = null; // Web Worker for Assist calculations
let workersAvailable = false; // Flag for worker availability
let workerBlobURL = null; // Cached blob URL for workers

// Create worker from serialized functions (avoids code duplication)
function createWorkerBlobURL() {
    if (workerBlobURL) return workerBlobURL;

    // Serialize existing functions to create worker code
    const workerCode = `
"use strict";
const BOARD_SIZE = 9;

self.onmessage = function(e) {
    const { type, data } = e.data;
    if (type === 'calculate') {
        const { player, pawns, placedFences, fences, positionHistory, calculationId } = data;
        try {
            const bestMove = findBestMoveForPlayer(player, pawns, placedFences, fences, positionHistory);
            self.postMessage({ type: 'result', bestMove, data: { calculationId } });
        } catch (error) {
            self.postMessage({ type: 'error', error: error.message, data: { calculationId } });
        }
    }
};

// Serialized functions from game.js
${findBestMoveForPlayer.toString()}
${minimaxForPlayer.toString()}
${evaluateStateForPlayer.toString()}
${generateFenceMovesForPlayer.toString()}
${getShortestPathDistance.toString()}
${getShortestPath.toString()}
${isFenceBlockingTest.toString()}
${hasPathToGoalTest.toString()}
${canPlaceFenceTest.toString()}
${getValidMovesTest.toString()}
`;

    const blob = new Blob([workerCode], {type: 'application/javascript'});
    workerBlobURL = URL.createObjectURL(blob);
    return workerBlobURL;
}

// Initialize AI Worker - uses serialized functions as blob worker
function initAIWorker() {
    if (typeof Worker === 'undefined') {
        workersAvailable = false;
        return;
    }

    try {
        const blobURL = createWorkerBlobURL();
        aiWorker = new Worker(blobURL);
        aiWorker.onmessage = handleAIWorkerMessage;
        aiWorker.onerror = (e) => {
            console.warn('AI Worker failed, using synchronous fallback');
            aiWorker = null;
            workersAvailable = false;
        };
        workersAvailable = true;
    } catch (e) {
        console.warn('Web Workers not available, using synchronous calculation');
        workersAvailable = false;
        aiWorker = null;
    }
}

// Initialize Assist Worker
function initAssistWorker() {
    if (typeof Worker === 'undefined' || !workersAvailable) {
        return;
    }

    try {
        const blobURL = createWorkerBlobURL();
        assistWorker = new Worker(blobURL);
        assistWorker.onmessage = handleAssistWorkerMessage;
        assistWorker.onerror = (e) => {
            console.warn('Assist Worker failed, using synchronous fallback');
            assistWorker = null;
        };
    } catch (e) {
        assistWorker = null;
    }
}

// Handle AI Worker response
function handleAIWorkerMessage(e) {
    const {type, bestMove, error} = e.data;

    if (type === 'result' && bestMove && aiThinking) {
        executeAIMove(bestMove);
    } else if (type === 'error') {
        console.error('AI Worker calculation error:', error);
    }

    aiThinking = false;
    hideAIThinkingIndicator();
}

// Handle Assist Worker response
function handleAssistWorkerMessage(e) {
    const {type, bestMove, error} = e.data;

    // Only process if this is still for the current calculation
    // (player might have moved before calculation finished)
    if (assistCalculationPlayer !== currentPlayer) {
        return;
    }

    // Only hide the indicator, don't reset assistCalculationPlayer yet
    hideCurrentPlayerThinkingIndicator();
    assistCalculationPlayer = null;

    if (type === 'result' && bestMove) {
        displayTrainProposal(bestMove);
    } else if (type === 'error') {
        console.error('Assist Worker calculation error:', error);
    }
}

// Cancel any pending AI/Assist calculations
function cancelPendingCalculations() {

    // Terminate and recreate workers to cancel pending calculations
    if (aiWorker && workersAvailable) {
        aiWorker.terminate();
        initAIWorker();
    }
    if (assistWorker && workersAvailable) {
        assistWorker.terminate();
        initAssistWorker();
    }
    aiThinking = false;
    assistCalculationPlayer = null;
    hideAIThinkingIndicator();
    hideCurrentPlayerThinkingIndicator();
    clearTrainProposal();
}

// Start AI calculation - uses worker if available, otherwise sync fallback
function startAICalculation() {
    // Check if we should use MCTS AI
    if (useMCTSAI) {
        // Use MCTS AI (synchronous but more powerful)
        setTimeout(() => {
            const bestMove = findBestMoveMCTS(aiPlayer);
            aiThinking = false;
            hideAIThinkingIndicator();
            if (bestMove) {
                executeAIMove(bestMove);
            }
        }, 50);
        return;
    }

    if (aiWorker && workersAvailable) {
        // Use Web Worker (non-blocking)
        aiWorker.postMessage({
            type: 'calculate', data: {
                player: aiPlayer,
                pawns: {1: {...pawns[1]}, 2: {...pawns[2]}},
                placedFences: [...placedFences],
                fences: {...fences},
                positionHistory: {
                    1: [...positionHistory[1]],
                    2: [...positionHistory[2]]
                }
            }
        });
    } else {
        // Synchronous fallback - use setTimeout to allow UI to update
        setTimeout(() => {
            const bestMove = findBestMoveForPlayer(aiPlayer, null, null, null, positionHistory);
            aiThinking = false;
            hideAIThinkingIndicator();
            if (bestMove) {
                executeAIMove(bestMove);
            }
        }, 50);
    }
}

// Start Assist calculation - uses worker if available, otherwise sync fallback
function startAssistCalculation() {
    // Track which player this calculation is for
    assistCalculationPlayer = currentPlayer;

    showCurrentPlayerThinkingIndicator();

    if (assistWorker && workersAvailable) {
        // Use Web Worker (non-blocking)
        assistWorker.postMessage({
            type: 'calculate', data: {
                player: currentPlayer,
                pawns: {1: {...pawns[1]}, 2: {...pawns[2]}},
                placedFences: [...placedFences],
                fences: {...fences},
                positionHistory: {
                    1: [...positionHistory[1]],
                    2: [...positionHistory[2]]
                }
            }
        });
    } else {
        // Synchronous fallback - use setTimeout to allow UI to update
        setTimeout(() => {
            // Check if this calculation is still valid
            if (assistCalculationPlayer !== currentPlayer) return;

            const bestMove = findBestMoveForPlayer(currentPlayer, null, null, null, positionHistory);
            hideCurrentPlayerThinkingIndicator();
            assistCalculationPlayer = null;
            if (bestMove) {
                displayTrainProposal(bestMove);
            }
        }, 50);
    }
}

// Show AI thinking indicator (pulsating green icon)
function showAIThinkingIndicator() {
    const player2Name = document.getElementById('player2-name');
    const topPlayer2Name = document.getElementById('top-player2-name');

    if (player2Name) {
        player2Name.classList.add('ai-thinking');
    }
    if (topPlayer2Name) {
        topPlayer2Name.classList.add('ai-thinking');
    }
    // Show pulsating ring around AI player's pawn
    showThinkingRing(aiPlayer);
}

// Hide AI thinking indicator
function hideAIThinkingIndicator() {
    const player2Name = document.getElementById('player2-name');
    const topPlayer2Name = document.getElementById('top-player2-name');

    if (player2Name) {
        player2Name.classList.remove('ai-thinking');
    }
    if (topPlayer2Name) {
        topPlayer2Name.classList.remove('ai-thinking');
    }
    // Hide pulsating ring for AI player (Player 2)
    hideThinkingRing(aiPlayer);
}

// Show Player 1 thinking indicator (for Assist mode)
function showPlayer1ThinkingIndicator() {
    const player1Name = document.getElementById('player1-name');
    if (player1Name) {
        player1Name.classList.add('ai-thinking');
    }
}

// Hide Player 1 thinking indicator
function hidePlayer1ThinkingIndicator() {
    const player1Name = document.getElementById('player1-name');
    if (player1Name) {
        player1Name.classList.remove('ai-thinking');
    }
}

// Show Player 2 thinking indicator (for Assist mode when AI is off)
function showPlayer2ThinkingIndicator() {
    const player2Name = document.getElementById('player2-name');
    const topPlayer2Name = document.getElementById('top-player2-name');
    if (player2Name) {
        player2Name.classList.add('ai-thinking');
    }
    if (topPlayer2Name) {
        topPlayer2Name.classList.add('ai-thinking');
    }
}

// Hide Player 2 thinking indicator
function hidePlayer2ThinkingIndicator() {
    const player2Name = document.getElementById('player2-name');
    const topPlayer2Name = document.getElementById('top-player2-name');
    if (player2Name) {
        player2Name.classList.remove('ai-thinking');
    }
    if (topPlayer2Name) {
        topPlayer2Name.classList.remove('ai-thinking');
    }
}

// Show/hide thinking indicator for current player
function showCurrentPlayerThinkingIndicator() {
    if (currentPlayer === 1) {
        showPlayer1ThinkingIndicator();
    } else {
        showPlayer2ThinkingIndicator();
    }
    // Show pulsating ring around the current player's pawn
    showThinkingRing(currentPlayer);
}

function hideCurrentPlayerThinkingIndicator() {
    // Hide CSS indicators for both players (in case currentPlayer changed)
    hidePlayer1ThinkingIndicator();
    hidePlayer2ThinkingIndicator();
    // Hide pulsating ring
    hideThinkingRing(currentPlayer);
}

// Show pulsating ring around pawn while calculating
function showThinkingRing(player) {
    // Safety check - ensure scene and pawns exist
    if (!scene || !pawn1Mesh || !pawn2Mesh) return;

    // Remove existing ring for this player only
    hideThinkingRing(player);

    const pawnMesh = player === 1 ? pawn1Mesh : pawn2Mesh;

    // Create small ring at the bottom of the pawn
    const ringGeometry = new THREE.TorusGeometry(PAWN_RADIUS * 0.9, 0.03, 8, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ff00,  // Green color
        transparent: true,
        opacity: 0.8
    });

    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2; // Lay flat
    ring.position.set(
        pawnMesh.position.x,
        0.08,  // Just above board at pawn base
        pawnMesh.position.z
    );
    ring.renderOrder = 10;

    // Store in player-specific variable
    if (player === 1) {
        thinkingRing1 = ring;
        thinkingRingAnimationStart1 = Date.now();
    } else {
        thinkingRing2 = ring;
        thinkingRingAnimationStart2 = Date.now();
    }

    scene.add(ring);
}

// Hide pulsating ring for a specific player (or both if no player specified)
function hideThinkingRing(player) {
    if (player === undefined || player === 1) {
        if (thinkingRing1 && scene) {
            scene.remove(thinkingRing1);
            if (thinkingRing1.geometry) thinkingRing1.geometry.dispose();
            if (thinkingRing1.material) thinkingRing1.material.dispose();
            thinkingRing1 = null;
        }
    }
    if (player === undefined || player === 2) {
        if (thinkingRing2 && scene) {
            scene.remove(thinkingRing2);
            if (thinkingRing2.geometry) thinkingRing2.geometry.dispose();
            if (thinkingRing2.material) thinkingRing2.material.dispose();
            thinkingRing2 = null;
        }
    }
}

// Update thinking ring animation (called in animate loop)
function updateThinkingRingAnimation() {
    const pulseDuration = 800; // Same as CSS animation

    // Update Player 1 ring
    if (thinkingRing1 && thinkingRing1.material) {
        const elapsed1 = Date.now() - thinkingRingAnimationStart1;
        const progress1 = (elapsed1 % pulseDuration) / pulseDuration;
        const scale1 = 1.0 + Math.sin(progress1 * Math.PI * 2) * 0.10 + 0.10;
        thinkingRing1.scale.set(scale1, scale1, scale1);
        thinkingRing1.material.opacity = 0.5 + Math.sin(progress1 * Math.PI * 2) * 0.2 + 0.2;

        // Update position to follow pawn
        if (pawn1Mesh) {
            thinkingRing1.position.x = pawn1Mesh.position.x;
            thinkingRing1.position.z = pawn1Mesh.position.z;
        }
    }

    // Update Player 2 ring
    if (thinkingRing2 && thinkingRing2.material) {
        const elapsed2 = Date.now() - thinkingRingAnimationStart2;
        const progress2 = (elapsed2 % pulseDuration) / pulseDuration;
        const scale2 = 1.0 + Math.sin(progress2 * Math.PI * 2) * 0.10 + 0.10;
        thinkingRing2.scale.set(scale2, scale2, scale2);
        thinkingRing2.material.opacity = 0.5 + Math.sin(progress2 * Math.PI * 2) * 0.2 + 0.2;

        // Update position to follow pawn
        if (pawn2Mesh) {
            thinkingRing2.position.x = pawn2Mesh.position.x;
            thinkingRing2.position.z = pawn2Mesh.position.z;
        }
    }
}

// Training mode state
let trainEnabled = false;
let trainProposalGroup = null;

// Assist calculation tracking
let assistCalculationPlayer = null; // Track which player the assist is calculating for

// Pulsating ring state for thinking indicator - separate for each player
let thinkingRing1 = null; // Ring for Player 1
let thinkingRing2 = null; // Ring for Player 2
let thinkingRingAnimationStart1 = 0;
let thinkingRingAnimationStart2 = 0;

// View mode state
let viewMode = '3d'; // '3d' or 'top'
let isAnimatingView = false;
let animationStartTime = 0;
const VIEW_ANIMATION_DURATION = 800; // ms

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
    // Initialize Web Workers for AI calculations
    initAIWorker();
    initAssistWorker();

    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    // Camera setup
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 8.1, -8.1);
    camera.lookAt(0, 0, 0);

    // Renderer setup
    renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('game-container').appendChild(renderer.domElement);

    // Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = true;
    controls.minDistance = 10;
    controls.maxDistance = 30;
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.enablePan = false;
    controls.target.set(0, 0, 0);

    // Intercept pointer events before OrbitControls can process them
    // This must be done right after OrbitControls is created
    const gameContainer = document.getElementById('game-container');
    gameContainer.addEventListener('pointerdown', onPointerDownForHighlight, true);
    gameContainer.addEventListener('pointerup', onPointerUpForHighlight, true);
    gameContainer.addEventListener('pointermove', onPointerMoveForHighlight, true);
    gameContainer.addEventListener('pointercancel', onPointerCancelForHighlight, true);
    gameContainer.addEventListener('pointerleave', onPointerCancelForHighlight, true);

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
    window.addEventListener('keydown', onKeyDown);

    // Touch event listeners for mobile (for tap detection and move handling)
    renderer.domElement.addEventListener('touchstart', onTouchStart, {passive: false});
    renderer.domElement.addEventListener('touchmove', onTouchMove, {passive: false});
    renderer.domElement.addEventListener('touchend', onTouchEnd, {passive: false});

    // Drag & Drop event listeners
    setupDragAndDrop();

    // UI buttons
    document.getElementById('restart-btn').addEventListener('click', restartGame);

    // Winner modal close button
    document.getElementById('winner-close-btn').addEventListener('click', closeWinnerModal);

    // AI toggle button
    document.getElementById('ai-btn').addEventListener('click', toggleAI);

    // Switch button - switches starting player
    document.getElementById('switch-btn').addEventListener('click', toggleP2First);

    // Train toggle button
    document.getElementById('train-btn').addEventListener('click', toggleTrain);

    // View toggle button
    document.getElementById('view-btn').addEventListener('click', toggleView);

    // Load saved settings from Local Storage
    loadSettings();

    // Apply loaded settings to UI
    applyLoadedSettings();

    // Initialize UI state (including fence panel transparency)
    updateUI();

    // Set initial camera position based on screen size and loaded view mode
    if (viewMode === 'top') {
        setTopView();
    } else {
        set3DView();
    }

    // Update layout classes for panel positioning on mobile devices
    updateMobileLayoutClass();
}

// Apply loaded settings to UI elements
function applyLoadedSettings() {
    // Apply AI setting
    const aiBtn = document.getElementById('ai-btn');
    if (aiEnabled) {
        aiBtn.textContent = '🤖 AI On';
        aiBtn.classList.add('active');
        // Keep icon in span for pulsating animation
        document.getElementById('player1-name').innerHTML = '<span class="player-icon">🔴</span> Player';
        document.getElementById('player2-name').innerHTML = '<span class="player-icon">🟢</span> AI';
        document.getElementById('top-player2-name').innerHTML = '<span class="player-icon">🟢</span> AI';
    }

    // Apply Train/Assist setting
    const trainBtn = document.getElementById('train-btn');
    if (trainEnabled) {
        trainBtn.textContent = '🎓 Assist On';
        trainBtn.classList.add('active');
        // Show train proposal if it's Player 1's turn
        if (currentPlayer === 1 && !gameOver) {
            setTimeout(() => {
                showTrainProposal();
            }, 100);
        }
    }

    // Apply View setting
    const viewBtn = document.getElementById('view-btn');
    if (viewMode === 'top') {
        viewBtn.textContent = '👁️ View Top';
        viewBtn.classList.add('active');
    }
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
    const baseMaterial = new THREE.MeshStandardMaterial({color: 0x2d2d44});
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

            const cellMaterial = new THREE.MeshStandardMaterial({color: cellColor});
            const cell = new THREE.Mesh(cellGeometry, cellMaterial);
            cell.position.set(boardOffset + x * CELL_SIZE, 0, boardOffset + y * CELL_SIZE);
            cell.receiveShadow = true;
            cell.userData = {type: 'cell', x, y};
            boardGroup.add(cell);
        }
    }

    // Create fence slots (for visual reference and interaction)
    for (let x = 0; x < BOARD_SIZE - 1; x++) {
        for (let y = 0; y < BOARD_SIZE - 1; y++) {
            // Horizontal fence slot
            const hSlotGeometry = new THREE.BoxGeometry(FENCE_LENGTH, 0.02, FENCE_THICKNESS);
            const hSlotMaterial = new THREE.MeshBasicMaterial({color: 0x222244, transparent: true, opacity: 0.3});
            const hSlot = new THREE.Mesh(hSlotGeometry, hSlotMaterial);
            hSlot.position.set(boardOffset + x * CELL_SIZE + CELL_SIZE / 2, 0.02, boardOffset + y * CELL_SIZE + CELL_SIZE / 2);
            hSlot.userData = {type: 'fenceSlot', x, y, orientation: 'h'};
            boardGroup.add(hSlot);

            // Vertical fence slot
            const vSlotGeometry = new THREE.BoxGeometry(FENCE_THICKNESS, 0.02, FENCE_LENGTH);
            const vSlotMaterial = new THREE.MeshBasicMaterial({color: 0x222244, transparent: true, opacity: 0.3});
            const vSlot = new THREE.Mesh(vSlotGeometry, vSlotMaterial);
            vSlot.position.set(boardOffset + x * CELL_SIZE + CELL_SIZE / 2, 0.02, boardOffset + y * CELL_SIZE + CELL_SIZE / 2);
            vSlot.userData = {type: 'fenceSlot', x, y, orientation: 'v'};
            boardGroup.add(vSlot);
        }
    }
}

function createPawns() {
    const boardOffset = -(BOARD_SIZE * CELL_SIZE) / 2 + CELL_SIZE / 2;

    // Player 1 pawn (red)
    const pawn1Geometry = new THREE.CylinderGeometry(PAWN_RADIUS * 0.7, PAWN_RADIUS, PAWN_HEIGHT, 32);
    const pawn1Material = new THREE.MeshStandardMaterial({
        color: 0xff6b6b, metalness: 0.3, roughness: 0.4
    });
    pawn1Mesh = new THREE.Mesh(pawn1Geometry, pawn1Material);
    pawn1Mesh.position.set(boardOffset + pawns[1].x * CELL_SIZE, PAWN_HEIGHT / 2 + 0.05, boardOffset + pawns[1].y * CELL_SIZE);
    pawn1Mesh.castShadow = true;
    pawn1Mesh.userData = {type: 'pawn', player: 1};
    pawnsGroup.add(pawn1Mesh);

    // Player 2 pawn (cyan)
    const pawn2Geometry = new THREE.CylinderGeometry(PAWN_RADIUS * 0.7, PAWN_RADIUS, PAWN_HEIGHT, 32);
    const pawn2Material = new THREE.MeshStandardMaterial({
        color: 0x4ecdc4, metalness: 0.3, roughness: 0.4
    });
    pawn2Mesh = new THREE.Mesh(pawn2Geometry, pawn2Material);
    pawn2Mesh.position.set(boardOffset + pawns[2].x * CELL_SIZE, PAWN_HEIGHT / 2 + 0.05, boardOffset + pawns[2].y * CELL_SIZE);
    pawn2Mesh.castShadow = true;
    pawn2Mesh.userData = {type: 'pawn', player: 2};
    pawnsGroup.add(pawn2Mesh);
}

function updatePawnPositions() {
    const boardOffset = -(BOARD_SIZE * CELL_SIZE) / 2 + CELL_SIZE / 2;

    pawn1Mesh.position.set(boardOffset + pawns[1].x * CELL_SIZE, PAWN_HEIGHT / 2 + 0.05, boardOffset + pawns[1].y * CELL_SIZE);

    pawn2Mesh.position.set(boardOffset + pawns[2].x * CELL_SIZE, PAWN_HEIGHT / 2 + 0.05, boardOffset + pawns[2].y * CELL_SIZE);
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

    const directions = [{dx: 0, dy: 1},  // forward (relative)
        {dx: 0, dy: -1}, // backward
        {dx: 1, dy: 0},  // right
        {dx: -1, dy: 0}  // left
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
            if (jumpX >= 0 && jumpX < BOARD_SIZE && jumpY >= 0 && jumpY < BOARD_SIZE && !isFenceBlocking(newX, newY, jumpX, jumpY)) {
                moves.push({x: jumpX, y: jumpY});
            } else {
                // Can't jump straight, try diagonal
                const sideDirs = dir.dx === 0 ? [{dx: 1, dy: 0}, {dx: -1, dy: 0}] : [{dx: 0, dy: 1}, {dx: 0, dy: -1}];

                for (const sideDir of sideDirs) {
                    const sideX = newX + sideDir.dx;
                    const sideY = newY + sideDir.dy;
                    if (sideX >= 0 && sideX < BOARD_SIZE && sideY >= 0 && sideY < BOARD_SIZE && !isFenceBlocking(newX, newY, sideX, sideY)) {
                        moves.push({x: sideX, y: sideY});
                    }
                }
            }
        } else {
            moves.push({x: newX, y: newY});
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

    // Don't show highlights when AI is enabled and it's AI's turn
    if (aiEnabled && currentPlayer === aiPlayer) return;

    validMoves = getValidMoves(currentPlayer);
    const boardOffset = -(BOARD_SIZE * CELL_SIZE) / 2 + CELL_SIZE / 2;

    for (const move of validMoves) {
        const highlightGeometry = new THREE.BoxGeometry(CELL_SIZE * 0.8, 0.05, CELL_SIZE * 0.8);
        const highlightMaterial = new THREE.MeshBasicMaterial({
            color: currentPlayer === 1 ? 0xff6b6b : 0x4ecdc4, transparent: true, opacity: 0.5
        });
        const highlight = new THREE.Mesh(highlightGeometry, highlightMaterial);
        highlight.position.set(boardOffset + move.x * CELL_SIZE, 0.1, boardOffset + move.y * CELL_SIZE);
        highlight.userData = {type: 'moveHighlight', x: move.x, y: move.y};
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
    placedFences.push({x, y, orientation});

    const player1HasPath = hasPathToGoal(1);
    const player2HasPath = hasPathToGoal(2);

    // Remove temporary fence
    placedFences.pop();

    return player1HasPath && player2HasPath;
}

function hasPathToGoal(player) {
    const goalY = player === 1 ? 8 : 0;
    const start = {x: pawns[player].x, y: pawns[player].y};
    const visited = new Set();
    const queue = [start];

    while (queue.length > 0) {
        const current = queue.shift();
        const key = `${current.x},${current.y}`;

        if (visited.has(key)) continue;
        visited.add(key);

        if (current.y === goalY) return true;

        const directions = [{dx: 0, dy: 1}, {dx: 0, dy: -1}, {dx: 1, dy: 0}, {dx: -1, dy: 0}];

        for (const dir of directions) {
            const newX = current.x + dir.dx;
            const newY = current.y + dir.dy;

            if (newX >= 0 && newX < BOARD_SIZE && newY >= 0 && newY < BOARD_SIZE && !isFenceBlocking(current.x, current.y, newX, newY)) {
                queue.push({x: newX, y: newY});
            }
        }
    }

    return false;
}

function placeFence(x, y, orientation) {
    if (!canPlaceFence(x, y, orientation)) return false;
    if (fences[currentPlayer] <= 0) return false;

    placedFences.push({x, y, orientation});
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
        metalness: 0.2, roughness: 0.6
    });
    const fenceMesh = new THREE.Mesh(fenceGeometry, fenceMaterial);
    fenceMesh.position.set(boardOffset + x * CELL_SIZE + CELL_SIZE / 2, FENCE_HEIGHT / 2, boardOffset + y * CELL_SIZE + CELL_SIZE / 2);
    fenceMesh.castShadow = true;
    fencesGroup.add(fenceMesh);

    return true;
}

function movePawn(x, y) {
    const isValid = validMoves.some(m => m.x === x && m.y === y);
    if (!isValid) return false;

    pawns[currentPlayer] = {x, y};
    // Update position history
    positionHistory[currentPlayer].push({x, y});
    // Keep only last 6 positions to save memory
    if (positionHistory[currentPlayer].length > 6) {
        positionHistory[currentPlayer].shift();
    }
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
    let winnerName;
    if (aiEnabled) {
        winnerName = winner === 1 ? 'Player' : 'AI';
    } else {
        winnerName = `Player ${winner}`;
    }

    // Hide all move highlights and disable all fences immediately
    updateValidMoves();
    updateFencePanelState();

    // Delay showing the winner modal so the last move can be seen
    setTimeout(() => {
        document.getElementById('winner-text').textContent = `${winnerName} Wins!`;
        document.getElementById('winner-modal').style.display = 'flex';
    }, 500);
}

function closeWinnerModal() {
    document.getElementById('winner-modal').style.display = 'none';
    // Game stays in read-only mode (gameOver remains true)
    // Ensure all fences are disabled and no move highlights shown
    updateValidMoves();
    updateFencePanelState();
}

function switchPlayer() {
    currentPlayer = currentPlayer === 1 ? 2 : 1;

    // Clear training proposal when player changes
    clearTrainProposal();

    updateUI();
    updateValidMoves();

    // Ensure fence panel state is updated immediately
    updateFencePanelState();

    // Check if AI should make a move
    if (aiEnabled && currentPlayer === aiPlayer && !gameOver && !aiThinking) {
        aiThinking = true;
        showAIThinkingIndicator();
        // Start AI calculation in Web Worker
        startAICalculation();
    } else if (trainEnabled && !gameOver) {
        // Show training proposal for current player (both players when AI is off)
        // Only show for Player 2 if AI is not enabled
        if (currentPlayer === 1 || (currentPlayer === 2 && !aiEnabled)) {
            startAssistCalculation();
        }
    }
}

function updateUI() {

    // Update fence panel counts
    document.getElementById('p1-fence-count').textContent = `${fences[1]} remaining`;
    document.getElementById('p2-fence-count').textContent = `${fences[2]} remaining`;

    // Update top fence panel count (for portrait top view)
    const topP2FenceCount = document.getElementById('top-p2-fence-count');
    if (topP2FenceCount) {
        topP2FenceCount.textContent = `${fences[2]} remaining`;
    }


    // Enable/disable fence elements based on current player and fence count
    updateFencePanelState();

    // Update Switch button state (only enabled at game start)
    updateSwitchButtonState();
}

function updateSwitchButtonState() {
    const switchBtn = document.getElementById('switch-btn');
    const isGameStart = pawns[1].x === 4 && pawns[1].y === 0 && pawns[2].x === 4 && pawns[2].y === 8 && placedFences.length === 0;

    if (isGameStart && !gameOver) {
        switchBtn.disabled = false;
        switchBtn.classList.remove('disabled');
    } else {
        switchBtn.disabled = true;
        switchBtn.classList.add('disabled');
    }
}

function updateFencePanelState() {
    // Get all fence elements (including top panel)
    const p1Fences = document.querySelectorAll('.player1-fence');
    const p2Fences = document.querySelectorAll('.player2-fence');

    // Player 1 fences: enabled when it's Player 1's turn, has fences, and game not over
    const p1Enabled = currentPlayer === 1 && fences[1] > 0 && !gameOver;
    p1Fences.forEach(fence => {
        if (p1Enabled) {
            fence.classList.remove('disabled');
        } else {
            fence.classList.add('disabled');
        }
    });

    // Player 2 fences: enabled when it's Player 2's turn, has fences, game not over, and AI is not controlling
    const isAIPlayer2 = aiEnabled && aiPlayer === 2;
    const p2Enabled = currentPlayer === 2 && fences[2] > 0 && !gameOver && !isAIPlayer2;
    p2Fences.forEach(fence => {
        if (p2Enabled) {
            fence.classList.remove('disabled');
        } else {
            fence.classList.add('disabled');
        }
    });
}

function setupDragAndDrop() {
    const draggableFences = document.querySelectorAll('.draggable-fence');
    const dragPreview = document.getElementById('drag-preview');

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

        // Touch events for mobile - use touchstart with improved handling
        fence.addEventListener('touchstart', (e) => {
            e.stopPropagation(); // Prevent event from bubbling
            const touch = e.touches[0];
            if (startFenceDrag(fence, touch.clientX, touch.clientY)) {
                e.preventDefault();
            }
        }, {passive: false, capture: true});
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

        // Disable OrbitControls during fence dragging
        controls.enabled = false;

        // Hide the original element during drag
        fence.style.opacity = '0.3';


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
    }, {passive: false});

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
    }, {passive: false});

    // Helper function to end fence drag
    function endFenceDrag(clientX, clientY) {
        // Reset drag state first
        isDragging = false;
        dragPreview.style.display = 'none';
        clearPreview();

        // Re-enable OrbitControls after fence dragging (if not in top view)
        if (viewMode !== 'top') {
            controls.enabled = true;
        }

        // Remove inline opacity style so CSS classes can take effect
        document.querySelectorAll('.draggable-fence').forEach(f => {
            f.style.opacity = '';
        });

        // Try to place fence at current position
        const boardPos = getBoardPositionFromMouse(clientX, clientY);

        if (boardPos && placeFence(boardPos.x, boardPos.y, dragOrientation)) {
            // Cancel any pending AI/Assist calculations
            cancelPendingCalculations();

            if (!checkWin()) {
                switchPlayer();
            }
        }

        // Always update valid moves and fence panel state
        updateValidMoves();
        updateFencePanelState();
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

        // Calculate cell position (center of cell as reference)
        const cellX = Math.floor((point.x - boardOffset + CELL_SIZE / 2) / CELL_SIZE);
        const cellY = Math.floor((point.z - boardOffset + CELL_SIZE / 2) / CELL_SIZE);

        // Calculate position within the cell (0 to 1)
        const cellCenterX = boardOffset + cellX * CELL_SIZE;
        const cellCenterY = boardOffset + cellY * CELL_SIZE;
        const offsetInCellX = point.x - cellCenterX;
        const offsetInCellY = point.z - cellCenterY;

        // Determine fence position based on which quadrant of the cell the mouse is in
        // Use the cell's corner closest to the mouse position
        let fx = cellX;
        let fy = cellY;

        // If mouse is in left half of cell, use previous fence column
        if (offsetInCellX < 0) {
            fx = cellX - 1;
        }

        // If mouse is in top half of cell (negative Z), use previous fence row
        if (offsetInCellY < 0) {
            fy = cellY - 1;
        }

        if (fx >= 0 && fx < BOARD_SIZE - 1 && fy >= 0 && fy < BOARD_SIZE - 1) {
            return {x: fx, y: fy};
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

    // Make preview slightly larger than actual fence to avoid z-fighting
    const previewScale = 1.01;
    let fenceGeometry;
    if (orientation === 'h') {
        fenceGeometry = new THREE.BoxGeometry(FENCE_LENGTH * previewScale, FENCE_HEIGHT * previewScale, FENCE_THICKNESS * previewScale);
    } else {
        fenceGeometry = new THREE.BoxGeometry(FENCE_THICKNESS * previewScale, FENCE_HEIGHT * previewScale, FENCE_LENGTH * previewScale);
    }

    const canPlace = canPlaceFence(x, y, orientation) && fences[currentPlayer] > 0;

    // Don't show preview if there's already a fence at this exact position
    const hasExistingFence = placedFences.some(f => f.x === x && f.y === y);
    if (hasExistingFence && !canPlace) {
        return; // Don't render preview over existing fence
    }

    const fenceMaterial = new THREE.MeshStandardMaterial({
        color: canPlace ? 0x00ff00 : 0xff0000, transparent: true, opacity: 0.6, depthWrite: false, // Prevent z-fighting with existing fences
    });
    const fenceMesh = new THREE.Mesh(fenceGeometry, fenceMaterial);
    fenceMesh.renderOrder = 999; // Render on top
    fenceMesh.position.set(boardOffset + x * CELL_SIZE + CELL_SIZE / 2, FENCE_HEIGHT / 2 + 0.01, // Slightly higher to avoid z-fighting with board
        boardOffset + y * CELL_SIZE + CELL_SIZE / 2);
    previewGroup.add(fenceMesh);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Update camera position based on view mode
    if (viewMode === 'top') {
        setTopView();
    } else {
        // Update 3D view camera position to fit board on screen
        set3DView();
    }

    // Update layout class for fence panel positioning
    updateMobileLayoutClass();
}

function onClick(event) {
    if (gameOver || isDragging) return;

    // Don't allow clicks when AI is playing
    if (aiEnabled && currentPlayer === aiPlayer) return;
    if (aiThinking) return;

    // Don't process clicks if intro modal is visible
    const introModal = document.getElementById('intro-modal');
    if (introModal && !introModal.classList.contains('hidden')) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Check for move highlight clicks
    const highlightIntersects = raycaster.intersectObjects(highlightsGroup.children);
    if (highlightIntersects.length > 0) {
        const target = highlightIntersects[0].object.userData;

        // Cancel any pending AI/Assist calculations
        cancelPendingCalculations();

        if (movePawn(target.x, target.y)) {
            if (!checkWin()) {
                switchPlayer();
            }
            // Ensure fence panel is updated after move
            setTimeout(() => {
                updateFencePanelState();
            }, 50);
        }
    }
}

// Pointer event handlers to intercept before OrbitControls
// These use the capture phase to run before OrbitControls handlers
let pointerOnHighlight = false;
let activePointers = new Set(); // Track active pointers for multi-touch detection

function onPointerDownForHighlight(event) {
    pointerOnHighlight = false;
    activePointers.add(event.pointerId);

    // Temporarily disable OrbitControls zoom at pointer start for single touch
    // But allow zoom (pinch gesture) when multiple pointers are active
    if (viewMode !== 'top') {
        if (activePointers.size === 1) {
            controls.enableZoom = false;
        } else {
            // Multi-touch detected (pinch gesture), re-enable zoom
            controls.enableZoom = true;
        }
    }

    if (gameOver || isDragging) return;
    if (viewMode === 'top') return;

    // Don't allow interactions when AI is playing
    if (aiEnabled && currentPlayer === aiPlayer) return;
    if (aiThinking) return;

    // Check if pointer is on a move highlight
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const highlightIntersects = raycaster.intersectObjects(highlightsGroup.children);

    if (highlightIntersects.length > 0) {
        // Stop event from reaching OrbitControls
        event.stopPropagation();
        event.stopImmediatePropagation();
        pointerOnHighlight = true;
        controls.enabled = false;
    }
}

function onPointerMoveForHighlight(event) {
    if (pointerOnHighlight) {
        // Stop event from reaching OrbitControls while dragging on highlight
        event.stopPropagation();
        event.stopImmediatePropagation();
        controls.enabled = false;
    }
}

function onPointerUpForHighlight(event) {
    activePointers.delete(event.pointerId);

    if (pointerOnHighlight) {
        // Stop event from reaching OrbitControls
        event.stopPropagation();
        event.stopImmediatePropagation();
    }
    // Re-enable controls and zoom for 3D view when all pointers are released
    if (viewMode !== 'top' && activePointers.size === 0) {
        controls.enabled = true;
        controls.enableZoom = true; // Re-enable zoom for 3D view
    }
    pointerOnHighlight = false;
}

function onPointerCancelForHighlight(event) {
    activePointers.delete(event.pointerId);

    // Re-enable controls and zoom for 3D view when all pointers are released
    if (viewMode !== 'top' && activePointers.size === 0) {
        controls.enabled = true;
        controls.enableZoom = true;
    }
    pointerOnHighlight = false;
}

// Touch event handlers for mobile
let touchStartTime = 0;
let touchMoved = false;

function onTouchStart() {
    if (gameOver) return;
    touchStartTime = Date.now();
    touchMoved = false;
}

function onTouchMove() {
    touchMoved = true;
}

function onTouchEnd(event) {
    if (gameOver || isDragging) return;

    // Don't allow touches when AI is playing
    if (aiEnabled && currentPlayer === aiPlayer) return;
    if (aiThinking) return;

    // Don't process touches if intro modal is visible
    const introModal = document.getElementById('intro-modal');
    if (introModal && !introModal.classList.contains('hidden')) return;

    // Only treat as tap if touch was short and didn't move much
    const touchDuration = Date.now() - touchStartTime;
    if (touchDuration > 300 || touchMoved) return;

    event.preventDefault();

    const touch = event.changedTouches[0];
    mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // First try: Check for direct move highlight intersections
    const highlightIntersects = raycaster.intersectObjects(highlightsGroup.children);
    if (highlightIntersects.length > 0) {
        const target = highlightIntersects[0].object.userData;

        // Cancel any pending AI/Assist calculations
        cancelPendingCalculations();

        if (movePawn(target.x, target.y)) {
            if (!checkWin()) {
                switchPlayer();
            }
            // Ensure fence panel is updated after move
            updateFencePanelState();
        }
        return;
    }

    // Fallback: Find closest valid move based on board position
    // This helps when touch doesn't directly hit the small highlight mesh
    const boardIntersects = raycaster.intersectObjects(boardGroup.children);
    if (boardIntersects.length > 0 && validMoves.length > 0) {
        const point = boardIntersects[0].point;
        const boardOffset = -(BOARD_SIZE * CELL_SIZE) / 2 + CELL_SIZE / 2;

        // Calculate touched cell position (rounded to nearest cell)
        const touchedX = Math.round((point.x - boardOffset) / CELL_SIZE);
        const touchedY = Math.round((point.z - boardOffset) / CELL_SIZE);

        // Ignore if touched position is the current player's position
        if (touchedX === pawns[currentPlayer].x && touchedY === pawns[currentPlayer].y) {
            return;
        }

        // Only move if the touched cell is exactly a valid move
        const validMove = validMoves.find(move => move.x === touchedX && move.y === touchedY);

        if (validMove) {
            // Cancel any pending AI/Assist calculations
            cancelPendingCalculations();

            if (movePawn(validMove.x, validMove.y)) {
                if (!checkWin()) {
                    switchPlayer();
                }
                // Ensure fence panel is updated after move
                updateFencePanelState();
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
    currentPlayer = 1;  // Always start with Player 1
    fences = {1: 10, 2: 10};
    pawns = {
        1: {x: 4, y: 0}, 2: {x: 4, y: 8}
    };
    placedFences = [];
    isDragging = false;
    gameOver = false;
    aiThinking = false;
    // Reset position history
    positionHistory = {
        1: [{x: 4, y: 0}],
        2: [{x: 4, y: 8}]
    };
    hideAIThinkingIndicator();


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

    // Update thinking ring animation
    updateThinkingRingAnimation();

    controls.update();
    renderer.render(scene, camera);
}

// ==================== AI IMPLEMENTATION ====================

function toggleAI() {
    aiEnabled = !aiEnabled;

    // Save setting to Local Storage
    saveSetting(STORAGE_KEYS.AI_ENABLED, aiEnabled);

    const btn = document.getElementById('ai-btn');
    const player1Name = document.getElementById('player1-name');
    const player2Name = document.getElementById('player2-name');
    const topPlayer2Name = document.getElementById('top-player2-name');
    const rulesPlayer1 = document.getElementById('rules-player1');
    const rulesPlayer2 = document.getElementById('rules-player2');

    if (aiEnabled) {
        btn.textContent = '🤖 AI On';
        btn.classList.add('active');

        // Rename players in fence panel (keep icon in span)
        if (player1Name) player1Name.innerHTML = '<span class="player-icon">🔴</span> Player';
        if (player2Name) player2Name.innerHTML = '<span class="player-icon">🟢</span> AI';
        if (topPlayer2Name) topPlayer2Name.innerHTML = '<span class="player-icon">🟢</span> AI';

        // Rename players in rules dialog
        if (rulesPlayer1) rulesPlayer1.innerHTML = '<strong>🔴 Player:</strong> Move from bottom to top';
        if (rulesPlayer2) rulesPlayer2.innerHTML = '<strong>🟢 AI:</strong> Move from top to bottom';

        // Clear any existing assist proposal for Player 2 (AI doesn't need it)
        if (currentPlayer === aiPlayer) {
            clearTrainProposal();
            hideCurrentPlayerThinkingIndicator();
        }

        // If it's already AI's turn, start thinking
        if (currentPlayer === aiPlayer && !gameOver && !aiThinking) {
            aiThinking = true;
            showAIThinkingIndicator();
            startAICalculation();
        }
    } else {
        btn.textContent = '🤖 AI';
        btn.classList.remove('active');

        // Cancel any pending AI calculation - Player 2 takes control again
        if (aiThinking) {
            cancelPendingCalculations();
        }

        // Reset player names in fence panel (keep icon in span)
        if (player1Name) player1Name.innerHTML = '<span class="player-icon">🔴</span> Player 1';
        if (player2Name) player2Name.innerHTML = '<span class="player-icon">🟢</span> Player 2';
        if (topPlayer2Name) topPlayer2Name.innerHTML = '<span class="player-icon">🟢</span> Player 2';

        // Reset player names in rules dialog
        if (rulesPlayer1) rulesPlayer1.innerHTML = '<strong>🔴 Player 1:</strong> Move from bottom to top';
        if (rulesPlayer2) rulesPlayer2.innerHTML = '<strong>🟢 Player 2:</strong> Move from top to bottom';

        // Show assist proposal for Player 2 if train mode is enabled
        if (trainEnabled && currentPlayer === 2 && !gameOver) {
            startAssistCalculation();
        }
    }

    // Update UI to reflect changes (fence panel state, valid moves)
    updateFencePanelState();
    updateValidMoves();

    // Update layout class for player 2 rotation
    updateMobileLayoutClass();
}

// Switch starting player - switches between Player 1 and Player 2 at game start
function toggleP2First() {
    // Check if game just started
    const isGameStart = pawns[1].x === 4 && pawns[1].y === 0 && pawns[2].x === 4 && pawns[2].y === 8 && placedFences.length === 0;

    // Only allow switch at game start
    if (!isGameStart || gameOver) {
        return;
    }

    // Simply switch the current player
    if (currentPlayer === 1) {
        currentPlayer = 2;
        clearTrainProposal();
    } else {
        currentPlayer = 1;
    }

    updateUI();
    updateValidMoves();

    // If AI is enabled and it's now AI's turn
    if (aiEnabled && currentPlayer === aiPlayer && !aiThinking) {
        aiThinking = true;
        showAIThinkingIndicator();
        startAICalculation();
    } else if (trainEnabled && !gameOver) {
        // Show training proposal for current player
        if (currentPlayer === 1 || (currentPlayer === 2 && !aiEnabled)) {
            startAssistCalculation();
        }
    }
}

// Calculate shortest path distance to goal using BFS
function getShortestPathDistance(player, testPawns, testFences) {
    const goalY = player === 1 ? 8 : 0;
    const start = {x: testPawns[player].x, y: testPawns[player].y};
    const visited = new Set();
    const queue = [{...start, dist: 0}];

    while (queue.length > 0) {
        const current = queue.shift();
        const key = `${current.x},${current.y}`;

        if (visited.has(key)) continue;
        visited.add(key);

        if (current.y === goalY) return current.dist;

        const directions = [{dx: 0, dy: 1}, {dx: 0, dy: -1}, {dx: 1, dy: 0}, {dx: -1, dy: 0}];

        for (const dir of directions) {
            const newX = current.x + dir.dx;
            const newY = current.y + dir.dy;

            if (newX >= 0 && newX < BOARD_SIZE && newY >= 0 && newY < BOARD_SIZE && !isFenceBlockingTest(current.x, current.y, newX, newY, testFences)) {
                queue.push({x: newX, y: newY, dist: current.dist + 1});
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
    const start = {x: testPawns[player].x, y: testPawns[player].y};
    const visited = new Set();
    const queue = [start];

    while (queue.length > 0) {
        const current = queue.shift();
        const key = `${current.x},${current.y}`;

        if (visited.has(key)) continue;
        visited.add(key);

        if (current.y === goalY) return true;

        const directions = [{dx: 0, dy: 1}, {dx: 0, dy: -1}, {dx: 1, dy: 0}, {dx: -1, dy: 0}];

        for (const dir of directions) {
            const newX = current.x + dir.dx;
            const newY = current.y + dir.dy;

            if (newX >= 0 && newX < BOARD_SIZE && newY >= 0 && newY < BOARD_SIZE && !isFenceBlockingTest(current.x, current.y, newX, newY, testFences)) {
                queue.push({x: newX, y: newY});
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
    const newFences = [...testFences, {x, y, orientation}];
    return hasPathToGoalTest(1, testPawns, newFences) && hasPathToGoalTest(2, testPawns, newFences);
}

// Get valid moves for a player with test state
function getValidMovesTest(player, testPawns, testFences) {
    const moves = [];
    const pos = testPawns[player];
    const opponent = player === 1 ? 2 : 1;
    const opponentPos = testPawns[opponent];

    const directions = [{dx: 0, dy: 1}, {dx: 0, dy: -1}, {dx: 1, dy: 0}, {dx: -1, dy: 0}];

    for (const dir of directions) {
        const newX = pos.x + dir.dx;
        const newY = pos.y + dir.dy;

        if (newX < 0 || newX >= BOARD_SIZE || newY < 0 || newY >= BOARD_SIZE) continue;
        if (isFenceBlockingTest(pos.x, pos.y, newX, newY, testFences)) continue;

        if (newX === opponentPos.x && newY === opponentPos.y) {
            const jumpX = newX + dir.dx;
            const jumpY = newY + dir.dy;

            if (jumpX >= 0 && jumpX < BOARD_SIZE && jumpY >= 0 && jumpY < BOARD_SIZE && !isFenceBlockingTest(newX, newY, jumpX, jumpY, testFences)) {
                moves.push({x: jumpX, y: jumpY});
            } else {
                const sideDirs = dir.dx === 0 ? [{dx: 1, dy: 0}, {dx: -1, dy: 0}] : [{dx: 0, dy: 1}, {dx: 0, dy: -1}];

                for (const sideDir of sideDirs) {
                    const sideX = newX + sideDir.dx;
                    const sideY = newY + sideDir.dy;
                    if (sideX >= 0 && sideX < BOARD_SIZE && sideY >= 0 && sideY < BOARD_SIZE && !isFenceBlockingTest(newX, newY, sideX, sideY, testFences)) {
                        moves.push({x: sideX, y: sideY});
                    }
                }
            }
        } else {
            moves.push({x: newX, y: newY});
        }
    }

    return moves;
}

// Evaluate board state for a specific player (positive = good for player, negative = good for opponent)
function evaluateStateForPlayer(player, testPawns, testFences, testFencesCounts) {
    const playerDist = getShortestPathDistance(player, testPawns, testFences);
    const oppPlayer = player === 1 ? 2 : 1;
    const oppDist = getShortestPathDistance(oppPlayer, testPawns, testFences);

    // Check for immediate wins
    if (player === 1 && testPawns[1].y === 8) return 10000;
    if (player === 2 && testPawns[2].y === 0) return 10000;
    if (oppPlayer === 1 && testPawns[1].y === 8) return -10000;
    if (oppPlayer === 2 && testPawns[2].y === 0) return -10000;

    let score = 0;

    // Primary factor: Path distance difference (heavily weighted)
    // Positive when we're closer to goal than opponent
    const pathAdvantage = oppDist - playerDist;
    score += pathAdvantage * 100;

    // Critical advantage: When player is about to win
    if (playerDist <= 2) {
        score += (3 - playerDist) * 50;
    }

    // Defensive: Penalize when opponent is about to win
    if (oppDist <= 2) {
        score -= (3 - oppDist) * 60;
    }

    // Tempo advantage: Who is closer to winning the race?
    if (playerDist <= oppDist) {
        score += 25;
    }

    // Center control bonus: Being in the center provides more options
    const playerCenterDist = Math.abs(testPawns[player].x - 4);
    const oppCenterDist = Math.abs(testPawns[oppPlayer].x - 4);
    score += (oppCenterDist - playerCenterDist) * 5;

    // Progressive position bonus - reward advancement more strongly
    // This creates a strong incentive to always move forward
    if (player === 1) {
        // Player 1 wants to reach y=8, so higher y is better
        score += testPawns[1].y * 15;  // Increased from 8 to 15
        score -= (8 - testPawns[2].y) * 12;
    } else {
        // Player 2 wants to reach y=0, so lower y is better
        score += (8 - testPawns[2].y) * 15;  // Increased from 8 to 15
        score -= testPawns[1].y * 12;
    }

    // Strong bonus for being on a direct path to goal
    // This prevents sideways movement when forward is possible
    const playerGoalY = player === 1 ? 8 : 0;
    const distToGoalY = Math.abs(testPawns[player].y - playerGoalY);
    if (distToGoalY <= playerDist) {
        // Player is on a relatively direct path
        score += 20;
    }

    // Fence advantage (but don't over-value)
    const fenceAdvantage = testFencesCounts[player] - testFencesCounts[oppPlayer];
    score += fenceAdvantage * 3;

    // Having fences when opponent is close to winning is valuable
    if (oppDist <= 3 && testFencesCounts[player] > 0) {
        score += testFencesCounts[player] * 5;
    }

    // Penalty for having no fences when opponent has lots
    if (testFencesCounts[player] === 0 && testFencesCounts[oppPlayer] > 3) {
        score -= 20;
    }

    // Tie-breaker: Consistent side preference to prevent oscillation
    // Once committed to a side, stay on that side
    const currentX = testPawns[player].x;
    if (currentX < 4) {
        // On left side - bonus for staying left, scaled by how far left
        score += (4 - currentX) * 2;
    } else if (currentX > 4) {
        // On right side - bonus for staying right, scaled by how far right
        score += (currentX - 4) * 2;
    }

    return score;
}


// Get the shortest path as an array of cells
function getShortestPath(player, testPawns, testFences) {
    const goalY = player === 1 ? 8 : 0;
    const start = {x: testPawns[player].x, y: testPawns[player].y};
    const visited = new Set();
    const queue = [{...start, path: [start]}];

    while (queue.length > 0) {
        const current = queue.shift();
        const key = `${current.x},${current.y}`;

        if (visited.has(key)) continue;
        visited.add(key);

        if (current.y === goalY) return current.path;

        const directions = [{dx: 0, dy: player === 1 ? 1 : -1}, // Towards goal first
            {dx: 1, dy: 0}, {dx: -1, dy: 0}, {dx: 0, dy: player === 1 ? -1 : 1}];

        for (const dir of directions) {
            const newX = current.x + dir.dx;
            const newY = current.y + dir.dy;

            if (newX >= 0 && newX < BOARD_SIZE && newY >= 0 && newY < BOARD_SIZE && !isFenceBlockingTest(current.x, current.y, newX, newY, testFences)) {
                queue.push({x: newX, y: newY, path: [...current.path, {x: newX, y: newY}]});
            }
        }
    }

    return null;
}

// Generate fence moves for a specific player (smart subset)
function generateFenceMovesForPlayer(player, testFences, testPawns, testFencesCounts) {
    if (testFencesCounts[player] <= 0) return [];

    const moves = [];
    const oppPlayer = player === 1 ? 2 : 1;
    const oppPos = testPawns[oppPlayer];

    // Calculate opponent's shortest path to find critical blocking points
    const oppPath = getShortestPath(oppPlayer, testPawns, testFences);
    const pathCells = new Set();
    if (oppPath) {
        for (const cell of oppPath) {
            pathCells.add(`${cell.x},${cell.y}`);
            // Also add adjacent cells for blocking opportunities
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    pathCells.add(`${cell.x + dx},${cell.y + dy}`);
                }
            }
        }
    }

    // Priority 1: Fences that block opponent's current path
    for (let x = 0; x <= BOARD_SIZE - 2; x++) {
        for (let y = 0; y <= BOARD_SIZE - 2; y++) {
            const nearPath = pathCells.has(`${x},${y}`) || pathCells.has(`${x + 1},${y}`) || pathCells.has(`${x},${y + 1}`) || pathCells.has(`${x + 1},${y + 1}`);

            if (nearPath) {
                for (const orientation of ['h', 'v']) {
                    if (canPlaceFenceTest(x, y, orientation, testFences, testPawns)) {
                        moves.push({type: 'fence', x, y, orientation, priority: 1});
                    }
                }
            }
        }
    }

    // Priority 2: Fences near opponent's position (within 2 cells)
    for (let x = Math.max(0, oppPos.x - 2); x <= Math.min(BOARD_SIZE - 2, oppPos.x + 2); x++) {
        for (let y = Math.max(0, oppPos.y - 2); y <= Math.min(BOARD_SIZE - 2, oppPos.y + 2); y++) {
            for (const orientation of ['h', 'v']) {
                if (canPlaceFenceTest(x, y, orientation, testFences, testPawns)) {
                    const exists = moves.some(m => m.x === x && m.y === y && m.orientation === orientation);
                    if (!exists) {
                        moves.push({type: 'fence', x, y, orientation, priority: 2});
                    }
                }
            }
        }
    }

    // Priority 3: Strategic positions - goal row blocking
    const oppGoalY = oppPlayer === 1 ? 7 : 0;
    for (let x = 0; x <= BOARD_SIZE - 2; x++) {
        for (const orientation of ['h', 'v']) {
            if (canPlaceFenceTest(x, oppGoalY, orientation, testFences, testPawns)) {
                const exists = moves.some(m => m.x === x && m.y === oppGoalY && m.orientation === orientation);
                if (!exists) {
                    moves.push({type: 'fence', x, y: oppGoalY, orientation, priority: 3});
                }
            }
        }
    }

    // Sort by priority
    moves.sort((a, b) => a.priority - b.priority);

    return moves;
}

// Minimax with alpha-beta pruning for a specific player
function minimaxForPlayer(player, testPawns, testFences, testFencesCounts, depth, alpha, beta, isMaximizing) {
    const oppPlayer = player === 1 ? 2 : 1;

    // Check terminal conditions
    if (testPawns[1].y === 8) {
        return player === 1 ? 10000 + depth : -10000 - depth;
    }
    if (testPawns[2].y === 0) {
        return player === 2 ? 10000 + depth : -10000 - depth;
    }

    if (depth === 0) {
        return evaluateStateForPlayer(player, testPawns, testFences, testFencesCounts);
    }

    const currentTurnPlayer = isMaximizing ? player : oppPlayer;

    // Generate and sort moves for better pruning
    const moveMoves = getValidMovesTest(currentTurnPlayer, testPawns, testFences);

    // Sort pawn moves by distance to goal (prefer moves toward goal)
    moveMoves.sort((a, b) => {
        const distA = currentTurnPlayer === 1 ? (8 - a.y) : a.y;
        const distB = currentTurnPlayer === 1 ? (8 - b.y) : b.y;
        return distA - distB;
    });

    const fenceMoves = generateFenceMovesForPlayer(currentTurnPlayer, testFences, testPawns, testFencesCounts);

    if (isMaximizing) {
        let maxEval = -Infinity;

        // Evaluate pawn moves first (usually better)
        for (const move of moveMoves) {
            const newPawns = {
                1: {...testPawns[1]}, 2: {...testPawns[2]}
            };
            newPawns[currentTurnPlayer] = {x: move.x, y: move.y};

            const evalScore = minimaxForPlayer(player, newPawns, testFences, testFencesCounts, depth - 1, alpha, beta, false);
            maxEval = Math.max(maxEval, evalScore);
            alpha = Math.max(alpha, evalScore);
            if (beta <= alpha) break;
        }

        // Then evaluate fence moves (limit based on depth for performance)
        const fenceLimit = depth >= 3 ? 8 : 12;
        const limitedFenceMoves = fenceMoves.slice(0, fenceLimit);
        for (const move of limitedFenceMoves) {
            const newFences = [...testFences, {x: move.x, y: move.y, orientation: move.orientation}];
            const newCounts = {...testFencesCounts};
            newCounts[currentTurnPlayer]--;

            const evalScore = minimaxForPlayer(player, testPawns, newFences, newCounts, depth - 1, alpha, beta, false);
            maxEval = Math.max(maxEval, evalScore);
            alpha = Math.max(alpha, evalScore);
            if (beta <= alpha) break;
        }

        return maxEval;
    } else {
        let minEval = Infinity;

        for (const move of moveMoves) {
            const newPawns = {
                1: {...testPawns[1]}, 2: {...testPawns[2]}
            };
            newPawns[currentTurnPlayer] = {x: move.x, y: move.y};

            const evalScore = minimaxForPlayer(player, newPawns, testFences, testFencesCounts, depth - 1, alpha, beta, true);
            minEval = Math.min(minEval, evalScore);
            beta = Math.min(beta, evalScore);
            if (beta <= alpha) break;
        }

        const fenceLimit = depth >= 3 ? 8 : 12;
        const limitedFenceMoves = fenceMoves.slice(0, fenceLimit);
        for (const move of limitedFenceMoves) {
            const newFences = [...testFences, {x: move.x, y: move.y, orientation: move.orientation}];
            const newCounts = {...testFencesCounts};
            newCounts[currentTurnPlayer]--;

            const evalScore = minimaxForPlayer(player, testPawns, newFences, newCounts, depth - 1, alpha, beta, true);
            minEval = Math.min(minEval, evalScore);
            beta = Math.min(beta, evalScore);
            if (beta <= alpha) break;
        }

        return minEval;
    }
}

// Find the best move for AI (wrapper for findBestMoveForPlayer)
function findBestMove() {
    return findBestMoveForPlayer(aiPlayer);
}


// Execute the AI's move (called from worker callback or synchronously)
function executeAIMove(bestMove) {
    if (gameOver || currentPlayer !== aiPlayer) return;

    if (!bestMove) {
        console.error('AI could not find a valid move!');
        return;
    }

    if (bestMove.type === 'move') {
        // Make the pawn move
        pawns[aiPlayer] = {x: bestMove.x, y: bestMove.y};
        // Update position history
        positionHistory[aiPlayer].push({x: bestMove.x, y: bestMove.y});
        // Keep only last 6 positions to save memory
        if (positionHistory[aiPlayer].length > 6) {
            positionHistory[aiPlayer].shift();
        }
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
                pawns[aiPlayer] = {x: move.x, y: move.y};
                // Update position history
                positionHistory[aiPlayer].push({x: move.x, y: move.y});
                if (positionHistory[aiPlayer].length > 6) {
                    positionHistory[aiPlayer].shift();
                }
                updatePawnPositions();
                if (!checkWin()) {
                    switchPlayer();
                }
            }
        }
    }
}

// Legacy function for backward compatibility
function makeAIMove() {
    const bestMove = findBestMove();
    if (bestMove) {
        executeAIMove(bestMove);
    }
}

// ==================== TRAINING MODE ====================

function toggleTrain() {
    trainEnabled = !trainEnabled;

    // Save setting to Local Storage
    saveSetting(STORAGE_KEYS.TRAIN_ENABLED, trainEnabled);

    const btn = document.getElementById('train-btn');

    if (trainEnabled) {
        btn.textContent = '🎓 Assist On';
        btn.classList.add('active');
        // Show proposal for current player
        // For Player 1: always show
        // For Player 2: only show when AI is off
        if (!gameOver && (currentPlayer === 1 || (currentPlayer === 2 && !aiEnabled))) {
            // Start async calculation
            startAssistCalculation();
        }
    } else {
        btn.textContent = '🎓 Assist';
        btn.classList.remove('active');
        // Cancel pending calculations and clear UI
        if (assistWorker) {
            assistWorker.terminate();
            initAssistWorker();
        }
        assistCalculationPlayer = null;
        clearTrainProposal();
        hidePlayer1ThinkingIndicator();
        hidePlayer2ThinkingIndicator();
        hideThinkingRing(); // Hide both rings
    }
}

// ==================== VIEW MODE ====================

function updateMobileLayoutClass() {
    const isPortrait = window.innerWidth < window.innerHeight;
    const isLandscape = window.innerWidth >= window.innerHeight;
    const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // Remove all layout classes first
    document.body.classList.remove('mobile-portrait');
    document.body.classList.remove('mobile-landscape');
    document.body.classList.remove('portrait-mode');
    document.body.classList.remove('landscape-mode');

    // Remove transition class to prevent animation during orientation change
    const fencePanel = document.getElementById('fence-panel');
    const topFencePanel = document.getElementById('top-fence-panel');
    const uiOverlay = document.getElementById('ui-overlay');
    if (fencePanel) fencePanel.classList.remove('enable-transition');
    if (topFencePanel) topFencePanel.classList.remove('enable-transition');
    if (uiOverlay) uiOverlay.classList.remove('enable-transition');

    // Add portrait/landscape classes for all devices (panel positioning)
    if (isPortrait) {
        document.body.classList.add('portrait-mode');
    } else if (isLandscape) {
        document.body.classList.add('landscape-mode');
    }

    // Add mobile-specific classes for touch behavior
    if (isMobile) {
        if (isPortrait) {
            document.body.classList.add('mobile-portrait');
        } else if (isLandscape) {
            document.body.classList.add('mobile-landscape');
        }
    }

    // Set two-player-mode class (for upside-down player 2 in landscape view)
    if (!aiEnabled) {
        document.body.classList.add('two-player-mode');
    } else {
        document.body.classList.remove('two-player-mode');
    }
}

function toggleView() {
    if (isAnimatingView) return; // Don't toggle while animating

    const btn = document.getElementById('view-btn');

    if (viewMode === '3d') {
        viewMode = 'top';
        btn.textContent = '👁️ View Top';
        btn.classList.add('active');
        animateToTopView();
    } else {
        viewMode = '3d';
        btn.textContent = '👁️ View 3D';
        btn.classList.remove('active');
        animateTo3DView();
    }

    // Save setting to Local Storage
    saveSetting(STORAGE_KEYS.VIEW_MODE, viewMode);

    updateMobileLayoutClass();
}

function getTopViewCameraDistance() {
    const boardSize = BOARD_SIZE * CELL_SIZE + 0.5;
    const aspect = window.innerWidth / window.innerHeight;
    const fov = camera.fov * (Math.PI / 180);

    let cameraDistance;
    if (aspect >= 1) {
        cameraDistance = (boardSize / 2) / Math.tan(fov / 2);
    } else {
        cameraDistance = (boardSize / 2) / (Math.tan(fov / 2) * aspect);
    }
    return cameraDistance * 0.99;
}

function get3DViewCameraPosition() {
    // Calculate optimal camera position for 3D view to fit board on screen
    const boardSize = BOARD_SIZE * CELL_SIZE + 0.5;
    const aspect = window.innerWidth / window.innerHeight;
    const fov = camera.fov * (Math.PI / 180);

    // For 3D view, we need to account for the viewing angle
    const viewAngle = Math.PI / 4; // 45 degrees

    // In 3D perspective view, the board appears foreshortened
    const effectiveBoardDepth = boardSize * Math.cos(viewAngle);
    const effectiveBoardWidth = boardSize;

    // Calculate distance needed for both dimensions
    let distanceForHeight, distanceForWidth;

    // For height: need to see the full foreshortened depth plus some height for perspective
    const verticalFov = fov;
    const horizontalFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);

    // Distance needed to fit board width (add padding for landscape)
    distanceForWidth = (effectiveBoardWidth / 2) / Math.tan(horizontalFov / 2) * 1.15;

    // Distance needed to fit board depth (add padding for portrait)
    distanceForHeight = (effectiveBoardDepth / 2 + 1.5) / Math.tan(verticalFov / 2) * 1.1;

    // Use the larger distance to ensure board fits completely
    const distance = Math.max(distanceForWidth, distanceForHeight);

    // Calculate Y and Z positions (45 degree angle)
    const y = distance * Math.sin(viewAngle);
    const z = -distance * Math.cos(viewAngle);

    return {x: 0, y: y, z: z};
}

function animateToTopView() {
    isAnimatingView = true;
    controls.enabled = false;

    const startPos = camera.position.clone();
    const startUp = camera.up.clone();
    const startTarget = controls.target.clone();

    const endPos = new THREE.Vector3(0, getTopViewCameraDistance(), 0);
    const endUp = new THREE.Vector3(0, 0, 1);
    const endTarget = new THREE.Vector3(0, 0, 0);

    animationStartTime = Date.now();

    function animateStep() {
        const elapsed = Date.now() - animationStartTime;
        const progress = Math.min(elapsed / VIEW_ANIMATION_DURATION, 1);

        // Easing function (ease-in-out)
        const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        // Interpolate position
        camera.position.lerpVectors(startPos, endPos, eased);

        // Interpolate up vector
        camera.up.lerpVectors(startUp, endUp, eased).normalize();

        // Interpolate target
        controls.target.lerpVectors(startTarget, endTarget, eased);

        camera.lookAt(controls.target);
        controls.update();

        if (progress < 1) {
            requestAnimationFrame(animateStep);
        } else {
            isAnimatingView = false;
            // Ensure final state
            camera.position.copy(endPos);
            camera.up.copy(endUp);
            controls.target.copy(endTarget);
            camera.lookAt(controls.target);
            controls.update();
        }
    }

    animateStep();
}

function animateTo3DView() {
    isAnimatingView = true;

    const startPos = camera.position.clone();
    const startUp = camera.up.clone();
    const startTarget = controls.target.clone();

    const pos = get3DViewCameraPosition();
    const endPos = new THREE.Vector3(pos.x, pos.y, pos.z);
    const endUp = new THREE.Vector3(0, 1, 0);
    const endTarget = new THREE.Vector3(0, 0, 0);

    animationStartTime = Date.now();

    function animateStep() {
        const elapsed = Date.now() - animationStartTime;
        const progress = Math.min(elapsed / VIEW_ANIMATION_DURATION, 1);

        // Easing function (ease-in-out)
        const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        // Interpolate position
        camera.position.lerpVectors(startPos, endPos, eased);

        // Interpolate up vector
        camera.up.lerpVectors(startUp, endUp, eased).normalize();

        // Interpolate target
        controls.target.lerpVectors(startTarget, endTarget, eased);

        camera.lookAt(controls.target);
        controls.update();

        if (progress < 1) {
            requestAnimationFrame(animateStep);
        } else {
            isAnimatingView = false;
            controls.enabled = true;
            // Ensure final state
            camera.position.copy(endPos);
            camera.up.copy(endUp);
            controls.target.copy(endTarget);
            camera.lookAt(controls.target);
            controls.update();
        }
    }

    animateStep();
}

function setTopView() {
    // Calculate the optimal camera distance to fit the board
    const cameraDistance = getTopViewCameraDistance();

    // Position camera directly above the board center
    // Rotate 180 degrees by setting camera up vector to negative Z
    camera.up.set(0, 0, 1);
    camera.position.set(0, cameraDistance, 0);
    camera.lookAt(0, 0, 0);

    // Lock OrbitControls and disable zoom for top view
    controls.enabled = false;
    controls.enableZoom = false;
    controls.target.set(0, 0, 0);
    controls.update();
}

function set3DView() {
    // Restore default 3D camera position
    // Reset camera up vector to default
    const pos = get3DViewCameraPosition();
    camera.up.set(0, 1, 0);
    camera.position.set(pos.x, pos.y, pos.z);
    camera.lookAt(0, 0, 0);

    // Unlock OrbitControls and enable zoom for 3D view
    controls.enabled = true;
    controls.enableZoom = true;
    controls.target.set(0, 0, 0);
    controls.update();
}

function showTrainProposal() {
    // Check if we should show proposal
    // For Player 1: always when train is enabled
    // For Player 2: only when train is enabled AND AI is off
    const shouldShow = trainEnabled && !gameOver && (currentPlayer === 1 || (currentPlayer === 2 && !aiEnabled));

    if (!shouldShow) {
        clearTrainProposal();
        hideCurrentPlayerThinkingIndicator();
        return;
    }

    // Clear previous proposal and start async calculation
    clearTrainProposal();
    startAssistCalculation();
}

// Display the training proposal visualization (called from worker callback)
function displayTrainProposal(bestMove) {
    if (!bestMove || !trainEnabled || gameOver) return;

    // Clear previous proposal
    clearTrainProposal();

    const boardOffset = -(BOARD_SIZE * CELL_SIZE) / 2 + CELL_SIZE / 2;

    if (bestMove.type === 'move') {
        // Show outlined/transparent highlight for the suggested move position
        const geometry = new THREE.RingGeometry(0.18, 0.28, 32);
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff00, transparent: true, opacity: 0.6, side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(geometry, material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(boardOffset + bestMove.x * CELL_SIZE, 0.15, boardOffset + bestMove.y * CELL_SIZE);
        trainProposalGroup.add(ring);

        // Add pulsing animation indicator (a second ring)
        const outerGeometry = new THREE.RingGeometry(0.25, 0.32, 32);
        const outerMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00, transparent: true, opacity: 0.3, side: THREE.DoubleSide
        });
        const outerRing = new THREE.Mesh(outerGeometry, outerMaterial);
        outerRing.rotation.x = -Math.PI / 2;
        outerRing.position.set(boardOffset + bestMove.x * CELL_SIZE, 0.14, boardOffset + bestMove.y * CELL_SIZE);
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
            color: 0x00ff00, transparent: true, opacity: 0.4, emissive: 0x00ff00, emissiveIntensity: 0.2
        });

        const fenceMesh = new THREE.Mesh(fenceGeometry, fenceMaterial);
        fenceMesh.position.set(boardOffset + bestMove.x * CELL_SIZE + CELL_SIZE / 2, FENCE_HEIGHT / 2, boardOffset + bestMove.y * CELL_SIZE + CELL_SIZE / 2);
        fenceMesh.castShadow = true;
        trainProposalGroup.add(fenceMesh);

        // Add wireframe outline
        const wireGeometry = new THREE.EdgesGeometry(fenceGeometry);
        const wireMaterial = new THREE.LineBasicMaterial({
            color: 0x00ff00, transparent: true, opacity: 0.8
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
// Uses the same improved logic as the AI player
// Parameters are optional - if not provided, uses global game state
function findBestMoveForPlayer(player, inputPawns, inputFences, inputFenceCounts, inputPositionHistory) {
    // Use provided data or fall back to global state
    const testPawns = inputPawns ? {
        1: {...inputPawns[1]}, 2: {...inputPawns[2]}
    } : {
        1: {...pawns[1]}, 2: {...pawns[2]}
    };
    const testFences = inputFences ? [...inputFences] : [...placedFences];
    const testFencesCounts = inputFenceCounts ? {...inputFenceCounts} : {...fences};

    // Get position history for anti-oscillation
    const playerHistory = inputPositionHistory ? inputPositionHistory[player] :
        (typeof positionHistory !== 'undefined' ? positionHistory[player] : []);

    let bestMove = null;
    let bestScore = -Infinity;
    const depth = 4; // Same depth as AI

    // Calculate distances for strategic decisions
    const playerDist = getShortestPathDistance(player, testPawns, testFences);
    const oppPlayer = player === 1 ? 2 : 1;
    const oppDist = getShortestPathDistance(oppPlayer, testPawns, testFences);

    // Get the shortest path to use for tie-breaking
    const shortestPath = getShortestPath(player, testPawns, testFences);
    const nextPathCell = shortestPath && shortestPath.length > 1 ? shortestPath[1] : null;

    // Evaluate pawn moves
    const moveMoves = getValidMovesTest(player, testPawns, testFences);

    // Calculate current Y position for forward/backward detection
    const currentY = testPawns[player].y;
    const goalY = player === 1 ? 8 : 0;

    // Sort moves by priority:
    // 1. Moves along the shortest path (highest priority)
    // 2. Moves toward goal
    // 3. Tie-break by consistent direction (prefer left side when equal)
    moveMoves.sort((a, b) => {
        // Check if move is on shortest path
        const aOnPath = nextPathCell && a.x === nextPathCell.x && a.y === nextPathCell.y;
        const bOnPath = nextPathCell && b.x === nextPathCell.x && b.y === nextPathCell.y;
        if (aOnPath && !bOnPath) return -1;
        if (bOnPath && !aOnPath) return 1;

        // Distance to goal
        const distA = player === 1 ? (8 - a.y) : a.y;
        const distB = player === 1 ? (8 - b.y) : b.y;
        if (distA !== distB) return distA - distB;

        // Tie-break: prefer moves that continue in the same horizontal direction
        // or prefer left side for consistency
        const currentX = testPawns[player].x;

        // If currently on left side, prefer continuing left; if right, prefer continuing right
        if (currentX <= 4) {
            return a.x - b.x; // Prefer smaller x (left)
        } else {
            return b.x - a.x; // Prefer larger x (right)
        }
    });

    // Track moves with their scores for tie-breaking
    const scoredMoves = [];

    for (const move of moveMoves) {
        const newPawns = {
            1: {...testPawns[1]}, 2: {...testPawns[2]}
        };
        newPawns[player] = {x: move.x, y: move.y};

        // Check for immediate win
        if (move.y === goalY) {
            return {type: 'move', x: move.x, y: move.y};
        }

        let score = minimaxForPlayer(player, newPawns, testFences, testFencesCounts, depth - 1, -Infinity, Infinity, false);

        // Anti-oscillation: Check if this move returns to a recent position
        const isRecentPosition = playerHistory.some((pos, idx) => {
            // Check last 4 positions (excluding current)
            return idx >= playerHistory.length - 4 && pos.x === move.x && pos.y === move.y;
        });

        // Heavy penalty for returning to recent positions
        if (isRecentPosition) {
            score -= 150;
        }

        // Penalty for backward moves (away from goal) unless path is blocked
        const isBackward = player === 1 ? (move.y < currentY) : (move.y > currentY);
        if (isBackward) {
            // Check if forward moves exist and are not blocked
            const forwardMoves = moveMoves.filter(m =>
                player === 1 ? m.y > currentY : m.y < currentY
            );
            if (forwardMoves.length > 0) {
                // Only penalize if forward moves are available
                score -= 80;
            }
        }

        // Bonus for progress toward goal
        const progress = player === 1 ? (move.y - currentY) : (currentY - move.y);
        if (progress > 0) {
            score += progress * 20;
        }

        // Check if this move is on the shortest path (for tie-breaking)
        const isOnPath = nextPathCell && move.x === nextPathCell.x && move.y === nextPathCell.y;

        // Strong bonus for moves on the shortest path
        if (isOnPath) {
            score += 30;
        }

        scoredMoves.push({
            move: {type: 'move', x: move.x, y: move.y},
            score: score,
            isOnPath: isOnPath,
            distToGoal: player === 1 ? (8 - move.y) : move.y,
            isRecentPosition: isRecentPosition,
            isBackward: isBackward
        });

        if (score > bestScore) {
            bestScore = score;
            bestMove = {type: 'move', x: move.x, y: move.y};
        }
    }

    // Find all moves with the best score and apply tie-breaking
    const bestMoves = scoredMoves.filter(m => m.score === bestScore);
    if (bestMoves.length > 1) {
        // First filter out moves to recent positions if we have other options
        const nonRecentMoves = bestMoves.filter(m => !m.isRecentPosition);
        const candidateMoves = nonRecentMoves.length > 0 ? nonRecentMoves : bestMoves;

        // Then filter out backward moves if we have forward options
        const nonBackwardMoves = candidateMoves.filter(m => !m.isBackward);
        const finalCandidates = nonBackwardMoves.length > 0 ? nonBackwardMoves : candidateMoves;

        // Prefer moves on the shortest path
        const pathMoves = finalCandidates.filter(m => m.isOnPath);
        if (pathMoves.length > 0) {
            bestMove = pathMoves[0].move;
        } else {
            // Sort by distance to goal, then by consistent direction
            finalCandidates.sort((a, b) => {
                if (a.distToGoal !== b.distToGoal) return a.distToGoal - b.distToGoal;
                // Consistent direction preference based on current position
                const currentX = testPawns[player].x;
                if (currentX <= 4) {
                    return a.move.x - b.move.x; // Prefer left
                } else {
                    return b.move.x - a.move.x; // Prefer right
                }
            });
            bestMove = finalCandidates[0].move;
        }
    }

    // Evaluate fence moves (strategic subset)
    // Only consider fences if we have them and it makes strategic sense
    const shouldConsiderFences = testFencesCounts[player] > 0 && (oppDist <= playerDist + 2 || // Opponent is close or ahead
        oppDist <= 4 ||              // Opponent is near goal
        testFencesCounts[player] >= 5); // We have lots of fences

    if (shouldConsiderFences) {
        const fenceMoves = generateFenceMovesForPlayer(player, testFences, testPawns, testFencesCounts);

        // Score and sort fence moves by immediate impact
        const scoredFences = fenceMoves.map(move => {
            const newFences = [...testFences, {x: move.x, y: move.y, orientation: move.orientation}];
            const oppDistBefore = getShortestPathDistance(oppPlayer, testPawns, testFences);
            const oppDistAfter = getShortestPathDistance(oppPlayer, testPawns, newFences);
            const playerDistAfter = getShortestPathDistance(player, testPawns, newFences);

            // Impact = how much we slow opponent minus how much we slow ourselves
            const impact = (oppDistAfter - oppDistBefore) - (playerDistAfter - playerDist) * 0.5;
            return {...move, impact};
        });

        // Sort by impact and take top candidates
        scoredFences.sort((a, b) => b.impact - a.impact);
        // Take more candidates for deeper analysis
        const topFences = scoredFences.filter(f => f.impact > 0).slice(0, 20);

        for (const move of topFences) {
            const newFences = [...testFences, {x: move.x, y: move.y, orientation: move.orientation}];
            const newCounts = {...testFencesCounts};
            newCounts[player]--;

            const score = minimaxForPlayer(player, testPawns, newFences, newCounts, depth - 1, -Infinity, Infinity, false);

            if (score > bestScore) {
                bestScore = score;
                bestMove = {type: 'fence', x: move.x, y: move.y, orientation: move.orientation};
            }
        }
    }

    return bestMove;
}

// Direction constants for MCTS
const MOVE_UP = [-1, 0];
const MOVE_DOWN = [1, 0];
const MOVE_LEFT = [0, -1];
const MOVE_RIGHT = [0, 1];

// Helper function to create 2D array initialized to a value
function create2DArrayInitializedTo(rows, cols, value) {
    const arr = [];
    for (let i = 0; i < rows; i++) {
        arr.push([]);
        for (let j = 0; j < cols; j++) {
            arr[i].push(value);
        }
    }
    return arr;
}

// Helper function to clone a 2D array
function create2DArrayClonedFrom(arr2D) {
    const clone = [];
    for (let i = 0; i < arr2D.length; i++) {
        clone.push([...arr2D[i]]);
    }
    return clone;
}

// Helper function to perform logical AND between 2D arrays
function logicalAndBetween2DArray(arr1, arr2) {
    const result = [];
    for (let i = 0; i < arr1.length; i++) {
        result.push([]);
        for (let j = 0; j < arr1[i].length; j++) {
            result[i].push(arr1[i][j] && arr2[i][j]);
        }
    }
    return result;
}

// Helper function to get indices of a value in 2D array
function indicesOfValueIn2DArray(arr2D, value) {
    let t = [];
    for (let i = 0; i < arr2D.length; i++) {
        for (let j = 0; j < arr2D[0].length; j++) {
            if (arr2D[i][j] === value) {
                t.push([i, j]);
            }
        }
    }
    return t;
}

// Helper function to get indices of minimum values in array
function indicesOfMin(arr) {
    let min = Infinity;
    let indices = [];
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] < min) {
            indices = [i];
            min = arr[i];
        } else if (arr[i] === min) {
            indices.push(i);
        }
    }
    return indices;
}

// Helper function to get indices of maximum values in array
function indicesOfMax(arr) {
    let max = -Infinity;
    let indices = [];
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] > max) {
            indices = [i];
            max = arr[i];
        } else if (arr[i] === max) {
            indices.push(i);
        }
    }
    return indices;
}

// Random index helper
function randomIndex(arr) {
    return Math.floor(Math.random() * arr.length);
}

// Random choice helper
function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Shuffle array in place (Fisher-Yates)
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const x = arr[i];
        arr[i] = arr[j];
        arr[j] = x;
    }
    return arr;
}

// Simple Priority Queue implementation
class PriorityQueue {
    constructor(comparator) {
        this.data = [];
        this.comparator = comparator || ((a, b) => a < b);
    }

    push(item) {
        this.data.push(item);
        this.data.sort((a, b) => this.comparator(a, b) ? -1 : 1);
    }

    pop() {
        return this.data.shift();
    }

    isEmpty() {
        return this.data.length === 0;
    }
}

// PawnPosition class for MCTS
class PawnPosition {
    constructor(row, col) {
        this.row = row;
        this.col = col;
    }

    equals(other) {
        return this.row === other.row && this.col === other.col;
    }

    newAddMove(moveTuple) {
        return new PawnPosition(this.row + moveTuple[0], this.col + moveTuple[1]);
    }

    getDisplacementPawnMoveTupleFrom(position) {
        return [this.row - position.row, this.col - position.col];
    }

    static clone(pawnPosition) {
        return new PawnPosition(pawnPosition.row, pawnPosition.col);
    }
}

// Pawn class for MCTS
class MCTSPawn {
    constructor(index, isHumanPlayer, skipInit = false) {
        this.index = index;
        this.isHumanPlayer = isHumanPlayer;
        if (!skipInit) {
            // Player 1 (index 0) starts at row 8 (y=0 in original), goal row 0 (y=8)
            // Player 2 (index 1) starts at row 0 (y=8 in original), goal row 8 (y=0)
            if (index === 0) {
                this.position = new PawnPosition(8, 4);
                this.goalRow = 0;
            } else {
                this.position = new PawnPosition(0, 4);
                this.goalRow = 8;
            }
            this.numberOfLeftWalls = 10;
        }
    }

    static clone(pawn) {
        const _clone = new MCTSPawn(pawn.index, pawn.isHumanPlayer, true);
        _clone.index = pawn.index;
        _clone.isHumanPlayer = pawn.isHumanPlayer;
        _clone.position = PawnPosition.clone(pawn.position);
        _clone.goalRow = pawn.goalRow;
        _clone.numberOfLeftWalls = pawn.numberOfLeftWalls;
        return _clone;
    }
}

// Board class for MCTS
class MCTSBoard {
    constructor(skipInit = false) {
        if (!skipInit) {
            this.pawns = [new MCTSPawn(0, true), new MCTSPawn(1, false)];
            this.walls = {
                horizontal: create2DArrayInitializedTo(8, 8, false),
                vertical: create2DArrayInitializedTo(8, 8, false)
            };
        }
    }

    static clone(board) {
        const _clone = new MCTSBoard(true);
        _clone.pawns = [MCTSPawn.clone(board.pawns[0]), MCTSPawn.clone(board.pawns[1])];
        _clone.walls = {
            horizontal: create2DArrayClonedFrom(board.walls.horizontal),
            vertical: create2DArrayClonedFrom(board.walls.vertical)
        };
        return _clone;
    }
}

// MCTSGame class for MCTS
class MCTSGame {
    constructor(skipInit = false) {
        if (!skipInit) {
            this.board = new MCTSBoard();
            this.winner = null;
            this._turn = 0;
            this.validNextWalls = {
                horizontal: create2DArrayInitializedTo(8, 8, true),
                vertical: create2DArrayInitializedTo(8, 8, true)
            };
            this._probableNextWalls = {
                horizontal: create2DArrayInitializedTo(8, 8, false),
                vertical: create2DArrayInitializedTo(8, 8, false)
            };
            this._probableValidNextWalls = null;
            this._probableValidNextWallsUpdated = false;
            this.openWays = {
                upDown: create2DArrayInitializedTo(10, 9, true),
                leftRight: create2DArrayInitializedTo(9, 10, true)
            };
            // Set boundaries as blocked
            for (let i = 0; i < 9; i++) {
                this.openWays.upDown[0][i] = false;
                this.openWays.upDown[9][i] = false;
                this.openWays.leftRight[i][0] = false;
                this.openWays.leftRight[i][9] = false;
            }
            this._validNextPositions = create2DArrayInitializedTo(9, 9, false);
            this._validNextPositionsUpdated = false;
        }
    }

    get turn() {
        return this._turn;
    }

    get pawnIndexOfTurn() {
        return this._turn % 2;
    }

    get pawnIndexOfNotTurn() {
        return (this._turn + 1) % 2;
    }

    get pawnOfTurn() {
        return this.board.pawns[this.pawnIndexOfTurn];
    }

    get pawnOfNotTurn() {
        return this.board.pawns[this.pawnIndexOfNotTurn];
    }

    get pawn0() {
        return this.board.pawns[0];
    }

    get pawn1() {
        return this.board.pawns[1];
    }

    get validNextPositions() {
        if (!this._validNextPositionsUpdated) {
            this._updateValidNextPositions();
        }
        return this._validNextPositions;
    }

    get probableValidNextWalls() {
        if (!this._probableValidNextWallsUpdated) {
            this._probableValidNextWalls = {
                horizontal: logicalAndBetween2DArray(this._probableNextWalls.horizontal, this.validNextWalls.horizontal),
                vertical: logicalAndBetween2DArray(this._probableNextWalls.vertical, this.validNextWalls.vertical)
            };
            this._probableValidNextWallsUpdated = true;
        }
        return this._probableValidNextWalls;
    }

    _updateValidNextPositions() {
        const pawn = this.pawnOfTurn;
        const opponent = this.pawnOfNotTurn;
        this._validNextPositions = create2DArrayInitializedTo(9, 9, false);

        const moveTuples = [MOVE_UP, MOVE_DOWN, MOVE_LEFT, MOVE_RIGHT];
        for (const moveTuple of moveTuples) {
            if (this.isOpenWay(pawn.position.row, pawn.position.col, moveTuple)) {
                const newPos = pawn.position.newAddMove(moveTuple);
                if (newPos.row === opponent.position.row && newPos.col === opponent.position.col) {
                    // Face to face - try to jump
                    if (this.isOpenWay(newPos.row, newPos.col, moveTuple)) {
                        const jumpPos = newPos.newAddMove(moveTuple);
                        if (jumpPos.row >= 0 && jumpPos.row < 9 && jumpPos.col >= 0 && jumpPos.col < 9) {
                            this._validNextPositions[jumpPos.row][jumpPos.col] = true;
                        }
                    } else {
                        // Try diagonal
                        const sideTuples = moveTuple[0] === 0 ? [MOVE_UP, MOVE_DOWN] : [MOVE_LEFT, MOVE_RIGHT];
                        for (const sideTuple of sideTuples) {
                            if (this.isOpenWay(newPos.row, newPos.col, sideTuple)) {
                                const sidePos = newPos.newAddMove(sideTuple);
                                if (sidePos.row >= 0 && sidePos.row < 9 && sidePos.col >= 0 && sidePos.col < 9) {
                                    this._validNextPositions[sidePos.row][sidePos.col] = true;
                                }
                            }
                        }
                    }
                } else {
                    this._validNextPositions[newPos.row][newPos.col] = true;
                }
            }
        }
        this._validNextPositionsUpdated = true;
    }

    isOpenWay(row, col, moveTuple) {
        if (moveTuple[0] === -1) { // UP
            return this.openWays.upDown[row][col];
        } else if (moveTuple[0] === 1) { // DOWN
            return this.openWays.upDown[row + 1][col];
        } else if (moveTuple[1] === -1) { // LEFT
            return this.openWays.leftRight[row][col];
        } else if (moveTuple[1] === 1) { // RIGHT
            return this.openWays.leftRight[row][col + 1];
        }
        return false;
    }

    movePawn(row, col) {
        this.pawnOfTurn.position = new PawnPosition(row, col);
        if (row === this.pawnOfTurn.goalRow) {
            this.winner = this.pawnOfTurn;
        }
        this._updateProbableNextWalls();
        this._turn++;
        this._validNextPositionsUpdated = false;
        this._probableValidNextWallsUpdated = false;
    }

    placeHorizontalWall(row, col) {
        this.board.walls.horizontal[row][col] = true;
        this.pawnOfTurn.numberOfLeftWalls--;
        // Block open ways
        this.openWays.upDown[row + 1][col] = false;
        this.openWays.upDown[row + 1][col + 1] = false;
        // Update valid walls
        this._updateValidNextWallsAfterPlaceHorizontalWall(row, col);
        this._updateProbableNextWalls();
        this._turn++;
        this._validNextPositionsUpdated = false;
        this._probableValidNextWallsUpdated = false;
    }

    placeVerticalWall(row, col) {
        this.board.walls.vertical[row][col] = true;
        this.pawnOfTurn.numberOfLeftWalls--;
        // Block open ways
        this.openWays.leftRight[row][col + 1] = false;
        this.openWays.leftRight[row + 1][col + 1] = false;
        // Update valid walls
        this._updateValidNextWallsAfterPlaceVerticalWall(row, col);
        this._updateProbableNextWalls();
        this._turn++;
        this._validNextPositionsUpdated = false;
        this._probableValidNextWallsUpdated = false;
    }

    _updateValidNextWallsAfterPlaceHorizontalWall(row, col) {
        this.validNextWalls.horizontal[row][col] = false;
        this.validNextWalls.vertical[row][col] = false;
        if (col > 0) this.validNextWalls.horizontal[row][col - 1] = false;
        if (col < 7) this.validNextWalls.horizontal[row][col + 1] = false;
    }

    _updateValidNextWallsAfterPlaceVerticalWall(row, col) {
        this.validNextWalls.vertical[row][col] = false;
        this.validNextWalls.horizontal[row][col] = false;
        if (row > 0) this.validNextWalls.vertical[row - 1][col] = false;
        if (row < 7) this.validNextWalls.vertical[row + 1][col] = false;
    }

    _updateProbableNextWalls() {
        this._probableNextWalls = {
            horizontal: create2DArrayInitializedTo(8, 8, false),
            vertical: create2DArrayInitializedTo(8, 8, false)
        };
        // Mark walls near pawns as probable
        for (const pawn of this.board.pawns) {
            MCTSGame.setWallsBesidePawn(this._probableNextWalls, pawn);
        }
    }

    static setWallsBesidePawn(wall2DArrays, pawn) {
        const row = pawn.position.row;
        const col = pawn.position.col;
        // Set walls around pawn position
        for (let dr = -1; dr <= 0; dr++) {
            for (let dc = -1; dc <= 0; dc++) {
                const r = row + dr;
                const c = col + dc;
                if (r >= 0 && r < 8 && c >= 0 && c < 8) {
                    wall2DArrays.horizontal[r][c] = true;
                    wall2DArrays.vertical[r][c] = true;
                }
            }
        }
    }

    testIfExistPathsToGoalLinesAfterPlaceHorizontalWall(row, col) {
        // Temporarily place wall
        this.openWays.upDown[row + 1][col] = false;
        this.openWays.upDown[row + 1][col + 1] = false;
        const result = this._existPathsToGoalForBothPawns();
        // Restore
        this.openWays.upDown[row + 1][col] = true;
        this.openWays.upDown[row + 1][col + 1] = true;
        return result;
    }

    testIfExistPathsToGoalLinesAfterPlaceVerticalWall(row, col) {
        // Temporarily place wall
        this.openWays.leftRight[row][col + 1] = false;
        this.openWays.leftRight[row + 1][col + 1] = false;
        const result = this._existPathsToGoalForBothPawns();
        // Restore
        this.openWays.leftRight[row][col + 1] = true;
        this.openWays.leftRight[row + 1][col + 1] = true;
        return result;
    }

    _existPathsToGoalForBothPawns() {
        return this._existPathToGoal(this.pawn0) && this._existPathToGoal(this.pawn1);
    }

    _existPathToGoal(pawn) {
        const visited = create2DArrayInitializedTo(9, 9, false);
        const queue = [pawn.position];
        visited[pawn.position.row][pawn.position.col] = true;

        while (queue.length > 0) {
            const pos = queue.shift();
            if (pos.row === pawn.goalRow) return true;

            const moveTuples = [MOVE_UP, MOVE_DOWN, MOVE_LEFT, MOVE_RIGHT];
            for (const moveTuple of moveTuples) {
                if (this.isOpenWay(pos.row, pos.col, moveTuple)) {
                    const newPos = pos.newAddMove(moveTuple);
                    if (newPos.row >= 0 && newPos.row < 9 && newPos.col >= 0 && newPos.col < 9 &&
                        !visited[newPos.row][newPos.col]) {
                        visited[newPos.row][newPos.col] = true;
                        queue.push(newPos);
                    }
                }
            }
        }
        return false;
    }

    doMove(move) {
        if (move[0] !== null) {
            this.movePawn(move[0][0], move[0][1]);
        } else if (move[1] !== null) {
            this.placeHorizontalWall(move[1][0], move[1][1]);
        } else if (move[2] !== null) {
            this.placeVerticalWall(move[2][0], move[2][1]);
        }
    }

    isPossibleNextMove(move) {
        if (move[0] !== null) {
            return this.validNextPositions[move[0][0]][move[0][1]];
        } else if (move[1] !== null) {
            return this.validNextWalls.horizontal[move[1][0]][move[1][1]] &&
                   this.testIfExistPathsToGoalLinesAfterPlaceHorizontalWall(move[1][0], move[1][1]);
        } else if (move[2] !== null) {
            return this.validNextWalls.vertical[move[2][0]][move[2][1]] &&
                   this.testIfExistPathsToGoalLinesAfterPlaceVerticalWall(move[2][0], move[2][1]);
        }
        return false;
    }

    getArrOfValidNextPositionTuples() {
        return indicesOfValueIn2DArray(this.validNextPositions, true);
    }

    getArrOfProbableValidNoBlockNextHorizontalWallPositions() {
        const nextHorizontals = indicesOfValueIn2DArray(this.probableValidNextWalls.horizontal, true);
        const noBlockNextHorizontals = [];
        for (let i = 0; i < nextHorizontals.length; i++) {
            if (this.testIfExistPathsToGoalLinesAfterPlaceHorizontalWall(nextHorizontals[i][0], nextHorizontals[i][1])) {
                noBlockNextHorizontals.push(nextHorizontals[i]);
            }
        }
        return noBlockNextHorizontals;
    }

    getArrOfProbableValidNoBlockNextVerticalWallPositions() {
        const nextVerticals = indicesOfValueIn2DArray(this.probableValidNextWalls.vertical, true);
        const noBlockNextVerticals = [];
        for (let i = 0; i < nextVerticals.length; i++) {
            if (this.testIfExistPathsToGoalLinesAfterPlaceVerticalWall(nextVerticals[i][0], nextVerticals[i][1])) {
                noBlockNextVerticals.push(nextVerticals[i]);
            }
        }
        return noBlockNextVerticals;
    }

    getArrOfValidNoBlockNextWallsDisturbPathOf(pawn) {
        const validNextWallsInterrupt = MCTSAIHelper.getValidNextWallsDisturbPathOf(pawn, this);
        const nextHorizontals = indicesOfValueIn2DArray(validNextWallsInterrupt.horizontal, true);
        const noBlockNextHorizontals = [];
        for (let i = 0; i < nextHorizontals.length; i++) {
            if (this.testIfExistPathsToGoalLinesAfterPlaceHorizontalWall(nextHorizontals[i][0], nextHorizontals[i][1])) {
                noBlockNextHorizontals.push(nextHorizontals[i]);
            }
        }
        const nextVerticals = indicesOfValueIn2DArray(validNextWallsInterrupt.vertical, true);
        const noBlockNextVerticals = [];
        for (let i = 0; i < nextVerticals.length; i++) {
            if (this.testIfExistPathsToGoalLinesAfterPlaceVerticalWall(nextVerticals[i][0], nextVerticals[i][1])) {
                noBlockNextVerticals.push(nextVerticals[i]);
            }
        }
        return {arrOfHorizontal: noBlockNextHorizontals, arrOfVertical: noBlockNextVerticals};
    }

    static clone(game) {
        const _clone = new MCTSGame(true);
        _clone.board = MCTSBoard.clone(game.board);
        if (game.winner === null) {
            _clone.winner = null;
        } else {
            _clone.winner = _clone.board.pawns[game.winner.index];
        }
        _clone._turn = game._turn;
        _clone.validNextWalls = {
            horizontal: create2DArrayClonedFrom(game.validNextWalls.horizontal),
            vertical: create2DArrayClonedFrom(game.validNextWalls.vertical)
        };
        _clone._probableNextWalls = {
            horizontal: create2DArrayClonedFrom(game._probableNextWalls.horizontal),
            vertical: create2DArrayClonedFrom(game._probableNextWalls.vertical)
        };
        _clone._probableValidNextWalls = null;
        _clone._probableValidNextWallsUpdated = false;
        _clone.openWays = {
            upDown: create2DArrayClonedFrom(game.openWays.upDown),
            leftRight: create2DArrayClonedFrom(game.openWays.leftRight)
        };
        _clone._validNextPositions = create2DArrayClonedFrom(game._validNextPositions);
        _clone._validNextPositionsUpdated = game._validNextPositionsUpdated;
        return _clone;
    }
}

// MNode class for Monte Carlo Tree Search
class MNode {
    constructor(move, parent, uctConst) {
        this.move = move;
        this.parent = parent;
        this.uctConst = uctConst;
        this.numWins = 0;
        this.numSims = 0;
        this.children = [];
        this.isTerminal = false;
    }

    get isLeaf() {
        return this.children.length === 0;
    }

    get isNew() {
        return this.numSims === 0;
    }

    get uct() {
        if (this.parent === null || this.parent.numSims === 0) {
            throw "UCT_ERROR";
        }
        if (this.numSims === 0) {
            return Infinity;
        }
        return (this.numWins / this.numSims) + Math.sqrt((this.uctConst * Math.log(this.parent.numSims)) / this.numSims);
    }

    get winRate() {
        return this.numWins / this.numSims;
    }

    get maxUCTChild() {
        let maxUCTIndices;
        let maxUCT = -Infinity;
        for (let i = 0; i < this.children.length; i++) {
            const uct = this.children[i].uct;
            if (uct > maxUCT) {
                maxUCT = uct;
                maxUCTIndices = [i];
            } else if (uct === maxUCT) {
                maxUCTIndices.push(i);
            }
        }
        const maxUCTIndex = randomChoice(maxUCTIndices);
        return this.children[maxUCTIndex];
    }

    get maxWinRateChild() {
        let maxWinRateIndex;
        let maxWinRate = -Infinity;
        for (let i = 0; i < this.children.length; i++) {
            if (this.children[i].winRate > maxWinRate) {
                maxWinRate = this.children[i].winRate;
                maxWinRateIndex = i;
            }
        }
        return this.children[maxWinRateIndex];
    }

    get maxSimsChild() {
        let maxSimsIndex;
        let maxSims = -Infinity;
        for (let i = 0; i < this.children.length; i++) {
            if (this.children[i].numSims > maxSims) {
                maxSims = this.children[i].numSims;
                maxSimsIndex = i;
            }
        }
        return this.children[maxSimsIndex];
    }

    addChild(childNode) {
        this.children.push(childNode);
    }
}

// Monte Carlo Tree Search implementation
class MonteCarloTreeSearch {
    constructor(game, uctConst) {
        this.game = game;
        this.uctConst = uctConst;
        this.root = new MNode(null, null, this.uctConst);
        this.totalNumOfSimulations = 0;
    }

    static maxDepth(node) {
        let max = 0;
        for (let i = 0; i < node.children.length; i++) {
            const d = this.maxDepth(node.children[i]) + 1;
            if (d > max) {
                max = d;
            }
        }
        return max;
    }

    search(numOfSimulations) {
        const uctConst = this.uctConst;
        let currentNode = this.root;
        const limitOfTotalNumOfSimulations = this.totalNumOfSimulations + numOfSimulations;

        while (this.totalNumOfSimulations < limitOfTotalNumOfSimulations) {
            // Selection
            if (currentNode.isTerminal) {
                this.rollout(currentNode);
                currentNode = this.root;
            } else if (currentNode.isLeaf) {
                if (currentNode.isNew) {
                    this.rollout(currentNode);
                    currentNode = this.root;
                } else {
                    // Expansion
                    const simulationGame = this.getSimulationGameAtNode(currentNode);
                    let move, childNode;
                    if (simulationGame.pawnOfNotTurn.numberOfLeftWalls > 0) {
                        const nextPositionTuples = simulationGame.getArrOfValidNextPositionTuples();
                        for (let i = 0; i < nextPositionTuples.length; i++) {
                            move = [nextPositionTuples[i], null, null];
                            childNode = new MNode(move, currentNode, uctConst);
                            currentNode.addChild(childNode);
                        }
                        if (simulationGame.pawnOfTurn.numberOfLeftWalls > 0) {
                            const noBlockNextHorizontals = simulationGame.getArrOfProbableValidNoBlockNextHorizontalWallPositions();
                            for (let i = 0; i < noBlockNextHorizontals.length; i++) {
                                move = [null, noBlockNextHorizontals[i], null];
                                childNode = new MNode(move, currentNode, uctConst);
                                currentNode.addChild(childNode);
                            }
                            const noBlockNextVerticals = simulationGame.getArrOfProbableValidNoBlockNextVerticalWallPositions();
                            for (let i = 0; i < noBlockNextVerticals.length; i++) {
                                move = [null, null, noBlockNextVerticals[i]];
                                childNode = new MNode(move, currentNode, uctConst);
                                currentNode.addChild(childNode);
                            }
                        }
                    } else {
                        const nextPositions = MCTSAIHelper.chooseShortestPathNextPawnPositionsThoroughly(simulationGame);
                        for (let i = 0; i < nextPositions.length; i++) {
                            const nextPosition = nextPositions[i];
                            move = [[nextPosition.row, nextPosition.col], null, null];
                            childNode = new MNode(move, currentNode, uctConst);
                            currentNode.addChild(childNode);
                        }
                        if (simulationGame.pawnOfTurn.numberOfLeftWalls > 0) {
                            const noBlockNextWallsInterrupt = simulationGame.getArrOfValidNoBlockNextWallsDisturbPathOf(simulationGame.pawnOfNotTurn);
                            const noBlockNextHorizontalsInterrupt = noBlockNextWallsInterrupt.arrOfHorizontal;
                            for (let i = 0; i < noBlockNextHorizontalsInterrupt.length; i++) {
                                move = [null, noBlockNextHorizontalsInterrupt[i], null];
                                childNode = new MNode(move, currentNode, uctConst);
                                currentNode.addChild(childNode);
                            }
                            const noBlockNextVerticalsInterrupt = noBlockNextWallsInterrupt.arrOfVertical;
                            for (let i = 0; i < noBlockNextVerticalsInterrupt.length; i++) {
                                move = [null, null, noBlockNextVerticalsInterrupt[i]];
                                childNode = new MNode(move, currentNode, uctConst);
                                currentNode.addChild(childNode);
                            }
                        }
                    }
                    if (currentNode.children.length > 0) {
                        this.rollout(randomChoice(currentNode.children));
                    }
                    currentNode = this.root;
                }
            } else {
                currentNode = currentNode.maxUCTChild;
            }
        }
    }

    selectBestMove() {
        const best = this.root.maxSimsChild;
        return {move: best.move, winRate: best.winRate};
    }

    getSimulationGameAtNode(node) {
        const simulationGame = MCTSGame.clone(this.game);
        const stack = [];

        let ancestor = node;
        while (ancestor.parent !== null) {
            stack.push(ancestor.move);
            ancestor = ancestor.parent;
        }

        while (stack.length > 0) {
            const move = stack.pop();
            simulationGame.doMove(move);
        }
        return simulationGame;
    }

    rollout(node) {
        this.totalNumOfSimulations++;
        const simulationGame = this.getSimulationGameAtNode(node);
        const nodePawnIndex = simulationGame.pawnIndexOfNotTurn;

        if (simulationGame.winner !== null) {
            node.isTerminal = true;
        }

        const cacheForPawns = [
            {updated: false, prev: null, next: null, distanceToGoal: null},
            {updated: false, prev: null, next: null, distanceToGoal: null}
        ];
        let pawnMoveFlag = false;

        while (simulationGame.winner === null) {
            if (!cacheForPawns[0].updated) {
                const t = MCTSAIHelper.get2DArrayPrevAndNextAndDistanceToGoalFor(simulationGame.pawn0, simulationGame);
                cacheForPawns[0].prev = t[0];
                cacheForPawns[0].next = t[1];
                cacheForPawns[0].distanceToGoal = t[2];
                cacheForPawns[0].updated = true;
            }
            if (!cacheForPawns[1].updated) {
                const t = MCTSAIHelper.get2DArrayPrevAndNextAndDistanceToGoalFor(simulationGame.pawn1, simulationGame);
                cacheForPawns[1].prev = t[0];
                cacheForPawns[1].next = t[1];
                cacheForPawns[1].distanceToGoal = t[2];
                cacheForPawns[1].updated = true;
            }

            const pawnOfTurn = simulationGame.pawnOfTurn;
            const pawnIndexOfTurn = simulationGame.pawnIndexOfTurn;

            if (Math.random() < 0.7) {
                pawnMoveFlag = false;
                const next = cacheForPawns[pawnIndexOfTurn].next;
                const currentPosition = pawnOfTurn.position;
                let nextPosition = next[currentPosition.row][currentPosition.col];

                if (nextPosition === null) {
                    throw "already in goal Position....";
                }

                if (MCTSAIHelper.arePawnsAdjacent(simulationGame)) {
                    const nextNextPosition = next[nextPosition.row][nextPosition.col];
                    if (nextNextPosition !== null &&
                        simulationGame.validNextPositions[nextNextPosition.row][nextNextPosition.col] === true) {
                        nextPosition = nextNextPosition;
                        cacheForPawns[pawnIndexOfTurn].distanceToGoal -= 2;
                    } else {
                        const nextPositions = MCTSAIHelper.chooseShortestPathNextPawnPositionsThoroughly(simulationGame);
                        const _nextPosition = randomChoice(nextPositions);
                        if (_nextPosition.equals(nextPosition)) {
                            cacheForPawns[pawnIndexOfTurn].distanceToGoal -= 1;
                        } else {
                            nextPosition = _nextPosition;
                            cacheForPawns[pawnIndexOfTurn].updated = false;
                        }
                    }
                } else {
                    cacheForPawns[pawnIndexOfTurn].distanceToGoal -= 1;
                }
                simulationGame.movePawn(nextPosition.row, nextPosition.col);
            } else if (!pawnMoveFlag && pawnOfTurn.numberOfLeftWalls > 0) {
                const nextMove = MCTSAIHelper.chooseProbableNextWall(simulationGame);
                if (nextMove !== null) {
                    simulationGame.doMove(nextMove);
                    cacheForPawns[0].updated = false;
                    cacheForPawns[1].updated = false;
                } else {
                    pawnMoveFlag = true;
                }
            } else {
                pawnMoveFlag = false;
                const prev = cacheForPawns[pawnIndexOfTurn].prev;
                const currentPosition = pawnOfTurn.position;
                let prevPosition = prev[currentPosition.row][currentPosition.col];
                if (prevPosition === null || !simulationGame.validNextPositions[prevPosition.row][prevPosition.col]) {
                    const prevPositions = MCTSAIHelper.chooseLongestPathNextPawnPositionsThoroughly(simulationGame);
                    prevPosition = randomChoice(prevPositions);
                    cacheForPawns[pawnIndexOfTurn].updated = false;
                } else {
                    cacheForPawns[pawnIndexOfTurn].distanceToGoal += 1;
                }
                simulationGame.movePawn(prevPosition.row, prevPosition.col);
            }
        }

        // Backpropagation
        let ancestor = node;
        let ancestorPawnIndex = nodePawnIndex;
        while (ancestor !== null) {
            ancestor.numSims++;
            if (simulationGame.winner.index === ancestorPawnIndex) {
                ancestor.numWins += 1;
            }
            ancestor = ancestor.parent;
            ancestorPawnIndex = (ancestorPawnIndex + 1) % 2;
        }
    }
}

// MCTS AI Helper class
class MCTSAIHelper {
    static chooseShortestPathNextPawnPositionsThoroughly(game) {
        const valids = indicesOfValueIn2DArray(game.validNextPositions, true);
        const distances = [];
        for (let i = 0; i < valids.length; i++) {
            const clonedGame = MCTSGame.clone(game);
            clonedGame.movePawn(valids[i][0], valids[i][1]);
            const distance = MCTSAIHelper.getShortestDistanceToGoalFor(clonedGame.pawnOfNotTurn, clonedGame);
            distances.push(distance);
        }
        const nextPositions = [];
        for (const index of indicesOfMin(distances)) {
            nextPositions.push(new PawnPosition(valids[index][0], valids[index][1]));
        }
        return nextPositions;
    }

    static chooseLongestPathNextPawnPositionsThoroughly(game) {
        const valids = indicesOfValueIn2DArray(game.validNextPositions, true);
        const distances = [];
        for (let i = 0; i < valids.length; i++) {
            const clonedGame = MCTSGame.clone(game);
            clonedGame.movePawn(valids[i][0], valids[i][1]);
            const distance = MCTSAIHelper.getShortestDistanceToGoalFor(clonedGame.pawnOfNotTurn, clonedGame);
            distances.push(distance);
        }
        const nextPositions = [];
        for (const index of indicesOfMax(distances)) {
            nextPositions.push(new PawnPosition(valids[index][0], valids[index][1]));
        }
        return nextPositions;
    }

    static get2DArrayPrevAndNextAndDistanceToGoalFor(pawn, game) {
        const t = this.getRandomShortestPathToGoal(pawn, game);
        const dist = t[0];
        const prev = t[1];
        const goalPosition = t[2];
        const distanceToGoal = dist[goalPosition.row][goalPosition.col];
        const next = MCTSAIHelper.getNextByReversingPrev(prev, goalPosition);
        return [prev, next, distanceToGoal];
    }

    static chooseShortestPathNextPawnPosition(game) {
        let nextPosition = null;
        if (MCTSAIHelper.arePawnsAdjacent(game)) {
            const nextPositions = this.chooseShortestPathNextPawnPositionsThoroughly(game);
            nextPosition = randomChoice(nextPositions);
        } else {
            const next = MCTSAIHelper.get2DArrayPrevAndNextAndDistanceToGoalFor(game.pawnOfTurn, game)[1];
            const currentPosition = game.pawnOfTurn.position;
            nextPosition = next[currentPosition.row][currentPosition.col];
        }
        return nextPosition;
    }

    static chooseProbableNextWall(game) {
        const nextMoves = [];
        const nextHorizontals = indicesOfValueIn2DArray(game.probableValidNextWalls.horizontal, true);
        for (let i = 0; i < nextHorizontals.length; i++) {
            nextMoves.push([null, nextHorizontals[i], null]);
        }
        const nextVerticals = indicesOfValueIn2DArray(game.probableValidNextWalls.vertical, true);
        for (let i = 0; i < nextVerticals.length; i++) {
            nextMoves.push([null, null, nextVerticals[i]]);
        }
        if (nextMoves.length === 0) {
            return null;
        }
        let nextMoveIndex = randomIndex(nextMoves);
        while (!game.isPossibleNextMove(nextMoves[nextMoveIndex])) {
            nextMoves.splice(nextMoveIndex, 1);
            if (nextMoves.length === 0) {
                return null;
            }
            nextMoveIndex = randomIndex(nextMoves);
        }
        return nextMoves[nextMoveIndex];
    }

    static arePawnsAdjacent(game) {
        return ((game.pawnOfNotTurn.position.row === game.pawnOfTurn.position.row &&
                 Math.abs(game.pawnOfNotTurn.position.col - game.pawnOfTurn.position.col) === 1) ||
                (game.pawnOfNotTurn.position.col === game.pawnOfTurn.position.col &&
                 Math.abs(game.pawnOfNotTurn.position.row - game.pawnOfTurn.position.row) === 1));
    }

    static getRandomShortestPathToGoal(pawn, game) {
        const visited = create2DArrayInitializedTo(9, 9, false);
        const dist = create2DArrayInitializedTo(9, 9, Infinity);
        const prev = create2DArrayInitializedTo(9, 9, null);

        const pawnMoveTuples = shuffle([MOVE_UP, MOVE_RIGHT, MOVE_DOWN, MOVE_LEFT]);
        const queue = [];

        visited[pawn.position.row][pawn.position.col] = true;
        dist[pawn.position.row][pawn.position.col] = 0;
        queue.push(pawn.position);

        while (queue.length > 0) {
            let position = queue.shift();
            if (position.row === pawn.goalRow) {
                const goalPosition = position;
                return [dist, prev, goalPosition];
            }
            for (let i = 0; i < pawnMoveTuples.length; i++) {
                if (game.isOpenWay(position.row, position.col, pawnMoveTuples[i])) {
                    const nextPosition = position.newAddMove(pawnMoveTuples[i]);
                    if (nextPosition.row >= 0 && nextPosition.row < 9 &&
                        nextPosition.col >= 0 && nextPosition.col < 9 &&
                        !visited[nextPosition.row][nextPosition.col]) {
                        const alt = dist[position.row][position.col] + 1;
                        dist[nextPosition.row][nextPosition.col] = alt;
                        prev[nextPosition.row][nextPosition.col] = position;
                        visited[nextPosition.row][nextPosition.col] = true;
                        queue.push(nextPosition);
                    }
                }
            }
        }
        return [dist, prev, null];
    }

    static getShortestDistanceToGoalFor(pawn, game) {
        const t = MCTSAIHelper.getRandomShortestPathToGoal(pawn, game);
        const dist = t[0];
        const goalPosition = t[2];
        if (goalPosition === null) {
            return Infinity;
        }
        return dist[goalPosition.row][goalPosition.col];
    }

    static getAllShortestPathsToEveryPosition(pawn, game) {
        const searched = create2DArrayInitializedTo(9, 9, false);
        const visited = create2DArrayInitializedTo(9, 9, false);
        const dist = create2DArrayInitializedTo(9, 9, Infinity);
        const multiPrev = create2DArrayInitializedTo(9, 9, null);

        const pawnMoveTuples = [MOVE_UP, MOVE_RIGHT, MOVE_DOWN, MOVE_LEFT];
        const queue = [];
        visited[pawn.position.row][pawn.position.col] = true;
        dist[pawn.position.row][pawn.position.col] = 0;
        queue.push(pawn.position);

        while (queue.length > 0) {
            let position = queue.shift();
            for (let i = 0; i < pawnMoveTuples.length; i++) {
                if (game.isOpenWay(position.row, position.col, pawnMoveTuples[i])) {
                    const nextPosition = position.newAddMove(pawnMoveTuples[i]);
                    if (nextPosition.row >= 0 && nextPosition.row < 9 &&
                        nextPosition.col >= 0 && nextPosition.col < 9 &&
                        !searched[nextPosition.row][nextPosition.col]) {
                        const alt = dist[position.row][position.col] + 1;
                        if (alt < dist[nextPosition.row][nextPosition.col]) {
                            dist[nextPosition.row][nextPosition.col] = alt;
                            multiPrev[nextPosition.row][nextPosition.col] = [position];
                        } else if (alt === dist[nextPosition.row][nextPosition.col]) {
                            multiPrev[nextPosition.row][nextPosition.col].push(position);
                        }
                        if (!visited[nextPosition.row][nextPosition.col]) {
                            visited[nextPosition.row][nextPosition.col] = true;
                            queue.push(nextPosition);
                        }
                    }
                }
            }
            searched[position.row][position.col] = true;
        }
        return [dist, multiPrev];
    }

    static getNextByReversingPrev(prev, goalPosition) {
        const next = create2DArrayInitializedTo(9, 9, null);
        let prevPosition;
        let position = goalPosition;
        while ((prevPosition = prev[position.row][position.col])) {
            next[prevPosition.row][prevPosition.col] = position;
            position = prevPosition;
        }
        return next;
    }

    static getValidNextWallsDisturbPathOf(pawn, game) {
        const validNextWallsInterrupt = create2DArrayInitializedTo(8, 8, false);
        const validNextWallsDisturb = create2DArrayInitializedTo(8, 8, false);

        const visited = create2DArrayInitializedTo(9, 9, false);
        const t = MCTSAIHelper.getAllShortestPathsToEveryPosition(pawn, game);
        const dist = t[0];
        const prev = t[1];
        const goalRow = pawn.goalRow;
        const goalCols = indicesOfMin(dist[goalRow]);

        const queue = [];
        for (let i = 0; i < goalCols.length; i++) {
            const goalPosition = new PawnPosition(goalRow, goalCols[i]);
            queue.push(goalPosition);
        }

        while (queue.length > 0) {
            let position = queue.shift();
            let prevs = prev[position.row][position.col];
            if (prevs === null) {
                continue;
            }
            for (let i = 0; i < prevs.length; i++) {
                let prevPosition = prevs[i];
                const pawnMoveTuple = position.getDisplacementPawnMoveTupleFrom(prevPosition);

                if (pawnMoveTuple[0] === -1 && pawnMoveTuple[1] === 0) { // up
                    if (prevPosition.col < 8) {
                        validNextWallsInterrupt[prevPosition.row - 1][prevPosition.col] = true;
                    }
                    if (prevPosition.col > 0) {
                        validNextWallsInterrupt[prevPosition.row - 1][prevPosition.col - 1] = true;
                    }
                } else if (pawnMoveTuple[0] === 1 && pawnMoveTuple[1] === 0) { // down
                    if (prevPosition.col < 8) {
                        validNextWallsInterrupt[prevPosition.row][prevPosition.col] = true;
                    }
                    if (prevPosition.col > 0) {
                        validNextWallsInterrupt[prevPosition.row][prevPosition.col - 1] = true;
                    }
                } else if (pawnMoveTuple[0] === 0 && pawnMoveTuple[1] === -1) { // left
                    if (prevPosition.row < 8) {
                        validNextWallsInterrupt[prevPosition.row][prevPosition.col - 1] = true;
                    }
                    if (prevPosition.row > 0) {
                        validNextWallsInterrupt[prevPosition.row - 1][prevPosition.col - 1] = true;
                    }
                } else if (pawnMoveTuple[0] === 0 && pawnMoveTuple[1] === 1) { // right
                    if (prevPosition.row < 8) {
                        validNextWallsInterrupt[prevPosition.row][prevPosition.col] = true;
                    }
                    if (prevPosition.row > 0) {
                        validNextWallsInterrupt[prevPosition.row - 1][prevPosition.col] = true;
                    }
                }

                if (!visited[prevPosition.row][prevPosition.col]) {
                    visited[prevPosition.row][prevPosition.col] = true;
                    queue.push(prevPosition);
                }
            }
        }

        const wall2DArrays = {horizontal: validNextWallsInterrupt, vertical: validNextWallsDisturb};
        MCTSGame.setWallsBesidePawn(wall2DArrays, pawn);

        wall2DArrays.horizontal = logicalAndBetween2DArray(wall2DArrays.horizontal, game.validNextWalls.horizontal);
        wall2DArrays.vertical = logicalAndBetween2DArray(wall2DArrays.vertical, game.validNextWalls.vertical);

        return wall2DArrays;
    }
}

// MCTS AI class - represents the AI player using Monte Carlo Tree Search
class MCTSAI {
    constructor(numOfMCTSSimulations = 1000, uctConst = 1.41, aiDevelopMode = false) {
        this.numOfMCTSSimulations = numOfMCTSSimulations;
        this.uctConst = uctConst;
        this.aiDevelopMode = aiDevelopMode;
    }

    // Convert current game state to MCTSGame format
    static createMCTSGameFromState(pawnsState, placedFencesState, fencesCount) {
        const mctsGame = new MCTSGame();

        // Convert pawn positions (note: coordinate system conversion)
        // Original: pawns = {1: {x, y}, 2: {x, y}} where y=0 is player 1 start
        // MCTS: row/col where row=0 is top (player 2 start)
        mctsGame.board.pawns[0].position = new PawnPosition(8 - pawnsState[1].y, pawnsState[1].x);
        mctsGame.board.pawns[1].position = new PawnPosition(8 - pawnsState[2].y, pawnsState[2].x);
        mctsGame.board.pawns[0].numberOfLeftWalls = fencesCount[1];
        mctsGame.board.pawns[1].numberOfLeftWalls = fencesCount[2];

        // Reset walls and openWays
        mctsGame.board.walls = {
            horizontal: create2DArrayInitializedTo(8, 8, false),
            vertical: create2DArrayInitializedTo(8, 8, false)
        };
        mctsGame.validNextWalls = {
            horizontal: create2DArrayInitializedTo(8, 8, true),
            vertical: create2DArrayInitializedTo(8, 8, true)
        };
        mctsGame.openWays = {
            upDown: create2DArrayInitializedTo(10, 9, true),
            leftRight: create2DArrayInitializedTo(9, 10, true)
        };
        // Set boundaries as blocked
        for (let i = 0; i < 9; i++) {
            mctsGame.openWays.upDown[0][i] = false;
            mctsGame.openWays.upDown[9][i] = false;
            mctsGame.openWays.leftRight[i][0] = false;
            mctsGame.openWays.leftRight[i][9] = false;
        }

        // Convert fences
        for (const fence of placedFencesState) {
            // Original fence: {x, y, orientation} where x,y are board coordinates
            // MCTS uses row/col
            const mctsRow = 7 - fence.y;
            const mctsCol = fence.x;

            if (fence.orientation === 'h') {
                mctsGame.board.walls.horizontal[mctsRow][mctsCol] = true;
                // Block open ways
                mctsGame.openWays.upDown[mctsRow + 1][mctsCol] = false;
                mctsGame.openWays.upDown[mctsRow + 1][mctsCol + 1] = false;
                // Update valid walls
                mctsGame.validNextWalls.horizontal[mctsRow][mctsCol] = false;
                mctsGame.validNextWalls.vertical[mctsRow][mctsCol] = false;
                if (mctsCol > 0) mctsGame.validNextWalls.horizontal[mctsRow][mctsCol - 1] = false;
                if (mctsCol < 7) mctsGame.validNextWalls.horizontal[mctsRow][mctsCol + 1] = false;
            } else {
                mctsGame.board.walls.vertical[mctsRow][mctsCol] = true;
                // Block open ways
                mctsGame.openWays.leftRight[mctsRow][mctsCol + 1] = false;
                mctsGame.openWays.leftRight[mctsRow + 1][mctsCol + 1] = false;
                // Update valid walls
                mctsGame.validNextWalls.vertical[mctsRow][mctsCol] = false;
                mctsGame.validNextWalls.horizontal[mctsRow][mctsCol] = false;
                if (mctsRow > 0) mctsGame.validNextWalls.vertical[mctsRow - 1][mctsCol] = false;
                if (mctsRow < 7) mctsGame.validNextWalls.vertical[mctsRow + 1][mctsCol] = false;
            }
        }

        mctsGame._updateProbableNextWalls();
        mctsGame._validNextPositionsUpdated = false;
        mctsGame._probableValidNextWallsUpdated = false;

        return mctsGame;
    }

    // Convert MCTS move to original game format
    static convertMCTSMoveToOriginal(mctsMove) {
        if (mctsMove[0] !== null) {
            // Pawn move
            const mctsRow = mctsMove[0][0];
            const mctsCol = mctsMove[0][1];
            return {
                type: 'move',
                x: mctsCol,
                y: 8 - mctsRow
            };
        } else if (mctsMove[1] !== null) {
            // Horizontal wall
            const mctsRow = mctsMove[1][0];
            const mctsCol = mctsMove[1][1];
            return {
                type: 'fence',
                x: mctsCol,
                y: 7 - mctsRow,
                orientation: 'h'
            };
        } else if (mctsMove[2] !== null) {
            // Vertical wall
            const mctsRow = mctsMove[2][0];
            const mctsCol = mctsMove[2][1];
            return {
                type: 'fence',
                x: mctsCol,
                y: 7 - mctsRow,
                orientation: 'v'
            };
        }
        return null;
    }

    chooseNextMove(pawnsState, placedFencesState, fencesCount, playerIndex) {
        const d0 = new Date();

        // Convert current game state to MCTSGame
        const mctsGame = MCTSAI.createMCTSGameFromState(pawnsState, placedFencesState, fencesCount);

        // Set correct turn (playerIndex is 1 or 2, MCTS uses 0 or 1)
        // Player 1 (index=1) corresponds to MCTS pawn index 0
        // Player 2 (index=2) corresponds to MCTS pawn index 1
        mctsGame._turn = playerIndex === 1 ? 0 : 1;

        // Run MCTS
        const mcts = new MonteCarloTreeSearch(mctsGame, this.uctConst);
        mcts.search(this.numOfMCTSSimulations);

        const best = mcts.selectBestMove();
        const mctsMove = best.move;
        const winRate = best.winRate;

        // Convert move back to original format
        const originalMove = MCTSAI.convertMCTSMoveToOriginal(mctsMove);

        const d1 = new Date();
        console.log(`MCTS AI time for ${this.numOfMCTSSimulations} simulations: ${(d1.getTime() - d0.getTime()) / 1000} sec`);
        console.log(`MCTS estimated win rate: ${winRate}`);

        return originalMove;
    }
}

// Global MCTS AI instance
let mctsAI = null;
let useMCTSAI = false; // Flag to switch between Minimax and MCTS AI

// Initialize MCTS AI
function initMCTSAI(numSimulations = 1000, uctConst = 1.41) {
    mctsAI = new MCTSAI(numSimulations, uctConst);
}

// Find best move using MCTS AI
function findBestMoveMCTS(player) {
    if (!mctsAI) {
        initMCTSAI();
    }
    return mctsAI.chooseNextMove(pawns, placedFences, fences, player);
}

// Toggle between Minimax and MCTS AI
function setAIType(useMCTS) {
    useMCTSAI = useMCTS;
    if (useMCTS && !mctsAI) {
        initMCTSAI();
    }
}

