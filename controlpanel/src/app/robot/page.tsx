"use client";
import {useContext} from "react";
import {Activity, BookText, Info, Play, type LucideIcon} from "lucide-react";
import {Card} from "@/components/ui/card";
import {GameDataContext} from "@/provider/WebsocketProvider";
import {TaskState, Tone, TONE_BADGE, useMonitor, useStoredState} from "@/app/robot/monitor";
import {StatusTab} from "@/app/robot/StatusTab";
import {InterpreterTab} from "@/app/robot/InterpreterTab";
import {LogbookTab} from "@/app/robot/LogbookTab";
import {SystemTab} from "@/app/robot/SystemTab";
import {GameData} from "@/app/models/GameData";

type Tab = "status" | "interpreter" | "logbook" | "system";

const TABS: { id: Tab, label: string, icon: LucideIcon }[] = [
    {id: "status", label: "Status", icon: Activity},
    {id: "interpreter", label: "Interpreter", icon: Play},
    {id: "logbook", label: "Logbuch", icon: BookText},
    {id: "system", label: "System", icon: Info},
];

/**
 * Read only monitoring of the robot controller, so problems can be found without the teach pendant.
 * The data is only requested while this page is open.
 */
export default function RobotMonitorPage() {
    const game = useContext(GameDataContext);
    const [tab, setTab] = useStoredState<Tab>("robot.tab", "status");
    // shared by the status list and the interpreter view
    const tasks = useMonitor<{ tasks: TaskState[], coincidence: string }>("monitor_tasks", "monitor:tasks", {}, 2000);

    if (!game) {
        return <div className={"flex justify-center h-screen w-full items-center text-3xl text-gray-700"}>Verbinden...</div>;
    }

    return <div className={"flex flex-col gap-3"}>
        <SummaryTiles game={game} tasks={tasks.data?.tasks}/>
        <Card className={"gap-0 overflow-hidden py-0"}>
            <div className={"flex border-b bg-gray-50"}>
                {TABS.map((t) => <button key={t.id} onClick={() => setTab(t.id)}
                                         className={`flex cursor-pointer items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium ${tab === t.id ? "border-orange-500 bg-white text-gray-900" : "border-transparent text-gray-500 hover:text-gray-900"}`}>
                    <t.icon className={"size-4"}/>{t.label}
                </button>)}
                {tasks.error && <span className={"ml-auto self-center px-3 text-xs text-red-600"}>{tasks.error}</span>}
            </div>
            {tab === "status" && <StatusTab game={game} tasks={tasks.data?.tasks} coincidence={tasks.data?.coincidence}/>}
            {tab === "interpreter" && <InterpreterTab tasks={tasks.data?.tasks}/>}
            {tab === "logbook" && <LogbookTab/>}
            {tab === "system" && <SystemTab/>}
        </Card>
    </div>;
}

// The few values that decide whether the robot can play, always visible above the tabs
function SummaryTiles(props: { game: GameData, tasks?: TaskState[] }) {
    const values = props.game.rv6l.telemetry?.values ?? [];
    const tile = (id: string) => values.find((v) => v.id === id);
    const interpreter = props.tasks?.find((t) => t.name === "Interpreter");
    const open = props.game.faultMemory?.open ?? [];
    const toneOf = (id: string): Tone => { const v = tile(id); return !v?.available ? "neutral" : v.alarm ? (v.severity === "fatal" ? "error" : "warn") : "ok"; };
    const valueOf = (id: string) => { const v = tile(id); return !v?.available ? "–" : v.alarm ? v.alarmText ?? "Problem" : v.okText ?? String(v.value); };

    const tiles: { label: string, value: string, tone: Tone }[] = [
        {label: "Verbindung", value: props.game.rv6l.mock ? "Mock" : props.game.rv6l.connected ? "verbunden" : "getrennt", tone: props.game.rv6l.mock ? "warn" : props.game.rv6l.connected ? "ok" : "error"},
        {label: "Antriebe", value: valueOf("drives_state"), tone: toneOf("drives_state")},
        // okText holds the plain mode, e.g. Test_1, which fits the tile better than the warning text
        {label: "Betriebsart", value: tile("run_mode")?.available ? tile("run_mode")!.okText ?? "–" : "–", tone: toneOf("run_mode")},
        {label: "Programm", value: interpreter?.filename
                ? `${interpreter.filename.split("/").pop()} · ${interpreter.state === "active" ? "läuft" : "angehalten"}${interpreter.step ? ` · Zeile ${interpreter.step}` : ""}`
                : "–", tone: toneOf("game_program")},
        {label: "Spiel", value: props.game.gameState.stateName === "ERROR" ? "gesperrt" : "freigegeben", tone: props.game.gameState.stateName === "ERROR" ? "error" : "ok"},
        {label: "Fehlerspeicher", value: open.length ? `${open.length} offen` : "leer", tone: open.some((f) => f.critical) ? "error" : open.length ? "warn" : "ok"},
    ];
    return <div className={"grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6"}>
        {tiles.map((t) => <div key={t.label} className={"rounded-lg border bg-white px-3 py-2"}>
            <p className={"text-xs text-gray-500"}>{t.label}</p>
            <p className={`mt-1 inline-block max-w-full truncate rounded px-1.5 py-0.5 text-sm font-semibold ${TONE_BADGE[t.tone]}`} title={t.value}>{t.value}</p>
        </div>)}
    </div>;
}
