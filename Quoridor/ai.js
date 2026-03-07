"use strict";

// ==================== AI MODULE ====================
// Three difficulty levels, each encapsulated in a closure factory:
//   createEasyAI()  → Monte Carlo Tree Search (MCTS)
//   createGoodAI()  → Minimax with alpha-beta pruning
//   createHardAI()  → Iterative-deepening PVS + transposition table
//
// A single unified Web Worker handles all three engines.
// Two worker instances: one for AI opponent, one for assist.

// ==================== STATE & CONFIGURATION ====================

let aiWorker = null;       // Web Worker for AI opponent
let assistWorker = null;   // Web Worker for assist suggestions
let workersAvailable = false;
let cachedWorkerBlobURL = null;

// AI difficulty: 'easy' | 'good' | 'hard'
let aiDifficulty = 'hard';

// Main-thread AI instances (sync fallback)
let easyAI = null;
let goodAI = null;
let hardAI = null;

// Weight variance for 'good' mode personality
const AI_VARIANCE_RANGE = 0.05;
const AI_VARIANCE_NOISE = 5;
const DEFAULT_WEIGHTS = Object.freeze({
    pathAdvantage: 100,
    criticalAdvantage: 50,
    defensivePenalty: 60,
    tempoBonus: 25,
    centerControl: 5,
    progressivePosition: 15,
    progressivePenalty: 12,
    directPath: 20,
    fenceAdvantage: 3,
    fenceDefense: 5,
    noFencePenalty: 20,
    sidePreference: 2,
    antiOscillation: 150,
    backwardPenalty: 80,
    forwardBonus: 20,
    shortestPathBonus: 30,
    oddSidesBonus: 35,
    clearPathForward: 200,
});

let aiWeightVariance = {};
let aiScoreNoise = 0;
let aiPersonality = {weights: {}, noise: 0};
let assistPersonality = {weights: {}, noise: 0};

function randomVariance(range) {
    return 1.0 + (Math.random() * 2 - 1) * range;
}

function createRandomWeights(varianceRange) {
    const w = {};
    for (const key of Object.keys(DEFAULT_WEIGHTS)) w[key] = randomVariance(varianceRange);
    return w;
}

function activateAIWeights() {
    aiWeightVariance = aiPersonality.weights;
    aiScoreNoise = aiPersonality.noise;
}

function activateAssistWeights() {
    aiWeightVariance = assistPersonality.weights;
    aiScoreNoise = assistPersonality.noise;
}

function randomizeAIForNewGame() {
    aiPersonality = {weights: createRandomWeights(AI_VARIANCE_RANGE), noise: AI_VARIANCE_NOISE};
    assistPersonality = {weights: createRandomWeights(AI_VARIANCE_RANGE), noise: AI_VARIANCE_NOISE};
    activateAIWeights();
    syncWeightsToWorkers();
}

function syncWeightsToWorkers() {
    const msg = {
        type: 'setWeights', data: {aiWeightVariance: aiPersonality.weights, aiScoreNoise: aiPersonality.noise}
    };
    if (aiWorker && workersAvailable) aiWorker.postMessage(msg);
    if (assistWorker && workersAvailable) {
        assistWorker.postMessage({
            type: 'setWeights',
            data: {aiWeightVariance: assistPersonality.weights, aiScoreNoise: assistPersonality.noise}
        });
    }
}

function getScoreNoise() {
    if (aiScoreNoise <= 0) return 0;
    return (Math.random() * 2 - 1) * aiScoreNoise;
}

// ==================== SHARED BOARD UTILITIES ====================
// Used by both goodAI and the game's getShortestPath / getValidMoves
// BOARD_SIZE is declared in game.js (shared global scope)

function isFenceBlockingTest(x1, y1, x2, y2, testFences) {
    const dx = x2 - x1, dy = y2 - y1;
    for (const fence of testFences) {
        if (fence.orientation === 'h') {
            if (dy !== 0) {
                const fenceY = fence.y + 1;
                if ((y1 === fenceY - 1 && y2 === fenceY) || (y1 === fenceY && y2 === fenceY - 1)) {
                    if (x1 >= fence.x && x1 <= fence.x + 1) return true;
                }
            }
        } else {
            if (dx !== 0) {
                const fenceX = fence.x + 1;
                if ((x1 === fenceX - 1 && x2 === fenceX) || (x1 === fenceX && x2 === fenceX - 1)) {
                    if (y1 >= fence.y && y1 <= fence.y + 1) return true;
                }
            }
        }
    }
    return false;
}

function hasPathToGoalTest(player, testPawns, testFences) {
    const goalY = player === 1 ? 8 : 0;
    const start = testPawns[player];
    const visited = new Set();
    const queue = [start];
    while (queue.length > 0) {
        const current = queue.shift();
        const key = `${current.x},${current.y}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (current.y === goalY) return true;
        for (const dir of [{dx: 0, dy: 1}, {dx: 0, dy: -1}, {dx: 1, dy: 0}, {dx: -1, dy: 0}]) {
            const nx = current.x + dir.dx, ny = current.y + dir.dy;
            if (nx >= 0 && nx < 9 && ny >= 0 && ny < 9 && !isFenceBlockingTest(current.x, current.y, nx, ny, testFences)) {
                queue.push({x: nx, y: ny});
            }
        }
    }
    return false;
}

function canPlaceFenceTest(x, y, orientation, testFences, testPawns) {
    if (x < 0 || x >= 8 || y < 0 || y >= 8) return false;
    for (const fence of testFences) {
        if (fence.x === x && fence.y === y && fence.orientation === orientation) return false;
        if (fence.x === x && fence.y === y && fence.orientation !== orientation) return false;
        if (orientation === 'h' && fence.orientation === 'h' && fence.y === y && Math.abs(fence.x - x) === 1) return false;
        if (orientation === 'v' && fence.orientation === 'v' && fence.x === x && Math.abs(fence.y - y) === 1) return false;
    }
    const newFences = [...testFences, {x, y, orientation}];
    return hasPathToGoalTest(1, testPawns, newFences) && hasPathToGoalTest(2, testPawns, newFences);
}

function getValidMovesTest(player, testPawns, testFences) {
    const moves = [];
    const pos = testPawns[player];
    const opponent = player === 1 ? 2 : 1;
    const opponentPos = testPawns[opponent];
    for (const dir of [{dx: 0, dy: 1}, {dx: 0, dy: -1}, {dx: 1, dy: 0}, {dx: -1, dy: 0}]) {
        const nx = pos.x + dir.dx, ny = pos.y + dir.dy;
        if (nx < 0 || nx >= 9 || ny < 0 || ny >= 9) continue;
        if (isFenceBlockingTest(pos.x, pos.y, nx, ny, testFences)) continue;
        if (nx === opponentPos.x && ny === opponentPos.y) {
            const jx = nx + dir.dx, jy = ny + dir.dy;
            if (jx >= 0 && jx < 9 && jy >= 0 && jy < 9 && !isFenceBlockingTest(nx, ny, jx, jy, testFences)) {
                moves.push({x: jx, y: jy});
            } else {
                const sideDirs = dir.dx === 0 ? [{dx: 1, dy: 0}, {dx: -1, dy: 0}] : [{dx: 0, dy: 1}, {dx: 0, dy: -1}];
                for (const sd of sideDirs) {
                    const sx = nx + sd.dx, sy = ny + sd.dy;
                    if (sx >= 0 && sx < 9 && sy >= 0 && sy < 9 && !isFenceBlockingTest(nx, ny, sx, sy, testFences)) {
                        moves.push({x: sx, y: sy});
                    }
                }
            }
        } else {
            moves.push({x: nx, y: ny});
        }
    }
    return moves;
}

function getShortestPathDistance(player, testPawns, testFences) {
    const goalY = player === 1 ? 8 : 0;
    const opp = player === 1 ? 2 : 1;
    const oppPos = testPawns[opp];
    const start = testPawns[player];
    const visited = new Set();
    const queue = [{x: start.x, y: start.y, dist: 0}];
    while (queue.length > 0) {
        const current = queue.shift();
        const key = `${current.x},${current.y}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (current.y === goalY) return current.dist;
        for (const dir of [{dx: 0, dy: 1}, {dx: 0, dy: -1}, {dx: 1, dy: 0}, {dx: -1, dy: 0}]) {
            const nx = current.x + dir.dx, ny = current.y + dir.dy;
            if (nx < 0 || nx >= 9 || ny < 0 || ny >= 9) continue;
            if (isFenceBlockingTest(current.x, current.y, nx, ny, testFences)) continue;
            if (nx === oppPos.x && ny === oppPos.y) {
                const jx = nx + dir.dx, jy = ny + dir.dy;
                if (jx >= 0 && jx < 9 && jy >= 0 && jy < 9 && !isFenceBlockingTest(nx, ny, jx, jy, testFences)) {
                    if (!visited.has(`${jx},${jy}`)) queue.push({x: jx, y: jy, dist: current.dist + 1});
                } else {
                    const sideDirs = dir.dx === 0 ? [{dx: 1, dy: 0}, {dx: -1, dy: 0}] : [{dx: 0, dy: 1}, {
                        dx: 0, dy: -1
                    }];
                    for (const sd of sideDirs) {
                        const sx = nx + sd.dx, sy = ny + sd.dy;
                        if (sx >= 0 && sx < 9 && sy >= 0 && sy < 9 && !isFenceBlockingTest(nx, ny, sx, sy, testFences)) {
                            if (!visited.has(`${sx},${sy}`)) queue.push({x: sx, y: sy, dist: current.dist + 1});
                        }
                    }
                }
            } else {
                if (!visited.has(`${nx},${ny}`)) queue.push({x: nx, y: ny, dist: current.dist + 1});
            }
        }
    }
    return 999;
}

function getShortestPath(player, testPawns, testFences) {
    const goalY = player === 1 ? 8 : 0;
    const opp = player === 1 ? 2 : 1;
    const oppPos = testPawns[opp];
    const start = testPawns[player];
    const visited = new Set();
    const queue = [{x: start.x, y: start.y, path: [start]}];
    while (queue.length > 0) {
        const current = queue.shift();
        const key = `${current.x},${current.y}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (current.y === goalY) return current.path;
        const directions = [{dx: 0, dy: player === 1 ? 1 : -1}, {dx: 1, dy: 0}, {dx: -1, dy: 0}, {
            dx: 0, dy: player === 1 ? -1 : 1
        }];
        for (const dir of directions) {
            const nx = current.x + dir.dx, ny = current.y + dir.dy;
            if (nx < 0 || nx >= 9 || ny < 0 || ny >= 9) continue;
            if (isFenceBlockingTest(current.x, current.y, nx, ny, testFences)) continue;
            if (nx === oppPos.x && ny === oppPos.y) {
                const jx = nx + dir.dx, jy = ny + dir.dy;
                if (jx >= 0 && jx < 9 && jy >= 0 && jy < 9 && !isFenceBlockingTest(nx, ny, jx, jy, testFences)) {
                    if (!visited.has(`${jx},${jy}`)) queue.push({
                        x: jx, y: jy, path: [...current.path, {x: jx, y: jy}]
                    });
                } else {
                    const sideDirs = dir.dx === 0 ? [{dx: 1, dy: 0}, {dx: -1, dy: 0}] : [{dx: 0, dy: 1}, {
                        dx: 0, dy: -1
                    }];
                    for (const sd of sideDirs) {
                        const sx = nx + sd.dx, sy = ny + sd.dy;
                        if (sx >= 0 && sx < 9 && sy >= 0 && sy < 9 && !isFenceBlockingTest(nx, ny, sx, sy, testFences)) {
                            if (!visited.has(`${sx},${sy}`)) queue.push({
                                x: sx, y: sy, path: [...current.path, {x: sx, y: sy}]
                            });
                        }
                    }
                }
            } else {
                if (!visited.has(`${nx},${ny}`)) queue.push({x: nx, y: ny, path: [...current.path, {x: nx, y: ny}]});
            }
        }
    }
    return null;
}

function countOpenSidesToGoal(x, y, player, testFences) {
    const dy = player === 1 ? 1 : -1;
    let openSides = 0;
    const nextY = y + dy;
    if (nextY >= 0 && nextY < 9 && !isFenceBlockingTest(x, y, x, nextY, testFences)) openSides++;
    if (x - 1 >= 0 && !isFenceBlockingTest(x, y, x - 1, y, testFences)) openSides++;
    if (x + 1 < 9 && !isFenceBlockingTest(x, y, x + 1, y, testFences)) openSides++;
    return openSides;
}

function isPathClear(player, testPawns, testFences) {
    const playerDist = getShortestPathDistance(player, testPawns, testFences);
    const goalY = player === 1 ? 8 : 0;
    const verticalDist = Math.abs(testPawns[player].y - goalY);
    return playerDist <= verticalDist && verticalDist > 0;
}

function noFencesShortestPathMove(player) {
    if (fences[player] > 0) return null;
    const path = getShortestPath(player, pawns, placedFences);
    if (!path || path.length < 2) return null;
    return {type: 'move', x: path[1].x, y: path[1].y};
}

// ================================================================
//  EASY AI — Monte Carlo Tree Search (closure)
// ================================================================

function createEasyAI(numSimulations, uctConst) {
    numSimulations = numSimulations || 1000;
    uctConst = uctConst || 1.41;

    // --- MCTS helper utilities (private to this closure) ---

    const MOVE_UP = [-1, 0], MOVE_DOWN = [1, 0], MOVE_LEFT = [0, -1], MOVE_RIGHT = [0, 1];

    function create2D(rows, cols, val) {
        const a = [];
        for (let i = 0; i < rows; i++) {
            a.push([]);
            for (let j = 0; j < cols; j++) a[i].push(val);
        }
        return a;
    }

    function clone2D(arr) {
        const c = [];
        for (let i = 0; i < arr.length; i++) c.push([...arr[i]]);
        return c;
    }

    function logicalAnd2D(a, b) {
        const r = [];
        for (let i = 0; i < a.length; i++) {
            r.push([]);
            for (let j = 0; j < a[i].length; j++) r[i].push(a[i][j] && b[i][j]);
        }
        return r;
    }

    function indicesOfValue2D(arr, val) {
        const t = [];
        for (let i = 0; i < arr.length; i++) for (let j = 0; j < arr[0].length; j++) if (arr[i][j] === val) t.push([i, j]);
        return t;
    }

    function indicesOfMin(arr) {
        let min = Infinity, idx = [];
        for (let i = 0; i < arr.length; i++) {
            if (arr[i] < min) {
                idx = [i];
                min = arr[i];
            } else if (arr[i] === min) idx.push(i);
        }
        return idx;
    }

    function indicesOfMax(arr) {
        let max = -Infinity, idx = [];
        for (let i = 0; i < arr.length; i++) {
            if (arr[i] > max) {
                idx = [i];
                max = arr[i];
            } else if (arr[i] === max) idx.push(i);
        }
        return idx;
    }

    function randomChoice(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function randomIndex(arr) {
        return Math.floor(Math.random() * arr.length);
    }

    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const x = arr[i];
            arr[i] = arr[j];
            arr[j] = x;
        }
        return arr;
    }

    class PawnPosition {
        constructor(row, col) {
            this.row = row;
            this.col = col;
        }

        equals(o) {
            return this.row === o.row && this.col === o.col;
        }

        newAddMove(m) {
            return new PawnPosition(this.row + m[0], this.col + m[1]);
        }

        getDisplacementPawnMoveTupleFrom(p) {
            return [this.row - p.row, this.col - p.col];
        }

        static clone(p) {
            return new PawnPosition(p.row, p.col);
        }
    }

    class MCTSPawn {
        constructor(index, isHuman, skip) {
            this.index = index;
            this.isHumanPlayer = isHuman;
            if (!skip) {
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

        static clone(p) {
            const c = new MCTSPawn(p.index, p.isHumanPlayer, true);
            c.position = PawnPosition.clone(p.position);
            c.goalRow = p.goalRow;
            c.numberOfLeftWalls = p.numberOfLeftWalls;
            return c;
        }
    }

    class MCTSBoard {
        constructor(skip) {
            if (!skip) {
                this.pawns = [new MCTSPawn(0, true), new MCTSPawn(1, false)];
                this.walls = {horizontal: create2D(8, 8, false), vertical: create2D(8, 8, false)};
            }
        }

        static clone(b) {
            const c = new MCTSBoard(true);
            c.pawns = [MCTSPawn.clone(b.pawns[0]), MCTSPawn.clone(b.pawns[1])];
            c.walls = {horizontal: clone2D(b.walls.horizontal), vertical: clone2D(b.walls.vertical)};
            return c;
        }
    }

    class MCTSGame {
        constructor(skip) {
            if (!skip) {
                this.board = new MCTSBoard();
                this.winner = null;
                this._turn = 0;
                this.validNextWalls = {horizontal: create2D(8, 8, true), vertical: create2D(8, 8, true)};
                this._probableNextWalls = {horizontal: create2D(8, 8, false), vertical: create2D(8, 8, false)};
                this._probableValidNextWalls = null;
                this._probableValidNextWallsUpdated = false;
                this.openWays = {upDown: create2D(10, 9, true), leftRight: create2D(9, 10, true)};
                for (let i = 0; i < 9; i++) {
                    this.openWays.upDown[0][i] = false;
                    this.openWays.upDown[9][i] = false;
                    this.openWays.leftRight[i][0] = false;
                    this.openWays.leftRight[i][9] = false;
                }
                this._validNextPositions = create2D(9, 9, false);
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
            if (!this._validNextPositionsUpdated) this._updateValidNextPositions();
            return this._validNextPositions;
        }

        get probableValidNextWalls() {
            if (!this._probableValidNextWallsUpdated) {
                this._probableValidNextWalls = {
                    horizontal: logicalAnd2D(this._probableNextWalls.horizontal, this.validNextWalls.horizontal),
                    vertical: logicalAnd2D(this._probableNextWalls.vertical, this.validNextWalls.vertical)
                };
                this._probableValidNextWallsUpdated = true;
            }
            return this._probableValidNextWalls;
        }

        _updateValidNextPositions() {
            const p = this.pawnOfTurn, o = this.pawnOfNotTurn;
            this._validNextPositions = create2D(9, 9, false);
            for (const mt of [MOVE_UP, MOVE_DOWN, MOVE_LEFT, MOVE_RIGHT]) {
                if (this.isOpenWay(p.position.row, p.position.col, mt)) {
                    const np = p.position.newAddMove(mt);
                    if (np.row === o.position.row && np.col === o.position.col) {
                        if (this.isOpenWay(np.row, np.col, mt)) {
                            const jp = np.newAddMove(mt);
                            if (jp.row >= 0 && jp.row < 9 && jp.col >= 0 && jp.col < 9) this._validNextPositions[jp.row][jp.col] = true;
                        } else {
                            for (const st of (mt[0] === 0 ? [MOVE_UP, MOVE_DOWN] : [MOVE_LEFT, MOVE_RIGHT])) {
                                if (this.isOpenWay(np.row, np.col, st)) {
                                    const sp = np.newAddMove(st);
                                    if (sp.row >= 0 && sp.row < 9 && sp.col >= 0 && sp.col < 9) this._validNextPositions[sp.row][sp.col] = true;
                                }
                            }
                        }
                    } else this._validNextPositions[np.row][np.col] = true;
                }
            }
            this._validNextPositionsUpdated = true;
        }

        isOpenWay(r, c, m) {
            if (m[0] === -1) return this.openWays.upDown[r][c];
            if (m[0] === 1) return this.openWays.upDown[r + 1][c];
            if (m[1] === -1) return this.openWays.leftRight[r][c];
            if (m[1] === 1) return this.openWays.leftRight[r][c + 1];
            return false;
        }

        movePawn(r, c) {
            this.pawnOfTurn.position = new PawnPosition(r, c);
            if (r === this.pawnOfTurn.goalRow) this.winner = this.pawnOfTurn;
            this._updateProbableNextWalls();
            this._turn++;
            this._validNextPositionsUpdated = false;
            this._probableValidNextWallsUpdated = false;
        }

        placeHorizontalWall(r, c) {
            this.board.walls.horizontal[r][c] = true;
            this.pawnOfTurn.numberOfLeftWalls--;
            this.openWays.upDown[r + 1][c] = false;
            this.openWays.upDown[r + 1][c + 1] = false;
            this._updateValidNextWallsH(r, c);
            this._updateProbableNextWalls();
            this._turn++;
            this._validNextPositionsUpdated = false;
            this._probableValidNextWallsUpdated = false;
        }

        placeVerticalWall(r, c) {
            this.board.walls.vertical[r][c] = true;
            this.pawnOfTurn.numberOfLeftWalls--;
            this.openWays.leftRight[r][c + 1] = false;
            this.openWays.leftRight[r + 1][c + 1] = false;
            this._updateValidNextWallsV(r, c);
            this._updateProbableNextWalls();
            this._turn++;
            this._validNextPositionsUpdated = false;
            this._probableValidNextWallsUpdated = false;
        }

        _updateValidNextWallsH(r, c) {
            this.validNextWalls.horizontal[r][c] = false;
            this.validNextWalls.vertical[r][c] = false;
            if (c > 0) this.validNextWalls.horizontal[r][c - 1] = false;
            if (c < 7) this.validNextWalls.horizontal[r][c + 1] = false;
        }

        _updateValidNextWallsV(r, c) {
            this.validNextWalls.vertical[r][c] = false;
            this.validNextWalls.horizontal[r][c] = false;
            if (r > 0) this.validNextWalls.vertical[r - 1][c] = false;
            if (r < 7) this.validNextWalls.vertical[r + 1][c] = false;
        }

        _updateProbableNextWalls() {
            this._probableNextWalls = {horizontal: create2D(8, 8, false), vertical: create2D(8, 8, false)};
            for (const p of this.board.pawns) MCTSGame.setWallsBesidePawn(this._probableNextWalls, p);
        }

        static setWallsBesidePawn(w, pawn) {
            const r = pawn.position.row, c = pawn.position.col;
            for (let dr = -1; dr <= 0; dr++) for (let dc = -1; dc <= 0; dc++) {
                const rr = r + dr, cc = c + dc;
                if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
                    w.horizontal[rr][cc] = true;
                    w.vertical[rr][cc] = true;
                }
            }
        }

        testIfExistPathsAfterH(r, c) {
            this.openWays.upDown[r + 1][c] = false;
            this.openWays.upDown[r + 1][c + 1] = false;
            const ok = this._existPathsBoth();
            this.openWays.upDown[r + 1][c] = true;
            this.openWays.upDown[r + 1][c + 1] = true;
            return ok;
        }

        testIfExistPathsAfterV(r, c) {
            this.openWays.leftRight[r][c + 1] = false;
            this.openWays.leftRight[r + 1][c + 1] = false;
            const ok = this._existPathsBoth();
            this.openWays.leftRight[r][c + 1] = true;
            this.openWays.leftRight[r + 1][c + 1] = true;
            return ok;
        }

        _existPathsBoth() {
            return this._existPathToGoal(this.pawn0) && this._existPathToGoal(this.pawn1);
        }

        _existPathToGoal(pawn) {
            const visited = create2D(9, 9, false), queue = [pawn.position];
            visited[pawn.position.row][pawn.position.col] = true;
            while (queue.length > 0) {
                const pos = queue.shift();
                if (pos.row === pawn.goalRow) return true;
                for (const mt of [MOVE_UP, MOVE_DOWN, MOVE_LEFT, MOVE_RIGHT]) {
                    if (this.isOpenWay(pos.row, pos.col, mt)) {
                        const np = pos.newAddMove(mt);
                        if (np.row >= 0 && np.row < 9 && np.col >= 0 && np.col < 9 && !visited[np.row][np.col]) {
                            visited[np.row][np.col] = true;
                            queue.push(np);
                        }
                    }
                }
            }
            return false;
        }

        doMove(m) {
            if (m[0] !== null) this.movePawn(m[0][0], m[0][1]); else if (m[1] !== null) this.placeHorizontalWall(m[1][0], m[1][1]); else if (m[2] !== null) this.placeVerticalWall(m[2][0], m[2][1]);
        }

        isPossibleNextMove(m) {
            if (m[0] !== null) return this.validNextPositions[m[0][0]][m[0][1]];
            if (m[1] !== null) return this.validNextWalls.horizontal[m[1][0]][m[1][1]] && this.testIfExistPathsAfterH(m[1][0], m[1][1]);
            if (m[2] !== null) return this.validNextWalls.vertical[m[2][0]][m[2][1]] && this.testIfExistPathsAfterV(m[2][0], m[2][1]);
            return false;
        }

        getArrOfValidNextPositionTuples() {
            return indicesOfValue2D(this.validNextPositions, true);
        }

        getArrOfProbableValidNoBlockNextH() {
            const nh = indicesOfValue2D(this.probableValidNextWalls.horizontal, true), r = [];
            for (const h of nh) if (this.testIfExistPathsAfterH(h[0], h[1])) r.push(h);
            return r;
        }

        getArrOfProbableValidNoBlockNextV() {
            const nv = indicesOfValue2D(this.probableValidNextWalls.vertical, true), r = [];
            for (const v of nv) if (this.testIfExistPathsAfterV(v[0], v[1])) r.push(v);
            return r;
        }

        getArrOfValidNoBlockNextWallsDisturbPathOf(pawn) {
            const wi = Helper.getValidNextWallsDisturbPathOf(pawn, this);
            const nh = indicesOfValue2D(wi.horizontal, true), rh = [];
            for (const h of nh) if (this.testIfExistPathsAfterH(h[0], h[1])) rh.push(h);
            const nv = indicesOfValue2D(wi.vertical, true), rv = [];
            for (const v of nv) if (this.testIfExistPathsAfterV(v[0], v[1])) rv.push(v);
            return {arrOfHorizontal: rh, arrOfVertical: rv};
        }

        static clone(g) {
            const c = new MCTSGame(true);
            c.board = MCTSBoard.clone(g.board);
            c.winner = g.winner === null ? null : c.board.pawns[g.winner.index];
            c._turn = g._turn;
            c.validNextWalls = {
                horizontal: clone2D(g.validNextWalls.horizontal), vertical: clone2D(g.validNextWalls.vertical)
            };
            c._probableNextWalls = {
                horizontal: clone2D(g._probableNextWalls.horizontal), vertical: clone2D(g._probableNextWalls.vertical)
            };
            c._probableValidNextWalls = null;
            c._probableValidNextWallsUpdated = false;
            c.openWays = {upDown: clone2D(g.openWays.upDown), leftRight: clone2D(g.openWays.leftRight)};
            c._validNextPositions = clone2D(g._validNextPositions);
            c._validNextPositionsUpdated = g._validNextPositionsUpdated;
            return c;
        }
    }

    // --- MNode / MCTS classes ---

    class MNode {
        constructor(move, parent, uct) {
            this.move = move;
            this.parent = parent;
            this.uctConst = uct;
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
            if (this.numSims === 0) return Infinity;
            return (this.numWins / this.numSims) + Math.sqrt((this.uctConst * Math.log(this.parent.numSims)) / this.numSims);
        }

        get maxUCTChild() {
            let max = -Infinity, idx = [];
            for (let i = 0; i < this.children.length; i++) {
                const u = this.children[i].uct;
                if (u > max) {
                    max = u;
                    idx = [i];
                } else if (u === max) idx.push(i);
            }
            return this.children[randomChoice(idx)];
        }

        get maxSimsChild() {
            let max = -Infinity, idx = 0;
            for (let i = 0; i < this.children.length; i++) if (this.children[i].numSims > max) {
                max = this.children[i].numSims;
                idx = i;
            }
            return this.children[idx];
        }

        addChild(c) {
            this.children.push(c);
        }
    }

    // --- Helper class ---

    class Helper {
        static chooseShortestPathNextPawnPositionsThoroughly(game) {
            const valids = indicesOfValue2D(game.validNextPositions, true), distances = [];
            for (const v of valids) {
                const cg = MCTSGame.clone(game);
                cg.movePawn(v[0], v[1]);
                distances.push(Helper.getShortestDistanceToGoalFor(cg.pawnOfNotTurn, cg));
            }
            const r = [];
            for (const i of indicesOfMin(distances)) r.push(new PawnPosition(valids[i][0], valids[i][1]));
            return r;
        }

        static chooseLongestPathNextPawnPositionsThoroughly(game) {
            const valids = indicesOfValue2D(game.validNextPositions, true), distances = [];
            for (const v of valids) {
                const cg = MCTSGame.clone(game);
                cg.movePawn(v[0], v[1]);
                distances.push(Helper.getShortestDistanceToGoalFor(cg.pawnOfNotTurn, cg));
            }
            const r = [];
            for (const i of indicesOfMax(distances)) r.push(new PawnPosition(valids[i][0], valids[i][1]));
            return r;
        }

        static get2DArrayPrevAndNextAndDistanceToGoalFor(pawn, game) {
            const t = this.getRandomShortestPathToGoal(pawn, game), dist = t[0], prev = t[1], goalPosition = t[2];
            const distanceToGoal = goalPosition ? dist[goalPosition.row][goalPosition.col] : Infinity;
            const next = goalPosition ? Helper.getNextByReversingPrev(prev, goalPosition) : create2D(9, 9, null);
            return [prev, next, distanceToGoal];
        }

        static chooseProbableNextWall(game) {
            const nm = [];
            const nh = indicesOfValue2D(game.probableValidNextWalls.horizontal, true);
            for (const h of nh) nm.push([null, h, null]);
            const nv = indicesOfValue2D(game.probableValidNextWalls.vertical, true);
            for (const v of nv) nm.push([null, null, v]);
            if (nm.length === 0) return null;
            let idx = randomIndex(nm);
            while (!game.isPossibleNextMove(nm[idx])) {
                nm.splice(idx, 1);
                if (nm.length === 0) return null;
                idx = randomIndex(nm);
            }
            return nm[idx];
        }

        static arePawnsAdjacent(game) {
            const p = game.pawnOfTurn.position, o = game.pawnOfNotTurn.position;
            return (o.row === p.row && Math.abs(o.col - p.col) === 1) || (o.col === p.col && Math.abs(o.row - p.row) === 1);
        }

        static getRandomShortestPathToGoal(pawn, game) {
            const visited = create2D(9, 9, false), dist = create2D(9, 9, Infinity), prev = create2D(9, 9, null);
            const mts = shuffle([MOVE_UP, MOVE_RIGHT, MOVE_DOWN, MOVE_LEFT]), queue = [];
            visited[pawn.position.row][pawn.position.col] = true;
            dist[pawn.position.row][pawn.position.col] = 0;
            queue.push(pawn.position);
            while (queue.length > 0) {
                const pos = queue.shift();
                if (pos.row === pawn.goalRow) return [dist, prev, pos];
                for (const mt of mts) {
                    if (game.isOpenWay(pos.row, pos.col, mt)) {
                        const np = pos.newAddMove(mt);
                        if (np.row >= 0 && np.row < 9 && np.col >= 0 && np.col < 9 && !visited[np.row][np.col]) {
                            dist[np.row][np.col] = dist[pos.row][pos.col] + 1;
                            prev[np.row][np.col] = pos;
                            visited[np.row][np.col] = true;
                            queue.push(np);
                        }
                    }
                }
            }
            return [dist, prev, null];
        }

        static getShortestDistanceToGoalFor(pawn, game) {
            const t = Helper.getRandomShortestPathToGoal(pawn, game);
            return t[2] ? t[0][t[2].row][t[2].col] : Infinity;
        }

        static getAllShortestPathsToEveryPosition(pawn, game) {
            const searched = create2D(9, 9, false), visited = create2D(9, 9, false), dist = create2D(9, 9, Infinity),
                multiPrev = create2D(9, 9, null);
            const mts = [MOVE_UP, MOVE_RIGHT, MOVE_DOWN, MOVE_LEFT], queue = [];
            visited[pawn.position.row][pawn.position.col] = true;
            dist[pawn.position.row][pawn.position.col] = 0;
            queue.push(pawn.position);
            while (queue.length > 0) {
                const pos = queue.shift();
                for (const mt of mts) {
                    if (game.isOpenWay(pos.row, pos.col, mt)) {
                        const np = pos.newAddMove(mt);
                        if (np.row >= 0 && np.row < 9 && np.col >= 0 && np.col < 9 && !searched[np.row][np.col]) {
                            const alt = dist[pos.row][pos.col] + 1;
                            if (alt < dist[np.row][np.col]) {
                                dist[np.row][np.col] = alt;
                                multiPrev[np.row][np.col] = [pos];
                            } else if (alt === dist[np.row][np.col]) multiPrev[np.row][np.col].push(pos);
                            if (!visited[np.row][np.col]) {
                                visited[np.row][np.col] = true;
                                queue.push(np);
                            }
                        }
                    }
                }
                searched[pos.row][pos.col] = true;
            }
            return [dist, multiPrev];
        }

        static getNextByReversingPrev(prev, goalPosition) {
            const next = create2D(9, 9, null);
            let prevP, pos = goalPosition;
            while ((prevP = prev[pos.row][pos.col])) {
                next[prevP.row][prevP.col] = pos;
                pos = prevP;
            }
            return next;
        }

        static getValidNextWallsDisturbPathOf(pawn, game) {
            const vi = create2D(8, 8, false), vd = create2D(8, 8, false);
            const visited = create2D(9, 9, false), t = Helper.getAllShortestPathsToEveryPosition(pawn, game),
                dist = t[0], prev = t[1];
            const goalCols = indicesOfMin(dist[pawn.goalRow]), queue = [];
            for (const gc of goalCols) queue.push(new PawnPosition(pawn.goalRow, gc));
            while (queue.length > 0) {
                const pos = queue.shift();
                const prevs = prev[pos.row][pos.col];
                if (!prevs) continue;
                for (const pp of prevs) {
                    const mt = pos.getDisplacementPawnMoveTupleFrom(pp);
                    if (mt[0] === -1 && mt[1] === 0) {
                        if (pp.col < 8) vi[pp.row - 1][pp.col] = true;
                        if (pp.col > 0) vi[pp.row - 1][pp.col - 1] = true;
                    } else if (mt[0] === 1 && mt[1] === 0) {
                        if (pp.col < 8) vi[pp.row][pp.col] = true;
                        if (pp.col > 0) vi[pp.row][pp.col - 1] = true;
                    } else if (mt[0] === 0 && mt[1] === -1) {
                        if (pp.row < 8) vi[pp.row][pp.col - 1] = true;
                        if (pp.row > 0) vi[pp.row - 1][pp.col - 1] = true;
                    } else if (mt[0] === 0 && mt[1] === 1) {
                        if (pp.row < 8) vi[pp.row][pp.col] = true;
                        if (pp.row > 0) vi[pp.row - 1][pp.col] = true;
                    }
                    if (!visited[pp.row][pp.col]) {
                        visited[pp.row][pp.col] = true;
                        queue.push(pp);
                    }
                }
            }
            const w = {horizontal: vi, vertical: vd};
            MCTSGame.setWallsBesidePawn(w, pawn);
            w.horizontal = logicalAnd2D(w.horizontal, game.validNextWalls.horizontal);
            w.vertical = logicalAnd2D(w.vertical, game.validNextWalls.vertical);
            return w;
        }
    }

    // --- MCTS search ---

    function mctsSearch(game) {
        const root = new MNode(null, null, uctConst);
        let totalSims = 0;
        let currentNode = root;
        while (totalSims < numSimulations) {
            if (currentNode.isTerminal) {
                rollout(currentNode, root, game);
                totalSims++;
                currentNode = root;
            } else if (currentNode.isLeaf) {
                if (currentNode.isNew) {
                    rollout(currentNode, root, game);
                    totalSims++;
                    currentNode = root;
                } else {
                    const sg = getSimulationGameAtNode(currentNode, root, game);
                    if (sg.pawnOfNotTurn.numberOfLeftWalls > 0) {
                        for (const nt of sg.getArrOfValidNextPositionTuples()) currentNode.addChild(new MNode([nt, null, null], currentNode, uctConst));
                        if (sg.pawnOfTurn.numberOfLeftWalls > 0) {
                            for (const h of sg.getArrOfProbableValidNoBlockNextH()) currentNode.addChild(new MNode([null, h, null], currentNode, uctConst));
                            for (const v of sg.getArrOfProbableValidNoBlockNextV()) currentNode.addChild(new MNode([null, null, v], currentNode, uctConst));
                        }
                    } else {
                        const nextPos = Helper.chooseShortestPathNextPawnPositionsThoroughly(sg);
                        for (const np of nextPos) currentNode.addChild(new MNode([[np.row, np.col], null, null], currentNode, uctConst));
                        if (sg.pawnOfTurn.numberOfLeftWalls > 0) {
                            const nw = sg.getArrOfValidNoBlockNextWallsDisturbPathOf(sg.pawnOfNotTurn);
                            for (const h of nw.arrOfHorizontal) currentNode.addChild(new MNode([null, h, null], currentNode, uctConst));
                            for (const v of nw.arrOfVertical) currentNode.addChild(new MNode([null, null, v], currentNode, uctConst));
                        }
                    }
                    if (currentNode.children.length > 0) {
                        rollout(randomChoice(currentNode.children), root, game);
                        totalSims++;
                    }
                    currentNode = root;
                }
            } else {
                currentNode = currentNode.maxUCTChild;
            }
        }
        const best = root.maxSimsChild;
        return best.move;
    }

    function getSimulationGameAtNode(node, root, game) {
        const sg = MCTSGame.clone(game);
        const stack = [];
        let a = node;
        while (a.parent !== null) {
            stack.push(a.move);
            a = a.parent;
        }
        while (stack.length > 0) sg.doMove(stack.pop());
        return sg;
    }

    function rollout(node, root, game) {
        const sg = getSimulationGameAtNode(node, root, game);
        const nodePawnIndex = sg.pawnIndexOfNotTurn;
        if (sg.winner !== null) node.isTerminal = true;

        const cache = [{updated: false, prev: null, next: null, distanceToGoal: null}, {
            updated: false, prev: null, next: null, distanceToGoal: null
        }];
        let pawnMoveFlag = false;

        while (sg.winner === null) {
            if (!cache[0].updated) {
                const t = Helper.get2DArrayPrevAndNextAndDistanceToGoalFor(sg.pawn0, sg);
                cache[0].prev = t[0];
                cache[0].next = t[1];
                cache[0].distanceToGoal = t[2];
                cache[0].updated = true;
            }
            if (!cache[1].updated) {
                const t = Helper.get2DArrayPrevAndNextAndDistanceToGoalFor(sg.pawn1, sg);
                cache[1].prev = t[0];
                cache[1].next = t[1];
                cache[1].distanceToGoal = t[2];
                cache[1].updated = true;
            }
            const pi = sg.pawnIndexOfTurn;
            if (Math.random() < 0.7) {
                pawnMoveFlag = false;
                const next = cache[pi].next;
                const cp = sg.pawnOfTurn.position;
                let np = next[cp.row][cp.col];
                if (np === null) throw "already in goal";
                if (Helper.arePawnsAdjacent(sg)) {
                    const nnp = next[np.row][np.col];
                    if (nnp !== null && sg.validNextPositions[nnp.row][nnp.col]) {
                        np = nnp;
                        cache[pi].distanceToGoal -= 2;
                    } else {
                        const nps = Helper.chooseShortestPathNextPawnPositionsThoroughly(sg);
                        const _np = randomChoice(nps);
                        if (_np.equals(np)) cache[pi].distanceToGoal -= 1; else {
                            np = _np;
                            cache[pi].updated = false;
                        }
                    }
                } else {
                    cache[pi].distanceToGoal -= 1;
                }
                sg.movePawn(np.row, np.col);
            } else if (!pawnMoveFlag && sg.pawnOfTurn.numberOfLeftWalls > 0) {
                const nm = Helper.chooseProbableNextWall(sg);
                if (nm !== null) {
                    sg.doMove(nm);
                    cache[0].updated = false;
                    cache[1].updated = false;
                } else pawnMoveFlag = true;
            } else {
                pawnMoveFlag = false;
                const prev = cache[pi].prev;
                const cp = sg.pawnOfTurn.position;
                let pp = prev[cp.row][cp.col];
                if (pp === null || !sg.validNextPositions[pp.row][pp.col]) {
                    const pps = Helper.chooseLongestPathNextPawnPositionsThoroughly(sg);
                    pp = randomChoice(pps);
                    cache[pi].updated = false;
                } else cache[pi].distanceToGoal += 1;
                sg.movePawn(pp.row, pp.col);
            }
        }

        let ancestor = node, ancestorPI = nodePawnIndex;
        while (ancestor !== null) {
            ancestor.numSims++;
            if (sg.winner.index === ancestorPI) ancestor.numWins++;
            ancestor = ancestor.parent;
            ancestorPI = (ancestorPI + 1) % 2;
        }
    }

    // --- State conversion ---

    function createMCTSGameFromState(pawnsState, placedFencesState, fencesCount) {
        const g = new MCTSGame();
        g.board.pawns[0].position = new PawnPosition(8 - pawnsState[1].y, pawnsState[1].x);
        g.board.pawns[1].position = new PawnPosition(8 - pawnsState[2].y, pawnsState[2].x);
        g.board.pawns[0].numberOfLeftWalls = fencesCount[1];
        g.board.pawns[1].numberOfLeftWalls = fencesCount[2];
        g.board.walls = {horizontal: create2D(8, 8, false), vertical: create2D(8, 8, false)};
        g.validNextWalls = {horizontal: create2D(8, 8, true), vertical: create2D(8, 8, true)};
        g.openWays = {upDown: create2D(10, 9, true), leftRight: create2D(9, 10, true)};
        for (let i = 0; i < 9; i++) {
            g.openWays.upDown[0][i] = false;
            g.openWays.upDown[9][i] = false;
            g.openWays.leftRight[i][0] = false;
            g.openWays.leftRight[i][9] = false;
        }
        for (const f of placedFencesState) {
            const mr = 7 - f.y, mc = f.x;
            if (f.orientation === 'h') {
                g.board.walls.horizontal[mr][mc] = true;
                g.openWays.upDown[mr + 1][mc] = false;
                g.openWays.upDown[mr + 1][mc + 1] = false;
                g.validNextWalls.horizontal[mr][mc] = false;
                g.validNextWalls.vertical[mr][mc] = false;
                if (mc > 0) g.validNextWalls.horizontal[mr][mc - 1] = false;
                if (mc < 7) g.validNextWalls.horizontal[mr][mc + 1] = false;
            } else {
                g.board.walls.vertical[mr][mc] = true;
                g.openWays.leftRight[mr][mc + 1] = false;
                g.openWays.leftRight[mr + 1][mc + 1] = false;
                g.validNextWalls.vertical[mr][mc] = false;
                g.validNextWalls.horizontal[mr][mc] = false;
                if (mr > 0) g.validNextWalls.vertical[mr - 1][mc] = false;
                if (mr < 7) g.validNextWalls.vertical[mr + 1][mc] = false;
            }
        }
        g._updateProbableNextWalls();
        g._validNextPositionsUpdated = false;
        g._probableValidNextWallsUpdated = false;
        return g;
    }

    function convertMCTSMoveToOriginal(m) {
        if (m[0] !== null) return {type: 'move', x: m[0][1], y: 8 - m[0][0]};
        if (m[1] !== null) return {type: 'fence', x: m[1][1], y: 7 - m[1][0], orientation: 'h'};
        if (m[2] !== null) return {type: 'fence', x: m[2][1], y: 7 - m[2][0], orientation: 'v'};
        return null;
    }

    // --- Public API ---

    return {
        findBestMove: function (player, pawnsState, placedFencesState, fencesCount, positionHistory) {
            const g = createMCTSGameFromState(pawnsState, placedFencesState, fencesCount);
            g._turn = player === 1 ? 0 : 1;
            const mctsMove = mctsSearch(g);
            return convertMCTSMoveToOriginal(mctsMove);
        }
    };
}

// ================================================================
//  GOOD AI — Minimax with alpha-beta pruning (closure)
// ================================================================

function createGoodAI() {
    // All helper functions are available from the shared utilities above
    // (isFenceBlockingTest, hasPathToGoalTest, etc.)
    // The closure captures the weight/noise state from the outer scope.

    function evaluateState(player, testPawns, testFences, testFencesCounts) {
        const playerDist = getShortestPathDistance(player, testPawns, testFences);
        const opp = player === 1 ? 2 : 1;
        const oppDist = getShortestPathDistance(opp, testPawns, testFences);
        const w = (typeof aiWeightVariance !== 'undefined') ? aiWeightVariance : {};
        const dw = (typeof DEFAULT_WEIGHTS !== 'undefined') ? DEFAULT_WEIGHTS : {};
        const wv = (key) => (dw[key] || 0) * (w[key] || 1.0);

        if (player === 1 && testPawns[1].y === 8) return 10000;
        if (player === 2 && testPawns[2].y === 0) return 10000;
        if (opp === 1 && testPawns[1].y === 8) return -10000;
        if (opp === 2 && testPawns[2].y === 0) return -10000;

        let score = 0;
        score += (oppDist - playerDist) * wv('pathAdvantage');
        if (playerDist <= 2) score += (3 - playerDist) * wv('criticalAdvantage');
        if (oppDist <= 2) score -= (3 - oppDist) * wv('defensivePenalty');
        if (playerDist <= oppDist) score += wv('tempoBonus');
        score += (Math.abs(testPawns[opp].x - 4) - Math.abs(testPawns[player].x - 4)) * wv('centerControl');
        if (player === 1) {
            score += testPawns[1].y * wv('progressivePosition');
            score -= (8 - testPawns[2].y) * wv('progressivePenalty');
        } else {
            score += (8 - testPawns[2].y) * wv('progressivePosition');
            score -= testPawns[1].y * wv('progressivePenalty');
        }
        const goalY = player === 1 ? 8 : 0;
        if (Math.abs(testPawns[player].y - goalY) <= playerDist) score += wv('directPath');
        score += (testFencesCounts[player] - testFencesCounts[opp]) * wv('fenceAdvantage');
        if (oppDist <= 3 && testFencesCounts[player] > 0) score += testFencesCounts[player] * wv('fenceDefense');
        if (testFencesCounts[player] === 0 && testFencesCounts[opp] > 3) score -= wv('noFencePenalty');
        const cx = testPawns[player].x;
        if (cx !== 4) score += Math.abs(cx - 4) * wv('sidePreference');
        if (playerDist <= 3) {
            if (countOpenSidesToGoal(cx, testPawns[player].y, player, testFences) % 2 === 1) score += wv('oddSidesBonus');
        }
        if (isPathClear(player, testPawns, testFences)) score += wv('clearPathForward');
        return score;
    }

    function generateFenceMoves(player, testFences, testPawns, testFencesCounts) {
        if (testFencesCounts[player] <= 0) return [];
        const moves = [];
        const opp = player === 1 ? 2 : 1;
        const oppPos = testPawns[opp];
        const oppPath = getShortestPath(opp, testPawns, testFences);
        const pathCells = new Set();
        if (oppPath) {
            for (const cell of oppPath) {
                pathCells.add(`${cell.x},${cell.y}`);
                for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) pathCells.add(`${cell.x + dx},${cell.y + dy}`);
            }
        }
        for (let x = 0; x <= 7; x++) for (let y = 0; y <= 7; y++) {
            const nearPath = pathCells.has(`${x},${y}`) || pathCells.has(`${x + 1},${y}`) || pathCells.has(`${x},${y + 1}`) || pathCells.has(`${x + 1},${y + 1}`);
            if (nearPath) {
                for (const ori of ['h', 'v']) if (canPlaceFenceTest(x, y, ori, testFences, testPawns)) moves.push({
                    type: 'fence', x, y, orientation: ori, priority: 1
                });
            }
        }
        for (let x = Math.max(0, oppPos.x - 2); x <= Math.min(7, oppPos.x + 2); x++) for (let y = Math.max(0, oppPos.y - 2); y <= Math.min(7, oppPos.y + 2); y++) {
            for (const ori of ['h', 'v']) {
                if (canPlaceFenceTest(x, y, ori, testFences, testPawns) && !moves.some(m => m.x === x && m.y === y && m.orientation === ori)) moves.push({
                    type: 'fence', x, y, orientation: ori, priority: 2
                });
            }
        }
        const oppGoalY = opp === 1 ? 7 : 0;
        for (let x = 0; x <= 7; x++) for (const ori of ['h', 'v']) {
            if (canPlaceFenceTest(x, oppGoalY, ori, testFences, testPawns) && !moves.some(m => m.x === x && m.y === oppGoalY && m.orientation === ori)) moves.push({
                type: 'fence', x, y: oppGoalY, orientation: ori, priority: 3
            });
        }
        moves.sort((a, b) => a.priority - b.priority);
        return moves;
    }

    function minimax(player, testPawns, testFences, testFencesCounts, depth, alpha, beta, isMax) {
        const opp = player === 1 ? 2 : 1;
        if (testPawns[1].y === 8) return player === 1 ? 10000 + depth : -10000 - depth;
        if (testPawns[2].y === 0) return player === 2 ? 10000 + depth : -10000 - depth;
        if (depth === 0) return evaluateState(player, testPawns, testFences, testFencesCounts);
        const ct = isMax ? player : opp;
        const moveMoves = getValidMovesTest(ct, testPawns, testFences);
        moveMoves.sort((a, b) => {
            const dA = ct === 1 ? (8 - a.y) : a.y, dB = ct === 1 ? (8 - b.y) : b.y;
            return dA - dB;
        });
        const fenceMoves = generateFenceMoves(ct, testFences, testPawns, testFencesCounts);
        if (isMax) {
            let maxEval = -Infinity;
            for (const m of moveMoves) {
                const np = {1: {...testPawns[1]}, 2: {...testPawns[2]}};
                np[ct] = {x: m.x, y: m.y};
                const e = minimax(player, np, testFences, testFencesCounts, depth - 1, alpha, beta, false);
                maxEval = Math.max(maxEval, e);
                alpha = Math.max(alpha, e);
                if (beta <= alpha) break;
            }
            const fl = depth >= 3 ? 8 : 12;
            for (const m of fenceMoves.slice(0, fl)) {
                const nf = [...testFences, {x: m.x, y: m.y, orientation: m.orientation}];
                const nc = {...testFencesCounts};
                nc[ct]--;
                const e = minimax(player, testPawns, nf, nc, depth - 1, alpha, beta, false);
                maxEval = Math.max(maxEval, e);
                alpha = Math.max(alpha, e);
                if (beta <= alpha) break;
            }
            return maxEval;
        } else {
            let minEval = Infinity;
            for (const m of moveMoves) {
                const np = {1: {...testPawns[1]}, 2: {...testPawns[2]}};
                np[ct] = {x: m.x, y: m.y};
                const e = minimax(player, np, testFences, testFencesCounts, depth - 1, alpha, beta, true);
                minEval = Math.min(minEval, e);
                beta = Math.min(beta, e);
                if (beta <= alpha) break;
            }
            const fl = depth >= 3 ? 8 : 12;
            for (const m of fenceMoves.slice(0, fl)) {
                const nf = [...testFences, {x: m.x, y: m.y, orientation: m.orientation}];
                const nc = {...testFencesCounts};
                nc[ct]--;
                const e = minimax(player, testPawns, nf, nc, depth - 1, alpha, beta, true);
                minEval = Math.min(minEval, e);
                beta = Math.min(beta, e);
                if (beta <= alpha) break;
            }
            return minEval;
        }
    }

    return {
        findBestMove: function (player, inputPawns, inputFences, inputFenceCounts, inputPositionHistory) {
            const testPawns = inputPawns ? {1: {...inputPawns[1]}, 2: {...inputPawns[2]}} : {
                1: {...pawns[1]}, 2: {...pawns[2]}
            };
            const testFences = inputFences ? [...inputFences] : [...placedFences];
            const testFencesCounts = inputFenceCounts ? {...inputFenceCounts} : {...fences};
            const playerHistory = inputPositionHistory ? inputPositionHistory[player] : (typeof positionHistory !== 'undefined' ? positionHistory[player] : []);
            const goalY = player === 1 ? 8 : 0;
            const opp = player === 1 ? 2 : 1;
            const depth = 4;
            const playerDist = getShortestPathDistance(player, testPawns, testFences);
            const oppDist = getShortestPathDistance(opp, testPawns, testFences);
            const shortestPath = getShortestPath(player, testPawns, testFences);
            const nextPathCell = shortestPath && shortestPath.length > 1 ? shortestPath[1] : null;
            if (testFencesCounts[player] <= 0 && shortestPath && shortestPath.length > 1) return {
                type: 'move', x: shortestPath[1].x, y: shortestPath[1].y
            };

            const w = (typeof aiWeightVariance !== 'undefined') ? aiWeightVariance : {};
            const dw = (typeof DEFAULT_WEIGHTS !== 'undefined') ? DEFAULT_WEIGHTS : {};
            const wv = (key) => (dw[key] || 0) * (w[key] || 1.0);
            const noise = (typeof getScoreNoise === 'function') ? getScoreNoise() : 0;
            const hasClearPath = isPathClear(player, testPawns, testFences);
            const currentY = testPawns[player].y;

            let bestMove = null, bestScore = -Infinity;
            const scoredMoves = [];
            const moveMoves = getValidMovesTest(player, testPawns, testFences);
            moveMoves.sort((a, b) => {
                const aOn = nextPathCell && a.x === nextPathCell.x && a.y === nextPathCell.y,
                    bOn = nextPathCell && b.x === nextPathCell.x && b.y === nextPathCell.y;
                if (aOn && !bOn) return -1;
                if (bOn && !aOn) return 1;
                const dA = player === 1 ? (8 - a.y) : a.y, dB = player === 1 ? (8 - b.y) : b.y;
                if (dA !== dB) return dA - dB;
                return testPawns[player].x <= 4 ? a.x - b.x : b.x - a.x;
            });

            for (const move of moveMoves) {
                if (move.y === goalY) return {type: 'move', x: move.x, y: move.y};
                const np = {1: {...testPawns[1]}, 2: {...testPawns[2]}};
                np[player] = {x: move.x, y: move.y};
                let score = minimax(player, np, testFences, testFencesCounts, depth - 1, -Infinity, Infinity, false);
                const isRecent = playerHistory.some((p, i) => i >= playerHistory.length - 4 && p.x === move.x && p.y === move.y);
                if (isRecent) score -= wv('antiOscillation');
                const isBackward = player === 1 ? (move.y < currentY) : (move.y > currentY);
                const isSideways = move.y === currentY;
                if (isBackward) {
                    const fm = moveMoves.filter(m => player === 1 ? m.y > currentY : m.y < currentY);
                    if (fm.length > 0) score -= wv('backwardPenalty');
                }
                if (hasClearPath) {
                    if (isBackward) score -= wv('clearPathForward'); else if (isSideways) score -= wv('clearPathForward') * 0.5;
                }
                const progress = player === 1 ? (move.y - currentY) : (currentY - move.y);
                if (progress > 0) score += progress * wv('forwardBonus');
                const isOnPath = nextPathCell && move.x === nextPathCell.x && move.y === nextPathCell.y;
                if (isOnPath) score += wv('shortestPathBonus');
                if (playerDist <= 3 && countOpenSidesToGoal(move.x, move.y, player, testFences) % 2 === 1) score += wv('oddSidesBonus');
                score += noise;
                scoredMoves.push({
                    move: {type: 'move', x: move.x, y: move.y},
                    score,
                    isOnPath,
                    distToGoal: player === 1 ? (8 - move.y) : move.y,
                    isRecentPosition: isRecent,
                    isBackward
                });
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = {type: 'move', x: move.x, y: move.y};
                }
            }

            const bm = scoredMoves.filter(m => m.score === bestScore);
            if (bm.length > 1) {
                let c = bm.filter(m => !m.isRecentPosition);
                if (c.length === 0) c = bm;
                let c2 = c.filter(m => !m.isBackward);
                if (c2.length > 0) c = c2;
                const pm = c.filter(m => m.isOnPath);
                if (pm.length > 0) bestMove = pm[0].move; else {
                    c.sort((a, b) => a.distToGoal !== b.distToGoal ? a.distToGoal - b.distToGoal : (testPawns[player].x <= 4 ? a.move.x - b.move.x : b.move.x - a.move.x));
                    bestMove = c[0].move;
                }
            }

            const shouldFence = testFencesCounts[player] > 0 && (oppDist <= playerDist + 2 || oppDist <= 4 || testFencesCounts[player] >= 5);
            if (shouldFence) {
                const fm = generateFenceMoves(player, testFences, testPawns, testFencesCounts);
                const sf = fm.map(m => {
                    const nf = [...testFences, {x: m.x, y: m.y, orientation: m.orientation}];
                    const ob = getShortestPathDistance(opp, testPawns, testFences),
                        oa = getShortestPathDistance(opp, testPawns, nf),
                        pa = getShortestPathDistance(player, testPawns, nf);
                    return {...m, impact: (oa - ob) - (pa - playerDist) * 0.5};
                });
                sf.sort((a, b) => b.impact - a.impact);
                for (const m of sf.filter(f => f.impact > 0).slice(0, 20)) {
                    const nf = [...testFences, {x: m.x, y: m.y, orientation: m.orientation}];
                    const nc = {...testFencesCounts};
                    nc[player]--;
                    const score = minimax(player, testPawns, nf, nc, depth - 1, -Infinity, Infinity, false) + noise;
                    if (score > bestScore) {
                        bestScore = score;
                        bestMove = {type: 'fence', x: m.x, y: m.y, orientation: m.orientation};
                    }
                }
            }
            return bestMove;
        }
    };
}

// ================================================================
//  HARD AI — Iterative-deepening alpha-beta with PVS (closure)
// ================================================================

function createHardAI() {
    const INF = 999999, WIN = 100000, MAX_DEPTH = 6, TIME_LIMIT = 2500;
    const TT_SIZE = 1 << 18, TT_MASK = TT_SIZE - 1;
    const EXACT = 0, LOWER = 1, UPPER = 2;

    // Zobrist tables
    const zPawn = [], zFence = [], zTurn = [];
    (function () {
        function r64() {
            return Math.floor(Math.random() * 9007199254740992);
        }

        for (let p = 0; p < 2; p++) {
            zPawn[p] = [];
            for (let x = 0; x < 9; x++) {
                zPawn[p][x] = [];
                for (let y = 0; y < 9; y++) zPawn[p][x][y] = r64();
            }
        }
        for (let i = 0; i < 128; i++) zFence[i] = r64();
        zTurn[0] = r64();
        zTurn[1] = r64();
    })();

    let tt = new Array(TT_SIZE);
    let killerMoves = [], historyTable = {};
    let nodesSearched = 0, searchStart = 0, aborted = false;

    function fenceIdx(x, y, ori) {
        return (ori === 'h' ? 0 : 64) + y * 8 + x;
    }

    function computeHash(tp, tf, turn) {
        let h = 0;
        h ^= zPawn[0][tp[1].x][tp[1].y];
        h ^= zPawn[1][tp[2].x][tp[2].y];
        for (const f of tf) h ^= zFence[fenceIdx(f.x, f.y, f.orientation)];
        h ^= zTurn[turn === 1 ? 0 : 1];
        return h;
    }

    function ttClear() {
        tt = new Array(TT_SIZE);
    }

    function ttProbe(hash, depth, alpha, beta) {
        const e = tt[hash & TT_MASK];
        if (!e || e.hash !== hash) return null;
        if (e.depth < depth) return {bestMove: e.bestMove};
        if (e.flag === EXACT) return {score: e.score, bestMove: e.bestMove, exact: true};
        if (e.flag === LOWER && e.score >= beta) return {score: e.score, bestMove: e.bestMove, exact: true};
        if (e.flag === UPPER && e.score <= alpha) return {score: e.score, bestMove: e.bestMove, exact: true};
        return {bestMove: e.bestMove};
    }

    function ttStore(hash, depth, score, flag, bestMove) {
        const idx = hash & TT_MASK;
        const ex = tt[idx];
        if (!ex || ex.hash === hash || ex.depth <= depth) tt[idx] = {hash, depth, score, flag, bestMove};
    }

    function shortestDist(px, py, goalY, tf) {
        const vis = new Uint8Array(81);
        const q = [];
        let head = 0;
        q.push(px | (py << 4) | (0 << 8));
        vis[py * 9 + px] = 1;
        while (head < q.length) {
            const pk = q[head++];
            const cx = pk & 0xF, cy = (pk >> 4) & 0xF, cd = pk >> 8;
            if (cy === goalY) return cd;
            for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || nx >= 9 || ny < 0 || ny >= 9) continue;
                if (vis[ny * 9 + nx]) continue;
                if (fenceBlocking(cx, cy, nx, ny, tf)) continue;
                vis[ny * 9 + nx] = 1;
                q.push(nx | (ny << 4) | ((cd + 1) << 8));
            }
        }
        return 999;
    }

    function shortestDistWithOpp(player, tp, tf) {
        const goalY = player === 1 ? 8 : 0, opp = player === 1 ? 2 : 1, ox = tp[opp].x, oy = tp[opp].y;
        const vis = new Uint8Array(81);
        const q = [];
        let head = 0;
        q.push({x: tp[player].x, y: tp[player].y, d: 0});
        vis[tp[player].y * 9 + tp[player].x] = 1;
        while (head < q.length) {
            const cur = q[head++];
            if (cur.y === goalY) return cur.d;
            for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                const nx = cur.x + dx, ny = cur.y + dy;
                if (nx < 0 || nx >= 9 || ny < 0 || ny >= 9) continue;
                if (fenceBlocking(cur.x, cur.y, nx, ny, tf)) continue;
                if (nx === ox && ny === oy) {
                    const jx = nx + dx, jy = ny + dy;
                    if (jx >= 0 && jx < 9 && jy >= 0 && jy < 9 && !fenceBlocking(nx, ny, jx, jy, tf)) {
                        if (!vis[jy * 9 + jx]) {
                            vis[jy * 9 + jx] = 1;
                            q.push({x: jx, y: jy, d: cur.d + 1});
                        }
                    } else {
                        for (const [sdx, sdy] of (dx === 0 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]])) {
                            const sx = nx + sdx, sy = ny + sdy;
                            if (sx >= 0 && sx < 9 && sy >= 0 && sy < 9 && !fenceBlocking(nx, ny, sx, sy, tf) && !vis[sy * 9 + sx]) {
                                vis[sy * 9 + sx] = 1;
                                q.push({x: sx, y: sy, d: cur.d + 1});
                            }
                        }
                    }
                } else {
                    if (!vis[ny * 9 + nx]) {
                        vis[ny * 9 + nx] = 1;
                        q.push({x: nx, y: ny, d: cur.d + 1});
                    }
                }
            }
        }
        return 999;
    }

    function shortestPath(player, tp, tf) {
        const goalY = player === 1 ? 8 : 0, opp = player === 1 ? 2 : 1, ox = tp[opp].x, oy = tp[opp].y;
        const vis = new Uint8Array(81);
        const q = [{x: tp[player].x, y: tp[player].y, path: [{x: tp[player].x, y: tp[player].y}]}];
        let head = 0;
        vis[tp[player].y * 9 + tp[player].x] = 1;
        while (head < q.length) {
            const cur = q[head++];
            if (cur.y === goalY) return cur.path;
            for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                const nx = cur.x + dx, ny = cur.y + dy;
                if (nx < 0 || nx >= 9 || ny < 0 || ny >= 9) continue;
                if (fenceBlocking(cur.x, cur.y, nx, ny, tf)) continue;
                if (nx === ox && ny === oy) {
                    const jx = nx + dx, jy = ny + dy;
                    if (jx >= 0 && jx < 9 && jy >= 0 && jy < 9 && !fenceBlocking(nx, ny, jx, jy, tf)) {
                        if (!vis[jy * 9 + jx]) {
                            vis[jy * 9 + jx] = 1;
                            q.push({x: jx, y: jy, path: [...cur.path, {x: jx, y: jy}]});
                        }
                    } else {
                        for (const [sdx, sdy] of (dx === 0 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]])) {
                            const sx = nx + sdx, sy = ny + sdy;
                            if (sx >= 0 && sx < 9 && sy >= 0 && sy < 9 && !fenceBlocking(nx, ny, sx, sy, tf) && !vis[sy * 9 + sx]) {
                                vis[sy * 9 + sx] = 1;
                                q.push({x: sx, y: sy, path: [...cur.path, {x: sx, y: sy}]});
                            }
                        }
                    }
                } else {
                    if (!vis[ny * 9 + nx]) {
                        vis[ny * 9 + nx] = 1;
                        q.push({x: nx, y: ny, path: [...cur.path, {x: nx, y: ny}]});
                    }
                }
            }
        }
        return null;
    }

    function shortestPathAllNext(px, py, goalY, tf) {
        const dist = new Int16Array(81).fill(-1);
        const q = [];
        let head = 0;
        dist[py * 9 + px] = 0;
        q.push(px | (py << 4));
        while (head < q.length) {
            const pk = q[head++];
            const cx = pk & 0xF, cy = (pk >> 4) & 0xF, cd = dist[cy * 9 + cx];
            for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || nx >= 9 || ny < 0 || ny >= 9) continue;
                if (fenceBlocking(cx, cy, nx, ny, tf)) continue;
                const ni = ny * 9 + nx;
                if (dist[ni] >= 0) continue;
                dist[ni] = cd + 1;
                q.push(nx | (ny << 4));
            }
        }
        return dist;
    }

    function fenceBlocking(x1, y1, x2, y2, tf) {
        const dx = x2 - x1, dy = y2 - y1;
        for (let i = 0; i < tf.length; i++) {
            const f = tf[i];
            if (f.orientation === 'h') {
                if (dy !== 0) {
                    const fy = f.y + 1;
                    if ((y1 === fy - 1 && y2 === fy) || (y1 === fy && y2 === fy - 1)) {
                        if (x1 >= f.x && x1 <= f.x + 1) return true;
                    }
                }
            } else {
                if (dx !== 0) {
                    const fx = f.x + 1;
                    if ((x1 === fx - 1 && x2 === fx) || (x1 === fx && x2 === fx - 1)) {
                        if (y1 >= f.y && y1 <= f.y + 1) return true;
                    }
                }
            }
        }
        return false;
    }

    function hasPath(player, tp, tf) {
        const goalY = player === 1 ? 8 : 0;
        const vis = new Uint8Array(81);
        const q = [];
        let head = 0;
        q.push(tp[player].x | (tp[player].y << 4));
        vis[tp[player].y * 9 + tp[player].x] = 1;
        while (head < q.length) {
            const pk = q[head++];
            const cx = pk & 0xF, cy = (pk >> 4) & 0xF;
            if (cy === goalY) return true;
            for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || nx >= 9 || ny < 0 || ny >= 9) continue;
                if (vis[ny * 9 + nx]) continue;
                if (fenceBlocking(cx, cy, nx, ny, tf)) continue;
                vis[ny * 9 + nx] = 1;
                q.push(nx | (ny << 4));
            }
        }
        return false;
    }

    function canPlace(x, y, ori, tf, tp) {
        if (x < 0 || x >= 8 || y < 0 || y >= 8) return false;
        for (const f of tf) {
            if (f.x === x && f.y === y) return false;
            if (ori === 'h' && f.orientation === 'h' && f.y === y && Math.abs(f.x - x) === 1) return false;
            if (ori === 'v' && f.orientation === 'v' && f.x === x && Math.abs(f.y - y) === 1) return false;
        }
        const nf = tf.slice();
        nf.push({x, y, orientation: ori});
        return hasPath(1, tp, nf) && hasPath(2, tp, nf);
    }

    function getValidMoves(player, tp, tf) {
        const moves = [], pos = tp[player], opp = player === 1 ? 2 : 1, op = tp[opp];
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const nx = pos.x + dx, ny = pos.y + dy;
            if (nx < 0 || nx >= 9 || ny < 0 || ny >= 9) continue;
            if (fenceBlocking(pos.x, pos.y, nx, ny, tf)) continue;
            if (nx === op.x && ny === op.y) {
                const jx = nx + dx, jy = ny + dy;
                if (jx >= 0 && jx < 9 && jy >= 0 && jy < 9 && !fenceBlocking(nx, ny, jx, jy, tf)) moves.push({
                    x: jx, y: jy
                }); else {
                    for (const [sdx, sdy] of (dx === 0 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]])) {
                        const sx = nx + sdx, sy = ny + sdy;
                        if (sx >= 0 && sx < 9 && sy >= 0 && sy < 9 && !fenceBlocking(nx, ny, sx, sy, tf)) moves.push({
                            x: sx, y: sy
                        });
                    }
                }
            } else moves.push({x: nx, y: ny});
        }
        return moves;
    }

    function evaluate(player, tp, tf, fc) {
        const opp = player === 1 ? 2 : 1, gP = player === 1 ? 8 : 0, gO = opp === 1 ? 8 : 0;
        if (tp[player].y === gP) return WIN;
        if (tp[opp].y === gO) return -WIN;
        const myD = shortestDistWithOpp(player, tp, tf), oppD = shortestDistWithOpp(opp, tp, tf);
        const myTD = shortestDist(tp[player].x, tp[player].y, gP, tf),
            oppTD = shortestDist(tp[opp].x, tp[opp].y, gO, tf);
        let s = (oppD - myD) * 120;
        if (myD < oppD) s += 40; else if (myD === oppD) s += 10;
        if (myD <= 1) s += 500; else if (myD <= 2) s += 200; else if (myD <= 3) s += 80;
        if (oppD <= 1) s -= 500; else if (oppD <= 2) s -= 200; else if (oppD <= 3) s -= 80;
        s += ((player === 1 ? tp[1].y : (8 - tp[2].y)) - (opp === 1 ? tp[1].y : (8 - tp[2].y))) * 15;
        const myV = Math.abs(tp[player].y - gP);
        if (myTD <= myV && myV > 0) s += 80;
        const oppV = Math.abs(tp[opp].y - gO);
        if (oppTD <= oppV && oppV > 0) s -= 80;
        s += (Math.abs(tp[opp].x - 4) - Math.abs(tp[player].x - 4)) * 5;
        const mf = fc[player], of2 = fc[opp];

        // --- Enhanced fence conservation logic ---
        // Game phase: how many total fences have been placed (0=early, 20=all placed)
        const totalFencesPlaced = (10 - mf) + (10 - of2);
        const gamePhase = totalFencesPlaced / 20; // 0.0 = start, 1.0 = all fences used

        // Base fence difference advantage (scales up as game progresses)
        const fenceDiffWeight = 3 + gamePhase * 12;
        s += (mf - of2) * fenceDiffWeight;

        // Defensive value of having fences when opponent is approaching
        if (oppD <= 4 && mf > 0) s += mf * 8;
        if (myD <= 4 && of2 > 0) s -= of2 * 8;

        // CRITICAL: Heavy penalty for running out of fences while opponent has many
        // This is the key fix — having 0 fences vs opponent with fences is catastrophic
        if (mf === 0 && of2 > 0) {
            // Scale penalty by how many fences opponent has — more fences = more danger
            s -= 40 + of2 * 20;
            // Extra penalty if opponent is not yet close to goal (they can build corridors)
            if (oppD > 3) s -= of2 * 15;
        }
        if (of2 === 0 && mf > 0) {
            s += 40 + mf * 20;
            if (myD > 3) s += mf * 15;
        }

        // Fence reserve bonus: reward keeping fences in reserve (diminishing returns for spending)
        // Having 3+ fences in reserve is strategically valuable as insurance
        if (mf >= 3) s += 15 + (mf - 3) * 5;
        if (of2 >= 3) s -= 15 + (of2 - 3) * 5;

        // Vulnerability: penalize if we have few fences AND opponent has corridor-building potential
        // (opponent has fences and is not yet near goal — they can redirect us)
        if (mf <= 2 && of2 >= 3 && myD > 3) {
            s -= (of2 - mf) * 25;
        }
        if (of2 <= 2 && mf >= 3 && oppD > 3) {
            s += (mf - of2) * 25;
        }

        // --- End of enhanced fence logic ---

        if (myD <= 4) {
            const px = tp[player].x, py = tp[player].y, fy = player === 1 ? py + 1 : py - 1;
            let os = 0;
            if (fy >= 0 && fy < 9 && !fenceBlocking(px, py, px, fy, tf)) os++;
            if (px - 1 >= 0 && !fenceBlocking(px, py, px - 1, py, tf)) os++;
            if (px + 1 < 9 && !fenceBlocking(px, py, px + 1, py, tf)) os++;
            if (os % 2 === 1) s += 25;
        }
        if (oppV > 0) s += (oppTD - oppV) * 12;
        if (myV > 0) s -= (myTD - myV) * 12;
        s += (estimateWidth(tp[player].x, tp[player].y, gP, tf) - estimateWidth(tp[opp].x, tp[opp].y, gO, tf)) * 8;
        return s;
    }

    function estimateWidth(px, py, goalY, tf) {
        const dist = shortestPathAllNext(px, py, goalY, tf);
        const td = dist.length > 0 ? shortestDist(px, py, goalY, tf) : 999;
        if (td >= 999) return 0;
        const mid = Math.floor(td / 2);
        if (mid === 0) return 1;
        let w = 0;
        for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (dist[y * 9 + x] === mid) w++;
        return Math.min(w, 5);
    }

    function genPawnMoves(player, tp, tf, goalY) {
        const raw = getValidMoves(player, tp, tf), fwd = player === 1 ? 1 : -1;
        raw.sort((a, b) => {
            if (a.y === goalY) return -1;
            if (b.y === goalY) return 1;
            const pA = (a.y - tp[player].y) * fwd, pB = (b.y - tp[player].y) * fwd;
            if (pA !== pB) return pB - pA;
            return Math.abs(a.x - 4) - Math.abs(b.x - 4);
        });
        return raw.map(m => ({type: 'move', x: m.x, y: m.y}));
    }

    function genFenceMoves(player, tp, tf, fc) {
        if (fc[player] <= 0) return [];
        const opp = player === 1 ? 2 : 1;

        // Fence conservation: require minimum impact threshold based on remaining fences
        // When AI has many fences left, threshold is low (place freely)
        // When AI has few fences left, threshold is high (only place high-impact fences)
        const myFences = fc[player], oppFences = fc[opp];
        const oppGoalDist = shortestDistWithOpp(opp, tp, tf);
        let minImpactThreshold = 0;
        if (myFences <= 2) {
            // Very few fences: only place if very high impact
            minImpactThreshold = 3;
        } else if (myFences <= 4) {
            // Getting low: require decent impact
            minImpactThreshold = 2;
        } else if (myFences <= 6 && oppFences >= myFences) {
            // Mid-game with opponent having equal or more fences: be somewhat careful
            minImpactThreshold = 1;
        }
        // If opponent is very close to goal, lower the threshold (must block urgently)
        if (oppGoalDist <= 3) {
            minImpactThreshold = Math.max(0, minImpactThreshold - 2);
        } else if (oppGoalDist <= 5) {
            minImpactThreshold = Math.max(0, minImpactThreshold - 1);
        }

        const oppPath = shortestPath(opp, tp, tf);
        const pathCells = new Set();
        if (oppPath) for (const c of oppPath) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) pathCells.add(`${c.x + dx},${c.y + dy}`);
        const candidates = [], seen = new Set(), op = tp[opp], oGY = opp === 1 ? 8 : 0;

        function tryAdd(x, y, ori, pri) {
            const k = `${x},${y},${ori}`;
            if (seen.has(k)) return;
            seen.add(k);
            if (!canPlace(x, y, ori, tf, tp)) return;
            const nf = tf.slice();
            nf.push({x, y, orientation: ori});
            const ob = shortestDist(op.x, op.y, oGY, tf), oa = shortestDist(op.x, op.y, oGY, nf),
                mg = player === 1 ? 8 : 0, ma = shortestDist(tp[player].x, tp[player].y, mg, nf),
                mb = shortestDist(tp[player].x, tp[player].y, mg, tf);
            candidates.push({
                type: 'fence', x, y, orientation: ori, priority: pri, impact: (oa - ob) - (ma - mb) * 0.7
            });
        }

        for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
            if (pathCells.has(`${x},${y}`) || pathCells.has(`${x + 1},${y}`) || pathCells.has(`${x},${y + 1}`) || pathCells.has(`${x + 1},${y + 1}`)) {
                tryAdd(x, y, 'h', 1);
                tryAdd(x, y, 'v', 1);
            }
        }
        for (let x = Math.max(0, op.x - 3); x <= Math.min(7, op.x + 3); x++) for (let y = Math.max(0, op.y - 3); y <= Math.min(7, op.y + 3); y++) {
            tryAdd(x, y, 'h', 2);
            tryAdd(x, y, 'v', 2);
        }
        const gr = opp === 1 ? 7 : 0;
        for (let x = 0; x < 8; x++) {
            tryAdd(x, gr, 'h', 3);
            tryAdd(x, gr, 'v', 3);
        }
        candidates.sort((a, b) => b.impact !== a.impact ? b.impact - a.impact : a.priority - b.priority);
        // Apply conservation threshold: only include fences with sufficient impact
        const filtered = candidates.filter(c => c.impact >= minImpactThreshold).slice(0, 24);
        // If very few candidates pass the threshold, allow a small number of best ones
        if (filtered.length < 4 && oppGoalDist <= 5) {
            for (const c of candidates) {
                if (filtered.length >= 6) break;
                if (c.impact > 0 && !filtered.some(f => f.x === c.x && f.y === c.y && f.orientation === c.orientation)) filtered.push(c);
            }
        }
        return filtered;
    }

    function resetTables() {
        killerMoves = [];
        for (let i = 0; i <= MAX_DEPTH + 2; i++) killerMoves.push([null, null]);
        historyTable = {};
    }

    function moveKey(m) {
        return m.type === 'move' ? `m${m.x},${m.y}` : `f${m.x},${m.y},${m.orientation}`;
    }

    function updateKiller(d, m) {
        if (!killerMoves[d]) return;
        const k = moveKey(m);
        if (killerMoves[d][0] && moveKey(killerMoves[d][0]) === k) return;
        killerMoves[d][1] = killerMoves[d][0];
        killerMoves[d][0] = m;
    }

    function updateHistory(m, d) {
        const k = moveKey(m);
        historyTable[k] = (historyTable[k] || 0) + d * d;
    }

    function orderMoves(moves, ttBM, depth) {
        const scored = moves.map(m => {
            let p = 0;
            const k = moveKey(m);
            if (ttBM && moveKey(ttBM) === k) p += 1000000;
            if (killerMoves[depth]) {
                if (killerMoves[depth][0] && moveKey(killerMoves[depth][0]) === k) p += 100000; else if (killerMoves[depth][1] && moveKey(killerMoves[depth][1]) === k) p += 90000;
            }
            if (m.type === 'fence' && m.impact !== undefined) p += m.impact * 100;
            p += (historyTable[k] || 0);
            return {move: m, priority: p};
        });
        scored.sort((a, b) => b.priority - a.priority);
        return scored.map(s => s.move);
    }

    function alphabeta(player, tp, tf, fc, depth, alpha, beta, isMax, ply) {
        nodesSearched++;
        if ((nodesSearched & 4095) === 0 && Date.now() - searchStart > TIME_LIMIT) {
            aborted = true;
            return 0;
        }
        if (aborted) return 0;
        const opp = player === 1 ? 2 : 1, gP = player === 1 ? 8 : 0, gO = opp === 1 ? 8 : 0;
        if (tp[player].y === gP) return WIN + depth;
        if (tp[opp].y === gO) return -(WIN + depth);
        if (depth <= 0) return evaluate(player, tp, tf, fc);
        const ct = isMax ? player : opp;
        const hash = computeHash(tp, tf, ct);
        const oA = alpha, oB = beta;
        let ttBM = null;
        const tte = ttProbe(hash, depth, alpha, beta);
        if (tte) {
            ttBM = tte.bestMove;
            if (tte.exact) return tte.score;
        }
        const gC = ct === 1 ? 8 : 0;
        const pm = genPawnMoves(ct, tp, tf, gC);
        let fm;
        const oppF = ct === player ? opp : player, oppGF = oppF === 1 ? 8 : 0;
        const crit = Math.abs(tp[oppF].y - oppGF) <= 3;
        if (depth <= 2 && !crit) fm = []; else {
            fm = genFenceMoves(ct, tp, tf, fc);
            const fl = depth >= 5 ? 16 : (depth >= 4 ? 12 : (depth >= 3 ? 8 : 5));
            if (fm.length > fl) fm = fm.slice(0, fl);
        }
        const all = pm.concat(fm);
        if (all.length === 0) return evaluate(player, tp, tf, fc);
        const ord = orderMoves(all, ttBM, ply);
        let bs, bm = ord[0];
        if (isMax) {
            bs = -INF;
            for (let i = 0; i < ord.length; i++) {
                const m = ord[i];
                let nP, nF, nC;
                if (m.type === 'move') {
                    nP = {1: {...tp[1]}, 2: {...tp[2]}};
                    nP[ct] = {x: m.x, y: m.y};
                    nF = tf;
                    nC = fc;
                } else {
                    nP = tp;
                    nF = tf.slice();
                    nF.push({x: m.x, y: m.y, orientation: m.orientation});
                    nC = {...fc};
                    nC[ct]--;
                }
                let sc;
                if (i === 0) sc = alphabeta(player, nP, nF, nC, depth - 1, alpha, beta, false, ply + 1); else {
                    sc = alphabeta(player, nP, nF, nC, depth - 1, alpha, alpha + 1, false, ply + 1);
                    if (sc > alpha && sc < beta && !aborted) sc = alphabeta(player, nP, nF, nC, depth - 1, alpha, beta, false, ply + 1);
                }
                if (aborted) return bs === -INF ? 0 : bs;
                if (sc > bs) {
                    bs = sc;
                    bm = m;
                }
                if (sc > alpha) alpha = sc;
                if (alpha >= beta) {
                    updateKiller(ply, m);
                    updateHistory(m, depth);
                    break;
                }
            }
        } else {
            bs = INF;
            for (let i = 0; i < ord.length; i++) {
                const m = ord[i];
                let nP, nF, nC;
                if (m.type === 'move') {
                    nP = {1: {...tp[1]}, 2: {...tp[2]}};
                    nP[ct] = {x: m.x, y: m.y};
                    nF = tf;
                    nC = fc;
                } else {
                    nP = tp;
                    nF = tf.slice();
                    nF.push({x: m.x, y: m.y, orientation: m.orientation});
                    nC = {...fc};
                    nC[ct]--;
                }
                let sc;
                if (i === 0) sc = alphabeta(player, nP, nF, nC, depth - 1, alpha, beta, true, ply + 1); else {
                    sc = alphabeta(player, nP, nF, nC, depth - 1, beta - 1, beta, true, ply + 1);
                    if (sc < beta && sc > alpha && !aborted) sc = alphabeta(player, nP, nF, nC, depth - 1, alpha, beta, true, ply + 1);
                }
                if (aborted) return bs === INF ? 0 : bs;
                if (sc < bs) {
                    bs = sc;
                    bm = m;
                }
                if (sc < beta) beta = sc;
                if (alpha >= beta) {
                    updateKiller(ply, m);
                    updateHistory(m, depth);
                    break;
                }
            }
        }
        if (isMax) {
            const fl = bs <= oA ? UPPER : (bs >= oB ? LOWER : EXACT);
            ttStore(hash, depth, bs, fl, bm);
        } else {
            const fl = bs >= oB ? LOWER : (bs <= oA ? UPPER : EXACT);
            ttStore(hash, depth, bs, fl, bm);
        }
        return bs;
    }

    function iterativeDeepening(player, tp, tf, fc, posHist) {
        resetTables();
        ttClear();
        searchStart = Date.now();
        aborted = false;
        let bestMove = null, bestScore = -INF;
        const goalY = player === 1 ? 8 : 0;
        for (const m of getValidMoves(player, tp, tf)) {
            if (m.y === goalY) return {type: 'move', x: m.x, y: m.y};
        }
        if (fc[player] <= 0 && fc[player === 1 ? 2 : 1] <= 0) {
            const p = shortestPath(player, tp, tf);
            if (p && p.length > 1) return {type: 'move', x: p[1].x, y: p[1].y};
        }
        for (let d = 1; d <= MAX_DEPTH; d++) {
            nodesSearched = 0;
            aborted = false;
            const sc = alphabeta(player, tp, tf, fc, d, -INF, INF, true, 0);
            if (aborted && d > 1) break;
            const hash = computeHash(tp, tf, player);
            const e = tt[hash & TT_MASK];
            if (e && e.hash === hash && e.bestMove) {
                bestMove = e.bestMove;
                bestScore = sc;
            }
            if (Math.abs(sc) >= WIN - 20) break;
            if (Date.now() - searchStart > TIME_LIMIT * 0.6) break;
        }
        if (!bestMove) {
            const p = shortestPath(player, tp, tf);
            if (p && p.length > 1) bestMove = {type: 'move', x: p[1].x, y: p[1].y}; else {
                const m = getValidMoves(player, tp, tf);
                if (m.length > 0) bestMove = {type: 'move', x: m[0].x, y: m[0].y};
            }
        }
        if (bestMove && bestMove.type === 'move' && posHist && posHist[player]) {
            const h = posHist[player];
            if (h.length >= 3 && h.slice(-4).some(p => p.x === bestMove.x && p.y === bestMove.y)) {
                const p = shortestPath(player, tp, tf);
                if (p && p.length > 1) {
                    const pm = {type: 'move', x: p[1].x, y: p[1].y};
                    if (!h.slice(-4).some(pp => pp.x === pm.x && pp.y === pm.y)) bestMove = pm; else {
                        const fwd = player === 1 ? 1 : -1;
                        const pM = getValidMoves(player, tp, tf).filter(m => (m.y - tp[player].y) * fwd > 0);
                        const nr = pM.filter(m => !h.slice(-4).some(pp => pp.x === m.x && pp.y === m.y));
                        if (nr.length > 0) bestMove = {type: 'move', x: nr[0].x, y: nr[0].y}; else if (fc[player] > 0) {
                            const fM = genFenceMoves(player, tp, tf, fc);
                            if (fM.length > 0 && fM[0].impact > 0) bestMove = {
                                type: 'fence', x: fM[0].x, y: fM[0].y, orientation: fM[0].orientation
                            };
                        }
                    }
                }
            }
        }
        return bestMove;
    }

    return {
        findBestMove: function (player, pawnsState, placedFencesState, fencesCount, posHistory) {
            const tp = {1: {...pawnsState[1]}, 2: {...pawnsState[2]}};
            const tf = placedFencesState.map(f => ({...f}));
            const fc = {...fencesCount};
            const raw = iterativeDeepening(player, tp, tf, fc, posHistory);
            if (!raw) return null;
            if (raw.type === 'move') return {type: 'move', x: raw.x, y: raw.y};
            return {type: 'fence', x: raw.x, y: raw.y, orientation: raw.orientation};
        }
    };
}

// ================================================================
//  UNIFIED WEB WORKER
// ================================================================

function createWorkerBlobURL() {
    if (cachedWorkerBlobURL) return cachedWorkerBlobURL;

    // Serialize all three factory functions + shared utilities
    const workerCode = `
"use strict";
const BOARD_SIZE = 9;
const DEFAULT_WEIGHTS = ${JSON.stringify(DEFAULT_WEIGHTS)};
let aiWeightVariance = {};
let aiScoreNoise = 0;
function getScoreNoise() { if (aiScoreNoise <= 0) return 0; return (Math.random() * 2 - 1) * aiScoreNoise; }

// Shared board utilities
${isFenceBlockingTest.toString()}
${hasPathToGoalTest.toString()}
${canPlaceFenceTest.toString()}
${getValidMovesTest.toString()}
${getShortestPathDistance.toString()}
${getShortestPath.toString()}
${countOpenSidesToGoal.toString()}
${isPathClear.toString()}

// AI factory functions
${createEasyAI.toString()}
${createGoodAI.toString()}
${createHardAI.toString()}

// Pre-create instances
const engines = {
    easy: createEasyAI(),
    good: createGoodAI(),
    hard: createHardAI()
};

self.onmessage = function(e) {
    const { type, data } = e.data;
    if (type === 'setWeights') {
        aiWeightVariance = data.aiWeightVariance || {};
        aiScoreNoise = data.aiScoreNoise || 0;
        return;
    }
    if (type === 'calculate') {
        const { difficulty, player, pawns, placedFences, fences, positionHistory } = data;
        try {
            const engine = engines[difficulty] || engines.hard;
            const bestMove = engine.findBestMove(player, pawns, placedFences, fences, positionHistory);
            self.postMessage({ type: 'result', bestMove });
        } catch (error) {
            self.postMessage({ type: 'error', error: error.message });
        }
    }
};
`;

    const blob = new Blob([workerCode], {type: 'application/javascript'});
    cachedWorkerBlobURL = URL.createObjectURL(blob);
    return cachedWorkerBlobURL;
}

// ================================================================
//  WORKER MANAGEMENT
// ================================================================

function handleAIWorkerMessage(e) {
    const {type, bestMove, error} = e.data;
    if (type === 'result' && bestMove && aiThinking && aiEnabled) {
        executeAIMove(bestMove);
    } else if (type === 'error') {
        console.error('AI Worker error:', error);
    }
    aiThinking = false;
    hideAIThinkingIndicator();
}

function handleAssistWorkerMessage(e) {
    const {type, bestMove, error} = e.data;
    if (assistCalculationPlayer !== currentPlayer) return;
    hideCurrentPlayerThinkingIndicator();
    assistCalculationPlayer = null;
    if (type === 'result' && bestMove) {
        displayAssistProposal(bestMove);
    } else if (type === 'error') {
        console.error('Assist Worker error:', error);
    }
}

function initAIWorker() {
    if (typeof Worker === 'undefined') {
        workersAvailable = false;
        return;
    }
    try {
        aiWorker = new Worker(createWorkerBlobURL());
        aiWorker.onmessage = handleAIWorkerMessage;
        aiWorker.onerror = () => {
            console.warn('AI Worker failed, using sync fallback');
            aiWorker = null;
            workersAvailable = false;
        };
        workersAvailable = true;
    } catch (e) {
        workersAvailable = false;
        aiWorker = null;
    }
}

function initAssistWorker() {
    if (typeof Worker === 'undefined' || !workersAvailable) return;
    try {
        assistWorker = new Worker(createWorkerBlobURL());
        assistWorker.onmessage = handleAssistWorkerMessage;
        assistWorker.onerror = () => {
            console.warn('Assist Worker failed');
            assistWorker = null;
        };
    } catch (e) {
        assistWorker = null;
    }
}

function cancelPendingCalculations() {
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

// ================================================================
//  CALCULATION DISPATCH
// ================================================================

function getAIState() {
    return {
        pawns: {1: {...pawns[1]}, 2: {...pawns[2]}},
        placedFences: [...placedFences],
        fences: {...fences},
        positionHistory: {1: [...positionHistory[1]], 2: [...positionHistory[2]]}
    };
}

function startAICalculation() {
    const shortcut = noFencesShortestPathMove(aiPlayer);
    if (shortcut) {
        setTimeout(() => {
            if (!aiEnabled) {
                aiThinking = false;
                hideAIThinkingIndicator();
                return;
            }
            aiThinking = false;
            hideAIThinkingIndicator();
            executeAIMove(shortcut);
        }, 50);
        return;
    }

    if (aiWorker && workersAvailable) {
        const state = getAIState();
        aiWorker.postMessage({
            type: 'calculate', data: {difficulty: aiDifficulty, player: aiPlayer, ...state}
        });
    } else {
        // Sync fallback
        setTimeout(() => {
            if (!aiEnabled) {
                aiThinking = false;
                hideAIThinkingIndicator();
                return;
            }
            try {
                const engine = getOrCreateEngine(aiDifficulty);
                if (aiDifficulty === 'good') activateAIWeights();
                const state = getAIState();
                const bestMove = engine.findBestMove(aiPlayer, state.pawns, state.placedFences, state.fences, state.positionHistory);
                aiThinking = false;
                hideAIThinkingIndicator();
                if (bestMove) executeAIMove(bestMove);
            } catch (e) {
                console.error('AI sync error:', e);
                aiThinking = false;
                hideAIThinkingIndicator();
            }
        }, 30);
    }
}

function startAssistCalculation() {
    assistCalculationPlayer = currentPlayer;
    showCurrentPlayerThinkingIndicator();

    if (assistWorker && workersAvailable) {
        const state = getAIState();
        assistWorker.postMessage({
            type: 'calculate', data: {difficulty: 'hard', player: currentPlayer, ...state}
        });
    } else {
        const calcPlayer = currentPlayer;
        setTimeout(() => {
            if (assistCalculationPlayer !== calcPlayer || calcPlayer !== currentPlayer) return;
            try {
                const engine = getOrCreateEngine('hard');
                const state = getAIState();
                const bestMove = engine.findBestMove(calcPlayer, state.pawns, state.placedFences, state.fences, state.positionHistory);
                hideCurrentPlayerThinkingIndicator();
                assistCalculationPlayer = null;
                if (bestMove && calcPlayer === currentPlayer) displayAssistProposal(bestMove);
            } catch (e) {
                console.error('Assist sync error:', e);
                hideCurrentPlayerThinkingIndicator();
                assistCalculationPlayer = null;
            }
        }, 30);
    }
}

function getOrCreateEngine(difficulty) {
    if (difficulty === 'easy') {
        if (!easyAI) easyAI = createEasyAI();
        return easyAI;
    }
    if (difficulty === 'good') {
        if (!goodAI) goodAI = createGoodAI();
        return goodAI;
    }
    if (!hardAI) hardAI = createHardAI();
    return hardAI;
}

// ================================================================
//  AI MOVE EXECUTION
// ================================================================

function executeAIMove(bestMove) {
    if (!aiEnabled || gameOver || currentPlayer !== aiPlayer) return;
    if (!bestMove) {
        console.error('AI could not find a valid move!');
        return;
    }

    saveStateForUndo();

    if (bestMove.type === 'move') {
        pawns[aiPlayer] = {x: bestMove.x, y: bestMove.y};
        positionHistory[aiPlayer].push({x: bestMove.x, y: bestMove.y});
        if (positionHistory[aiPlayer].length > 6) positionHistory[aiPlayer].shift();
        updatePawnPositions();
        if (!checkWin()) switchPlayer();
    } else if (bestMove.type === 'fence') {
        if (placeFence(bestMove.x, bestMove.y, bestMove.orientation)) {
            if (!checkWin()) switchPlayer();
        } else {
            const moves = getValidMoves(aiPlayer);
            if (moves.length > 0) {
                const move = moves[0];
                pawns[aiPlayer] = {x: move.x, y: move.y};
                positionHistory[aiPlayer].push({x: move.x, y: move.y});
                if (positionHistory[aiPlayer].length > 6) positionHistory[aiPlayer].shift();
                updatePawnPositions();
                if (!checkWin()) switchPlayer();
            }
        }
    }
}

