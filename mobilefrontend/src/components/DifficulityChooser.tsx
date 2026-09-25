import { GameState } from "@/interface/GameState"
import { cn } from "@/lib/utils"

const LEVELS = [
    { value: "easy", label: "Leicht" },
    { value: "medium", label: "Mittel" },
    { value: "hard", label: "Schwer" },
];

export default function DifficultyChooser(props: {onDifficultyChange: (difficulty: string)=>void, gameState: GameState}) {
    return <div role="radiogroup" aria-label="Schwierigkeit" className="flex w-full sm:inline-flex sm:w-auto rounded-lg border border-wri-petrol/15 bg-white/60 p-0.5">
        {LEVELS.map(level => {
            const active = props.gameState.difficulty === level.value;
            return <button key={level.value} type="button" role="radio" aria-checked={active}
                onClick={() => props.onDifficultyChange(level.value)}
                className={cn("flex-1 sm:flex-none px-3 h-9 rounded-md text-sm font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-wri-cyan",
                    active ? "bg-wri-petrol text-white" : "text-wri-petrol/70 hover:text-wri-petrol")}>
                {level.label}
            </button>
        })}
    </div>
}
