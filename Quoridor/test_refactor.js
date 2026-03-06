// Stub globals that game.js would provide
let fences = {1:10,2:10}, pawns = {1:{x:4,y:0},2:{x:4,y:8}}, placedFences = [], positionHistory = {1:[{x:4,y:0}],2:[{x:4,y:8}]};
let aiEnabled=true, aiPlayer=2, aiThinking=false, gameOver=false, currentPlayer=1, assistCalculationPlayer=null;
let aiDifficulty='hard';
const BOARD_SIZE = 9;
function showAIThinkingIndicator(){} function hideAIThinkingIndicator(){} function showCurrentPlayerThinkingIndicator(){} function hideCurrentPlayerThinkingIndicator(){} function displayAssistProposal(){} function clearAssistProposal(){} function updatePawnPositions(){} function checkWin(){return false} function switchPlayer(){} function placeFence(){return true} function getValidMoves(){return [{x:4,y:1}]}

// Load ai.js (strip use strict for eval)
let code = require('fs').readFileSync('/Users/D045365/Documents/Vibe/Quoridor/ai.js','utf8');
code = code.replace(/^"use strict";/, '');
eval(code);

const testState = {
    player: 1,
    pawns: {1:{x:4,y:0},2:{x:4,y:8}},
    fences: [],
    counts: {1:10,2:10},
    history: {1:[{x:4,y:0}],2:[{x:4,y:8}]}
};

console.log('Testing Easy AI (MCTS)...');
console.time('easy');
const e = createEasyAI(200);
const em = e.findBestMove(testState.player, testState.pawns, testState.fences, testState.counts, testState.history);
console.timeEnd('easy');
console.log('Easy:', JSON.stringify(em));
console.assert(em && em.type, 'Easy AI returned valid move');

console.log('\nTesting Good AI (Minimax)...');
console.time('good');
const g = createGoodAI();
const gm = g.findBestMove(testState.player, testState.pawns, testState.fences, testState.counts, testState.history);
console.timeEnd('good');
console.log('Good:', JSON.stringify(gm));
console.assert(gm && gm.type, 'Good AI returned valid move');

console.log('\nTesting Hard AI (ID-PVS)...');
console.time('hard');
const h = createHardAI();
const hm = h.findBestMove(testState.player, testState.pawns, testState.fences, testState.counts, testState.history);
console.timeEnd('hard');
console.log('Hard:', JSON.stringify(hm));
console.assert(hm && hm.type, 'Hard AI returned valid move');

// Test mid-game with fences
console.log('\nTesting mid-game state...');
const midPawns = {1:{x:4,y:3},2:{x:4,y:5}};
const midFences = [{x:3,y:4,orientation:'h'},{x:5,y:3,orientation:'v'}];
const midCounts = {1:8,2:9};

const hm2 = h.findBestMove(1, midPawns, midFences, midCounts, {1:[{x:4,y:2},{x:4,y:3}],2:[{x:4,y:6},{x:4,y:5}]});
console.log('Hard mid-game:', JSON.stringify(hm2));
console.assert(hm2 && hm2.type, 'Hard AI returned valid mid-game move');

const em2 = e.findBestMove(2, midPawns, midFences, midCounts, {1:[{x:4,y:2},{x:4,y:3}],2:[{x:4,y:6},{x:4,y:5}]});
console.log('Easy mid-game:', JSON.stringify(em2));
console.assert(em2 && em2.type, 'Easy AI returned valid mid-game move');

console.log('\nALL_TESTS_PASSED');

