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
        const { player, pawns, placedFences, fences, calculationId } = data;
        try {
            const bestMove = findBestMoveForPlayer(player, pawns, placedFences, fences);
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
    if (aiWorker && workersAvailable) {
        // Use Web Worker (non-blocking)
        aiWorker.postMessage({
            type: 'calculate', data: {
                player: aiPlayer,
                pawns: {1: {...pawns[1]}, 2: {...pawns[2]}},
                placedFences: [...placedFences],
                fences: {...fences}
            }
        });
    } else {
        // Synchronous fallback - use setTimeout to allow UI to update
        setTimeout(() => {
            const bestMove = findBestMoveForPlayer(aiPlayer);
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
                fences: {...fences}
            }
        });
    } else {
        // Synchronous fallback - use setTimeout to allow UI to update
        setTimeout(() => {
            // Check if this calculation is still valid
            if (assistCalculationPlayer !== currentPlayer) return;

            const bestMove = findBestMoveForPlayer(currentPlayer);
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
        document.getElementById('player2-name').innerHTML = '🟢 AI';
        document.getElementById('top-player2-name').innerHTML = '🟢 AI';
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

function onPointerDownForHighlight(event) {
    pointerOnHighlight = false;

    // Temporarily disable OrbitControls zoom at pointer start
    // This prevents accidental zoom when trying to click on game elements
    if (viewMode !== 'top') {
        controls.enableZoom = false;
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
    if (pointerOnHighlight) {
        // Stop event from reaching OrbitControls
        event.stopPropagation();
        event.stopImmediatePropagation();
    }
    // Re-enable controls and zoom
    if (viewMode !== 'top') {
        controls.enabled = true;
        controls.enableZoom = false; // Keep zoom disabled as per earlier setting
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

        // Rename players in fence panel
        if (player1Name) player1Name.textContent = '🔴 Player';
        if (player2Name) player2Name.textContent = '🟢 AI';
        if (topPlayer2Name) topPlayer2Name.textContent = '🟢 AI';

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

        // Reset player names in fence panel
        if (player1Name) player1Name.textContent = '🔴 Player 1';
        if (player2Name) player2Name.textContent = '🟢 Player 2';
        if (topPlayer2Name) topPlayer2Name.textContent = '🟢 Player 2';

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

    // Progressive position bonus - reward advancement
    if (player === 1) {
        score += testPawns[1].y * 8;
        score -= (8 - testPawns[2].y) * 8;
    } else {
        score += (8 - testPawns[2].y) * 8;
        score -= testPawns[1].y * 8;
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

    // Lock OrbitControls
    controls.enabled = false;
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

    // Unlock OrbitControls
    controls.enabled = true;
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
function findBestMoveForPlayer(player, inputPawns, inputFences, inputFenceCounts) {
    // Use provided data or fall back to global state
    const testPawns = inputPawns ? {
        1: {...inputPawns[1]}, 2: {...inputPawns[2]}
    } : {
        1: {...pawns[1]}, 2: {...pawns[2]}
    };
    const testFences = inputFences ? [...inputFences] : [...placedFences];
    const testFencesCounts = inputFenceCounts ? {...inputFenceCounts} : {...fences};

    let bestMove = null;
    let bestScore = -Infinity;
    const depth = 4; // Same depth as AI

    // Calculate distances for strategic decisions
    const playerDist = getShortestPathDistance(player, testPawns, testFences);
    const oppPlayer = player === 1 ? 2 : 1;
    const oppDist = getShortestPathDistance(oppPlayer, testPawns, testFences);

    // Evaluate pawn moves
    const moveMoves = getValidMovesTest(player, testPawns, testFences);

    // Sort moves by distance to goal (prefer moves toward goal)
    moveMoves.sort((a, b) => {
        const distA = player === 1 ? (8 - a.y) : a.y;
        const distB = player === 1 ? (8 - b.y) : b.y;
        return distA - distB;
    });

    for (const move of moveMoves) {
        const newPawns = {
            1: {...testPawns[1]}, 2: {...testPawns[2]}
        };
        newPawns[player] = {x: move.x, y: move.y};

        // Check for immediate win
        const goalY = player === 1 ? 8 : 0;
        if (move.y === goalY) {
            return {type: 'move', x: move.x, y: move.y};
        }

        const score = minimaxForPlayer(player, newPawns, testFences, testFencesCounts, depth - 1, -Infinity, Infinity, false);

        if (score > bestScore) {
            bestScore = score;
            bestMove = {type: 'move', x: move.x, y: move.y};
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
