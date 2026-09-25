import {GameState, Winner} from "@/interface/GameState";
import {useEffect, useState} from "react";
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

type Send = (message: object) => void;

export default function Game(props: { sessionID: string, indoor: boolean }) {

    const [isSessionIDValid, setIsSessionIDValid] = useState(true);
    const [gameState, setGameState] = useState<GameState | null>(null)
    const [connectionFailed, setConnectionFailed] = useState(false);
    const clientId = useClientId();
    const [nickname, setNickname] = useStoredValue("connect4.nickname", "");

    const {
        sendJsonMessage,
        readyState
    } = useWebSocket(clientId ? `https://${process.env.NEXT_PUBLIC_BACKEND_URL}/play?sessionID=` + props.sessionID + `&clientID=${clientId}` : null, {
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
    const send: Send = (message) => sendJsonMessage(message);

    // the nickname is sent along before starting or queueing
    const startGame = () => {
        if (nickname.trim()) send({type: "setNickname", nickname});
        send({type: "startGame"});
    };
    const joinQueue = () => send({type: "joinQueue", nickname});

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

    if (!gameState?.player) {
        return <Panel title="Spielstand wird geladen" text="Einen Moment." />
    }

    if(gameState.stateName === "ERROR") {
        return <Panel title="Der Roboter macht Pause" text="Das System ist gerade außer Betrieb. Bitte versuche es später noch einmal." />
    }

    if(gameState.stateName === "SLEEP") {
        return <Panel title="Der Roboter schläft" text="Morgen ist er wieder bereit für eine Partie." />
    }

    const player = gameState.player;
    const waiting = gameState.queue.length;

    // the result of one's own game stays until the next game starts, also while the board is cleared
    if (player.ownResult && ["CLEAN_UP", "IDLE"].includes(gameState.stateName) && player.role !== "offered") {
        return <ResultPanel winner={player.ownResult} cleaning={gameState.stateName === "CLEAN_UP"}>
            {player.canStart || player.canRestart
                ? <StartButton label="Nochmal spielen" disabled={gameState.stateName !== "IDLE"} onClick={startGame}/>
                : player.role === "queued"
                    ? <QueueStatus gameState={gameState} onLeave={() => send({type: "leaveQueue"})}/>
                    : <>
                        <p className="text-sm text-wri-grey mb-2">{waiting === 1 ? "Eine Person wartet" : `${waiting} Personen warten`} auf ein Spiel.</p>
                        <StartButton label="Hinten anstellen" onClick={joinQueue}/>
                    </>}
        </ResultPanel>
    }

    if (player.role === "active") {
        if (gameState.stateName === "CLEAN_UP" || gameState.stateName === "IDLE") {
            return <Panel title="Das Spielfeld wird geleert" text="Der Roboter räumt die Chips zurück. Gleich geht es los." />
        }
        return <PlayingView gameState={gameState} indoor={props.indoor} send={send} onRestart={startGame}/>
    }

    if (player.role === "offered") {
        return <Panel title={`Du bist dran${player.nickname ? `, ${player.nickname}` : ""}!`} text="Starte jetzt deine Partie. Du spielst Blau, der Roboter spielt Rot.">
            <div className="flex flex-col gap-3">
                <Countdown until={player.offerEndsAt}/>
                <DifficultyChooser gameState={gameState} onDifficultyChange={(difficulty) => send({type: "setDifficulty", difficulty})}/>
                <StartButton label="Spiel starten" onClick={startGame}/>
            </div>
        </Panel>
    }

    if (player.canStart) {
        return <Panel title="Bereit für eine Partie?" text="Du spielst Blau, der Roboter spielt Rot. Vier in einer Reihe gewinnen.">
            <div className="flex flex-col gap-3">
                <NicknameInput value={nickname} onChange={setNickname}/>
                <DifficultyChooser gameState={gameState} onDifficultyChange={(difficulty) => send({type: "setDifficulty", difficulty})}/>
                <StartButton label="Spiel starten" onClick={startGame}/>
            </div>
        </Panel>
    }

    // someone else plays or the queue is not empty: watch and queue up
    return <>
        <Panel title={spectatorTitle(gameState)} text={player.role === "queued" ? "Du bist in der Warteschlange." : "Stell dich an, dann bist du als Nächstes dran."}>
            {player.role === "queued"
                ? <QueueStatus gameState={gameState} onLeave={() => send({type: "leaveQueue"})}/>
                : <div className="flex flex-col gap-3">
                    <p className="text-sm text-wri-grey">{waiting === 0 ? "Noch niemand wartet." : waiting === 1 ? "Eine Person wartet." : `${waiting} Personen warten.`}</p>
                    <NicknameInput value={nickname} onChange={setNickname}/>
                    <StartButton label="Anstellen" onClick={joinQueue}/>
                </div>}
        </Panel>
        {gameState.board && gameState.stateName !== "IDLE" && <div className="panel rounded-2xl p-3 sm:p-4 mt-4">
            <GameField board={orient(gameState.board, props.indoor)} interactive={false} xl={false}/>
        </div>}
    </>
}

function spectatorTitle(gameState: GameState) {
    if (gameState.stateName === "CLEAN_UP") return "Das Spielfeld wird geleert";
    if (gameState.active) return `${gameState.active.nickname} spielt gerade`;
    return "Gleich geht es weiter";
}

// Flip the board for outdoor play
function orient(board: GameState["board"], indoor: boolean): GameState["board"] {
    if (indoor || !board) return board;
    return {0: board[6], 1: board[5], 2: board[4], 3: board[3], 4: board[2], 5: board[1], 6: board[0]};
}

function PlayingView(props: { gameState: GameState, indoor: boolean, send: Send, onRestart: () => void }) {
    const {gameState, indoor, send} = props;
    const isPlayerTurn = gameState.stateName === "PLAYER_SELECTION";

    function handleColumnClick(columnIndex: number) {
        if (isPlayerTurn) {
            send({type: "placeChip", slot: indoor ? columnIndex : 6 - columnIndex});
        }
    }

    return <div className="panel rounded-2xl p-3 sm:p-4 mt-8 flex flex-col gap-4">
        <CurrentAction gameState={gameState} />

        <GameField board={orient(gameState.board, indoor)} interactive={true} xl={false} onColumnClick={handleColumnClick} isPlayerTurn={isPlayerTurn} />

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
            <DifficultyChooser gameState={gameState} onDifficultyChange={(difficulty) => send({type: "setDifficulty", difficulty})} ></DifficultyChooser>
            {gameState.player.canRestart && <RestartButton onRestart={props.onRestart} enabled={isPlayerTurn}/>}
        </div>
        {gameState.queue.length > 0 && <p className="px-1 text-sm text-wri-grey">
            {gameState.queue.length === 1 ? "Eine Person wartet" : `${gameState.queue.length} Personen warten`} auf das nächste Spiel.
        </p>}
    </div>
}

function ResultPanel(props: { winner: Winner, cleaning: boolean, children?: React.ReactNode }) {
    const texts: Record<Winner, [string, string]> = {
        player: ["Du hast gewonnen!", "Vier in einer Reihe. Glückwunsch!"],
        robot: ["Der Roboter gewinnt.", "Diesmal war er schneller."],
        tie: ["Unentschieden.", "Das Feld ist voll."],
    };
    const [title, text] = texts[props.winner];
    return <Panel title={title} text={`${text}${props.cleaning ? " Der Roboter räumt gerade das Spielfeld auf." : ""}`}>
        {props.children}
    </Panel>
}

function QueueStatus(props: { gameState: GameState, onLeave: () => void }) {
    const {player, queue} = props.gameState;
    return <div className="flex flex-col gap-3">
        <p className="text-3xl font-extrabold text-wri-cyan-dark">Platz {player.position}</p>
        <ol className="flex flex-col gap-1 text-sm">
            {queue.map((entry) => <li key={entry.position}
                                      className={`flex justify-between rounded-lg px-3 py-1.5 ${entry.position === player.position ? "bg-wri-cyan/15 font-bold" : "bg-white/60"}`}>
                <span>{entry.position}. {entry.nickname}{entry.position === player.position ? " (du)" : ""}</span>
                {entry.offered && <span className="text-wri-cyan-dark">ist dran</span>}
            </li>)}
        </ol>
        <Button variant="ghost" onClick={props.onLeave} className="self-start text-wri-petrol/80 font-bold px-3 rounded-lg">Warteschlange verlassen</Button>
    </div>
}

function NicknameInput(props: { value: string, onChange: (value: string) => void }) {
    return <label className="flex flex-col gap-1 text-sm font-semibold">
        Dein Spitzname (optional)
        <input value={props.value} maxLength={20} placeholder="z. B. Robo-Bezwinger"
               onChange={(e) => props.onChange(e.target.value)}
               className="h-11 rounded-lg border border-wri-petrol/20 bg-white px-3 text-base font-normal outline-none focus:border-wri-cyan"/>
    </label>
}

function Countdown(props: { until: number | null }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(id);
    }, []);
    if (!props.until) return null;
    const seconds = Math.max(0, Math.ceil((props.until - now) / 1000));
    return <p className="text-sm text-wri-grey">Noch <b className="text-wri-petrol">{seconds} s</b>, dann ist die nächste Person dran.</p>
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

function StartButton(props: { label: string, onClick: () => void, disabled?: boolean }) {
    return <Button onClick={props.onClick} disabled={props.disabled} size="lg" className="h-12 px-7 rounded-lg font-extrabold text-base">{props.label}</Button>
}

function CurrentAction(props: { gameState: GameState }) {
    const s = props.gameState.stateName;
    let title = "", hint = "", accent = false;

    if (["GRAP_BLUE_CHIP", "PLACE_BLUE_CHIP"].includes(s)) { title = "Der Roboter setzt deinen Chip"; hint = "Schau auf das Spielfeld."; }
    else if (["ROBOT_SELECTION", "GRAP_RED_CHIP", "PLACE_RED_CHIP"].includes(s)) { title = "Der Roboter überlegt"; hint = "Gleich ist er dran."; }
    else if (s === "PLAYER_SELECTION") { title = "Du bist am Zug"; hint = "Tippe auf die Spalte, in die dein Chip fallen soll."; accent = true; }

    return <div className="px-1">
        <p className={`text-2xl font-extrabold tracking-[-0.02em] leading-tight ${accent ? "text-wri-cyan-dark" : ""}`}>{title}</p>
        <p className="text-wri-grey text-sm mt-0.5">{hint}</p>
    </div>
}

// Restarting throws the current game away, so it asks first; only offered while nobody waits
function RestartButton(props: { onRestart: () => void, enabled: boolean }) {
    return <AlertDialog>
        <AlertDialogTrigger asChild>
            <Button disabled={!props.enabled} variant="ghost" className="w-full sm:w-auto text-wri-petrol/80 hover:text-wri-petrol hover:bg-wri-petrol/5 font-bold px-3 rounded-lg">Neu starten</Button>
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
                <AlertDialogAction onClick={props.onRestart}>Neue Partie</AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
}

// The phone keeps its own id, so the backend recognises it again after a reload and it keeps its place in the queue
function useClientId() {
    const [id, setId] = useState<string | null>(null);
    useEffect(() => {
        let stored: string | null = null;
        try {
            stored = localStorage.getItem("connect4.clientId");
        } catch { /* storage blocked */ }
        if (!stored) {
            stored = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c${Date.now()}${Math.random().toString(36).slice(2)}`;
            try {
                localStorage.setItem("connect4.clientId", stored);
            } catch { /* storage blocked */ }
        }
        setId(stored);
    }, []);
    return id;
}

function useStoredValue(key: string, initial: string): [string, (value: string) => void] {
    const [value, setValue] = useState(initial);
    useEffect(() => {
        try {
            const stored = localStorage.getItem(key);
            if (stored) setValue(stored);
        } catch { /* storage blocked */ }
    }, [key]);
    const update = (next: string) => {
        setValue(next);
        try {
            localStorage.setItem(key, next);
        } catch { /* storage blocked */ }
    };
    return [value, update];
}
