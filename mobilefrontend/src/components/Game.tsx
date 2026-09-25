import {GameState} from "@/interface/GameState";
import {useState} from "react";
import useWebSocket from "react-use-websocket";
import {Button} from "@/components/ui/button"
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
import {GameField} from "./GameField";

export default function Game(props: { sessionID: string, indoor: boolean }) {

    const [isSessionIDValid, setIsSessionIDValid] = useState(true);
    const [gameState, setGameState] = useState<GameState | null>(null)
    const [connectionFailed, setConnectionFailed] = useState(false);

    const {
        sendJsonMessage,
        readyState
    } = useWebSocket(`https://${process.env.NEXT_PUBLIC_BACKEND_URL}/play?sessionID=` + props.sessionID, {
        onOpen: () => console.log('opened'),
        onMessage: (message) => {
            console.log('message received', message);
            try {
                setGameState(JSON.parse(message.data) as GameState);
            } catch (e) {
                console.error('Invalid game state received', e);
            }
        },
        // about 30 seconds of retries, then show an error instead of loading forever
        reconnectAttempts: 10,
        reconnectInterval: 3000,
        onReconnectStop: () => setConnectionFailed(true),
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
                slot: props.indoor?columnIndex: 6- columnIndex // Adjust for outdoor play,
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
        return <Panel title="Dieses Spiel ist abgelaufen" text="Scanne den QR-Code am Spieltisch, um ein neues Spiel zu starten." />
    }

    if (connectionFailed) {
        return <Panel title="Keine Verbindung zum Spiel" text="Der Server ist gerade nicht erreichbar. Prüfe deine Internetverbindung und versuche es noch einmal.">
            <RetryButton />
        </Panel>
    }

    if(readyState !== 1) {
        return gameState
            ? <Panel title="Verbindung unterbrochen" text="Die Verbindung wird wiederhergestellt. Einen Moment." />
            : <Panel title="Verbindung wird aufgebaut" text="Einen Moment." />
    }

    if (!gameState) {
        return <Panel title="Spielstand wird geladen" text="Einen Moment." />
    }

    if(gameState.stateName === "ERROR") {
        return <Panel title="Der Roboter macht Pause" text="Das System ist gerade außer Betrieb. Bitte versuche es später noch einmal." />
    }

    if(gameState.stateName === "SLEEP") {
        return <Panel title="Der Roboter schläft" text="Morgen ist er wieder bereit für eine Partie." />
    }

    if (gameState.stateName === "IDLE") {
        return <Panel title="Bereit für eine Partie?" text="Du spielst Blau, der Roboter spielt Rot. Vier in einer Reihe gewinnen.">
            <StartGame gameState={gameState.stateName} onGameStart={() => {
                sendJsonMessage({
                    type: "startGame",
                });
            }} />
        </Panel>
    }

    if (gameState.stateName === "CLEAN_UP") {
        return <Panel title="Das Spielfeld wird geleert" text="Der Roboter räumt die Chips zurück. Das dauert einen Moment." />
    }

    let gameBoard = gameState.board;
    if(!props.indoor && gameBoard) {
        // Flip the board for outdoor play
        gameBoard = {
            0: gameBoard[6],
            1: gameBoard[5],
            2: gameBoard[4],
            3: gameBoard[3],
            4: gameBoard[2],
            5: gameBoard[1],
            6: gameBoard[0],
        };
    }

    const isPlayerTurn = gameState.stateName === "PLAYER_SELECTION";

    return <div className="panel rounded-2xl p-3 sm:p-4 mt-8 flex flex-col gap-4">
        <CurrentAction gameState={gameState} />

        <GameField board={gameBoard} interactive={true} xl={false} onColumnClick={handleColumnClick} isPlayerTurn={isPlayerTurn} />

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
            <DifficultyChooser gameState={gameState} onDifficultyChange={handleDifficultyChange} ></DifficultyChooser>
            <StartGame onGameStart={() => {
                sendJsonMessage({
                    type: "startGame",
                });
            }} gameState={gameState.stateName} />
        </div>
    </div>

}

export function Panel(props: { title: string, text: string, children?: React.ReactNode }) {
    return <div className="panel rounded-2xl p-6 mt-8 flex flex-col gap-2">
        <p className="text-2xl font-extrabold tracking-[-0.02em] leading-tight">{props.title}</p>
        <p className="text-wri-grey">{props.text}</p>
        {props.children && <div className="mt-3">{props.children}</div>}
    </div>
}

export function RetryButton(props: { onClick?: () => void }) {
    return <Button onClick={props.onClick ?? (() => window.location.reload())} size="lg" className="h-12 px-7 rounded-lg font-extrabold text-base">Erneut versuchen</Button>
}

function CurrentAction(props: { gameState: GameState }) {
    const s = props.gameState.stateName;
    let title = "", hint = "", accent = false;

    if (s === "ROBOT_WIN") { title = "Der Roboter gewinnt."; hint = "Revanche? Starte einfach eine neue Partie."; }
    else if (s === "PLAYER_WIN") { title = "Du hast gewonnen!"; hint = "Vier in einer Reihe. Der Roboter räumt gleich auf."; accent = true; }
    else if (s === "TIE") { title = "Unentschieden."; hint = "Das Feld ist voll. Noch eine Runde?"; }
    else if (["GRAP_BLUE_CHIP", "PLACE_BLUE_CHIP"].includes(s)) { title = "Der Roboter setzt deinen Chip"; hint = "Schau auf das Spielfeld."; }
    else if (["ROBOT_SELECTION", "GRAP_RED_CHIP", "PLACE_RED_CHIP"].includes(s)) { title = "Der Roboter überlegt"; hint = "Gleich ist er dran."; }
    else if (s === "PLAYER_SELECTION") { title = "Du bist am Zug"; hint = "Tippe auf die Spalte, in die dein Chip fallen soll."; accent = true; }

    return <div className="px-1">
        <p className={`text-2xl font-extrabold tracking-[-0.02em] leading-tight ${accent ? "text-wri-cyan-dark" : ""}`}>{title}</p>
        <p className="text-wri-grey text-sm mt-0.5">{hint}</p>
    </div>
}


function StartGame(props: { onGameStart: () => void, gameState: string }) {


    const isRestartable = ["ROBOT_WIN", "PLAYER_WIN", "TIE", "PLAYER_SELECTION", "IDLE"].includes(props.gameState)

    if (props.gameState != "IDLE") {
        return <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button disabled={!isRestartable} variant="ghost" className="w-full sm:w-auto text-wri-petrol/80 hover:text-wri-petrol hover:bg-wri-petrol/5 font-bold px-3 rounded-lg">Neu starten</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Neue Partie starten?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Die laufende Partie wird abgebrochen und das Spielfeld geleert.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                    <AlertDialogAction onClick={props.onGameStart}>Neue Partie</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    } else {

        return <Button disabled={!isRestartable} onClick={props.onGameStart} size="lg" className="h-12 px-7 rounded-lg font-extrabold text-base">Spiel starten</Button>


    }

}