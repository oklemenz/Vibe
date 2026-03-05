"use strict";

// ==================== AI MODULE ====================
// This module contains all AI-related logic including:
// - Web Worker management for AI calculations
// - Minimax algorithm with alpha-beta pruning
// - Monte Carlo Tree Search (MCTS) AI
// - Board evaluation and pathfinding for AI

// AI state variables (shared with game.js)
let aiWorker = null; // Web Worker for AI calculations
let assistWorker = null; // Web Worker for Assist calculations
let workersAvailable = false; // Flag for worker availability
let workerBlobURL = null; // Cached blob URL for workers

// MCTS AI state
let mctsAI = null;
let mctsAssist = null;
let useMCTSAI = false;    // AI opponent: Minimax or MCTS
let useMCTSAssist = false; // Assist: Minimax or MCTS (independent choice)

// Default base values for all evaluation weights
const DEFAULT_WEIGHTS = Object.freeze({
    pathAdvantage:       100,
    criticalAdvantage:    50,
    defensivePenalty:     60,
    tempoBonus:           25,
    centerControl:         5,
    progressivePosition:  15,
    progressivePenalty:   12,
    directPath:           20,
    fenceAdvantage:        3,
    fenceDefense:          5,
    noFencePenalty:       20,
    sidePreference:        2,
    antiOscillation:     150,
    backwardPenalty:      80,
    forwardBonus:         20,
    shortestPathBonus:    30,
    oddSidesBonus:        35,  // Prefer goal columns with odd open approaches (harder to fence)
    clearPathForward:    200,  // Heavy penalty for backward/sideways when clear path exists
});

// Active calculation weights — multipliers applied to DEFAULT_WEIGHTS.
// Referenced by evaluateStateForPlayer and findBestMoveForPlayer.
// Workers have their own copies (sent via setWeights messages);
// on the main thread we swap these before each sync-fallback call.
let aiWeightVariance = {};
let aiScoreNoise = 0;

// Stored per-game personalities (separate for AI opponent and Assist)
let aiPersonality  = { weights: {}, noise: 0 };
let assistPersonality = { weights: {}, noise: 0 };

// Generate a random variance factor between (1 - range) and (1 + range)
function randomVariance(range) {
    return 1.0 + (Math.random() * 2 - 1) * range;
}

// Create a full set of randomised weight multipliers (one per DEFAULT_WEIGHTS key)
function createRandomWeights(varianceRange) {
    const weights = {};
    for (const key of Object.keys(DEFAULT_WEIGHTS)) {
        weights[key] = randomVariance(varianceRange);
    }
    return weights;
}

// Swap the active weights to the AI opponent personality
function activateAIWeights() {
    aiWeightVariance = aiPersonality.weights;
    aiScoreNoise     = aiPersonality.noise;
}

// Swap the active weights to the Assist personality
function activateAssistWeights() {
    aiWeightVariance = assistPersonality.weights;
    aiScoreNoise     = assistPersonality.noise;
}

// Called at every game start / restart — rolls new personalities for both
function randomizeAIForNewGame() {
    // --- AI opponent ---
    useMCTSAI = Math.random() < 0.5;
    if (useMCTSAI && !mctsAI) initMCTSAI();
    aiPersonality = { weights: createRandomWeights(0.10), noise: 5 };

    // --- Assist (independent) ---
    useMCTSAssist = Math.random() < 0.5;
    if (useMCTSAssist && !mctsAssist) initMCTSAssist();
    assistPersonality = { weights: createRandomWeights(0.10), noise: 3 };

    // Default active set to AI
    activateAIWeights();
    syncWeightsToWorkers();
}

// Send the correct personality to each worker
function syncWeightsToWorkers() {
    if (aiWorker && workersAvailable) {
        aiWorker.postMessage({ type: 'setWeights',
            data: { aiWeightVariance: aiPersonality.weights, aiScoreNoise: aiPersonality.noise }});
    }
    if (assistWorker) {
        assistWorker.postMessage({ type: 'setWeights',
            data: { aiWeightVariance: assistPersonality.weights, aiScoreNoise: assistPersonality.noise }});
    }
}

// Noise helper — used by evaluateStateForPlayer / findBestMoveForPlayer
function getScoreNoise() {
    if (aiScoreNoise <= 0) return 0;
    return (Math.random() * 2 - 1) * aiScoreNoise;
}

// Create worker from serialized functions (avoids code duplication)
function createWorkerBlobURL() {
    if (workerBlobURL) return workerBlobURL;

    // Serialize existing functions to create worker code
    const workerCode = `
"use strict";
const BOARD_SIZE = 9;

// Default weight base values (mirrored from main thread)
const DEFAULT_WEIGHTS = ${JSON.stringify(DEFAULT_WEIGHTS)};

// Per-game weight variance and noise (set via messages from main thread)
let aiWeightVariance = {};
let aiScoreNoise = 0;
function getScoreNoise() {
    if (aiScoreNoise <= 0) return 0;
    return (Math.random() * 2 - 1) * aiScoreNoise;
}

self.onmessage = function(e) {
    const { type, data } = e.data;
    if (type === 'setWeights') {
        aiWeightVariance = data.aiWeightVariance || {};
        aiScoreNoise = data.aiScoreNoise || 0;
        return;
    }
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
${countOpenSidesToGoal.toString()}
${isPathClear.toString()}
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
        displayAssistProposal(bestMove);
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
    syncWeightsToWorkers();
    aiThinking = false;
    assistCalculationPlayer = null;
    hideAIThinkingIndicator();
    hideCurrentPlayerThinkingIndicator();
    clearAssistProposal();
}

// Start AI calculation - uses worker if available, otherwise sync fallback
function startAICalculation() {
    // Use MCTS AI for this game?
    if (useMCTSAI) {
        setTimeout(() => {
            activateAIWeights();
            const bestMove = findBestMoveMCTS(aiPlayer);
            aiThinking = false;
            hideAIThinkingIndicator();
            if (bestMove) executeAIMove(bestMove);
        }, 50);
        return;
    }

    if (aiWorker && workersAvailable) {
        // Worker already has AI personality weights via setWeights
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
        // Synchronous fallback — activate AI personality weights
        setTimeout(() => {
            activateAIWeights();
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

    // Use MCTS Assist for this game?
    if (useMCTSAssist) {
        setTimeout(() => {
            if (assistCalculationPlayer !== currentPlayer) return;
            activateAssistWeights();
            const bestMove = findBestMoveMCTSAssist(currentPlayer);
            hideCurrentPlayerThinkingIndicator();
            assistCalculationPlayer = null;
            if (bestMove) displayAssistProposal(bestMove);
        }, 50);
        return;
    }

    if (assistWorker && workersAvailable) {
        // Worker already has Assist personality weights via setWeights
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
        // Synchronous fallback — activate Assist personality weights
        setTimeout(() => {
            if (assistCalculationPlayer !== currentPlayer) return;
            activateAssistWeights();
            const bestMove = findBestMoveForPlayer(currentPlayer, null, null, null, positionHistory);
            hideCurrentPlayerThinkingIndicator();
            assistCalculationPlayer = null;
            if (bestMove) {
                displayAssistProposal(bestMove);
            }
        }, 50);
    }
}

// ==================== AI TEST FUNCTIONS ====================
// These functions operate on test state for AI calculations

// Get shortest path distance for a player
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

// Count how many open (unfenced) approaches a position has toward the goal row.
// An odd number is harder for the opponent to fully block with 2-cell fences.
// Checks left, right, and forward directions from the given position.
function countOpenSidesToGoal(x, y, player, testFences) {
    const dy = player === 1 ? 1 : -1;
    let openSides = 0;

    // Forward (toward goal)
    const nextY = y + dy;
    if (nextY >= 0 && nextY < BOARD_SIZE && !isFenceBlockingTest(x, y, x, nextY, testFences)) {
        openSides++;
    }
    // Left
    if (x - 1 >= 0 && !isFenceBlockingTest(x, y, x - 1, y, testFences)) {
        openSides++;
    }
    // Right
    if (x + 1 < BOARD_SIZE && !isFenceBlockingTest(x, y, x + 1, y, testFences)) {
        openSides++;
    }

    return openSides;
}

// Check if the player has a clear, straight-line path to the goal
// (path distance equals vertical distance — no detour needed)
function isPathClear(player, testPawns, testFences) {
    const playerDist = getShortestPathDistance(player, testPawns, testFences);
    const goalY = player === 1 ? 8 : 0;
    const verticalDist = Math.abs(testPawns[player].y - goalY);
    return playerDist === verticalDist && verticalDist > 0;
}

// Evaluate board state for a specific player (positive = good for player, negative = good for opponent)
function evaluateStateForPlayer(player, testPawns, testFences, testFencesCounts) {
    const playerDist = getShortestPathDistance(player, testPawns, testFences);
    const oppPlayer = player === 1 ? 2 : 1;
    const oppDist = getShortestPathDistance(oppPlayer, testPawns, testFences);

    // Weight helper: base from DEFAULT_WEIGHTS, multiplied by per-game variance
    const w = (typeof aiWeightVariance !== 'undefined') ? aiWeightVariance : {};
    const dw = (typeof DEFAULT_WEIGHTS !== 'undefined') ? DEFAULT_WEIGHTS : {};
    const wv = (key) => (dw[key] || 0) * (w[key] || 1.0);

    // Check for immediate wins
    if (player === 1 && testPawns[1].y === 8) return 10000;
    if (player === 2 && testPawns[2].y === 0) return 10000;
    if (oppPlayer === 1 && testPawns[1].y === 8) return -10000;
    if (oppPlayer === 2 && testPawns[2].y === 0) return -10000;

    let score = 0;

    const pathAdvantage = oppDist - playerDist;
    score += pathAdvantage * wv('pathAdvantage');

    if (playerDist <= 2) {
        score += (3 - playerDist) * wv('criticalAdvantage');
    }
    if (oppDist <= 2) {
        score -= (3 - oppDist) * wv('defensivePenalty');
    }
    if (playerDist <= oppDist) {
        score += wv('tempoBonus');
    }

    const playerCenterDist = Math.abs(testPawns[player].x - 4);
    const oppCenterDist = Math.abs(testPawns[oppPlayer].x - 4);
    score += (oppCenterDist - playerCenterDist) * wv('centerControl');

    if (player === 1) {
        score += testPawns[1].y * wv('progressivePosition');
        score -= (8 - testPawns[2].y) * wv('progressivePenalty');
    } else {
        score += (8 - testPawns[2].y) * wv('progressivePosition');
        score -= testPawns[1].y * wv('progressivePenalty');
    }

    const playerGoalY = player === 1 ? 8 : 0;
    const distToGoalY = Math.abs(testPawns[player].y - playerGoalY);
    if (distToGoalY <= playerDist) {
        score += wv('directPath');
    }

    const fenceAdvantage = testFencesCounts[player] - testFencesCounts[oppPlayer];
    score += fenceAdvantage * wv('fenceAdvantage');

    if (oppDist <= 3 && testFencesCounts[player] > 0) {
        score += testFencesCounts[player] * wv('fenceDefense');
    }
    if (testFencesCounts[player] === 0 && testFencesCounts[oppPlayer] > 3) {
        score -= wv('noFencePenalty');
    }

    const currentX = testPawns[player].x;
    if (currentX < 4) {
        score += (4 - currentX) * wv('sidePreference');
    } else if (currentX > 4) {
        score += (currentX - 4) * wv('sidePreference');
    }

    // Near-goal: prefer positions with an odd number of open sides
    // (odd is harder for the opponent to fully block with 2-cell fences)
    if (playerDist <= 3) {
        const openSides = countOpenSidesToGoal(currentX, testPawns[player].y, player, testFences);
        if (openSides % 2 === 1) {
            score += wv('oddSidesBonus');
        }
    }

    // Clear-path bonus: when the shortest path equals vertical distance,
    // there is a straight unblocked corridor — strongly reward this state
    if (isPathClear(player, testPawns, testFences)) {
        score += wv('clearPathForward');
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

// ==================== MINIMAX ALGORITHM ====================

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

// ==================== FIND BEST MOVE ====================

// Find best move for a specific player (used for assist mode)
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

    // Pre-compute: does the player currently have a clear straight path to goal?
    const hasClearPath = isPathClear(player, testPawns, testFences);

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
            return idx >= playerHistory.length - 4 && pos.x === move.x && pos.y === move.y;
        });

        // Weight helper: base from DEFAULT_WEIGHTS, multiplied by per-game variance
        const w = (typeof aiWeightVariance !== 'undefined') ? aiWeightVariance : {};
        const dw = (typeof DEFAULT_WEIGHTS !== 'undefined') ? DEFAULT_WEIGHTS : {};
        const wv = (key) => (dw[key] || 0) * (w[key] || 1.0);
        const noise = (typeof getScoreNoise === 'function') ? getScoreNoise() : 0;

        if (isRecentPosition) {
            score -= wv('antiOscillation');
        }

        const isBackward = player === 1 ? (move.y < currentY) : (move.y > currentY);
        const isSideways = (move.y === currentY);

        if (isBackward) {
            const forwardMoves = moveMoves.filter(m =>
                player === 1 ? m.y > currentY : m.y < currentY
            );
            if (forwardMoves.length > 0) {
                score -= wv('backwardPenalty');
            }
        }

        // When a clear straight path exists, heavily penalise backward AND sideways
        // moves to prevent oscillation and unnecessary detours
        if (hasClearPath) {
            if (isBackward) {
                score -= wv('clearPathForward');
            } else if (isSideways) {
                // Sideways is less bad than backward, but still discouraged
                score -= wv('clearPathForward') * 0.5;
            }
        }

        const progress = player === 1 ? (move.y - currentY) : (currentY - move.y);
        if (progress > 0) {
            score += progress * wv('forwardBonus');
        }

        const isOnPath = nextPathCell && move.x === nextPathCell.x && move.y === nextPathCell.y;
        if (isOnPath) {
            score += wv('shortestPathBonus');
        }

        // Near goal: prefer the side with an odd number of open approaches
        if (playerDist <= 3) {
            const openSides = countOpenSidesToGoal(move.x, move.y, player, testFences);
            if (openSides % 2 === 1) {
                score += wv('oddSidesBonus');
            }
        }

        // Small random noise for less deterministic play
        score += noise;

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

            const score = minimaxForPlayer(player, testPawns, newFences, newCounts, depth - 1, -Infinity, Infinity, false)
                + ((typeof getScoreNoise === 'function') ? getScoreNoise() : 0);

            if (score > bestScore) {
                bestScore = score;
                bestMove = {type: 'fence', x: move.x, y: move.y, orientation: move.orientation};
            }
        }
    }

    return bestMove;
}

// ==================== MCTS IMPLEMENTATION ====================

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
        return originalMove;
    }
}

// Initialize MCTS AI (opponent)
function initMCTSAI(numSimulations = 1000, uctConst = 1.41) {
    mctsAI = new MCTSAI(numSimulations, uctConst);
}

// Initialize MCTS Assist (separate instance)
function initMCTSAssist(numSimulations = 1000, uctConst = 1.41) {
    mctsAssist = new MCTSAI(numSimulations, uctConst);
}

// Find best move using MCTS AI (opponent)
function findBestMoveMCTS(player) {
    if (!mctsAI) initMCTSAI();
    return mctsAI.chooseNextMove(pawns, placedFences, fences, player);
}

// Find best move using MCTS Assist (separate instance)
function findBestMoveMCTSAssist(player) {
    if (!mctsAssist) initMCTSAssist();
    return mctsAssist.chooseNextMove(pawns, placedFences, fences, player);
}

// Toggle between Minimax and MCTS AI (manual override)
function setAIType(useMCTS) {
    useMCTSAI = useMCTS;
    if (useMCTS && !mctsAI) initMCTSAI();
}
