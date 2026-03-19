"use strict";

// ==================== AI CONSTANTS ====================
const AI_PLAYER = 2;
const AI_TIME_LIMIT = 2500;
const AI_MAX_DEPTH = 14;

const AI_DIR_VECTORS = {
    up:    { dx: 0, dy: -1 },
    down:  { dx: 0, dy:  1 },
    left:  { dx: -1, dy: 0 },
    right: { dx:  1, dy: 0 }
};

const AI_DIR_OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };
const AI_ALL_DIRS = ["up", "down", "left", "right"];

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

        // Found a winning/losing move — stop
        if (result.score >= 90000) break;
        if (result.score <= -90000) break;
        if (performance.now() - startTime > AI_TIME_LIMIT * 0.75) break;
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

    for (const dir of AI_ALL_DIRS) {
        const d = AI_DIR_VECTORS[dir];
        const nx = px + d.dx;
        const ny = py + d.dy;
        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;

        if (nx === state.pawns[other].x && ny === state.pawns[other].y) {
            const jx = nx + d.dx;
            const jy = ny + d.dy;
            if (jx >= 0 && jx < BOARD_SIZE && jy >= 0 && jy < BOARD_SIZE) {
                moves.push({ type: "move", x: jx, y: jy });
            } else {
                // Quoridor rule: straight jump blocked (off board), allow side-steps
                for (const sideDir of AI_ALL_DIRS) {
                    if (sideDir === dir || sideDir === AI_DIR_OPPOSITE[dir]) continue;
                    const sd = AI_DIR_VECTORS[sideDir];
                    const sx = nx + sd.dx;
                    const sy = ny + sd.dy;
                    if (sx < 0 || sx >= BOARD_SIZE || sy < 0 || sy >= BOARD_SIZE) continue;
                    moves.push({ type: "move", x: sx, y: sy });
                }
            }
            continue;
        }
        moves.push({ type: "move", x: nx, y: ny });
    }

    if (state.arrowCounts[player] > 0) {
        for (let y = 0; y < BOARD_SIZE; y++) {
            for (let x = 0; x < BOARD_SIZE; x++) {
                for (const dir of AI_ALL_DIRS) {
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

    for (const otherDir of AI_ALL_DIRS) {
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

        for (const dir of AI_ALL_DIRS) {
            const d = AI_DIR_VECTORS[dir];
            const nx = cx + d.dx;
            const ny = cy + d.dy;
            if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;

            const dest = aiResolveFlow(state, nx, ny, player);
            if (aiFlowCrossesGoal(state, nx, ny, goalRow, player)) return true;

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
        // Jump over other pawn
        if (nx === state.pawns[other].x && ny === state.pawns[other].y) {
            const jx = nx + d.dx;
            const jy = ny + d.dy;
            if (jx < 0 || jx >= BOARD_SIZE || jy < 0 || jy >= BOARD_SIZE) break;
            const jk = jx + "," + jy;
            if (visited.has(jk)) break;
            cx = jx;
            cy = jy;
            if (!state.arrows[jk]) break;
            continue;
        }
        cx = nx;
        cy = ny;
    }

    return { x: cx, y: cy };
}

function aiFlowCrossesGoal(state, sx, sy, goalRow, player) {
    let cx = sx;
    let cy = sy;
    const other = player === 1 ? 2 : 1;
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
        // Jump over other pawn
        if (nx === state.pawns[other].x && ny === state.pawns[other].y) {
            const jx = nx + d.dx;
            const jy = ny + d.dy;
            if (jx < 0 || jx >= BOARD_SIZE || jy < 0 || jy >= BOARD_SIZE) break;
            const jk = jx + "," + jy;
            if (visited.has(jk)) break;
            cx = jx;
            cy = jy;
            if (cy === goalRow) return true;
            if (!state.arrows[jk]) break;
            continue;
        }
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
        if (dest.y === goalRow || aiFlowCrossesGoal(ns, move.x, move.y, goalRow, player)) {
            ns.gameOver = true;
        }
    } else if (move.type === "arrow") {
        ns.arrows[move.x + "," + move.y] = { dir: move.dir, player };
        ns.arrowCounts[player]--;
    }

    return ns;
}

// ==================== SMART MOVE ORDERING ====================
function aiOrderMoves(moves, state, player) {
    const goalRow = player === 1 ? 0 : 8;
    const other = player === 1 ? 2 : 1;
    const otherGoalRow = other === 1 ? 0 : 8;

    // Pre-compute distances (cheap relative to full search)
    const oppBfsDist = aiBFSDistance(state, other);
    const myBfsDist = aiBFSDistance(state, player);

    // Analyze opponent's flow threat zones
    const oppThreatCells = aiGetFlowThreatZone(state, other);

    // Phase 1: Quick heuristic scoring for all moves
    for (const m of moves) {
        m._priority = 0;

        if (m.type === "move") {
            const dest = aiResolveFlow(state, m.x, m.y, player);
            if (dest.y === goalRow || aiFlowCrossesGoal(state, m.x, m.y, goalRow, player)) {
                m._priority = 100000; // winning move
            } else {
                const distBefore = player === 1 ? state.pawns[player].y : (8 - state.pawns[player].y);
                const distAfter = player === 1 ? dest.y : (8 - dest.y);
                const progress = distBefore - distAfter;
                m._priority = progress * 2000 + 5000;

                // Bonus for moving onto a flow chain
                const flowLen = aiFlowLength(state, m.x, m.y, player);
                m._priority += flowLen * 500;
            }
        } else if (m.type === "arrow") {
            const arrowKey = m.x + "," + m.y;

            // Bonus for placing in opponent's flow threat zone
            if (oppThreatCells.has(arrowKey)) {
                m._priority += 2500;
            }

            // Bonus for arrows that point opponent away from their goal
            if (m.dir === (otherGoalRow === 0 ? "down" : "up")) {
                const distToOpp = Math.abs(m.y - state.pawns[other].y) + Math.abs(m.x - state.pawns[other].x);
                m._priority += Math.max(0, 2000 - distToOpp * 200);
            }

            // Bonus for arrows pointing us toward our goal
            if (m.dir === (goalRow === 0 ? "up" : "down")) {
                const distToMe = Math.abs(m.y - state.pawns[player].y) + Math.abs(m.x - state.pawns[player].x);
                m._priority += Math.max(0, 1500 - distToMe * 200);
            }

            // Center bonus
            const centerBonus = 4 - Math.abs(m.x - 4);
            m._priority += centerBonus * 50;

            // Arrows near opponent's current position
            const nearOpp = Math.abs(m.x - state.pawns[other].x) + Math.abs(m.y - state.pawns[other].y);
            if (nearOpp <= 3) {
                m._priority += (4 - nearOpp) * 400;
            }

            // Arrows extending existing chains
            const chainExt = aiArrowExtendsChain(state, m.x, m.y, m.dir, player);
            m._priority += chainExt * 600;
        }
    }

    // Sort by quick heuristic first
    moves.sort((a, b) => b._priority - a._priority);

    // Phase 2: Expensive BFS-based evaluation for top candidate arrows only
    // This avoids doing BFS for hundreds of arrow moves at every depth
    const arrowMoves = moves.filter(m => m.type === "arrow");
    const pawnMoves = moves.filter(m => m.type === "move");
    const bfsEvalCount = Math.min(arrowMoves.length, oppBfsDist <= 3 ? 25 : 15);

    for (let i = 0; i < bfsEvalCount; i++) {
        const m = arrowMoves[i];
        const childState = aiApplyMove(state, player, m);
        const newOppDist = aiBFSDistance(childState, other);
        const distIncrease = newOppDist - oppBfsDist;

        if (distIncrease > 0) {
            m._priority += 6000 + distIncrease * 1500;
        }

        const newMyDist = aiBFSDistance(childState, player);
        const myDistDecrease = myBfsDist - newMyDist;
        if (myDistDecrease > 0) {
            m._priority += myDistDecrease * 1200;
        }
    }

    // Re-sort arrows after BFS evaluation and prune
    arrowMoves.sort((a, b) => b._priority - a._priority);
    const maxArrows = oppBfsDist <= 3 ? 40 : 30;
    const topArrows = arrowMoves.length > maxArrows ? arrowMoves.slice(0, maxArrows) : arrowMoves;

    moves.length = 0;
    moves.push(...pawnMoves, ...topArrows);
    moves.sort((a, b) => b._priority - a._priority);
}

// ==================== ENHANCED EVALUATION ====================
function aiEvaluate(state) {
    const me = AI_PLAYER;
    const opp = me === 1 ? 2 : 1;
    const myGoal = me === 1 ? 0 : 8;
    const oppGoal = opp === 1 ? 0 : 8;

    // Terminal states
    if (state.gameOver) {
        if (state.pawns[me].y === myGoal) return 100000;
        if (state.pawns[opp].y === oppGoal) return -100000;
    }

    let score = 0;

    // === BFS DISTANCE (most important factor) ===
    const myPathLen = aiBFSDistance(state, me);
    const oppPathLen = aiBFSDistance(state, opp);
    score += (oppPathLen - myPathLen) * 800;

    // === URGENCY: near-win/near-loss detection ===
    if (myPathLen <= 1) score += 12000;
    else if (myPathLen === 2) score += 4000;
    else if (myPathLen === 3) score += 1500;

    if (oppPathLen <= 1) score -= 15000;
    else if (oppPathLen === 2) score -= 6000;
    else if (oppPathLen === 3) score -= 2000;

    // === RAW POSITIONAL DISTANCE ===
    const myRawDist = me === 1 ? state.pawns[me].y : (8 - state.pawns[me].y);
    const oppRawDist = opp === 1 ? state.pawns[opp].y : (8 - state.pawns[opp].y);
    score += (oppRawDist - myRawDist) * 150;
    score += (8 - myRawDist) * 60;
    score -= (8 - oppRawDist) * 60;

    // === FLOW CHAIN ANALYSIS ===
    const myChainScore = aiAnalyzeFlowChains(state, me, myGoal);
    const oppChainScore = aiAnalyzeFlowChains(state, opp, oppGoal);
    score += myChainScore * 120;
    score -= oppChainScore * 150; // Weight opponent's chains more to encourage blocking

    // === ARROW ECONOMY ===
    score += (state.arrowCounts[me] - state.arrowCounts[opp]) * 40;

    // === BOARD CONTROL ===
    score += aiBoardControl(state, me, opp);

    // === OPPONENT FLOW DISRUPTION ===
    score += aiDisruptionScore(state, me, opp);

    // === CENTER CONTROL ===
    const myCenterDist = Math.abs(state.pawns[me].x - 4);
    const oppCenterDist = Math.abs(state.pawns[opp].x - 4);
    score += (oppCenterDist - myCenterDist) * 20;

    // === TEMPO ===
    if (state.currentPlayer === me) score += 30;

    // === FLOW CONNECTIVITY ===
    score += aiFlowConnectivity(state, me, myGoal) * 80;
    score -= aiFlowConnectivity(state, opp, oppGoal) * 100;

    return score;
}

// ==================== EVALUATION HELPERS ====================

function aiBFSDistance(state, player) {
    const goalRow = player === 1 ? 0 : 8;
    const start = state.pawns[player];
    if (start.y === goalRow) return 0;

    const visited = new Set([start.x + "," + start.y]);
    const queue = [{ x: start.x, y: start.y, dist: 0 }];

    while (queue.length > 0) {
        const { x: cx, y: cy, dist } = queue.shift();

        for (const dir of AI_ALL_DIRS) {
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
            if (dest.y === goalRow || aiFlowCrossesGoal(state, nx, ny, goalRow, player)) {
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

// Analyze flow chain quality for a player
function aiAnalyzeFlowChains(state, player, goalRow) {
    let chainScore = 0;
    const goalDir = goalRow === 0 ? "up" : "down";
    const pawn = state.pawns[player];

    for (const key of Object.keys(state.arrows)) {
        const a = state.arrows[key];
        const [ax, ay] = key.split(",").map(Number);

        // Arrows belonging to this player pointing toward goal
        if (a.player === player) {
            if (a.dir === goalDir) {
                const dist = Math.abs(ax - pawn.x) + Math.abs(ay - pawn.y);
                chainScore += Math.max(0, 8 - dist);

                // Extra bonus for arrows between pawn and goal
                const pawnToGoal = player === 1 ? pawn.y : (8 - pawn.y);
                const arrowToGoal = player === 1 ? ay : (8 - ay);
                if (arrowToGoal < pawnToGoal) {
                    chainScore += 3;
                }
            }
        }

        // Any arrow that can flow toward our goal
        const flowEnd = aiResolveFlow(state, ax, ay, player);
        const startDist = player === 1 ? ay : (8 - ay);
        const endDist = player === 1 ? flowEnd.y : (8 - flowEnd.y);
        const progress = startDist - endDist;
        if (progress > 0) {
            const dist = Math.abs(ax - pawn.x) + Math.abs(ay - pawn.y);
            if (dist <= 5) {
                chainScore += progress * Math.max(0, 3 - dist / 2);
            }
        }
    }

    return chainScore;
}

// Evaluate board control
function aiBoardControl(state, me, opp) {
    let score = 0;
    const myGoalDir = me === 1 ? "up" : "down";
    const oppGoalDir = opp === 1 ? "up" : "down";

    let myGoalAligned = 0;
    let oppDeflected = 0;
    let myArrowsOnBoard = 0;
    let oppArrowsOnBoard = 0;

    for (const key of Object.keys(state.arrows)) {
        const a = state.arrows[key];
        const [ax, ay] = key.split(",").map(Number);

        if (a.player === me) {
            myArrowsOnBoard++;
            if (a.dir === myGoalDir) myGoalAligned++;

            // Arrows that deflect opponent sideways or backwards
            const distToOpp = Math.abs(ax - state.pawns[opp].x) + Math.abs(ay - state.pawns[opp].y);
            if (distToOpp <= 4) {
                if (a.dir === AI_DIR_OPPOSITE[oppGoalDir]) {
                    oppDeflected += (5 - distToOpp) * 2;
                } else if (a.dir === "left" || a.dir === "right") {
                    oppDeflected += (5 - distToOpp);
                }
            }
        } else {
            oppArrowsOnBoard++;
        }
    }

    score += myGoalAligned * 30;
    score += oppDeflected * 40;
    score += (myArrowsOnBoard - oppArrowsOnBoard) * 10;

    return score;
}

// Score how well our arrows disrupt opponent's path to goal
function aiDisruptionScore(state, me, opp) {
    let score = 0;
    const oppGoalDir = opp === 1 ? "up" : "down";
    const oppPawn = state.pawns[opp];
    const oppGoalRow = opp === 1 ? 0 : 8;

    const colMin = Math.max(0, oppPawn.x - 3);
    const colMax = Math.min(8, oppPawn.x + 3);
    const rowLo = Math.min(oppPawn.y, oppGoalRow);
    const rowHi = Math.max(oppPawn.y, oppGoalRow);

    for (let y = rowLo; y <= rowHi; y++) {
        for (let x = colMin; x <= colMax; x++) {
            const key = x + "," + y;
            const a = state.arrows[key];
            if (!a || a.player !== me) continue;

            if (a.dir === AI_DIR_OPPOSITE[oppGoalDir]) {
                score += 50;
            } else if (a.dir === "left" || a.dir === "right") {
                score += 30;
            }
        }
    }

    return score;
}

// Measure flow connectivity: how many cells near pawn can reach the goal
function aiFlowConnectivity(state, player, goalRow) {
    let connectivity = 0;
    const pawn = state.pawns[player];

    for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -3; dy <= 3; dy++) {
            const cx = pawn.x + dx;
            const cy = pawn.y + dy;
            if (cx < 0 || cx >= BOARD_SIZE || cy < 0 || cy >= BOARD_SIZE) continue;

            const key = cx + "," + cy;
            if (!state.arrows[key]) continue;

            if (aiFlowCrossesGoal(state, cx, cy, goalRow, player)) {
                const dist = Math.abs(dx) + Math.abs(dy);
                connectivity += Math.max(0, 5 - dist);
            }
        }
    }

    return connectivity;
}

// Get the cells in the opponent's flow threat zone
function aiGetFlowThreatZone(state, player) {
    const threatCells = new Set();
    const goalRow = player === 1 ? 0 : 8;
    const pawn = state.pawns[player];
    const yStep = goalRow === 0 ? -1 : 1;

    // Cells in front of the opponent pawn (toward their goal)
    for (let y = pawn.y; y !== goalRow + yStep; y += yStep) {
        for (let x = Math.max(0, pawn.x - 3); x <= Math.min(8, pawn.x + 3); x++) {
            const key = x + "," + y;
            if (!state.arrows[key]) {
                threatCells.add(key);
            }
        }
    }

    // Cells adjacent to existing player arrows (chain extension points)
    for (const key of Object.keys(state.arrows)) {
        const a = state.arrows[key];
        if (a.player !== player) continue;
        const [ax, ay] = key.split(",").map(Number);

        for (const dir of AI_ALL_DIRS) {
            const d = AI_DIR_VECTORS[dir];
            const nx = ax + d.dx;
            const ny = ay + d.dy;
            if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE) {
                const nk = nx + "," + ny;
                if (!state.arrows[nk]) {
                    threatCells.add(nk);
                }
            }
        }
    }

    return threatCells;
}

// Check how many steps a flow chain covers from a given cell
function aiFlowLength(state, x, y, player) {
    let len = 0;
    let cx = x, cy = y;
    const visited = new Set();
    const goalRow = player === 1 ? 0 : 8;

    while (cx >= 0 && cx < BOARD_SIZE && cy >= 0 && cy < BOARD_SIZE) {
        if (cy === goalRow) return len + 5;
        const key = cx + "," + cy;
        if (visited.has(key)) break;
        visited.add(key);
        const a = state.arrows[key];
        if (!a) break;
        const d = AI_DIR_VECTORS[a.dir];
        cx += d.dx;
        cy += d.dy;
        len++;
    }

    return len;
}

// Check if placing an arrow extends an existing chain
function aiArrowExtendsChain(state, x, y, dir, player) {
    const goalRow = player === 1 ? 0 : 8;
    const goalDir = goalRow === 0 ? "up" : "down";
    let extends_ = 0;

    // Check if there's an arrow pointing TO this cell
    for (const checkDir of AI_ALL_DIRS) {
        const d = AI_DIR_VECTORS[checkDir];
        const sx = x - d.dx;
        const sy = y - d.dy;
        if (sx < 0 || sx >= BOARD_SIZE || sy < 0 || sy >= BOARD_SIZE) continue;
        const srcKey = sx + "," + sy;
        const srcArrow = state.arrows[srcKey];
        if (srcArrow && srcArrow.dir === checkDir) {
            extends_ += 2;
            if (srcArrow.player === player) extends_ += 1;
        }
    }

    // Check if the arrow's target has a continuation
    const d = AI_DIR_VECTORS[dir];
    const tx = x + d.dx;
    const ty = y + d.dy;
    if (tx >= 0 && tx < BOARD_SIZE && ty >= 0 && ty < BOARD_SIZE) {
        const targetKey = tx + "," + ty;
        if (state.arrows[targetKey]) {
            extends_ += 1;
        }
    }

    // Bonus if pointing toward our goal
    if (dir === goalDir) extends_ += 2;

    return extends_;
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
const AI_ALL_DIRS = ${JSON.stringify(AI_ALL_DIRS)};

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
${aiAnalyzeFlowChains.toString()}
${aiBoardControl.toString()}
${aiDisruptionScore.toString()}
${aiFlowConnectivity.toString()}
${aiGetFlowThreatZone.toString()}
${aiFlowLength.toString()}
${aiArrowExtendsChain.toString()}

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
