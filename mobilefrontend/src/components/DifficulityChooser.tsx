import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { GameState } from "@/interface/GameState"
export default function DifficultyChooser(props: {onDifficultyChange: (difficulty: string)=>void, gameState: GameState}) {
    return <Select onValueChange={props.onDifficultyChange} value={props.gameState.difficulty}>
        <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Schwierigkeit" />
        </SelectTrigger>
        <SelectContent>
            <SelectItem value="easy">Leicht</SelectItem>
            <SelectItem value="medium">Mittel</SelectItem>
            <SelectItem value="hard">Schwer</SelectItem>
        </SelectContent>
    </Select>
}