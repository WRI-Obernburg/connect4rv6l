"use client";
import {useEffect, useMemo, useRef, useState} from "react";
import {RefreshCw} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Checkbox} from "@/components/ui/checkbox";
import {TaskState, TONE_BADGE, useMonitor} from "@/app/robot/monitor";

const GAME_PROGRAM = "S:/PROG/4GEWINNT/AKTUELL/4GEWINNT.MPR";

/**
 * Shows the program a task of the controller is running, with the current step highlighted.
 * The step reported by the controller is the line number in the decompiled source, starting at 1.
 */
export function InterpreterTab(props: { tasks?: TaskState[] }) {
    const [taskName, setTaskName] = useState("Interpreter");
    const [follow, setFollow] = useState(true);
    const task = props.tasks?.find((t) => t.name === taskName);
    const filename = task?.filename ?? "";

    return <div className={"flex flex-col gap-3 p-3"}>
        <div className={"flex flex-wrap items-center gap-2"}>
            {(props.tasks ?? []).map((t) => <button key={t.name} onClick={() => setTaskName(t.name)}
                                                    className={`cursor-pointer rounded-md border px-3 py-1 text-sm ${t.name === taskName ? "border-gray-900 bg-gray-900 text-white" : "bg-white hover:bg-gray-50"}`}>
                {t.name.replace(/([a-z])([A-Z])/g, "$1 $2")}
                {t.state && <span className={`ml-2 rounded px-1 text-xs ${t.state === "active" ? "bg-green-500 text-white" : "bg-gray-200 text-gray-700"}`}>{t.state}</span>}
            </button>)}
            <label className={"ml-auto flex items-center gap-2 text-sm"}>
                <Checkbox checked={follow} onCheckedChange={(c) => setFollow(c === true)}/> Aktueller Zeile folgen
            </label>
        </div>

        {!props.tasks && <p className={"text-sm text-gray-400"}>Lade Tasks der Steuerung…</p>}
        {task?.error && <p className={"text-sm text-red-600"}>{task.error}</p>}
        {task && !task.error && !filename && <p className={"text-sm text-gray-400"}>Diese Task hat kein Programm angewählt.</p>}
        {filename && <ProgramView filename={filename} step={task?.step} state={task?.state ?? ""} follow={follow}/>}
    </div>;
}

function ProgramView(props: { filename: string, step?: number, state: string, follow: boolean }) {
    const program = useMonitor<{ filename: string, source: string }>("monitor_program", "monitor:program", {filename: props.filename});
    const lines = useMemo(() => (program.data?.filename === props.filename ? program.data.source : "").replace(/\r/g, "").split("\n"), [program.data, props.filename]);
    const currentRef = useRef<HTMLLIElement>(null);

    useEffect(() => {
        if (props.follow) currentRef.current?.scrollIntoView({block: "center", behavior: "smooth"});
    }, [props.step, props.follow, lines.length]);

    const isGameProgram = props.filename.toUpperCase() === GAME_PROGRAM;
    const active = props.state === "active";
    const currentLine = props.step ? lines[props.step - 1] : undefined;

    return <div className={"flex flex-col gap-2"}>
        <div className={"flex flex-wrap items-center gap-2 rounded-md border bg-white p-3"}>
            <span className={"font-mono text-sm font-semibold"}>{props.filename}</span>
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${active ? TONE_BADGE.ok : TONE_BADGE.warn}`}>{props.state || "?"}</span>
            {props.step && <span className={"rounded bg-gray-100 px-1.5 py-0.5 text-xs"}>Schritt {props.step}</span>}
            {!isGameProgram && <span className={`rounded px-1.5 py-0.5 text-xs ${TONE_BADGE.warn}`}>Nicht das Spielprogramm 4GEWINNT</span>}
            <Button variant={"outline"} size={"sm"} className={"ml-auto cursor-pointer"} onClick={() => program.refresh({refresh: true})}>
                <RefreshCw className={"size-4"}/> Programm neu laden
            </Button>
            {currentLine !== undefined && <p className={"w-full text-sm"}>
                <span className={"text-gray-500"}>{active ? "Führt aus: " : "Steht bei: "}</span>
                <code className={"rounded bg-orange-50 px-1"}>{shorten(currentLine)}</code>
            </p>}
        </div>
        {program.error && <p className={"text-sm text-red-600"}>{program.error}</p>}
        {program.loading && !program.data && <p className={"text-sm text-gray-400"}>Lade Programmtext…</p>}
        {lines.length > 1 && <ol className={"max-h-[65vh] overflow-auto rounded-md border bg-white py-1 font-mono text-xs"}>
            {lines.map((line, i) => {
                const current = i + 1 === props.step;
                const comment = /^\\|^C\s/.test(line) || line === "C";
                return <li key={i} ref={current ? currentRef : undefined}
                           className={`grid grid-cols-[3.5rem_1fr] ${current ? "bg-orange-100 font-semibold" : ""}`}>
                    <span className={`pr-2 text-right select-none ${current ? "text-orange-600" : "text-gray-300"}`}>{i + 1}</span>
                    <span className={`truncate pr-3 ${comment ? "text-gray-400" : ""}`} title={line}>{shorten(line)}</span>
                </li>;
            })}
        </ol>}
    </div>;
}

// Positions are stored as long XML in the source; show only the coordinates
function shorten(line: string) {
    const position = /<XPOS[^>]*>.*?<x>([-\d.e+]+)<\/x><y>([-\d.e+]+)<\/y><z>([-\d.e+]+)<\/z>/.exec(line);
    if (!position) return line;
    const [, x, y, z] = position.map(Number);
    return `${line.slice(0, line.indexOf("<XPOS")).trim()} Position x=${x.toFixed(1)} y=${y.toFixed(1)} z=${z.toFixed(1)}`;
}
