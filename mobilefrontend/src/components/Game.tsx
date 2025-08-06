import { GameState } from "@/interface/GameState";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import useWebSocket from "react-use-websocket";
import GameField from "./GameField";
import { Button } from "@/components/ui/button"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import DifficultyChooser from "./DifficulityChooser";

export default function Game(props: { sessionID: string }) {

    const [isSessionIDValid, setIsSessionIDValid] = useState(true);
    const [gameState, setGameState] = useState<GameState | null>(null)

    const {
        sendMessage,
        sendJsonMessage,
        lastMessage,
        lastJsonMessage,
        readyState,
        getWebSocket,
    } = useWebSocket("http://192.168.178.53:3000/play?sessionID=" + props.sessionID, {
        onOpen: () => console.log('opened'),
        onMessage: (message) => {
            console.log('message received', message);
            const data = JSON.parse(message.data) as GameState;
            setGameState(data);
        },
        //Will attempt to reconnect on all close events, such as server shutting down
        shouldReconnect: (closeEvent) => {
            if (closeEvent.code === 4422) {
                setIsSessionIDValid(false);
                return false; // Don't reconnect if the session is not found
            }

            return true;
        },
    });

    function handleColumnClick(columnIndex: number) {
        console.log('Column clicked:', columnIndex);
        if (gameState && gameState.isHumanTurn && !gameState.isGameOver) {
            sendJsonMessage({
                type: "placeChip",
                slot: columnIndex,
            });
        }
    }

    function handleDifficultyChange(difficulty: string) {
        sendJsonMessage({
            type: "setDifficulty",
            difficulty: difficulty
        })
    }




    if (!isSessionIDValid) {
        return <div className="flex flex-col gap-4 justify-center mt-4">
            <div className="text-center font-bold">Scanne den QR-Code um ein Spiel zu starten</div>
            <div className="text-red-500 text-center font-bold">
                Spiel ID ist abgelaufen
            </div>
        </div>
    }

    if (!gameState) {
        return <div className="flex flex-col gap-4 justify-center mt-4">
            <div className="text-center">Warte auf Spielstatus...</div>
        </div>
    }

    if (!gameState.isGameRunning && !gameState.isGameOver) {
        return <div className="flex flex-col gap-4 justify-center self-center w-fit mt-4">
            <div className="text-center text-2xl font-bold">Spiel ist noch nicht gestartet</div>
            <StartGame isRobotInAction={false} onGameStart={() => {
                sendJsonMessage({
                    type: "startGame",
                });
            }} />
        </div>
    }

    if (gameState.isPhysicalBoardClearing) {
        return <div className="flex flex-col gap-4 justify-center mt-4">
            <div className="text-center text-2xl font-bold">Das Spielfeld wird geleert...</div>
            <div className="text-center">Bitte warte einen Moment</div>
        </div>
    }

    return <div className="flex flex-col gap-4 justify-center mt-4 items-center">
        <CurrentAction gameState={gameState} />

        <GameField gameState={gameState} onColumnClick={handleColumnClick} playerTurn={gameState.isHumanTurn && !gameState.isRobotInAction} />
        <DifficultyChooser gameState={gameState} onDifficultyChange={handleDifficultyChange} ></DifficultyChooser>

        <StartGame onGameStart={() => {
            sendJsonMessage({
                type: "startGame",
            });
        }} isGameRunning={gameState.isGameRunning} isRobotInAction={gameState.isRobotInAction} />

    </div>

}

function CurrentAction(props: { gameState: GameState }) {


    if (props.gameState.isGameOver && props.gameState.winner === 2) {
        return <div className="text-center text-2xl font-bold">Der Roboter hat gewonnen!</div>
    }

    if (props.gameState.isGameOver && props.gameState.winner === 1) {
        return <div className="text-center text-2xl font-bold">Du hast gewonnen!</div>
    }

    if (props.gameState.isRobotInAction && props.gameState.isHumanTurn) {
        return <div className="text-center text-2xl font-bold">Der Roboter setzt deinen Chip...</div>
    }

    if (!props.gameState.isHumanTurn) {
        return <div className="text-center text-2xl font-bold">Der Roboter ist am Zug...</div>
    }

    if (props.gameState.isHumanTurn) {
        return <div className="text-center text-2xl font-bold">Du bist am Zug!</div>
    }



}


function StartGame(props: { onGameStart: () => void, isGameRunning?: boolean, isRobotInAction: boolean }) {

    if (props.isGameRunning) {
        return <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button disabled={props.isRobotInAction} className="bg-green-600 text-white px-4 py-2 w-fit self-center rounded cursor-pointer">
                    Spiel neustarten
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Spiel beenden?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Bist du sicher, dass du das Spiel neustarten möchtest? Alle Fortschritte gehen verloren.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                    <AlertDialogAction onClick={props.onGameStart}>Ja, Spiel beenden</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    } else {

        return <Button disabled={props.isRobotInAction} onClick={props.onGameStart} className="bg-green-600 text-white px-4 py-2 w-fit self-center rounded cursor-pointer">
            Spiel starten
        </Button>


    }

}