import { rotateNorm, place, canPlace } from "./gridLogic";

export function evaluateBoard(board) {
  let score = 0;
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      if (board[y][x]) score += 1;
    }
  }
  for (let x = 0; x < board.length; x++) {
    let seen = false;
    for (let y = 0; y < board.length; y++) {
      if (board[y][x]) seen = true;
      else if (seen) score -= 2;
    }
  }
  return score;
}

export function bestPlacement(board, pieceCells) {
  let best = null;
  for (let rot = 0; rot < 4; rot++) {
    const rotated = rotateNorm(pieceCells, rot * 90);
    for (let y = 0; y <= board.length - 1; y++) {
      for (let x = 0; x <= board.length - 1; x++) {
        const pos = { x, y };
        if (!canPlace(board, rotated, pos)) continue;
        const { board: newBoard } = place(board, rotated, pos);
        const score = evaluateBoard(newBoard);
        if (!best || score > best.score) {
          best = { pos, rot: rot * 90, score };
        }
      }
    }
  }
  return best;
}
