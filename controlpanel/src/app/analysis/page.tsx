"use client";
import {useContext, useState} from "react";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {GameDataContext} from "@/provider/WebsocketProvider";
import {AIDecision, Analysis, AnalysisMove, CleanupStep} from "@/app/models/GameData";

// Columns are numbered 1 to 7 from the left as seen from inside, like on the control panel board.
// Chips: 1 is the player's blue, 2 the robot's red.

const DIFFICULTY: Record<string, string> = {easy: "Leicht", medium: "Mittel", hard: "Schwer"};
const RESULT: Record<string, string> = {
    player: "Der Spieler hat gewonnen", robot: "Der Roboter hat gewonnen", tie: "Unentschieden",
    aborted: "Von der Spielleitung abgebrochen", restarted: "Von der Spielleitung neu gestartet",
};

export default function AnalysisPage() {
    const gameData = useContext(GameDataContext);
    const [selected, setSelected] = useState<number | null>(null);

    if (!gameData) {
        return <div className={"flex justify-center h-screen w-full items-center text-3xl text-gray-700"}>Verbinden...</div>;
    }

    const analysis: Analysis = gameData.analysis ?? {game: null, cleanup: null};
    const moves = analysis.game?.moves ?? [];
    const robotMoves = moves.filter((m) => m.decision);
    // follow the latest robot move unless one is picked
    const move = moves.find((m) => m.number === selected) ?? robotMoves[robotMoves.length - 1] ?? null;

    return <div className={"flex flex-col gap-4"}>
        <Card>
            <CardHeader>
                <CardTitle>Spielanalyse</CardTitle>
                <p className={"text-sm text-gray-500"}>
                    So entscheidet der Roboter: Er bewertet jede freie Spalte mit Negamax, drei Züge voraus. Ein positiver Wert
                    heißt, der Roboter kann den Sieg erzwingen, ein negativer, der Spieler kann gewinnen; je größer der Betrag,
                    desto schneller. 0 heißt: innerhalb der Vorausschau entscheidet sich nichts. Die Werte werden in drei Stufen
                    eingeteilt, eine Zufallszahl wählt je nach Schwierigkeit die Stufe, und unter den Spalten mit dem Wert dieser
                    Stufe entscheidet nochmals der Zufall.
                </p>
            </CardHeader>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle>{gameData.gameState.stateName === "IDLE" || analysis.game?.result ? "Letzte Partie" : "Aktuelle Partie"}</CardTitle>
                {analysis.game
                    ? <p className={"text-sm text-gray-500"}>
                        Gestartet {formatDate(analysis.game.startedAt)} · {moves.length} Züge
                        {analysis.game.result && ` · ${RESULT[analysis.game.result] ?? analysis.game.result}`}
                    </p>
                    : <p className={"text-sm text-gray-400"}>Seit dem Start des Backends wurde noch keine Partie gespielt.</p>}
            </CardHeader>
            {analysis.game && <CardContent className={"flex flex-col gap-6"}>
                <MoveList moves={moves} selected={move?.number ?? null} onSelect={setSelected}/>
                {move?.decision
                    ? <Decision move={move} decision={move.decision}/>
                    : move && <p className={"text-sm text-gray-500"}>Zug {move.number}: Der Spieler wirft in Spalte {move.column + 1} ein.</p>}
                {!move && <p className={"text-sm text-gray-400"}>Der Roboter hat in dieser Partie noch nicht gezogen.</p>}
            </CardContent>}
        </Card>

        <CleanupCard cleanup={analysis.cleanup}/>
    </div>;
}

function MoveList(props: { moves: AnalysisMove[], selected: number | null, onSelect: (n: number) => void }) {
    return <div className={"flex flex-wrap gap-2"}>
        {props.moves.map((m) => {
            const active = m.number === props.selected;
            return <button key={m.number} onClick={() => props.onSelect(m.number)}
                           className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm ${active ? "border-gray-900 bg-gray-900 text-white" : "bg-white hover:bg-gray-50"}`}>
                <span className={`inline-block size-3 rounded-full ${m.by === "player" ? "bg-blue-500" : "bg-red-500"}`}/>
                {m.number}. {m.by === "player" ? "Spieler" : "Roboter"} → {m.column + 1}
            </button>;
        })}
    </div>;
}

// ---------------------------------------------------------------------------------------------
// One robot decision

function Decision({move, decision}: { move: AnalysisMove, decision: AIDecision }) {
    const unique = [...new Set(decision.scores.filter((s): s is number => s != null))].sort((a, b) => b - a);
    // tier 1 must hold the best score; the library's getTop3ScoreTiers broke that (fixed in the backend on 2026-10-01)
    const bestSkipped = unique.length > 0 && unique[0]! > decision.tiers[0];
    const chosenScore = decision.scores[move.column];

    return <div className={"grid gap-6 lg:grid-cols-[auto_1fr]"}>
        <div className={"flex flex-col items-center gap-2"}>
            <p className={"text-sm font-semibold"}>Spielfeld vor Zug {move.number}</p>
            <MiniBoard board={move.boardBefore} chosen={move.column} candidates={decision.candidates}/>
            <p className={"text-xs text-gray-500"}>▼ gewählt · ◦ ebenfalls in Frage</p>
        </div>
        <div className={"flex flex-col gap-5"}>
            <div>
                <p className={"text-sm font-semibold"}>1. Bewertung jeder Spalte</p>
                <ScoreChart scores={decision.scores} chosen={move.column} candidates={decision.candidates}/>
            </div>
            <div>
                <p className={"text-sm font-semibold"}>2. Stufen</p>
                <div className={"mt-2 grid grid-cols-3 gap-2 text-sm"}>
                    {decision.tiers.map((score, i) => <div key={i}
                        className={`rounded-md border p-2 ${decision.tier === i + 1 ? "border-gray-900 bg-gray-50" : ""}`}>
                        <p className={"text-gray-500"}>Stufe {i + 1}</p>
                        <p className={"text-lg font-semibold tabular-nums"}>{signed(score)}</p>
                    </div>)}
                </div>
                <p className={"mt-1 text-xs text-gray-500"}>Verschiedene Werte, absteigend: {unique.map(signed).join(", ") || "–"}</p>
                {bestSkipped && <p className={"mt-2 rounded-md border border-yellow-300 bg-yellow-50 p-2 text-sm text-yellow-900"}>
                    Der beste Wert {signed(unique[0]!)} ist nicht in Stufe 1. Das darf nicht vorkommen; die Stufenbildung im Backend
                    (topThreeTiers in game.ts) prüfen.
                </p>}
            </div>
            <div>
                <p className={"text-sm font-semibold"}>3. Zufall nach Schwierigkeit ({DIFFICULTY[decision.difficulty] ?? decision.difficulty})</p>
                <DrawBar decision={decision}/>
            </div>
            <p className={"rounded-md bg-gray-50 p-3 text-sm"}>
                Die Zufallszahl {decision.draw.toFixed(2)} wählt Stufe {decision.tier} (Wert {signed(decision.tiers[decision.tier - 1])}).
                {decision.candidates.length > 1
                    ? ` Diesen Wert haben die Spalten ${decision.candidates.map((c) => c + 1).join(", ")}; per Zufall wurde Spalte ${move.column + 1} gewählt.`
                    : ` Nur Spalte ${move.column + 1} hat diesen Wert.`}
                {chosenScore != null && chosenScore > 0 && " Der Roboter kann von hier den Sieg erzwingen."}
                {chosenScore != null && chosenScore < 0 && " Mit diesem Zug kann der Spieler gewinnen."}
                <span className={"text-gray-500"}> Berechnet in {decision.durationMs} ms.</span>
            </p>
        </div>
    </div>;
}

// Diverging columns around a zero line: red up is good for the robot, blue down is good for the player
function ScoreChart(props: { scores: (number | null)[], chosen: number, candidates: number[] }) {
    const max = Math.max(1, ...props.scores.map((s) => Math.abs(s ?? 0)));
    const HALF = 72;
    return <div className={"mt-2"}>
        <div className={"flex items-stretch gap-3"}>
            {props.scores.map((score, column) => {
                const height = score == null ? 0 : Math.max(2, Math.round(Math.abs(score) / max * HALF));
                const up = (score ?? 0) > 0, down = (score ?? 0) < 0;
                const color = up ? "bg-red-500" : down ? "bg-blue-500" : "bg-gray-300";
                const title = score == null ? `Spalte ${column + 1}: voll`
                    : `Spalte ${column + 1}: ${signed(score)}${up ? ", Roboter kann gewinnen" : down ? ", Spieler kann gewinnen" : ", offen"}`;
                return <div key={column} title={title} className={"flex w-10 flex-col items-center"}>
                    <div className={"relative flex w-full flex-col items-center justify-end"} style={{height: HALF + 18}}>
                        {up && <span className={"text-xs tabular-nums text-gray-700"}>{signed(score!)}</span>}
                        {score != null && (up || score === 0) && <div className={`w-6 ${color} ${up ? "rounded-t" : "rounded"}`} style={{height}}/>}
                    </div>
                    <div className={"h-px w-full bg-gray-400"}/>
                    <div className={"flex w-full flex-col items-center"} style={{height: HALF + 18}}>
                        {down && <div className={`w-6 rounded-b ${color}`} style={{height}}/>}
                        {down && <span className={"text-xs tabular-nums text-gray-700"}>{signed(score!)}</span>}
                        {score === 0 && <span className={"text-xs tabular-nums text-gray-500"}>0</span>}
                        {score == null && <span className={"text-xs text-gray-400"}>voll</span>}
                    </div>
                    <span className={`text-sm ${column === props.chosen ? "font-bold" : "text-gray-600"}`}>
                        {column === props.chosen ? "▼" : props.candidates.includes(column) ? "◦" : ""} {column + 1}
                    </span>
                </div>;
            })}
        </div>
        <div className={"mt-2 flex gap-4 text-xs text-gray-600"}>
            <span className={"flex items-center gap-1"}><span className={"inline-block size-3 rounded-sm bg-red-500"}/> Vorteil Roboter</span>
            <span className={"flex items-center gap-1"}><span className={"inline-block size-3 rounded-sm bg-blue-500"}/> Vorteil Spieler</span>
            <span className={"flex items-center gap-1"}><span className={"inline-block size-3 rounded-sm bg-gray-300"}/> offen</span>
        </div>
    </div>;
}

// The interval 0..1 split by the difficulty's tier quotas, with the random number that was drawn
function DrawBar({decision}: { decision: AIDecision }) {
    const {tier1, tier2, tier3} = decision.ratios;
    // same order as the library: tier 3 from 0, tier 2 above it, tier 1 at the top end
    const segments = [
        {tier: 3, from: 0, width: tier3}, {tier: 2, from: tier3, width: tier2}, {tier: 1, from: tier3 + tier2, width: tier1},
    ].filter((s) => s.width > 0);
    return <div className={"mt-2"}>
        <div className={"relative h-8 w-full"}>
            <div className={"flex h-8 w-full gap-0.5 overflow-hidden rounded"}>
                {segments.map((s) => <div key={s.tier} style={{width: `${s.width * 100}%`}}
                    className={`flex items-center justify-center text-xs ${s.tier === decision.tier ? "bg-gray-800 text-white" : "bg-gray-200 text-gray-700"}`}>
                    Stufe {s.tier} · {Math.round(s.width * 100)} %
                </div>)}
            </div>
            <div className={"absolute top-[-6px] h-11 w-0.5 bg-amber-500"} style={{left: `calc(${decision.draw * 100}% - 1px)`}} title={`Zufallszahl ${decision.draw.toFixed(3)}`}/>
        </div>
        <div className={"mt-1 flex justify-between text-xs text-gray-500"}><span>0</span><span>Zufallszahl {decision.draw.toFixed(2)}</span><span>1</span></div>
    </div>;
}

function MiniBoard(props: { board: Record<string, number[]>, chosen?: number, candidates?: number[], numbers?: Map<string, number>, current?: string, faded?: Set<string> }) {
    return <div className={"flex flex-col items-center gap-1"}>
        {props.chosen != null && <div className={"flex gap-1.5 px-2"}>
            {Array.from({length: 7}).map((_, column) => <span key={column} className={"w-8 text-center text-sm"}>
                {column === props.chosen ? "▼" : props.candidates?.includes(column) ? "◦" : ""}
            </span>)}
        </div>}
        <div className={"flex gap-1.5 rounded-lg border border-gray-300 p-2"}>
            {Array.from({length: 7}).map((_, column) => <div key={column} className={"flex flex-col gap-1.5"}>
                {Array.from({length: 6}).map((_, i) => {
                    const row = 5 - i;
                    const chip = props.board[column]?.[row];
                    const key = `${column}:${row}`;
                    const number = props.numbers?.get(key);
                    const color = chip === 1 ? "bg-blue-500 text-white" : chip === 2 ? "bg-red-500 text-white" : "bg-gray-100";
                    return <div key={i} className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${color} ${props.current === key ? "ring-4 ring-amber-400" : "border-gray-400"} ${props.faded?.has(key) ? "opacity-25" : ""}`}>
                        {number ?? ""}
                    </div>;
                })}
            </div>)}
        </div>
        <div className={"flex gap-1.5 px-2"}>
            {Array.from({length: 7}).map((_, column) => <span key={column} className={"w-8 text-center text-xs text-gray-500"}>{column + 1}</span>)}
        </div>
    </div>;
}

// ---------------------------------------------------------------------------------------------
// Clean-up: the order the chips go back, live while it runs and afterwards

const PHASE: Record<string, string> = {
    init: "Paletten werden initialisiert", chips: "Chips werden zurückgelegt", reinit: "Paletten werden für das nächste Spiel initialisiert",
    done: "Abgeschlossen", failed: "Fehlgeschlagen",
};
const STEP: Record<CleanupStep["status"], string> = {
    pending: "wartet", removing: "wird entnommen", returning: "wird abgelegt", done: "erledigt", failed: "fehlgeschlagen",
};

function CleanupCard({cleanup}: { cleanup: Analysis["cleanup"] }) {
    if (!cleanup) {
        return <Card>
            <CardHeader><CardTitle>Aufräumen</CardTitle></CardHeader>
            <CardContent><p className={"text-sm text-gray-400"}>Seit dem Start des Backends wurde noch nicht aufgeräumt.</p></CardContent>
        </Card>;
    }
    // the board as it was when the clean-up began, every chip numbered in the order it is taken back
    const board: Record<string, number[]> = {};
    for (let c = 0; c < 7; c++) board[c] = [];
    for (const step of cleanup.steps) board[step.column]![step.row] = step.color;
    const numbers = new Map(cleanup.steps.map((s, i) => [`${s.column}:${s.row}`, i + 1]));
    const active = cleanup.steps.find((s) => s.status === "removing" || s.status === "returning" || s.status === "failed");
    const done = cleanup.steps.filter((s) => s.status === "done").length;
    // chips already back in their magazine
    const faded = new Set(cleanup.steps.filter((s) => s.status === "done").map((s) => `${s.column}:${s.row}`));
    const tone = cleanup.phase === "failed" ? "border-red-300 bg-red-50 text-red-900"
        : cleanup.phase === "done" ? "border-green-200 bg-green-50 text-green-900" : "border-blue-200 bg-blue-50 text-blue-900";

    return <Card>
        <CardHeader>
            <CardTitle>Aufräumen</CardTitle>
            <p className={"text-sm text-gray-500"}>
                {cleanup.reason} · gestartet {formatDate(cleanup.startedAt)}
                {cleanup.finishedAt && ` · Dauer ${duration(new Date(cleanup.finishedAt).getTime() - new Date(cleanup.startedAt).getTime())}`}
            </p>
        </CardHeader>
        <CardContent className={"flex flex-col gap-4"}>
            <div className={`rounded-md border p-3 ${tone}`}>
                <p className={"font-semibold"}>{PHASE[cleanup.phase]} · {done} von {cleanup.steps.length} Chips zurück</p>
                {cleanup.error && <p className={"text-sm"}>{cleanup.error}</p>}
                <div className={"mt-2 h-2 w-full overflow-hidden rounded bg-white/70"}>
                    <div className={"h-2 rounded bg-current opacity-60"} style={{width: `${cleanup.steps.length ? done / cleanup.steps.length * 100 : 100}%`}}/>
                </div>
            </div>
            <p className={"text-sm text-gray-500"}>
                Reihenfolge: Spalte für Spalte von links, in jeder Spalte der oberste Chip zuerst. Jeder Chip geht zurück in das
                Magazin seiner Farbe; vorher und nachher werden die Paletten initialisiert, damit das nächste Spiel bei Platz 0 greift.
            </p>
            <div className={"grid gap-6 lg:grid-cols-[auto_1fr]"}>
                <MiniBoard board={board} numbers={numbers} faded={faded} current={active ? `${active.column}:${active.row}` : undefined}/>
                <table className={"w-full text-sm"}>
                    <thead className={"text-left text-gray-500"}>
                    <tr><th className={"py-1"}>#</th><th>Chip</th><th>Spalte · Reihe</th><th>Ziel</th><th>Status</th><th>Dauer</th></tr>
                    </thead>
                    <tbody>
                    {cleanup.steps.map((s, i) => <tr key={i} className={`border-t ${s === active ? "bg-amber-50" : ""}`}>
                        <td className={"py-1 tabular-nums"}>{i + 1}</td>
                        <td><span className={`inline-block size-3 rounded-full ${s.color === 1 ? "bg-blue-500" : "bg-red-500"}`}/></td>
                        <td className={"tabular-nums"}>{s.column + 1} · {s.row + 1}</td>
                        <td>{s.color === 1 ? "blaues Magazin" : "rotes Magazin"}</td>
                        <td className={s.status === "failed" ? "text-red-700" : s.status === "done" ? "text-green-700" : ""}>{STEP[s.status]}</td>
                        <td className={"tabular-nums text-gray-500"}>{s.durationMs != null ? duration(s.durationMs) : ""}</td>
                    </tr>)}
                    {cleanup.steps.length === 0 && <tr><td colSpan={6} className={"py-2 text-gray-400"}>Es lagen keine Chips auf dem Spielfeld.</td></tr>}
                    </tbody>
                </table>
            </div>
        </CardContent>
    </Card>;
}

function signed(value: number) {
    return value > 0 ? `+${value}` : String(value);
}

function duration(ms: number) {
    const s = Math.round(ms / 1000);
    return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleString("de-DE", {dateStyle: "short", timeStyle: "medium"});
}
