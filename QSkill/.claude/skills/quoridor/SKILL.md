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

### Fence Rendering Rules

A horizontal fence at anchor `Xr` (column X, row r) blocks movement between row r and row r+1 at columns X and the next column. On the board, replace the two `---` segments on the border line *above* row r+1 (i.e., between row r and row r+1) at the anchor column and the column to its right with `███`.

A vertical fence at anchor `Xr` blocks movement between column X and the next column at rows r and r+1. On the board, replace the two `|` separators between those columns on row r and row r+1 with `█`.

Example — horizontal fence at e5 and vertical fence at d3:

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
1. Display the board and game state
2. Prompt: `Your move (P1):`
3. Parse user input
4. Validate the move (see `references/rules-and-validation.md`)
5. If invalid, explain why and prompt again
6. Apply the move, update state
7. Check win condition: if P1 reached row 9, declare user wins
8. Proceed to Claude's turn

### Claude's Turn
1. Load `references/ai-strategy.md`
2. Analyze the position following the AI decision framework
3. Choose and validate a move
4. Apply the move, update state
5. Display: "Claude plays: [move description]"
6. Check win condition: if P2 reached row 1, declare Claude wins
7. Render updated board and state
8. Prompt user for their next move

## Win Condition

- Player 1 wins by reaching any square in row 9
- Player 2 wins by reaching any square in row 1
- On resignation, the other player wins
- Display a congratulatory/commiserating message and the final board

## Important Rules

- Always validate that fence placement leaves a path open for BOTH players to reach their goal row. Use BFS path checking from `references/rules-and-validation.md`.
- Never skip validation. An illegal move from either player breaks the game.
- Keep the ASCII board rendering consistent — exact spacing and character use matters for readability.
- When the user types `help`, re-display the controls and a brief rules summary.
