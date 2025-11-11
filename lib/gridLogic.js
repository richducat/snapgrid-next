export const SIZE = 8;

export const BASE_PIECES = [
  [{ x: 0, y: 0 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  [{ x: 0, y: 0 }, { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]
];

export function rotateCells(cells, degrees) {
  const times = ((degrees / 90) % 4 + 4) % 4;
  let out = cells;
  for (let i = 0; i < times; i++) {
    out = out.map((p) => ({ x: -p.y, y: p.x }));
  }
  return out;
}

export function normalizeCells(cells) {
  const minX = Math.min(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  return cells.map((c) => ({ x: c.x - minX, y: c.y - minY }));
}

export function rotateNorm(cells, degrees) {
  return normalizeCells(rotateCells(cells, degrees));
}

export function canPlace(board, cells, pos) {
  return cells.every(({ x, y }) => {
    const gx = x + pos.x;
    const gy = y + pos.y;
    return gx >= 0 && gx < SIZE && gy >= 0 && gy < SIZE && board[gy][gx] === 0;
  });
}

export function place(board, cells, pos) {
  const newBoard = board.map((row) => row.slice());
  cells.forEach(({ x, y }) => {
    newBoard[pos.y + y][pos.x + x] = 1;
  });
  const rowsCleared = [];
  const colsCleared = [];
  for (let i = 0; i < SIZE; i++) {
    if (newBoard[i].every((v) => v === 1)) rowsCleared.push(i);
    if (newBoard.every((row) => row[i] === 1)) colsCleared.push(i);
  }
  rowsCleared.forEach((r) => {
    for (let c = 0; c < SIZE; c++) newBoard[r][c] = 0;
  });
  colsCleared.forEach((c) => {
    for (let r = 0; r < SIZE; r++) newBoard[r][c] = 0;
  });
  return { board: newBoard, linesCleared: rowsCleared.length + colsCleared.length };
}
