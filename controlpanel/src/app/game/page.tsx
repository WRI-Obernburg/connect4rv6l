import {ControllableBoard} from "@/app/game/ControllableBoard";

export default function GamePage() {
    return (
        <div className="flex flex-col items-center justify-center h-screen">

        <ControllableBoard></ControllableBoard>
        </div>
    );
}