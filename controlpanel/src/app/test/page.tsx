"use client";
import {useContext, useEffect, useState} from "react";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {GameDataContext, WebsocketSendContext} from "@/provider/WebsocketProvider";
import {TestConfig, TestMode, TestStatus} from "@/app/models/GameData";

const MODES: { mode: TestMode, label: string, text: string }[] = [
    {mode: "cycle", label: "Bestücken und aufräumen", text: "Zufällig bestücken, wieder aufräumen und das wiederholen, auch als Dauertest."},
    {mode: "fill", label: "Nur bestücken", text: "Das leere Spielfeld einmal zufällig bestücken. Die Chips bleiben liegen."},
    {mode: "clear", label: "Nur aufräumen", text: "Alle Chips, die laut Backend auf dem Spielfeld liegen, zurück in die Magazine legen."},
];

const ACTION_LABELS: Record<string, string> = {
    InitChipPalletizing: "Paletten initialisieren",
    MoveToBlue: "Blau greifen",
    MoveToRed: "Rot greifen",
    MoveToColumn: "Einwerfen",
    RemoveFromField: "Aus dem Feld entnehmen",
    PutBackToBlue: "Blau ablegen",
    PutBackToRed: "Rot ablegen",
};

const PHASE_LABELS: Record<TestStatus["phase"], string> = {
    idle: "bereit", init: "Paletten werden initialisiert", fill: "Spielfeld wird bestückt",
    clear: "Spielfeld wird aufgeräumt", pause: "Pause bis zum nächsten Zyklus",
};

const RESULT_LABELS: Record<NonNullable<TestStatus["result"]>, { text: string, tone: string }> = {
    done: {text: "Test abgeschlossen", tone: "border-green-200 bg-green-50 text-green-800"},
    stopped: {text: "Test gestoppt", tone: "border-gray-200 bg-gray-50 text-gray-800"},
    aborted: {text: "Test abgebrochen. Greifer und Spielfeld prüfen, es können Chips liegen geblieben sein.", tone: "border-yellow-300 bg-yellow-50 text-yellow-900"},
    failed: {text: "Test fehlgeschlagen", tone: "border-red-300 bg-red-50 text-red-800"},
};

export default function TestPage() {
    const gameData = useContext(GameDataContext);
    const send = useContext(WebsocketSendContext);
    const [mode, setMode] = useState<TestMode>("cycle");
    const [minChips, setMinChips] = useState("10");
    const [maxChips, setMaxChips] = useState("30");
    const [cycles, setCycles] = useState("0");
    const [pauseSeconds, setPauseSeconds] = useState("10");
    const [confirmAbort, setConfirmAbort] = useState(false);
    const now = useNow();

    if (!gameData) {
        return <div className={"flex justify-center h-screen w-full items-center text-3xl text-gray-700"}>Verbinden...</div>;
    }

    const test = gameData.testRun;
    const running = test?.running ?? false;
    const stateName = gameData.gameState.stateName;
    const board = gameData.gameState.board as Record<string, number[]> | null;
    const chipsOnBoard = board ? Object.values(board).reduce((sum, column) => sum + column.length, 0) : 0;

    const config: TestConfig = {
        mode, minChips: Number(minChips), maxChips: Number(maxChips), cycles: Number(cycles), pauseSeconds: Number(pauseSeconds),
    };
    const startBlocker = running ? null
        : stateName !== "IDLE" ? `Start nur im Zustand IDLE möglich, aktuell ${stateName}.`
        : !gameData.rv6l.connected && !gameData.rv6l.mock ? "Keine Verbindung zum RV6L."
        : mode === "clear" && chipsOnBoard === 0 ? "Laut Backend liegen keine Chips auf dem Spielfeld."
        : mode !== "clear" && chipsOnBoard > 0 ? `Auf dem Spielfeld liegen noch ${chipsOnBoard} Chips, erst aufräumen.`
        : mode !== "clear" && !validChips(config) ? "Chipanzahl muss zwischen 1 und 42 liegen, Minimum höchstens Maximum."
        : mode === "cycle" && !(Number.isInteger(config.cycles) && config.cycles >= 0) ? "Zyklen müssen eine ganze Zahl ab 0 sein."
        : mode === "cycle" && !(config.pauseSeconds >= 0 && config.pauseSeconds <= 3600) ? "Pause muss zwischen 0 und 3600 s liegen."
        : null;

    const start = () => send?.(JSON.stringify({action: "test_start", config}));
    const stop = () => send?.(JSON.stringify({action: "test_stop"}));
    const abort = () => {
        setConfirmAbort(false);
        send?.(JSON.stringify({action: "test_abort"}));
    };

    return <div className={"flex flex-col gap-4"}>
        <Card>
            <CardHeader>
                <CardTitle>Testbetrieb</CardTitle>
                <p className={"text-sm text-gray-500"}>
                    Bestückt das Spielfeld zufällig und räumt es mit denselben Roboteraktionen wie im Spiel wieder auf. Die Chips
                    werden wie im Spiel abwechselnd aus beiden Magazinen eingeworfen, beginnend mit dem Chip des Spielers. Solange der Test läuft, steht das
                    Spiel im Zustand TEST und niemand kann eine Partie starten. Jeder Fehler einer Roboteraktion beendet den Test.
                </p>
                {gameData.rv6l.mock && <div className={"mt-2 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900"}>
                    Die RV6L-Verbindung wird gemockt: Der Test läuft nur im Backend, der Roboter bewegt sich nicht.
                </div>}
            </CardHeader>
        </Card>

        <div className={"grid gap-4 lg:grid-cols-2"}>
            <Card>
                <CardHeader><CardTitle>Einstellungen</CardTitle></CardHeader>
                <CardContent className={"flex flex-col gap-4"}>
                    <div className={"flex flex-col gap-2"}>
                        {MODES.map((m) => <label key={m.mode}
                                                 className={`flex cursor-pointer gap-3 rounded-md border p-3 ${mode === m.mode ? "border-gray-900 bg-gray-50" : ""} ${running ? "opacity-60" : ""}`}>
                            <input type={"radio"} name={"mode"} checked={mode === m.mode} disabled={running} onChange={() => setMode(m.mode)}/>
                            <span>
                                <span className={"font-semibold"}>{m.label}</span>
                                <span className={"block text-sm text-gray-500"}>{m.text}</span>
                            </span>
                        </label>)}
                    </div>
                    {mode !== "clear" && <div className={"grid grid-cols-2 gap-3"}>
                        <NumberField label={"Chips mindestens"} value={minChips} onChange={setMinChips} disabled={running}/>
                        <NumberField label={"Chips höchstens"} value={maxChips} onChange={setMaxChips} disabled={running}/>
                    </div>}
                    {mode === "cycle" && <div className={"grid grid-cols-2 gap-3"}>
                        <NumberField label={"Zyklen (0 = Dauertest)"} value={cycles} onChange={setCycles} disabled={running}/>
                        <NumberField label={"Pause zwischen Zyklen [s]"} value={pauseSeconds} onChange={setPauseSeconds} disabled={running}/>
                    </div>}
                    {mode !== "clear" && <p className={"text-xs text-gray-500"}>
                        Pro Zyklus wird eine zufällige Anzahl Chips zwischen Minimum und Maximum auf zufällige Spalten verteilt (höchstens 42).
                    </p>}
                    {!running && <div className={"flex flex-col gap-2"}>
                        <Button className={"cursor-pointer"} disabled={startBlocker != null} onClick={start}>Test starten</Button>
                        {startBlocker && <p className={"text-sm text-gray-500"}>{startBlocker}</p>}
                    </div>}
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>Status</CardTitle></CardHeader>
                <CardContent className={"flex flex-col gap-4"}>
                    {!test || (!running && !test.result)
                        ? <p className={"text-sm text-gray-400"}>Seit dem Start des Backends lief noch kein Test.</p>
                        : <RunStatus test={test} now={now} chipsOnBoard={chipsOnBoard}/>}
                    {running && <div className={"flex flex-wrap gap-2"}>
                        <Button variant={"outline"} className={"cursor-pointer"} disabled={test!.stopRequested} onClick={stop}>
                            {test!.stopRequested ? "Wird beendet ..." : "Beenden"}
                        </Button>
                        {!confirmAbort
                            ? <Button variant={"destructive"} className={"cursor-pointer"} onClick={() => setConfirmAbort(true)}>Sofort abbrechen</Button>
                            : <>
                                <Button variant={"destructive"} className={"cursor-pointer"} onClick={abort}>Wirklich abbrechen</Button>
                                <Button variant={"outline"} className={"cursor-pointer"} onClick={() => setConfirmAbort(false)}>Nein</Button>
                            </>}
                    </div>}
                    {running && <p className={"text-xs text-gray-500"}>
                        <b>Beenden</b> wartet auf einen sicheren Punkt: kein Chip im Greifer, und im Zyklus wird das Feld vorher noch
                        aufgeräumt. <b>Sofort abbrechen</b> wartet nicht mehr auf den Roboter; er beendet nur seine aktuelle Bewegung,
                        danach können Chips im Greifer oder auf dem Feld liegen.
                    </p>}
                    <Board board={board}/>
                    <p className={"text-center text-xs text-gray-500"}>
                        Spielfeld laut Backend: {chipsOnBoard} Chips · Magazin blau {gameData.rv6l.blueChipsLeft}, rot {gameData.rv6l.redChipsLeft}
                    </p>
                </CardContent>
            </Card>
        </div>

        {test && Object.keys(test.actions).length > 0 && <Statistics test={test}/>}
    </div>;
}

function RunStatus({test, now, chipsOnBoard}: { test: TestStatus, now: number, chipsOnBoard: number }) {
    const start = test.startedAt ? new Date(test.startedAt).getTime() : now;
    const end = test.running ? now : test.finishedAt ? new Date(test.finishedAt).getTime() : now;
    const cycles = test.config?.mode === "cycle"
        ? `${test.cyclesDone} abgeschlossen${test.config.cycles === 0 ? " (Dauertest)" : ` von ${test.config.cycles}`}`
        : null;
    const result = test.result ? RESULT_LABELS[test.result] : null;

    return <div className={"flex flex-col gap-3"}>
        {test.running
            ? <div className={"rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-900"}>
                <p className={"font-semibold"}>{PHASE_LABELS[test.phase]}{test.stopRequested ? " (wird beendet)" : ""}</p>
                {test.phase === "fill" && <p className={"text-sm"}>{chipsOnBoard} von {test.targetChips} Chips eingeworfen</p>}
            </div>
            : result && <div className={`rounded-md border p-3 ${result.tone}`}>
                <p className={"font-semibold"}>{result.text}</p>
                {test.error && <p className={"text-sm"}>{test.error}</p>}
            </div>}
        <dl className={"grid grid-cols-2 gap-x-4 gap-y-1 text-sm"}>
            {cycles && <><dt className={"text-gray-500"}>Zyklen</dt><dd>{cycles}</dd></>}
            <dt className={"text-gray-500"}>Chips eingeworfen</dt><dd>{test.chipsPlaced}</dd>
            <dt className={"text-gray-500"}>Chips entnommen</dt><dd>{test.chipsRemoved}</dd>
            <dt className={"text-gray-500"}>Gestartet</dt><dd>{test.startedAt ? formatDate(test.startedAt) : "–"}</dd>
            <dt className={"text-gray-500"}>Laufzeit</dt><dd>{formatDuration(end - start)}</dd>
        </dl>
    </div>;
}

function Statistics({test}: { test: TestStatus }) {
    const rows = Object.entries(test.actions).sort(([a], [b]) =>
        (Object.keys(ACTION_LABELS).indexOf(a) + 100) % 100 - (Object.keys(ACTION_LABELS).indexOf(b) + 100) % 100);
    const cycleMs = test.cycles.map((c) => c.fillMs + c.clearMs);
    const meanCycle = cycleMs.length ? cycleMs.reduce((a, b) => a + b, 0) / cycleMs.length : null;
    const chipsPerHour = cycleMs.length
        ? test.cycles.reduce((sum, c) => sum + c.chips, 0) / (cycleMs.reduce((a, b) => a + b, 0) / 3_600_000)
        : null;

    return <Card>
        <CardHeader>
            <CardTitle>Statistik</CardTitle>
            {meanCycle != null && <p className={"text-sm text-gray-500"}>
                Mittlere Zykluszeit {formatDuration(meanCycle)} · {Math.round(chipsPerHour!)} Chips pro Stunde (einwerfen und aufräumen)
            </p>}
        </CardHeader>
        <CardContent className={"flex flex-col gap-6"}>
            <table className={"w-full text-sm"}>
                <thead className={"text-left text-gray-500"}>
                <tr><th className={"py-1"}>Aktion</th><th>Anzahl</th><th>Mittel</th><th>Min</th><th>Max</th></tr>
                </thead>
                <tbody>
                {rows.map(([name, s]) => <tr key={name} className={"border-t"}>
                    <td className={"py-1"}>{ACTION_LABELS[name] ?? name}</td>
                    <td>{s.count}</td>
                    <td>{seconds(s.totalMs / s.count)}</td>
                    <td>{seconds(s.minMs)}</td>
                    <td>{seconds(s.maxMs)}</td>
                </tr>)}
                </tbody>
            </table>
            {test.cycles.length > 0 && <div>
                <p className={"mb-1 font-semibold"}>Letzte Zyklen</p>
                <table className={"w-full text-sm"}>
                    <thead className={"text-left text-gray-500"}>
                    <tr><th className={"py-1"}>Zyklus</th><th>Chips</th><th>Bestücken</th><th>Aufräumen</th><th>Fertig</th></tr>
                    </thead>
                    <tbody>
                    {test.cycles.map((c) => <tr key={c.cycle} className={"border-t"}>
                        <td className={"py-1"}>{c.cycle}</td>
                        <td>{c.chips}</td>
                        <td>{formatDuration(c.fillMs)}</td>
                        <td>{formatDuration(c.clearMs)}</td>
                        <td>{formatDate(c.finishedAt)}</td>
                    </tr>)}
                    </tbody>
                </table>
            </div>}
        </CardContent>
    </Card>;
}

// same colors as the other boards: 1 (the player's chip) red, 2 (the robot's) blue; row 0 is the bottom row
function Board({board}: { board: Record<string, number[]> | null }) {
    return <div className={"flex justify-center gap-1.5 self-center rounded-lg border border-gray-300 p-2"}>
        {Array.from({length: 7}).map((_, column) => <div key={column} className={"flex flex-col gap-1.5"}>
            {Array.from({length: 6}).map((_, i) => {
                const chip = board?.[column]?.[5 - i];
                const color = chip === 1 ? "bg-red-500" : chip === 2 ? "bg-blue-500" : "bg-gray-100";
                return <div key={i} className={`h-8 w-8 rounded-full border border-gray-400 ${color}`}/>;
            })}
        </div>)}
    </div>;
}

function NumberField(props: { label: string, value: string, onChange: (value: string) => void, disabled: boolean }) {
    return <label className={"flex flex-col gap-1 text-sm"}>
        <span className={"text-gray-600"}>{props.label}</span>
        <Input type={"number"} min={0} value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value)}/>
    </label>;
}

function validChips(config: TestConfig) {
    return Number.isInteger(config.minChips) && Number.isInteger(config.maxChips)
        && config.minChips >= 1 && config.maxChips <= 42 && config.minChips <= config.maxChips;
}

function useNow() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    return now;
}

function seconds(ms: number) {
    return `${(ms / 1000).toFixed(1)} s`;
}

function formatDuration(ms: number) {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    return h > 0 ? `${h} h ${m} min` : m > 0 ? `${m} min ${s} s` : `${s} s`;
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleString("de-DE", {dateStyle: "short", timeStyle: "medium"});
}
