# Quoridor Rules and Validation Reference

Load this file at game start and consult it for every move validation.

## Coordinate System

- Columns: a=1, b=2, c=3, d=4, e=5, f=6, g=7, h=8, i=9
- Rows: 1 (bottom) to 9 (top)
- A square is identified as `<col><row>`, e.g., `e5` = column 5, row 5

## Complete Rules (2 Players)

- 9x9 board. Each player starts with 10 fences.
- Player 1 starts at e1 (bottom center). Goal: reach any square in row 9.
- Player 2 starts at e9 (top center). Goal: reach any square in row 1.
- Each turn: move pawn OR place one fence. When out of fences, must move.
- Pawns move exactly one square horizontally or vertically (not diagonal).
- Fences span exactly 2 squares and block passage between those squares.
- Every fence placement must leave at least one path open for each player to reach their goal row.

## Pawn Move Validation

Given current position (col, row) and target (tcol, trow):

### Simple Move (one step, no opponent adjacent in that direction)
1. Target must be exactly one step away: |col-tcol| + |row-trow| = 1
2. Target must be in bounds: tcol ∈ [1,9], trow ∈ [1,9]
3. No fence blocks the edge between current and target (see Fence Blocking below)
4. Target square is not occupied by opponent

### Jump Move (opponent is adjacent)
When the opponent occupies the target of a simple move:

**Straight jump:** If opponent is at adjacent square A and the square B directly behind A (same direction) is:
- In bounds, AND
- Not blocked by a fence between A and B, AND
- Not occupied

Then the player can jump to B (2 squares in that direction).

**Diagonal jump:** If the straight jump is blocked (fence behind opponent or B is out of bounds), the player can move to either square laterally adjacent to the opponent, provided:
- That lateral square is in bounds
- No fence blocks movement from the opponent's square to that lateral square

Example: P1 at e4, P2 at e5.
- If no fence above e5: P1 can jump to e6 (straight jump)
- If fence above e5 (blocking e5→e6): P1 can move to d5 or f5 (diagonal jump), if no fence blocks those lateral moves from e5

### Direction-to-Delta Mapping
- N: row+1 (move up)
- S: row-1 (move down)
- E: col+1 (move right)
- W: col-1 (move left)

## Fence Blocking Rules

A move from square (c1, r1) to (c2, r2) is blocked by a fence if:

### Moving North (r2 = r1+1, same column)
Blocked if ANY horizontal fence has anchor (x, r1) where x ∈ {c1-1, c1}
- Reason: horizontal fence at anchor (x, r1) blocks the edge between row r1 and r1+1 at columns x and x+1

### Moving South (r2 = r1-1, same column)
Blocked if ANY horizontal fence has anchor (x, r2) where x ∈ {c1-1, c1}
- Same as checking north from the target

### Moving East (c2 = c1+1, same row)
Blocked if ANY vertical fence has anchor (c1, y) where y ∈ {r1-1, r1}
- Reason: vertical fence at anchor (c1, y) blocks the edge between columns c1 and c1+1 at rows y and y+1

### Moving West (c2 = c1-1, same row)
Blocked if ANY vertical fence has anchor (c2, y) where y ∈ {r1-1, r1}
- Same as checking east from the target

**Remember:** Column letters map to numbers: a=1, b=2, ..., i=9. When a fence anchor is stored as e.g., "e5", convert to (5, 5) for arithmetic.

## Fence Placement Validation

For placing a fence with anchor at (col, row):

### Horizontal Fence at (col, row)
1. **Bounds:** col ∈ [1,8] and row ∈ [1,8] (fence extends to col+1 and between row/row+1)
2. **No overlap with existing horizontal fences:** No existing h-fence at same (col, row)
3. **No partial overlap:** No existing h-fence at (col-1, row) or (col+1, row) — these would share a segment
4. **No crossing:** No existing v-fence at (col, row) — a vertical fence at the same anchor crosses through the horizontal fence
5. **Path remains open:** After hypothetically placing this fence, both players must still have a path to their goal (BFS check)
6. **Player has fences remaining**

Wait — correction on overlap rule #3. Two horizontal fences CAN be at (col-1, row) and (col+1, row) — they just can't share a segment. Actually the rule is: a horizontal fence occupies the bottom edges of (col, row+1) and (col+1, row+1). Two h-fences overlap if they share any edge segment. H-fence at (c, r) occupies edges at columns c and c+1 between rows r and r+1. So:
- H-fence at (c, r) conflicts with h-fence at (c-1, r) because they share the edge at column c
- H-fence at (c, r) conflicts with h-fence at (c+1, r) because they share the edge at column c+1
- So no h-fence can be placed if one already exists at (col±1, row) or (col, row)

### Vertical Fence at (col, row)
1. **Bounds:** col ∈ [1,8] and row ∈ [1,8] (fence extends between col/col+1 and rows row/row+1)
2. **No overlap:** No existing v-fence at same (col, row)
3. **No partial overlap:** No existing v-fence at (col, row-1) or (col, row+1)
4. **No crossing:** No existing h-fence at (col, row)
5. **Path remains open:** BFS check for both players
6. **Player has fences remaining**

## BFS Path Validation Procedure

After every fence placement, verify both players can still reach their goal. Follow this step-by-step procedure:

### For each player (P1 goal = row 9, P2 goal = row 1):

1. Start with a queue containing the player's current position
2. Mark that position as visited
3. While the queue is not empty:
   a. Dequeue a position (c, r)
   b. If r equals the goal row, PATH EXISTS — stop, this player is OK
   c. For each of the 4 neighbors (N/S/E/W):
      - Compute neighbor position
      - Skip if out of bounds [1,9]
      - Skip if visited
      - Skip if a fence blocks movement from (c,r) to the neighbor (use Fence Blocking Rules above)
      - Add neighbor to queue, mark visited
4. If queue empties without reaching goal row: PATH BLOCKED — fence placement is ILLEGAL

### Shortcut for mental BFS

When doing BFS mentally, work in layers from the player's position. Focus on whether fences create a complete wall across the board. A valid blocking wall would need to span all 9 columns (for horizontal blocking) or all 9 rows (for vertical blocking) without gaps. Since each fence only covers 2 squares, it takes at minimum 5 fences to create a theoretical wall — but gaps between fences and existing openings usually ensure paths exist.

When in doubt about a complex position: trace a specific path manually from the player to any goal square. If you can find even one valid path, the placement is legal.

## Worked Examples

### Example 1: Simple Move Validation
State: P1 at e2, no fences.
User plays: `move N`
- Target: e3 (row 2+1=3)
- In bounds: yes
- Fence check: no fences exist, not blocked
- Opponent at e3? No (P2 at e9)
- VALID. P1 moves to e3.

### Example 2: Fence-Blocked Move
State: P1 at e4. H-fence at d4 (blocks rows 4↔5 at columns d and e).
User plays: `move N`
- Target: e5
- Fence check: h-fence at (4, 4). Moving north from (5, 4): check h-fences at (4, 4) and (5, 4). H-fence at (4, 4) has col=4, and c1=5, so c1-1=4 matches. BLOCKED.
- INVALID. "A fence blocks movement from e4 to e5."

### Example 3: Jump Over Opponent
State: P1 at e4, P2 at e5. No fences.
User plays: `move N`
- Simple target e5 is occupied by P2
- Check straight jump: e6 (behind P2 in same direction)
- e6 in bounds: yes
- Fence between e5 and e6: no
- e6 occupied: no
- VALID. P1 jumps to e6.

### Example 4: Diagonal Jump
State: P1 at e4, P2 at e5. H-fence at e5 (blocks e5↔e6).
User plays: `move d5`
- P2 is adjacent at e5 (north)
- Straight jump to e6 blocked by h-fence at e5
- Diagonal to d5: from e5, move west to d5
- Check fence blocking e5→d5: vertical fence at (4, 4) or (4, 5)? None.
- d5 in bounds, not occupied
- VALID. P1 moves to d5.

### Example 5: Fence Placement Validation
State: P1 at e3, P2 at e7. H-fences: [d5]. V-fences: [].
User plays: `fence h e5`
- Anchor (5, 5). Bounds: col 5 ∈ [1,8], row 5 ∈ [1,8]. OK.
- Overlap with existing h-fences: d5 is (4, 5). Check |5-4|=1, same row. H-fence at (4,5) would conflict because col+1=5 matches new fence col=5. CONFLICT.
- INVALID. "That fence overlaps with the existing horizontal fence at d5."

### Example 6: Fence Path Check
State: P1 at e1, P2 at e9. H-fences along row 8: [a8, c8, e8, g8]. Attempting: `fence h h8` (would create unbroken wall at row 8).
- Check: h-fences at a8(cols 1-2), c8(cols 3-4), e8(cols 5-6), g8(cols 7-8). Adding h8 would be (8, 8) covering cols 8-9. But g8 covers cols 7-8, so h8 overlaps at col 8. INVALID due to overlap, not even getting to path check.
- If instead we tried `fence h i8`: col 9 is out of bounds for fence anchor (max 8). INVALID.
