---
name: quoridor
description: This skill should be used when the user asks to "play quoridor", "start a quoridor game", "play a board game", or mentions "quoridor". Provides an interactive Quoridor board game played against Claude AI in the terminal using ASCII art.
---

# Quoridor

Play Quoridor against Claude AI in the terminal. Two players race to cross the board while placing fences to block each other.

Load `references/rules-and-validation.md` at game start and on every move validation.
Load `references/ai-strategy.md` before each AI turn.

## Game Setup

On `/quoridor` invocation:

1. Display a welcome message explaining the controls
2. Randomly decide who goes first (P1 = user, P2 = Claude)
3. Initialize game state (see below)
4. Render the board
5. If Claude goes first, make the AI move immediately; otherwise prompt the user

## Board Rendering

**CRITICAL RULE: The rendered board is the SOLE visual interface for the player. It MUST be an exact, faithful representation of the game state. Every render must satisfy ALL of these invariants:**

1. **Player positions:** The `1` and `2` tokens appear in EXACTLY the cells matching `p1` and `p2` in the game state. No other cells contain player tokens.
2. **Horizontal fences:** Every entry in `h_fences` produces exactly two `███` segments on the correct border line, and NO `███` segment appears that is not backed by an entry in `h_fences`.
3. **Vertical fences:** Every entry in `v_fences` produces exactly two `█` separators on the correct cell lines, and NO `█` separator appears that is not backed by an entry in `v_fences`.
4. **No stale rendering:** After every state change (move or fence placement), re-derive the board from scratch using the current game state. Never carry forward parts of a previous render.

**Rendering verification — perform after every render:**
- Count the `1` tokens on the board. Must be exactly 1, located at the `p1` position.
- Count the `2` tokens on the board. Must be exactly 1, located at the `p2` position.
- Count `███` segments. Must equal `2 × len(h_fences)`.
- Count `█` separators (on cell lines, not border lines). Must equal `2 × len(v_fences)`.
- If any check fails, re-derive the board from the game state before displaying it.

The board is a 9x9 grid. Rows are numbered 1 (bottom) to 9 (top). Columns are labeled a (left) to i (right). Player 1 (user) is shown as `1`, Player 2 (Claude) as `2`.

Render the board exactly in this format — every cell is 3 characters wide, borders use `---` normally and `███` for horizontal fences, `|` for normal vertical borders and `█` for vertical fences:

```
    a   b   c   d   e   f   g   h   i
  +---+---+---+---+---+---+---+---+---+
9 |   |   |   |   | 2 |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
8 |   |   |   |   |   |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
7 |   |   |   |   |   |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
6 |   |   |   |   |   |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
5 |   |   |   |   |   |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
4 |   |   |   |   |   |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
3 |   |   |   |   |   |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
2 |   |   |   |   |   |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
1 |   |   |   |   | 1 |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
    a   b   c   d   e   f   g   h   i
```

### Rendering Procedure (state → board)

To render the board, follow this procedure step by step. NEVER render from memory or by modifying a previous board — always derive from the current game state.

**Step 1 — Build the empty board:**
Generate all 19 lines (9 cell rows interleaved with 10 border rows). All cells contain `   ` (3 spaces), all border segments are `---`, all cell-line separators are `|`.

**Step 2 — Place players:**
For each player, locate the cell line for their row and the column position for their column. Replace the center space of that cell's 3-character content with the player number (`1` or `2`). Map the game state position directly:
- Column a = 1st cell, b = 2nd cell, ..., i = 9th cell
- Row 1 = bottom cell line, row 9 = top cell line

**Step 3 — Place horizontal fences:**
For each entry in `h_fences` with anchor (col, row):
- Identify the border line between row `row` and row `row+1` (this is the border line directly above the row `row` cell line)
- Replace the `---` at column position `col` with `███`
- Replace the `---` at column position `col+1` with `███`
- Leave all `+` intersections unchanged

**Step 4 — Place vertical fences:**
For each entry in `v_fences` with anchor (col, row):
- Identify the cell line for row `row`: replace the `|` separator between column `col` and column `col+1` with `█`
- Identify the cell line for row `row+1`: replace the `|` separator between column `col` and column `col+1` with `█`

**Step 5 — Verify (mandatory):**
Cross-check the rendered board against the game state per the invariants above. If anything is wrong, redo from Step 1.

### Fence Rendering Rules

**Horizontal fence** at anchor `Xr` (column X, row r) blocks movement between row r and row r+1 at columns X and X+1 (the next column). To render: find the border line between row r and row r+1 (this is the line directly above the row r cell). On that line, replace the `---` segment for column X with `███` and replace the `---` segment for column X+1 with `███`. The `+` intersections on either side of those segments remain unchanged.

Example: `d2h` → anchor column d, row 2. The border line between row 2 and row 3 gets `███` at the column-d segment and `███` at the column-e segment:
```
  3 |   |   |   |   |   |   |   |   |   |
    +---+---+---+███+███+---+---+---+---+
  2 |   |   |   |   |   |   |   |   |   |
      a   b   c   d   e   f   g   h   i
```
(Counting from left: a=`---`, b=`---`, c=`---`, d=`███`, e=`███`, f=`---`, …)

**Vertical fence** at anchor `Xr` blocks movement between column X and column X+1 at rows r and r+1. To render: replace the `|` separator between column X and column X+1 on both the row r cell line and the row r+1 cell line with `█`.

Example: `d3v` → anchor column d, row 3. The `|` between columns d and e on rows 3 and 4 becomes `█`:
```
  4 |   |   |   |   █   |   |   |   |   |
  3 |   |   |   |   █   |   |   |   |   |
      a   b   c   d   e   f   g   h   i
```

Full board example — horizontal fence at e5 and vertical fence at d3:

```
    a   b   c   d   e   f   g   h   i
  +---+---+---+---+---+---+---+---+---+
9 |   |   |   |   | 2 |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
8 |   |   |   |   |   |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
7 |   |   |   |   |   |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
6 |   |   |   |   |   |   |   |   |   |
  +---+---+---+---+███+███+---+---+---+
5 |   |   |   |   |   |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
4 |   |   |   |   █   |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
3 |   |   |   |   █   |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
2 |   |   |   |   |   |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
1 |   |   |   |   | 1 |   |   |   |   |
  +---+---+---+---+---+---+---+---+---+
    a   b   c   d   e   f   g   h   i
```

## Move Notation

Display these controls to the user at game start:

```
CONTROLS:
  Move pawn:    e2           (just name the square)
                move e2      (or use move + square)
                N / S / E / W  (or a direction)
  Place fence:  e3h or he3   (square + h/v, or h/v + square)
                fence h e3   (or verbose: fence + h/v + square)
  Other:        resign, help
```

### Notation Details

- **Pawn movement:** Naming a square directly (e.g., `e2`) moves the pawn to that square (must be a legal one-step move or jump). `move e2` also works. Direction shortcuts `N`/`S`/`E`/`W` (or `move N`, etc.) move one step in that direction. N=row+1, S=row-1, E=col+1, W=col-1.
- **Fence placement:** All of the following are equivalent ways to place a horizontal fence at anchor e3:
  - `e3h` — square then orientation (compact)
  - `he3` — orientation then square (compact)
  - `fence h e3` — verbose form
  - `fh e3` — shorthand verbose
  Similarly for vertical: `g6v`, `vg6`, `fence v g6`, `fv g6` are all equivalent.
- Fence anchors range from a1–h8 for horizontal and a1–h8 for vertical (fences span 2 cells, so the anchor can't be in the last row/column).

### Input Parsing Rules

Accept case-insensitive input. Parse user input by matching against these patterns (in order):

1. **Resign/help:** literal `resign` or `help`
2. **Direction only:** single token matching `n`, `s`, `e`, `w`, `north`, `south`, `east`, `west` → pawn move in that direction
3. **Compact fence (suffix):** pattern `<col><row><h|v>` e.g., `e3h`, `g6v` → fence placement
4. **Compact fence (prefix):** pattern `<h|v><col><row>` e.g., `he3`, `vg6` → fence placement
5. **Bare square (move):** pattern `<col><row>` where col ∈ a–i, row ∈ 1–9 e.g., `e2` → pawn move to that square
6. **Verbose move:** `move <direction|square>` → pawn move
7. **Verbose fence:** `fence <h|v> <square>` or `fh <square>` / `fv <square>` → fence placement

**Disambiguation:** A bare two-character input like `e3` is a pawn move. To place a fence, the `h` or `v` must be present (e.g., `e3h`). Note that `e` alone is ambiguous between column `e` and direction East — resolve single-letter `e` and `w` as directions (East/West), not columns.

## Game State

Maintain this state block after every move. Display it alongside the board.

```
GAME STATE — Turn N
  Player 1 (You):   e1  |  Fences: 10
  Player 2 (Claude): e9  |  Fences: 10
```

Internally track:
- `p1` and `p2`: positions as (col, row) where col ∈ {a..i} mapped to 1..9, row ∈ 1..9
- `p1_fences` and `p2_fences`: remaining fence counts (start at 10)
- `h_fences`: list of horizontal fence anchors placed
- `v_fences`: list of vertical fence anchors placed
- `turn`: current turn number
- `current_player`: whose turn it is

## Turn Flow

### User's Turn
1. Render the board from the current game state (follow the Rendering Procedure) and display the game state block
2. Prompt: `Your move (P1):`
3. Parse user input
4. Validate the move (see `references/rules-and-validation.md`)
5. If invalid, explain why and prompt again (do NOT re-render the board for invalid moves — it hasn't changed)
6. Apply the move: update `p1`/`p2` position or add fence to `h_fences`/`v_fences` and decrement fence count. The game state is now the source of truth.
7. Check win condition: if P1 reached row 9, declare user wins and render the final board from state
8. Proceed to Claude's turn

### Claude's Turn
1. Load `references/ai-strategy.md`
2. Analyze the position following the AI decision framework
3. Choose and validate a move
4. Apply the move: update `p1`/`p2` position or add fence to `h_fences`/`v_fences` and decrement fence count. The game state is now the source of truth.
5. Display: "Claude plays: [move description]"
6. Check win condition: if P2 reached row 1, declare Claude wins
7. Render the board from the UPDATED game state (follow the Rendering Procedure) and display the game state block. The board must reflect ALL changes including this turn's move.
8. Prompt user for their next move

## Win Condition

- Player 1 wins by reaching any square in row 9
- Player 2 wins by reaching any square in row 1
- On resignation, the other player wins
- Display a congratulatory/commiserating message and the final board

## Important Rules

- **Rendering is derived from state, never the other way around.** The game state (`p1`, `p2`, `h_fences`, `v_fences`) is the single source of truth. The board is re-rendered from scratch every time using the Rendering Procedure. Never "edit" a previous render — always rebuild from state.
- **If state and board disagree, the state is correct.** Fix the rendering, not the state.
- Always validate that fence placement leaves a path open for BOTH players to reach their goal row. Use BFS path checking from `references/rules-and-validation.md`.
- Never skip validation. An illegal move from either player breaks the game.
- Keep the ASCII board rendering consistent — exact spacing and character use matters for readability.
- When the user types `help`, re-display the controls and a brief rules summary.
