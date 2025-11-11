import React, { useState } from "react";
import { BASE_PIECES, rotateNorm, SIZE, canPlace, place } from "../lib/gridLogic";
import { bestPlacement } from "../lib/botHeuristic";

function randPiece() {
  const def = BASE_PIECES[Math.floor(Math.random() * BASE_PIECES.length)];
  const rot = Math.floor(Math.random() * 4) * 90;
  return { def, rot };
}

export default function Play() {
  const initialBoard = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  const [board, setBoard] = useState(initialBoard);
  const [score, setScore] = useState(0);
  const [queue, setQueue] = useState([randPiece(), randPiece(), randPiece()]);
  const [message, setMessage] = useState("Click a piece then click a cell to place it.");
  const [selectedIndex, setSelectedIndex] = useState(null);

  function handlePieceClick(i) {
    setSelectedIndex(i);
    setMessage("Now click a square on the board.");
  }
  function handleCellClick(x, y) {
    if (selectedIndex === null) return;
    const piece = queue[selectedIndex];
    const rotated = rotateNorm(piece.def, piece.rot);
    if (!canPlace(board, rotated, { x, y })) {
      setMessage("Cannot place there. Try another spot.");
      return;
    }
    const { board: newBoard, linesCleared } = place(board, rotated, { x, y });
    setBoard(newBoard);
    setScore((s) => s + 10 + linesCleared * 100);
    const nextQueue = queue.slice();
    nextQueue[selectedIndex] = randPiece();
    setQueue(nextQueue);
    setSelectedIndex(null);
    setMessage("Piece placed! Click a new piece.");
  }
  function handleBot() {
    // simple bot picks first piece and finds best placement
    const piece = queue[0];
    const best = bestPlacement(board, piece.def);
    if (!best) {
      alert("No moves left for bot");
      return;
    }
    const { pos, rot } = best;
    const { board: newBoard } = place(board, rotateNorm(piece.def, rot), pos);
    setBoard(newBoard);
    setScore((s) => s + 10);
    const nextQueue = queue.slice();
    nextQueue[0] = randPiece();
    setQueue(nextQueue);
    setMessage("Bot placed a piece.");
  }
  return (
    <main style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 600, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, marginBottom: 12 }}>Play SnapGrid</h1>
      <p style={{ color: "#6b7280" }}>Score: {score}</p>
      <p style={{ color: "#6b7280", marginBottom: 12 }}>{message}</p>
      <div style={{ display: "grid", gridTemplateRows: `repeat(${SIZE}, 1fr)`, width: 320, height: 320, border: "1px solid #d1d5db" }}>
        {board.map((row, y) =>
          row.map((cell, x) => {
            const canHighlight =
              selectedIndex !== null &&
              canPlace(
                board,
                rotateNorm(queue[selectedIndex].def, queue[selectedIndex].rot),
                { x, y }
              );
            return (
              <div
                key={`${x}-${y}`}
                onClick={() => handleCellClick(x, y)}
                style={{
                  border: "1px solid #e5e7eb",
                  backgroundColor: cell
                    ? "#6366f1"
                    : canHighlight
                    ? "#d1fae5"
                    : "#f9fafb",
                  width: 320 / SIZE,
                  height: 320 / SIZE,
                  boxSizing: "border-box"
                }}
              />
            );
          })
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
        {queue.map((p, i) => (
          <button
            key={i}
            onClick={() => handlePieceClick(i)}
            style={{
              padding: 8,
              border: selectedIndex === i ? "2px solid #6366f1" : "2px solid #d1d5db",
              borderRadius: 8,
              background: "#f3f4f6"
            }}
          >
            <Piece cells={rotateNorm(p.def, p.rot)} />
          </button>
        ))}
      </div>
      <button onClick={handleBot} style={{ marginTop: 16, padding: "8px 16px", borderRadius: 8, background: "#6366f1", color: "#fff", border: "none" }}>
        Let Bot Play
      </button>
    </main>
  );
}

function Piece({ cells }) {
  const maxX = Math.max(...cells.map((c) => c.x));
  const maxY = Math.max(...cells.map((c) => c.y));
  return (
    <div style={{ display: "inline-grid", gridTemplateColumns: `repeat(${maxX + 1}, 1fr)` }}>
      {Array.from({ length: (maxX + 1) * (maxY + 1) }).map((_, i) => {
        const x = i % (maxX + 1);
        const y = Math.floor(i / (maxX + 1));
        const hit = cells.some((c) => c.x === x && c.y === y);
        return (
          <div
            key={i}
            style={{ width: 16, height: 16, margin: 2, borderRadius: 4, backgroundColor: hit ? "#6366f1" : "#e5e7eb" }}
          />
        );
      })}
    </div>
  );
}
