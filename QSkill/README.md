# Quoridor

A classic two-player strategy board game played against Claude AI, right in your terminal
via [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

## Getting Started

Open Claude Code in this directory and type:

```
/quoridor
```

No installation or setup required.

## How to Play

**Goal:** Move your pawn from the bottom row to the top row before the AI crosses from top to bottom. The board is a 9x9
grid (columns `a`-`i`, rows `1`-`9`).

Each turn you may either **move your pawn** or **place a fence** (10 fences per player).

### Moving

Move one square up, down, left, or right (no diagonals). You can jump over the opponent if they are adjacent.

| Input             | Example               | Meaning                    |
|-------------------|-----------------------|----------------------------|
| Square coordinate | `e2`                  | Move pawn to e2            |
| Direction         | `N` / `S` / `E` / `W` | Move north/south/east/west |

### Placing Fences

Fences span two squares and block passage. Every fence must still leave a valid path for both players to reach their
goal.

| Input   | Example        | Meaning                |
|---------|----------------|------------------------|
| Compact | `e3h` or `he3` | Horizontal fence at e3 |
| Compact | `g6v` or `vg6` | Vertical fence at g6   |

### Other Commands

| Command  | Action                  |
|----------|-------------------------|
| `help`   | Show controls and rules |
| `resign` | Forfeit the game        |

## Rules Summary

1. Players alternate turns.
2. **Move** one square orthogonally, or jump over an adjacent opponent.
3. **Place a fence** to block paths — but you must never seal off all routes to a player's goal row.
4. First player to reach their goal row wins.
