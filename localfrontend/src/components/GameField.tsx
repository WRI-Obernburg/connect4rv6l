"use client";
import { cn } from "../lib/utils";
import { AnimatePresence, motion } from "motion/react";
type GameFieldProps = {
  board: Dict<number[]> | null,
  xl: boolean,
  isPlayerTurn?: boolean,
  interactive: boolean,
  onColumnClick?: (columnIndex: number) => void;
};

function RenderCell({ entryState, highlight, xl }: { entryState: number | null; highlight?: boolean, xl:boolean }) {
  const size = xl ? "w-20 h-20" : "w-10 h-10";
  return (
    <div className={cn("relative", size)}>
      <div className={cn(size, "rounded-full hole")} />
      {entryState != null && (
        <motion.div
          initial={{ opacity: 0, y: -100 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.4, type: "spring", bounce: 0.3 }}
          className={cn(
            size, "absolute inset-0 rounded-full",
            entryState === 1 ? "chip-red" : entryState === 2 ? "chip-blue" : "",
            highlight && "ring-[3px] ring-white"
          )}
        />
      )}
    </div>
  );
}

// Helper to find four-in-a-row and return their coordinates
function getWinningCells(board: Dict<number[]> | null): [number, number][] | null {
  if (!board) return null;
  const directions: [number, number][] = [
    [1, 0], // horizontal
    [0, 1], // vertical
    [1, 1], // diagonal down
    [1, -1], // diagonal up
  ];
  for (let col = 0; col < 7; col++) {
    for (let row = 0; row < 6; row++) {
      const player = board[col]![row]!;
      if (!player) continue;
      for (const [dx, dy] of directions) {
        const cells: [number, number][] = [[col, row]];
        for (let k = 1; k < 4; k++) {
          const nc = col + dx * k;
          const nr = row + dy * k;
          if (nc < 0 || nc >= 7 || nr < 0 || nr >= 6) break;
          if (board[nc]![nr] !== player) break;
          cells.push([nc, nr]);
        }
        if (cells.length === 4) return cells;
      }
    }
  }
  return null;
}

/**
 * The board is rendered as a physical object: petrol frame, recessed holes, glossy chips.
 * In interactive mode every column is one tap target; a cyan marker above the column
 * shows where a chip can still be dropped.
 */
export function GameField(props: GameFieldProps) {
  const winningCells = getWinningCells(props.board);
  const canPlay = props.interactive && !!props.isPlayerTurn;
  const gap = props.xl ? "gap-4" : "gap-2";

  return (
    <div className="flex flex-col justify-center w-fit self-center">
      <div className={cn("flex flex-row justify-center board", props.xl ? "p-6 rounded-3xl gap-4" : "p-2.5 rounded-2xl gap-2")}>
        {Array.from({ length: 7 }).map((_, colIdx) => {
          const full = props.board != null && props.board[colIdx] != null && props.board[colIdx]!.length >= 6;
          const clickable = canPlay && !full;
          return (
            <button
              key={colIdx}
              type="button"
              disabled={!clickable}
              aria-label={`Spalte ${colIdx + 1}`}
              onClick={() => props.onColumnClick?.(colIdx)}
              className={cn("relative flex flex-col rounded-full outline-none", gap,
                props.interactive && "transition-colors",
                clickable && "cursor-pointer hover:bg-white/10 active:bg-white/15 focus-visible:ring-2 focus-visible:ring-wri-cyan")}
            >
              {props.interactive && (
                <span aria-hidden className={cn("absolute left-1/2 -translate-x-1/2 rounded-full bg-wri-cyan transition-opacity",
                  props.xl ? "-top-4 w-3 h-3" : "-top-2 w-1.5 h-1.5",
                  clickable ? "opacity-100" : "opacity-0")} />
              )}
              <AnimatePresence>
                {Array.from({ length: 6 }).map((_, rowIdx) => {
                  const boardRowIdx = 5 - rowIdx;
                  const entryState = props.board ? props.board[colIdx]![boardRowIdx] : null;
                  const highlight =
                    winningCells?.some(([c, r]) => c === colIdx && r === boardRowIdx) ?? false;
                  return <RenderCell key={rowIdx} entryState={entryState!} highlight={highlight} xl={props.xl} />;
                })}
              </AnimatePresence>
            </button>
          );
        })}
      </div>
    </div>
  );
}
