"use strict";

// ==================== AI CONSTANTS ====================
const AI_PLAYER = 2;
const AI_TIME_LIMIT = 1500;
const AI_MAX_DEPTH = 12;

const AI_DIR_VECTORS = {
    up:    { dx: 0, dy: -1 },
    down:  { dx: 0, dy:  1 },
    left:  { dx: -1, dy: 0 },
    right: { dx:  1, dy: 0 }
};

const AI_DIR_OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

// Worker state (shared with game.js)
let aiWorker = null;
let aiWorkerReqId = 0;
const aiWorkerPending = new Map();

// ==================== AI ENGINE FUNCTIONS ====================

function aiFindBestMove(gameState) {
    const startTime = performance.now();
    let bestMove = null;

    for (let depth = 1; depth <= AI_MAX_DEPTH; depth++) {
        const result = aiMinimax(gameState, depth, -Infinity, Infinity, true, startTime);
        if (result.timedOut) break;
        bestMove = result.move;

        if (result.score >= 90000) break;
        if (result.score <= -90000) break;
        if (performance.now() - startTime > AI_TIME_LIMIT * 0.8) break;
    }

    return bestMove;
}

function aiMinimax(state, depth, alpha, beta, maximizing, startTime) {
    if (performance.now() - startTime > AI_TIME_LIMIT) {
        return { score: 0, move: null, timedOut: true };
    }

    if (depth === 0 || state.gameOver) {
        return { score: aiEvaluate(state), move: null, timedOut: false };
    }

    const player = maximizing ? AI_PLAYER : (AI_PLAYER === 1 ? 2 : 1);
    const moves = aiGenerateMoves(state, player);

    if (moves.length === 0) {
        return { score: aiEvaluate(state), move: null, timedOut: false };
    }

    aiOrderMoves(moves, state, player);

    let bestMove = moves[0];

    if (maximizing) {
        let maxScore = -Infinity;
        for (const move of moves) {
            const child = aiApplyMove(state, player, move);
            const result = aiMinimax(child, depth - 1, alpha, beta, false, startTime);
            if (result.timedOut) return { score: 0, move: bestMove, timedOut: true };

            if (result.score > maxScore) {
                maxScore = result.score;
                bestMove = move;
            }
            alpha = Math.max(alpha, maxScore);
            if (beta <= alpha) break;
        }
        return { score: maxScore, move: bestMove, timedOut: false };
    }

    let minScore = Infinity;
    for (const move of moves) {
        const child = aiApplyMove(state, player, move);
        const result = aiMinimax(child, depth - 1, alpha, beta, true, startTime);
        if (result.timedOut) return { score: 0, move: bestMove, timedOut: true };

        if (result.score < minScore) {
            minScore = result.score;
            bestMove = move;
        }
        beta = Math.min(beta, minScore);
        if (beta <= alpha) break;
    }
    return { score: minScore, move: bestMove, timedOut: false };
}

function aiGenerateMoves(state, player) {
    const moves = [];

    const px = state.pawns[player].x;
    const py = state.pawns[player].y;
    const other = player === 1 ? 2 : 1;

    for (const dir of ["up", "down", "left", "right"]) {
        const d = AI_DIR_VECTORS[dir];
        const nx = px + d.dx;
        const ny = py + d.dy;
        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;

        if (nx === state.pawns[other].x && ny === state.pawns[other].y) {
            const jx = nx + d.dx;
            const jy = ny + d.dy;
            if (jx >= 0 && jx < BOARD_SIZE && jy >= 0 && jy < BOARD_SIZE) {
                moves.push({ type: "move", x: jx, y: jy });
            }
            continue;
        }
        moves.push({ type: "move", x: nx, y: ny });
    }

    if (state.arrowCounts[player] > 0) {
        for (let y = 0; y < BOARD_SIZE; y++) {
            for (let x = 0; x < BOARD_SIZE; x++) {
                for (const dir of ["up", "down", "left", "right"]) {
                    if (aiCanPlaceArrow(state, x, y, dir, player)) {
                        moves.push({ type: "arrow", x, y, dir });
                    }
                }
            }
        }
    }

    return moves;
}

function aiCanPlaceArrow(state, x, y, dir, player) {
    const key = x + "," + y;
    if (state.arrows[key]) return false;
    if (state.pawns[1].x === x && state.pawns[1].y === y) return false;
    if (state.pawns[2].x === x && state.pawns[2].y === y) return false;

    const d = AI_DIR_VECTORS[dir];
    const tx = x + d.dx;
    const ty = y + d.dy;
    if (tx < 0 || tx >= BOARD_SIZE || ty < 0 || ty >= BOARD_SIZE) return false;

    const targetKey = tx + "," + ty;
    if (state.arrows[targetKey] && state.arrows[targetKey].dir === AI_DIR_OPPOSITE[dir]) return false;

    if (aiCreatesLoop(state, x, y, dir)) return false;

    state.arrows[key] = { dir, player };
    const ok = aiCanBothReach(state);
    delete state.arrows[key];
    return ok;
}


function aiCreatesLoop(state, x, y, dir) {
    const tempKey = x + "," + y;
    const visited = new Set([tempKey]);
    let cx = x + AI_DIR_VECTORS[dir].dx;
    let cy = y + AI_DIR_VECTORS[dir].dy;

    while (cx >= 0 && cx < BOARD_SIZE && cy >= 0 && cy < BOARD_SIZE) {
        const ck = cx + "," + cy;
        if (visited.has(ck)) return true;
        visited.add(ck);
        const a = state.arrows[ck];
        if (!a) break;
        cx += AI_DIR_VECTORS[a.dir].dx;
        cy += AI_DIR_VECTORS[a.dir].dy;
    }

    for (const otherDir of ["up", "down", "left", "right"]) {
        const od = AI_DIR_VECTORS[otherDir];
        const sx = x - od.dx;
        const sy = y - od.dy;
        if (sx < 0 || sx >= BOARD_SIZE || sy < 0 || sy >= BOARD_SIZE) continue;

        const sa = state.arrows[sx + "," + sy];
        if (sa && sa.dir === otherDir) {
            const v2 = new Set([tempKey]);
            let fx = x + AI_DIR_VECTORS[dir].dx;
            let fy = y + AI_DIR_VECTORS[dir].dy;
            while (fx >= 0 && fx < BOARD_SIZE && fy >= 0 && fy < BOARD_SIZE) {
                const fk = fx + "," + fy;
                if (fk === sx + "," + sy) return true;
                if (v2.has(fk)) return true;
                v2.add(fk);
                const fa = state.arrows[fk];
                if (!fa) break;
                fx += AI_DIR_VECTORS[fa.dir].dx;
                fy += AI_DIR_VECTORS[fa.dir].dy;
            }
        }
    }

    return false;
}

function aiCanBothReach(state) {
    return aiCanReach(state, 1) && aiCanReach(state, 2);
}

function aiCanReach(state, player) {
    const goalRow = player === 1 ? 0 : 8;
    const start = state.pawns[player];
    const visited = new Set([start.x + "," + start.y]);
    const queue = [{ x: start.x, y: start.y }];

    while (queue.length > 0) {
        const { x: cx, y: cy } = queue.shift();
        if (cy === goalRow) return true;

        for (const dir of ["up", "down", "left", "right"]) {
            const d = AI_DIR_VECTORS[dir];
            const nx = cx + d.dx;
            const ny = cy + d.dy;
            if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;

            const dest = aiResolveFlow(state, nx, ny, player);
            if (aiFlowCrossesGoal(state, nx, ny, goalRow)) return true;

            const dk = dest.x + "," + dest.y;
            if (!visited.has(dk)) {
                visited.add(dk);
                queue.push(dest);
            }
        }
    }

    return false;
}

function aiResolveFlow(state, x, y, player) {
    let cx = x;
    let cy = y;
    const goalRow = player === 1 ? 0 : 8;
    const other = player === 1 ? 2 : 1;
    const visited = new Set();

    while (true) {
        if (cy === goalRow) return { x: cx, y: cy };
        const key = cx + "," + cy;
        if (visited.has(key)) break;
        visited.add(key);
        const a = state.arrows[key];
        if (!a) break;
        const d = AI_DIR_VECTORS[a.dir];
        const nx = cx + d.dx;
        const ny = cy + d.dy;
        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) break;
        if (nx === state.pawns[other].x && ny === state.pawns[other].y) break;
        cx = nx;
        cy = ny;
    }

    return { x: cx, y: cy };
}

function aiFlowCrossesGoal(state, sx, sy, goalRow) {
    let cx = sx;
    let cy = sy;
    const visited = new Set();

    while (true) {
        if (cy === goalRow) return true;
        const key = cx + "," + cy;
        if (visited.has(key)) break;
        visited.add(key);
        const a = state.arrows[key];
        if (!a) break;
        const d = AI_DIR_VECTORS[a.dir];
        const nx = cx + d.dx;
        const ny = cy + d.dy;
        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) break;
        cx = nx;
        cy = ny;
    }

    return false;
}

function aiApplyMove(state, player, move) {
    const ns = {
        pawns: { 1: { ...state.pawns[1] }, 2: { ...state.pawns[2] } },
        arrows: Object.fromEntries(Object.entries(state.arrows).map(([k, v]) => [k, { ...v }])),
        arrowCounts: { ...state.arrowCounts },
        currentPlayer: player === 1 ? 2 : 1,
        gameOver: false
    };

    if (move.type === "move") {
        ns.pawns[player] = { x: move.x, y: move.y };
        const dest = aiResolveFlow(ns, move.x, move.y, player);
        ns.pawns[player] = dest;
        const goalRow = player === 1 ? 0 : 8;
        if (dest.y === goalRow || aiFlowCrossesGoal(ns, move.x, move.y, goalRow)) {
            ns.gameOver = true;
        }
    } else if (move.type === "arrow") {
        ns.arrows[move.x + "," + move.y] = { dir: move.dir, player };
        ns.arrowCounts[player]--;
    }

    return ns;
}

function aiOrderMoves(moves, state, player) {
    const goalRow = player === 1 ? 0 : 8;
    const other = player === 1 ? 2 : 1;
    const otherGoalRow = other === 1 ? 0 : 8;

    for (const m of moves) {
        m._priority = 0;

        if (m.type === "move") {
            const dest = aiResolveFlow(state, m.x, m.y, player);
            if (dest.y === goalRow || aiFlowCrossesGoal(state, m.x, m.y, goalRow)) {
                m._priority = 100000;
            } else {
                const distBefore = player === 1 ? state.pawns[player].y : (8 - state.pawns[player].y);
                const distAfter = player === 1 ? dest.y : (8 - dest.y);
                m._priority = (distBefore - distAfter) * 1000 + 5000;
            }
        } else if (m.type === "arrow") {
            const myDist = Math.abs(m.y - state.pawns[player].y) + Math.abs(m.x - state.pawns[player].x);
            const oppDist = Math.abs(m.y - state.pawns[other].y) + Math.abs(m.x - state.pawns[other].x);

            if (m.dir === (otherGoalRow === 0 ? "down" : "up")) {
                m._priority = 2000 - oppDist * 50;
            } else if (m.dir === (goalRow === 0 ? "up" : "down")) {
                m._priority = 1800 - myDist * 50;
            } else {
                m._priority = 1000 - Math.min(myDist, oppDist) * 30;
            }
        }
    }

    moves.sort((a, b) => b._priority - a._priority);

    const arrowMoves = moves.filter(m => m.type === "arrow");
    const pawnMoves = moves.filter(m => m.type === "move");
    if (arrowMoves.length > 20) {
        const topArrows = arrowMoves.slice(0, 20);
        moves.length = 0;
        moves.push(...pawnMoves, ...topArrows);
    }
}

function aiEvaluate(state) {
    const me = AI_PLAYER;
    const opp = me === 1 ? 2 : 1;
    const myGoal = me === 1 ? 0 : 8;
    const oppGoal = opp === 1 ? 0 : 8;

    if (state.gameOver) {
        if (state.pawns[me].y === myGoal) return 100000;
        if (state.pawns[opp].y === oppGoal) return -100000;
    }

    let score = 0;

    const myPathLen = aiBFSDistance(state, me);
    const oppPathLen = aiBFSDistance(state, opp);
    score += (oppPathLen - myPathLen) * 500;

    const myRawDist = me === 1 ? state.pawns[me].y : (8 - state.pawns[me].y);
    const oppRawDist = opp === 1 ? state.pawns[opp].y : (8 - state.pawns[opp].y);
    score += (oppRawDist - myRawDist) * 100;

    score += (state.arrowCounts[me] - state.arrowCounts[opp]) * 30;

    score += aiFlowChainBonus(state, me, myGoal) * 80;
    score -= aiFlowChainBonus(state, opp, oppGoal) * 80;

    const myCenterDist = Math.abs(state.pawns[me].x - 4);
    const oppCenterDist = Math.abs(state.pawns[opp].x - 4);
    score += (oppCenterDist - myCenterDist) * 15;

    score += (8 - myRawDist) * 50;
    score -= (8 - oppRawDist) * 50;

    if (state.currentPlayer === me) score += 25;

    if (oppPathLen <= 1) score -= 8000;
    if (myPathLen <= 1) score += 8000;

    score += aiRedirectionBonus(state, me, opp);
    return score;
}

function aiBFSDistance(state, player) {
    const goalRow = player === 1 ? 0 : 8;
    const start = state.pawns[player];
    if (start.y === goalRow) return 0;

    const visited = new Set([start.x + "," + start.y]);
    const queue = [{ x: start.x, y: start.y, dist: 0 }];

    while (queue.length > 0) {
        const { x: cx, y: cy, dist } = queue.shift();

        for (const dir of ["up", "down", "left", "right"]) {
            const d = AI_DIR_VECTORS[dir];
            let nx = cx + d.dx;
            let ny = cy + d.dy;
            if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;

            const other = player === 1 ? 2 : 1;
            if (nx === state.pawns[other].x && ny === state.pawns[other].y) {
                const jx = nx + d.dx;
                const jy = ny + d.dy;
                if (jx >= 0 && jx < BOARD_SIZE && jy >= 0 && jy < BOARD_SIZE) {
                    nx = jx;
                    ny = jy;
                } else continue;
            }

            const dest = aiResolveFlow(state, nx, ny, player);
            if (dest.y === goalRow || aiFlowCrossesGoal(state, nx, ny, goalRow)) {
                return dist + 1;
            }

            const dk = dest.x + "," + dest.y;
            if (!visited.has(dk)) {
                visited.add(dk);
                queue.push({ x: dest.x, y: dest.y, dist: dist + 1 });
            }
        }
    }

    return 50;
}

function aiFlowChainBonus(state, player, goalRow) {
    let bonus = 0;
    const goalDir = goalRow === 0 ? "up" : "down";

    for (const key of Object.keys(state.arrows)) {
        const a = state.arrows[key];
        const parts = key.split(",");
        const ax = Number(parts[0]);
        const ay = Number(parts[1]);

        if (a.player === player && a.dir === goalDir) {
            const dist = Math.abs(ax - state.pawns[player].x) + Math.abs(ay - state.pawns[player].y);
            bonus += Math.max(0, 5 - dist);
        }
    }

    return bonus;
}

function aiRedirectionBonus(state, me, opp) {
    let bonus = 0;
    const oppGoalDir = opp === 1 ? "up" : "down";

    for (const key of Object.keys(state.arrows)) {
        const a = state.arrows[key];
        const parts = key.split(",");
        const ax = Number(parts[0]);
        const ay = Number(parts[1]);

        const distToOpp = Math.abs(ax - state.pawns[opp].x) + Math.abs(ay - state.pawns[opp].y);
        if (distToOpp <= 3 && a.player === me) {
            if (a.dir === AI_DIR_OPPOSITE[oppGoalDir]) {
                bonus += (4 - distToOpp) * 25;
            } else if (a.dir === "left" || a.dir === "right") {
                bonus += (4 - distToOpp) * 12;
            }
        }
    }

    return bonus;
}

// ==================== WEB WORKER BLOB CREATION ====================

let cachedWorkerBlobURL = null;

function createAIWorkerBlob() {
    if (cachedWorkerBlobURL) return cachedWorkerBlobURL;

    const workerCode = `
"use strict";
const BOARD_SIZE = ${BOARD_SIZE};
const AI_PLAYER = ${AI_PLAYER};
const AI_TIME_LIMIT = ${AI_TIME_LIMIT};
const AI_MAX_DEPTH = ${AI_MAX_DEPTH};
const AI_DIR_VECTORS = ${JSON.stringify(AI_DIR_VECTORS)};
const AI_DIR_OPPOSITE = ${JSON.stringify(AI_DIR_OPPOSITE)};

// AI engine functions (serialized from ai.js)
${aiFindBestMove.toString()}
${aiMinimax.toString()}
${aiGenerateMoves.toString()}
${aiCanPlaceArrow.toString()}
${aiCreatesLoop.toString()}
${aiCanBothReach.toString()}
${aiCanReach.toString()}
${aiResolveFlow.toString()}
${aiFlowCrossesGoal.toString()}
${aiApplyMove.toString()}
${aiOrderMoves.toString()}
${aiEvaluate.toString()}
${aiBFSDistance.toString()}
${aiFlowChainBonus.toString()}
${aiRedirectionBonus.toString()}

self.onmessage = function(event) {
    const { type, requestId, state } = event.data || {};
    if (type !== "bestMove") return;

    try {
        const move = aiFindBestMove(state);
        self.postMessage({ requestId, move });
    } catch (error) {
        self.postMessage({ requestId, error: (error && error.message) ? error.message : String(error) });
    }
};
`;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    cachedWorkerBlobURL = URL.createObjectURL(blob);
    return cachedWorkerBlobURL;
}

// ==================== WORKER MANAGEMENT ====================

function initAIWorker() {
    if (aiWorker) return;
    const blobUrl = createAIWorkerBlob();
    aiWorker = new Worker(blobUrl);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);

    aiWorker.onmessage = (event) => {
        const { requestId, move, error } = event.data || {};
        const pending = aiWorkerPending.get(requestId);
        if (!pending) return;
        aiWorkerPending.delete(requestId);
        if (error) {
            pending.reject(new Error(error));
            return;
        }
        pending.resolve(move || null);
    };

    aiWorker.onerror = (event) => {
        for (const pending of aiWorkerPending.values()) {
            pending.reject(new Error(event.message || 'AI worker error'));
        }
        aiWorkerPending.clear();
        console.error('AI worker crashed:', event.message || event);
    };
}

function requestBestMoveFromWorker(state) {
    initAIWorker();

    return new Promise((resolve, reject) => {
        const requestId = ++aiWorkerReqId;
        aiWorkerPending.set(requestId, { resolve, reject });
        aiWorker.postMessage({ type: 'bestMove', requestId, state });
    });
}
