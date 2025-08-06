import { GameState } from "@/interface/GameState";
import { cn } from "@/lib/utils";
import { MoveDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

type GameFieldProps = {
  gameState: GameState;
  playerTurn: boolean;
  onColumnClick: (columnIndex: number) => void;
};

function RenderMoveIndicators({ playerTurn, isGameOver, onColumnClick }: { playerTurn: boolean; isGameOver: boolean; onColumnClick: (col: number) => void }) {
  if (!playerTurn || isGameOver) return <div className="h-10" />;
  return (
    <div className="flex flex-row gap-2 justify-center">
      {Array.from({ length: 7 }).map((_, colIdx) => (
        <MoveDown
          key={colIdx}
          className="w-10 h-10 p-1 text-red-500 hover:bg-gray-300 active:bg-gray-300 rounded cursor-pointer"
          onClick={() => onColumnClick(colIdx)}
        />
      ))}
    </div>
  );
}

function RenderCell({ entryState, highlight }: { entryState: number | null; highlight?: boolean }) {
  return (
    <div className="relative">
      {entryState != null && (
        <motion.div
          initial={{ opacity: 0, y: -100 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.4, type: "spring", bounce: 0.3 }}
          className={cn(
            "w-10 h-10 border absolute rounded-full",
            entryState === 1
              ? "bg-red-500"
              : entryState === 2
              ? "bg-blue-500"
              : "bg-gray-200",
            highlight && entryState === 2 && "shadow-blue-500 shadow-xl",
            highlight && entryState === 1 && "shadow-red-500 shadow-xl"
          )}
        />
      )}
      <div
        className={cn(
          "w-10 h-10 border rounded-full border-gray-500 shadow hover:shadow-lg transition-shadow flex items-center justify-center",        )}
      />
    </div>
  );
}

// Helper to find four-in-a-row and return their coordinates
function getWinningCells(board: number[][] | null): [number, number][] | null {
  if (!board) return null;
  const directions: [number, number][] = [
    [1, 0], // horizontal
    [0, 1], // vertical
    [1, 1], // diagonal down
    [1, -1], // diagonal up
  ];
  for (let col = 0; col < 7; col++) {
    for (let row = 0; row < 6; row++) {
      const player = board[col][row];
      if (!player) continue;
      for (const [dx, dy] of directions) {
        const cells: [number, number][] = [[col, row]];
        for (let k = 1; k < 4; k++) {
          const nc = col + dx * k;
          const nr = row + dy * k;
          if (nc < 0 || nc >= 7 || nr < 0 || nr >= 6) break;
          if (board[nc][nr] !== player) break;
          cells.push([nc, nr]);
        }
        if (cells.length === 4) return cells;
      }
    }
  }
  return null;
}

function RenderBoard({ board }: { board: number[][] | null }) {
  // board: [column][row], but we want to render as [col][row] with bottom at index 0
  const winningCells = getWinningCells(board);
  return (
    <div className="flex flex-row gap-2 justify-center rounded border border-gray-300 p-2">
      {Array.from({ length: 7 }).map((_, colIdx) => (
        <div key={colIdx} className="flex flex-col gap-2">
          <AnimatePresence>
            {Array.from({ length: 6 }).map((_, rowIdx) => {
              const boardRowIdx = 5 - rowIdx;
              const entryState = board ? board[colIdx][boardRowIdx] : null;
              const highlight =
                winningCells?.some(([c, r]) => c === colIdx && r === boardRowIdx) ?? false;
              return <RenderCell key={rowIdx} entryState={entryState} highlight={highlight} />;
            })}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

export default function GameField({ gameState, playerTurn, onColumnClick }: GameFieldProps) {
  // console.log(gameState.board);
  return (
    <div className="flex flex-col gap-4 justify-center w-fit self-center">
      <RenderMoveIndicators
        playerTurn={playerTurn}
        isGameOver={gameState.isGameOver}
        onColumnClick={onColumnClick}
      />
      <RenderBoard board={gameState.board} />
    </div>
  );
}