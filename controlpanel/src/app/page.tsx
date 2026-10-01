"use client";
import {useContext, useEffect, useState} from "react";
import Link from "next/link";
import QRCode from "react-qr-code";
import {Activity, AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CircleCheck, ExternalLink, FlaskConical, Monitor, Smartphone, Wrench} from "lucide-react";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {GameField} from "@/components/GameField";
import {GameDataContext, WebsocketSendContext} from "@/provider/WebsocketProvider";
import {ErrorType, GameData, TelemetryValue} from "@/app/models/GameData";

// What each state means for someone looking at the robot
const STATE_TEXT: Record<string, string> = {
    IDLE: "Bereit, wartet auf einen Spieler",
    PLAYER_SELECTION: "Der Spieler ist am Zug",
    GRAP_BLUE_CHIP: "Roboter holt den Chip des Spielers",
    PLACE_BLUE_CHIP: "Roboter setzt den Chip des Spielers",
    ROBOT_SELECTION: "Roboter überlegt seinen Zug",
    GRAP_RED_CHIP: "Roboter holt seinen Chip",
    PLACE_RED_CHIP: "Roboter setzt seinen Chip",
    PLAYER_WIN: "Der Spieler hat gewonnen",
    ROBOT_WIN: "Der Roboter hat gewonnen",
    TIE: "Unentschieden",
    CLEAN_UP: "Spielfeld wird geleert",
    ERROR: "Gesperrt, offene Fehler",
    SLEEP: "Ruhemodus",
    TEST: "Testbetrieb läuft, keine Partie möglich",
};

const PALLET_SIZE = 21;

export default function Overview() {
    const game = useContext(GameDataContext);
    const now = useNow();
    if (!game) return <div className={"flex h-screen w-full items-center justify-center text-3xl text-gray-700"}>Verbinden...</div>;

    return <div className={"flex flex-col gap-4"}>
        <StatusBanner game={game} now={now}/>
        <div className={"grid grid-cols-1 gap-4 xl:grid-cols-3"}>
            <GameCard game={game} now={now}/>
            <RobotCard game={game}/>
            <JoinCard game={game} now={now}/>
        </div>
        <div className={"grid grid-cols-1 gap-4 xl:grid-cols-3"}>
            <MagazineCard game={game}/>
            <div className={"xl:col-span-2"}><EventsCard game={game}/></div>
        </div>
    </div>;
}

// ---------------------------------------------------------------------------------------------
// Can the game be played right now, and if not, why

function StatusBanner({game, now}: { game: GameData, now: number }) {
    const send = useContext(WebsocketSendContext);
    const state = game.gameState.stateName;
    const reasons = game.faultMemory?.lockReasons ?? [];
    const open = game.faultMemory?.open ?? [];
    const acknowledgeable = open.filter((f) => !f.active).length;
    const since = sinceText(game.gameStates[state as keyof GameData["gameStates"]]?.startTime, now);

    let tone = "border-green-300 bg-green-50 text-green-900";
    let Icon = CircleCheck;
    let title = "Spielbereit";
    if (state === "ERROR") {
        tone = "border-red-300 bg-red-50 text-red-900";
        Icon = AlertTriangle;
        title = "Spiel gesperrt";
    } else if (state === "TEST") {
        tone = "border-purple-300 bg-purple-50 text-purple-900";
        Icon = FlaskConical;
        title = "Testbetrieb";
    } else if (state === "CLEAN_UP") {
        tone = "border-blue-300 bg-blue-50 text-blue-900";
        Icon = Wrench;
        title = "Spielfeld wird geleert";
    } else if (state !== "IDLE") {
        tone = "border-blue-300 bg-blue-50 text-blue-900";
        Icon = Activity;
        title = "Partie läuft";
    }

    return <div className={`flex flex-col gap-3 rounded-xl border-2 p-5 md:flex-row md:items-center ${tone}`}>
        <Icon className={"size-10 shrink-0"}/>
        <div className={"flex-1"}>
            <div className={"flex flex-wrap items-baseline gap-x-3"}>
                <h1 className={"text-2xl font-bold"}>{title}</h1>
                <span className={"text-sm opacity-80"}>{STATE_TEXT[state] ?? state}{since && ` · seit ${since}`}</span>
                {game.rv6l.mock && <span className={"rounded bg-yellow-200 px-2 py-0.5 text-xs font-semibold text-yellow-900"}>RV6L gemockt</span>}
            </div>
            {reasons.length > 0 && <ul className={"mt-2 list-disc pl-5 text-sm"}>
                {reasons.map((reason, i) => <li key={i}>{reason}</li>)}
            </ul>}
            {state !== "ERROR" && open.length > 0 && <p className={"mt-1 text-sm opacity-80"}>
                {open.length} {open.length === 1 ? "Warnung" : "Warnungen"} im Fehlerspeicher, das Spiel ist davon nicht gesperrt.
            </p>}
        </div>
        <div className={"flex shrink-0 flex-col gap-2"}>
            {acknowledgeable > 0 && <Button className={"cursor-pointer"} onClick={() => send?.(JSON.stringify({action: "acknowledge_all_faults"}))}>
                {acknowledgeable} behobene quittieren
            </Button>}
            {open.length > 0 && <Link href={"/fault-memory/"}><Button variant={"outline"} className={"w-full cursor-pointer"}>
                Fehlerspeicher <ArrowRight className={"size-4"}/>
            </Button></Link>}
        </div>
    </div>;
}

// ---------------------------------------------------------------------------------------------
// The running game

function GameCard({game, now}: { game: GameData, now: number }) {
    const state = game.gameState.stateName;
    const inGame = !["IDLE", "ERROR", "SLEEP", "TEST"].includes(state);
    const chips = game.gameState.board ? Object.values(game.gameState.board as Record<string, number[]>).reduce((n, column) => n + column.length, 0) : 0;
    const difficulty: Record<string, string> = {easy: "Leicht", medium: "Mittel", hard: "Schwer"};

    return <Card className={"gap-3"}>
        <CardHeader><CardTitle>Aktuelle Partie</CardTitle></CardHeader>
        <CardContent className={"flex flex-col items-center gap-3"}>
            <GameField board={game.gameState.board} xl={false} interactive={false}/>
            <dl className={"grid w-full grid-cols-2 gap-x-3 gap-y-1 text-sm"}>
                <dt className={"text-gray-500"}>Zustand</dt><dd>{STATE_TEXT[state] ?? state}</dd>
                <dt className={"text-gray-500"}>Spieler</dt><dd>{game.players?.active?.nickname ?? (game.gameState.isPlayerConnected ? "niemand spielt, Handys verbunden" : "niemand verbunden")}</dd>
                <dt className={"text-gray-500"}>Warteschlange</dt><dd>{game.players?.queue.length ? `${game.players.queue.length} warten` : "leer"}</dd>
                <dt className={"text-gray-500"}>Dauer</dt><dd>{inGame && game.gameState.gameStartTime ? sinceText(game.gameState.gameStartTime, now) : "–"}</dd>
                <dt className={"text-gray-500"}>Chips im Feld</dt><dd>{chips}</dd>
                <dt className={"text-gray-500"}>Schwierigkeit</dt><dd>{difficulty[game.gameState.difficulty] ?? game.gameState.difficulty}</dd>
            </dl>
            <GameMasterSection game={game} now={now}/>
        </CardContent>
    </Card>;
}

// ---------------------------------------------------------------------------------------------
// Game master: stop or steer the running game without switching states by hand. The backend waits for the end
// of a robot movement (and places a gripped chip first), so the board and the robot stay in step.

const RUNNING_STATES = ["PLAYER_SELECTION", "GRAP_BLUE_CHIP", "PLACE_BLUE_CHIP", "ROBOT_SELECTION", "GRAP_RED_CHIP", "PLACE_RED_CHIP"];
const RESULT_STATES = ["PLAYER_WIN", "ROBOT_WIN", "TIE"];
const DIFFICULTIES: [string, string][] = [["easy", "Leicht"], ["medium", "Mittel"], ["hard", "Schwer"]];
const ROWS = 6;

function GameMasterSection({game, now}: { game: GameData, now: number }) {
    const send = useContext(WebsocketSendContext);
    const action = (payload: object) => send?.(JSON.stringify(payload));
    const state = game.gameState.stateName;
    const running = RUNNING_STATES.includes(state);
    const pending = game.gameManager.pendingStop;
    const board = (game.gameState.board ?? {}) as Record<string, number[]>;
    const player = game.players?.active?.nickname;

    return <div className={"flex w-full flex-col gap-3 border-t pt-3"}>
        <p className={"font-semibold"}>Spielleitung</p>

        {pending && <div className={"flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900"}>
            <span>
                {pending.restart ? "Neustart" : "Abbruch"} nach der aktuellen Roboterbewegung
                <span className={"text-amber-700"}> (angefordert vor {sinceText(pending.requestedAt, now)})</span>
            </span>
            <Button size={"sm"} variant={"outline"} className={"cursor-pointer"} onClick={() => action({action: "gm_cancel_stop"})}>Zurücknehmen</Button>
        </div>}

        {!running && !RESULT_STATES.includes(state)
            ? <p className={"text-sm text-gray-400"}>Kein Spiel läuft.</p>
            : <div className={"flex flex-wrap gap-2"}>
                <ConfirmButton label={"Spiel abbrechen"} confirm={`Spiel${player ? ` von ${player}` : ""} abbrechen und Feld leeren?`}
                               disabled={!running || !!pending} destructive
                               onConfirm={() => action({action: "gm_stop_game", restart: false})}/>
                <ConfirmButton label={"Neu starten"} confirm={"Feld leeren und mit demselben Spieler neu starten?"}
                               disabled={!!pending}
                               onConfirm={() => action({action: "gm_stop_game", restart: true})}/>
            </div>}

        {state === "PLAYER_SELECTION" && <div className={"flex flex-col gap-1"}>
            <p className={"text-sm text-gray-500"}>Zug für {player ?? "den Spieler"} setzen</p>
            <div className={"grid grid-cols-7 gap-1"}>
                {Array.from({length: 7}, (_, column) => {
                    const full = (board[column]?.length ?? 0) >= ROWS;
                    return <ConfirmButton key={column} label={String(column + 1)} compact disabled={full}
                                          confirm={`Chip in Spalte ${column + 1}?`}
                                          onConfirm={() => action({action: "gm_place_chip", slot: column})}/>;
                })}
            </div>
        </div>}

        <div className={"flex items-center justify-between gap-2 text-sm"}>
            <span className={"text-gray-500"}>Schwierigkeit</span>
            <div className={"flex overflow-hidden rounded-md border"}>
                {DIFFICULTIES.map(([key, label]) => <button key={key}
                    className={`cursor-pointer px-3 py-1 ${game.gameState.difficulty === key ? "bg-gray-900 text-white" : "hover:bg-gray-100"}`}
                    onClick={() => action({action: "gm_set_difficulty", difficulty: key})}>{label}</button>)}
            </div>
        </div>
    </div>;
}

// Asks once more before an intervention; the question replaces the button until confirmed or cancelled
function ConfirmButton(props: { label: string, confirm: string, onConfirm: () => void, disabled?: boolean, destructive?: boolean, compact?: boolean }) {
    const [asking, setAsking] = useState(false);
    useEffect(() => {
        if (!asking) return;
        const id = setTimeout(() => setAsking(false), 8000);
        return () => clearTimeout(id);
    }, [asking]);
    useEffect(() => { if (props.disabled) setAsking(false); }, [props.disabled]);

    if (asking && props.compact) {
        return <Button size={"sm"} title={props.confirm} className={"cursor-pointer bg-blue-700 px-0 hover:bg-blue-800"}
                       onClick={() => { setAsking(false); props.onConfirm(); }}>OK?</Button>;
    }
    if (asking) {
        return <div className={"flex w-full flex-wrap items-center gap-2 rounded-md border bg-gray-50 p-2 text-sm"}>
            <span className={"mr-auto"}>{props.confirm}</span>
            <Button size={"sm"} variant={props.destructive ? "destructive" : "default"} className={"cursor-pointer"}
                    onClick={() => { setAsking(false); props.onConfirm(); }}>Ja</Button>
            <Button size={"sm"} variant={"outline"} className={"cursor-pointer"} onClick={() => setAsking(false)}>Nein</Button>
        </div>;
    }
    return <Button size={"sm"} variant={props.destructive ? "destructive" : "outline"} disabled={props.disabled}
                   className={`cursor-pointer ${props.compact ? "px-0" : ""}`} onClick={() => setAsking(true)}>{props.label}</Button>;
}

// ---------------------------------------------------------------------------------------------
// The robot: the few values that decide whether it can play

function RobotCard({game}: { game: GameData }) {
    const values = game.rv6l.telemetry?.values ?? [];
    const value = (id: string) => values.find((v) => v.id === id);
    // short values here; the full warning texts are in the status banner and the robot monitor
    const rows: { label: string, v?: TelemetryValue, text?: string, tone?: string, alarmShort?: string }[] = [
        {
            label: "Verbindung", text: game.rv6l.mock ? "gemockt" : game.rv6l.connected ? "verbunden" : "getrennt",
            tone: game.rv6l.mock ? "text-yellow-700" : game.rv6l.connected ? "text-green-700" : "text-red-700",
        },
        {label: "Antriebe", v: value("drives_state")},
        {label: "Betriebsart", v: value("run_mode"), alarmShort: value("run_mode")?.okText},
        {label: "Programm", v: value("game_program")},
        {label: "Override", v: value("override")},
        {label: "Kollisionserkennung", v: value("collision_detection"), alarmShort: "aus"},
        {label: "Aktion", text: game.rv6l.moving ? `${game.rv6l.state} läuft` : "keine", tone: game.rv6l.moving ? "text-blue-700" : "text-gray-500"},
    ];

    return <Card className={"gap-3"}>
        <CardHeader className={"flex flex-row items-center justify-between"}>
            <CardTitle>Roboter</CardTitle>
            <Link href={"/robot/"} className={"flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"}>Roboter-Monitor <ArrowRight className={"size-4"}/></Link>
        </CardHeader>
        <CardContent>
            <dl className={"grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm"}>
                {rows.map((row) => {
                    const {text, tone} = describe(row.v, row.text, row.tone, row.alarmShort);
                    return <div key={row.label} className={"contents"}>
                        <dt className={"text-gray-500"}>{row.label}</dt>
                        <dd className={`font-medium break-words ${tone}`}>{text}</dd>
                    </div>;
                })}
            </dl>
        </CardContent>
    </Card>;
}

function describe(v: TelemetryValue | undefined, text?: string, tone?: string, alarmShort?: string) {
    if (!v) return {text: text ?? "–", tone: tone ?? ""};
    if (!v.available) return {text: "nicht verfügbar", tone: "text-gray-400"};
    if (v.alarm) return {text: alarmShort ?? v.alarmText ?? String(v.value), tone: v.severity === "fatal" ? "text-red-700" : "text-yellow-700"};
    return {text: text ?? v.okText ?? `${v.value ?? "–"}${v.unit ? ` ${v.unit}` : ""}`, tone: tone ?? (v.okText !== undefined ? "text-green-700" : "")};
}

// ---------------------------------------------------------------------------------------------
// How visitors join, and whether the displays on site are connected

function JoinCard({game, now}: { game: GameData, now: number }) {
    const host = typeof window !== "undefined" ? window.location.hostname : "";
    const displays = game.displays ?? [];
    return <Card className={"gap-3"}>
        <CardHeader><CardTitle>Mitspielen</CardTitle></CardHeader>
        <CardContent className={"flex flex-col items-center gap-3"}>
            <div className={"rounded-lg border bg-white p-3"}><QRCode value={game.qrCodeLink} size={150}/></div>
            <div className={"flex w-full flex-col gap-1 text-sm"}>
                <a className={"flex items-center gap-2 hover:underline"} target={"_blank"} href={game.qrCodeLink}>
                    <Smartphone className={"size-4"}/> Spieler-Seite öffnen <ExternalLink className={"size-3 text-gray-400"}/>
                </a>
                {/* another app on the backend, not a page of the control panel */}
                <a className={"flex items-center gap-2 hover:underline"} target={"_blank"} href={`http://${host}:4000/localfrontend`}>
                    <Monitor className={"size-4"}/> Anzeige vor Ort öffnen <ExternalLink className={"size-3 text-gray-400"}/>
                </a>
                <p className={`mt-1 ${displays.length ? "text-green-700" : "text-yellow-700"}`}>
                    {displays.length ? `${displays.length} ${displays.length === 1 ? "Anzeige" : "Anzeigen"} verbunden (${displays.map((d) => d.indoor ? "innen" : "außen").join(", ")})`
                        : "Keine Anzeige vor Ort verbunden"}
                </p>
            </div>
            <QueueSection game={game} now={now}/>
        </CardContent>
    </Card>;
}

const RESULT_TEXT = {player: "hat gewonnen", robot: "hat gegen den Roboter verloren", tie: "spielte unentschieden", aborted: "wurde von der Spielleitung beendet"};
const OFFER_SECONDS = 60;

// Who plays and who waits; entries can be removed, e.g. when someone left
function QueueSection({game, now}: { game: GameData, now: number }) {
    const send = useContext(WebsocketSendContext);
    const players = game.players;
    if (!players) return null;
    return <div className={"w-full border-t pt-3"}>
        <p className={"mb-2 font-semibold"}>Warteschlange</p>
        <p className={"text-sm"}>
            <span className={"text-gray-500"}>Spielt gerade: </span>
            {players.active ? <b>{players.active.nickname}</b> : <span className={"text-gray-400"}>niemand</span>}
        </p>
        {players.lastResult && <p className={"text-sm text-gray-500"}>
            Zuletzt: {players.lastResult.nickname} {RESULT_TEXT[players.lastResult.winner]} ({sinceText(players.lastResult.at, now)} her)
        </p>}
        {players.queue.length === 0
            ? <p className={"mt-2 text-sm text-gray-400"}>Niemand wartet.</p>
            : <ol className={"mt-2 flex flex-col gap-1"}>
                {players.queue.map((entry) => <li key={entry.clientId} className={"flex items-center justify-between gap-2 rounded-md bg-gray-50 px-2 py-1 text-sm"}>
                    <span className={"min-w-0"}>
                        <b>{entry.position}.</b> {entry.nickname}
                        <span className={"ml-2 text-xs text-gray-500"}>
                            wartet {sinceText(entry.joinedAt, now)}
                            {!entry.connected && ", Seite geschlossen"}
                            {entry.offeredAt && `, ist dran (${Math.max(0, OFFER_SECONDS - Math.round((now - entry.offeredAt) / 1000))} s)`}
                        </span>
                    </span>
                    <span className={"flex shrink-0 items-center gap-1"}>
                        {entry.offeredAt && <button className={"cursor-pointer text-xs text-gray-400 hover:text-gray-900"} title={"Die volle Startzeit erneut geben"}
                                                    onClick={() => send?.(JSON.stringify({action: "gm_renew_offer"}))}>mehr Zeit</button>}
                        <button className={"cursor-pointer text-gray-400 hover:text-gray-900 disabled:cursor-default disabled:opacity-30"} title={"nach vorne"}
                                disabled={entry.position === 1}
                                onClick={() => send?.(JSON.stringify({action: "gm_move_in_queue", clientId: entry.clientId, delta: -1}))}><ArrowUp className={"size-3.5"}/></button>
                        <button className={"cursor-pointer text-gray-400 hover:text-gray-900 disabled:cursor-default disabled:opacity-30"} title={"nach hinten"}
                                disabled={entry.position === players.queue.length}
                                onClick={() => send?.(JSON.stringify({action: "gm_move_in_queue", clientId: entry.clientId, delta: 1}))}><ArrowDown className={"size-3.5"}/></button>
                        <button className={"cursor-pointer text-xs text-gray-400 hover:text-red-600"}
                                onClick={() => send?.(JSON.stringify({action: "remove_from_queue", clientId: entry.clientId}))}>entfernen</button>
                    </span>
                </li>)}
            </ol>}
    </div>;
}

// ---------------------------------------------------------------------------------------------
// How many chips are left in the magazines, as counted by the robot program

function MagazineCard({game}: { game: GameData }) {
    const values = game.rv6l.telemetry?.values ?? [];
    const pallets = [
        {label: "Blau (Spieler)", v: values.find((v) => v.id === "pallet_blue"), color: "bg-blue-500"},
        {label: "Rot (Roboter)", v: values.find((v) => v.id === "pallet_red"), color: "bg-red-500"},
    ];
    return <Card className={"gap-3"}>
        <CardHeader><CardTitle>Magazine</CardTitle></CardHeader>
        <CardContent className={"flex flex-col gap-3"}>
            {pallets.map(({label, v, color}) => {
                const count = v?.available ? Number(v.value) : null;
                const share = count === null ? 0 : Math.max(0, Math.min(1, count / PALLET_SIZE));
                return <div key={label} className={"flex flex-col gap-1"}>
                    <div className={"flex justify-between text-sm"}>
                        <span>{label}</span>
                        <span className={"font-mono"}>{count === null ? "–" : `${count} / ${PALLET_SIZE}`}</span>
                    </div>
                    <div className={"h-3 overflow-hidden rounded-full bg-gray-100"}>
                        <div className={`h-full ${count !== null && count <= 3 ? "bg-yellow-500" : color}`} style={{width: `${share * 100}%`}}/>
                    </div>
                </div>;
            })}
            <p className={"text-xs text-gray-500"}>Zähler des Roboterprogramms; wird beim Aufräumen zurückgesetzt.</p>
        </CardContent>
    </Card>;
}

// ---------------------------------------------------------------------------------------------
// The latest events that matter, without the info messages

// A fault is logged by its source ("RV6L: …") and by the fault memory ("Fehlerspeicher: … Das Spiel ist
// gesperrt …"); for the overview both are the same event
const eventText = (description: string) => description
    .replace(/^(Fehlerspeicher|RV6L|Spiel gesperrt): /, "")
    .replace(/\. Das Spiel ist gesperrt, bis der Fehler quittiert ist\.$/, "");

function EventsCard({game}: { game: GameData }) {
    const seen = new Set<string>();
    const events = game.errors
        .map((e, i) => ({...e, number: i + 1, text: eventText(e.description)}))
        .filter((e) => e.errorType !== ErrorType.INFO)
        .reverse()
        .filter((e) => !seen.has(e.text) && seen.add(e.text))
        .slice(0, 8);
    const today = new Date().toDateString();
    return <Card className={"gap-3"}>
        <CardHeader className={"flex flex-row items-center justify-between"}>
            <CardTitle>Letzte Warnungen und Fehler</CardTitle>
            <Link href={"/error-log/"} className={"flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"}>Error Log <ArrowRight className={"size-4"}/></Link>
        </CardHeader>
        <CardContent>
            {events.length === 0 && <p className={"text-sm text-gray-400"}>Keine Warnungen oder Fehler.</p>}
            <ul className={"flex flex-col"}>
                {events.map((e) => <li key={e.number} className={"grid grid-cols-[7.5rem_1fr] gap-3 border-b border-gray-100 py-1.5 text-sm last:border-0"}>
                    <span className={"font-mono text-xs text-gray-500"}>
                        {new Date(e.date).toDateString() !== today && <>{new Date(e.date).toLocaleDateString("de-DE", {day: "2-digit", month: "2-digit"})} </>}
                        {new Date(e.date).toLocaleTimeString("de-DE")}
                    </span>
                    <span className={e.errorType === ErrorType.FATAL ? "text-red-700" : "text-yellow-800"}>{e.text}</span>
                </li>)}
            </ul>
        </CardContent>
    </Card>;
}

// ---------------------------------------------------------------------------------------------

function useNow() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);
    return now;
}

function sinceText(start: Date | string | number | null | undefined, now: number) {
    if (!start) return "";
    const seconds = Math.max(0, Math.round((now - new Date(start).getTime()) / 1000));
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
