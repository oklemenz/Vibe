# Quoridor AI Strategy Reference

Load this file before each AI turn. Follow the decision framework systematically.

## Core Principles

1. **Shortest path wins.** The player with the shorter path to their goal has the advantage. Always know both players' approximate shortest path lengths.
2. **Fences are finite.** 10 fences total. Every fence spent on offense is one fewer for defense. Budget them.
3. **Tempo matters.** Each turn spent placing a fence is a turn not advancing. A fence must gain more than 1 step advantage to be worth the tempo loss.
4. **The center is key.** A pawn near the center column has more routing options around fences.

## Shortest Path Estimation

Before each move, estimate the shortest path for both players using BFS:

1. From the player's current position, count the minimum number of moves to reach any square in their goal row
2. Account for all placed fences — trace around them
3. Do this for both P1 and P2

**Quick estimate:** Without any fences, the shortest path is simply the distance to the goal row (e.g., from row 3 to row 9 = 6 moves). Each fence in the path adds roughly 2 moves (must go around). Use this for fast approximation, but trace carefully in complex positions.

**Notation:** Let `myPath` = AI's shortest path length, `oppPath` = opponent's shortest path length.

## Decision Framework

Follow this checklist on every AI turn, in order:

### Step 1: Check Win
- If AI can reach row 1 this turn (myPath = 1), MOVE to the goal. Game over.

### Step 2: Check Urgent Defense
- If oppPath ≤ 2 and AI has fences remaining, strongly consider blocking.
- If oppPath = 1 (opponent wins next turn), MUST place a fence that increases oppPath, or lose.

### Step 3: Evaluate Position
Compute the path differential: `diff = oppPath - myPath`

- **diff ≥ 3 (AI far ahead):** Just advance. No need to fence. Move toward goal on the shortest path.
- **diff = 1 or 2 (AI slightly ahead):** Advance, but consider a strong fence if one is available that increases oppPath by 2+ without increasing myPath.
- **diff = 0 (even):** Critical decision point. Go to Step 4.
- **diff = -1 or -2 (AI slightly behind):** Fence if a good option exists. Otherwise advance.
- **diff ≤ -3 (AI far behind):** Must fence aggressively. Find the best blocking fence.

### Step 4: Fence-or-Move Decision (when position is close)

Evaluate the best available fence placement:
1. Consider fences near the opponent's current position and along their shortest path
2. Score each candidate: `value = oppPath_after - oppPath_before - (myPath_after - myPath_before)`
3. A fence is worth placing if `value ≥ 2` (net gain of 2+ moves)
4. If no fence scores ≥ 2, advance the pawn instead

### Step 5: Choose the Best Fence (if fencing)

Prioritize fence placements in this order:
1. **Fences that force a U-turn:** Placed just ahead of opponent so they must reverse direction and go around. These typically add 4-6 moves to opponent's path.
2. **Fences that extend existing walls:** Linking a new fence to an existing one or to the board edge creates longer barriers.
3. **Fences near the opponent:** More impactful than fences far from the opponent.
4. **Fences that don't hurt AI's own path:** Avoid fences that also increase your shortest path.

### Step 6: Choose the Best Move (if moving)

1. Move along the shortest path toward row 1
2. If multiple shortest paths exist, prefer the one that:
   - Moves toward the center column (more routing flexibility)
   - Moves away from opponent's fences
   - Sets up a potential jump (positioning adjacent to opponent when beneficial)
3. Avoid moving into dead-end corridors created by fences

## Phase-Based Strategy

### Opening (Turns 1-6, few or no fences)
- **Primary:** Advance pawn toward center of board (rows 4-6)
- **Fence placement:** Only if opponent is advancing much faster, or an exceptionally strong fence is available
- **Don't:** Waste fences early. The opponent hasn't committed to a path yet, so fences may be easily routed around
- **Tip:** Advance straight toward goal unless opponent is on a collision course, then consider lateral movement

### Midgame (Turns 7-15, some fences placed)
- **Primary:** Maintain or gain path advantage
- **Fence placement:** This is the highest-value phase for fencing. Opponent has fewer routing options as more fences appear.
- **Key tactic:** Place fences that work with existing fences to create longer walls. A lone fence adds ~2 moves, but two connected fences can add 4-6.
- **Watch for:** Corridors forming that funnel the opponent into longer routes

### Endgame (Turns 16+, many fences placed, close to goal)
- **Primary:** Race to the goal
- **Fence placement:** Only for emergency defense (opponent about to win)
- **Reserve:** Keep 1-2 fences for emergencies. An endgame fence that stops the opponent from winning is worth more than any midgame fence.
- **Jump opportunities:** When pawns are close, look for jumps to gain an extra square

## Fence Placement Patterns

### The L-Block
Place two fences in an L-shape near the opponent to force them to go around two walls:
```
Opponent at e6, heading south:
  fence h d5  (blocks d5-e5 ↔ d6-e6)
  fence v e4  (blocks e4-f4 and e5-f5)
This creates an L that forces the opponent east or far west.
```

### The Wall Extension
When a horizontal fence already exists, place another adjacent to extend the wall:
```
Existing: fence h c5
Place:    fence h e5  (extends wall to cover columns c,d,e,f at row 5)
```
But remember: fence h d5 would overlap with c5 (shared edge at column d).
Valid extensions: fences that are exactly 2 columns apart (no gap, no overlap).

### The Corridor Funnel
Place fences to create a narrow corridor the opponent must follow:
```
H-fences staggered at alternating sides force a zigzag:
  fence h a3  (blocks left side at row 3)
  fence h g5  (blocks right side at row 5)
  fence h b7  (blocks left side at row 7)
Each forces the opponent to zigzag across the board.
```

### Edge Pin
When opponent is near the board edge (columns a-b or h-i), fences are more effective because the edge itself acts as a wall:
```
Opponent at b6, heading south:
  fence h a5  (together with the left board edge, this blocks 2 of ~3 columns)
```

## Face-to-Face Tactics

When pawns are adjacent:
- **If AI can jump past opponent toward goal:** Jump. This gains 2 squares of progress in one move.
- **If fence blocks the jump:** Move laterally to a position that resumes the shortest path.
- **Avoid ending up adjacent to opponent unless:** You benefit from the jump opportunity or you're blocking their jump.

## Fence Budget Guidelines

| AI Fences Remaining | Strategy |
|---------------------|----------|
| 8-10 | Conservative. Only fence for high-value opportunities (value ≥ 3) |
| 5-7  | Moderate. Fence when value ≥ 2 |
| 2-4  | Defensive reserve. Fence only to prevent opponent winning or for critical blocks |
| 0-1  | Emergency only. Save last fence for when opponent is 1-2 moves from winning |

## Anti-Patterns (Avoid These)

- **Wasting fences far from opponent:** A fence on the opposite side of the board rarely matters.
- **Symmetric fencing:** Don't mirror opponent's fences — this wastes tempo.
- **Ignoring your own path:** A fence that adds 3 to opponent but 2 to yourself only nets +1.
- **Fencing when far ahead:** If you're 3+ moves ahead, just race. Fences waste tempo.
- **Panic fencing:** Don't spam all fences when behind. Budget them for maximum impact.
- **Forgetting path validation:** Always verify the fence leaves a legal path for both players before committing.
