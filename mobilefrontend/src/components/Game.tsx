import { GameState } from "@/interface/GameState";
import { useState } from "react";
import useWebSocket from "react-use-websocket";
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
import { GameField } from "./GameField";

export default function Game(props: { sessionID: string }) {

    const [isSessionIDValid, setIsSessionIDValid] = useState(true);
    const [gameState, setGameState] = useState<GameState | null>(null)

    const {
        sendJsonMessage,
        readyState
    } = useWebSocket("https://rv6l.tim-arnold.de/play?sessionID=" + props.sessionID, {
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
        if (gameState && gameState.stateName == "PLAYER_SELECTION") {
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

    if(readyState !== 1) {
        return <div className="flex flex-col gap-4 justify-center mt-4">
            <div className="text-center">Verbinde zum Server...</div>
        </div>
    }

    if (!gameState) {
        return <div className="flex flex-col gap-4 justify-center mt-4">
            <div className="text-center">Warte auf Spielstatus...</div>
        </div>
    }

    if(gameState.stateName === "ERROR") {
        return <div className="flex flex-col gap-4 justify-center mt-4">
            <div className="text-center text-2xl font-bold text-red-500">Das System ist zur Zeit außer Betrieb</div>
        </div>
    }

    if (gameState.stateName === "IDLE") {
        return <div className="flex flex-col gap-4 justify-center self-center w-fit mt-4">
            <div className="text-center text-2xl font-bold">Spiel ist noch nicht gestartet</div>
            <StartGame gameState={gameState.stateName} onGameStart={() => {
                sendJsonMessage({
                    type: "startGame",
                });
            }} />
        </div>
    }

    if (gameState.stateName === "CLEAN_UP") {
        return <div className="flex flex-col gap-4 justify-center mt-4">
            <div className="text-center text-2xl font-bold">Das Spielfeld wird geleert...</div>
            <div className="text-center">Bitte warte einen Moment</div>
        </div>
    }

    return <div className="flex flex-col gap-4 justify-center mt-4 items-center">
        <CurrentAction gameState={gameState} />

        <GameField board={gameState.board} interactive={true} xl={false} onColumnClick={handleColumnClick} isPlayerTurn={gameState.stateName === "PLAYER_SELECTION"} />
        <DifficultyChooser gameState={gameState} onDifficultyChange={handleDifficultyChange} ></DifficultyChooser>

        <StartGame onGameStart={() => {
            sendJsonMessage({
                type: "startGame",
            });
        }} gameState={gameState.stateName} />

    </div>

}

function CurrentAction(props: { gameState: GameState }) {


    if (props.gameState.stateName === "ROBOT_WIN") {
        return <div className="text-center text-2xl font-bold">Der Roboter hat gewonnen!</div>
    }

    if (props.gameState.stateName === "PLAYER_WIN") {
        return <div className="text-center text-2xl font-bold">Du hast gewonnen!</div>
    }

    if (props.gameState.stateName === "TIE") {
        return <div className="text-center text-2xl font-bold">Das Spiel endet unentschieden!</div>
    }

    if (["GRAP_BLUE_CHIP", "PLACE_BLUE_CHIP"].includes(props.gameState.stateName)) {
        return <div className="text-center text-2xl font-bold">Der Roboter setzt deinen Chip...</div>
    }

    if (["ROBOT_SELECTION", "GRAP_RED_CHIP", "PLACE_RED_CHIP"].includes(props.gameState.stateName)) {
        return <div className="text-center text-2xl font-bold">Der Roboter ist am Zug...</div>
    }

    if (props.gameState.stateName === "PLAYER_SELECTION") {
        return <div className="text-center text-2xl font-bold">Du bist am Zug!</div>
    }



}


function StartGame(props: { onGameStart: () => void, gameState: string }) {


    const isRestartable = ["ROBOT_WIN", "PLAYER_WIN", "TIE", "PLAYER_SELECTION", "IDLE"].includes(props.gameState)

    if (props.gameState != "IDLE") {
        return <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button disabled={!isRestartable} className="bg-green-600 text-white px-4 py-2 w-fit self-center rounded cursor-pointer">
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

        return <Button disabled={!isRestartable} onClick={props.onGameStart} className="bg-green-600 text-white px-4 py-2 w-fit self-center rounded cursor-pointer">
            Spiel starten
        </Button>


    }

}