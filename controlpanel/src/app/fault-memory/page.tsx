"use client";
import {useContext, useState} from "react";
import {Input} from "@/components/ui/input";
import {Checkbox} from "@/components/ui/checkbox";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {GameDataContext, WebsocketSendContext} from "@/provider/WebsocketProvider";
import {FaultEntry} from "@/app/models/GameData";

export default function FaultMemoryPage() {
    const gameData = useContext(GameDataContext);
    const send = useContext(WebsocketSendContext);

    if (!gameData) {
        return <div className={"flex justify-center h-screen w-full items-center text-3xl text-gray-700"}>Verbinden...</div>;
    }

    const memory = gameData.faultMemory ?? {open: [], acknowledged: [], lockReasons: []};
    const locked = memory.lockReasons.length > 0;
    // active and critical faults first, newest first within each block
    const open = [...memory.open].sort((a, b) =>
        Number(b.active) - Number(a.active) || Number(b.critical) - Number(a.critical) || b.lastSeen.localeCompare(a.lastSeen));
    const acknowledge = (key: string) => send?.(JSON.stringify({action: "acknowledge_fault", key}));
    const canAcknowledgeAll = open.some((f) => !f.active);

    return <div className={"flex flex-col gap-4"}>
        <Card>
            <CardHeader>
                <CardTitle>Fehlerspeicher</CardTitle>
                <p className={"text-sm text-gray-500"}>
                    Fehler bleiben hier gespeichert, auch wenn ihre Ursache wieder weg ist, und müssen quittiert werden.
                    Quittieren geht erst, wenn der Fehler nicht mehr anliegt. Solange ein kritischer Fehler offen ist, steht das
                    Spiel im Zustand ERROR und verlässt ihn von selbst, sobald alle kritischen Fehler quittiert sind.
                </p>
                {locked
                    ? <div className={"mt-2 rounded-md bg-red-500 p-3 text-white"}>
                        <p className={"font-bold"}>Spiel gesperrt (ERROR)</p>
                        <ul className={"list-disc pl-5"}>{memory.lockReasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>
                        <p className={"mt-1 text-sm"}>Ursache beheben, prüfen und dann quittieren.</p>
                    </div>
                    : <div className={"mt-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800"}>
                        Keine offenen kritischen Fehler, das Spiel ist freigegeben.
                    </div>}
                <ManualFaultForm onCreate={(title, details, critical) =>
                    send?.(JSON.stringify({action: "create_manual_fault", title, details, critical}))}/>
            </CardHeader>
            <CardContent className={"flex flex-col gap-2"}>
                <div className={"flex items-center justify-between"}>
                    <p className={"font-semibold"}>Offene Einträge ({open.length})</p>
                    <Button variant={"outline"} className={"cursor-pointer"} disabled={!canAcknowledgeAll}
                            onClick={() => send?.(JSON.stringify({action: "acknowledge_all_faults"}))}>
                        Alle behobenen quittieren
                    </Button>
                </div>
                {open.length === 0 && <p className={"text-sm text-gray-400"}>Keine offenen Einträge.</p>}
                {open.map((fault) => <FaultRow key={fault.key} fault={fault} onAcknowledge={() => acknowledge(fault.key)}/>)}
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle>Quittiert</CardTitle>
                <p className={"text-sm text-gray-500"}>Die letzten 100 quittierten Einträge.</p>
            </CardHeader>
            <CardContent className={"flex flex-col gap-2"}>
                {memory.acknowledged.length === 0 && <p className={"text-sm text-gray-400"}>Noch nichts quittiert.</p>}
                {memory.acknowledged.map((fault) => <FaultRow key={fault.key + fault.acknowledgedAt} fault={fault}/>)}
            </CardContent>
        </Card>
    </div>;
}

// E.g. "Spielfeld wird repariert": locks the game until the fault is acknowledged again
function ManualFaultForm(props: { onCreate: (title: string, details: string, critical: boolean) => void }) {
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState("");
    const [details, setDetails] = useState("");
    const [critical, setCritical] = useState(true);
    if (!open) {
        return <div><Button variant={"outline"} className={"mt-2 cursor-pointer"} onClick={() => setOpen(true)}>Fehler manuell anlegen</Button></div>;
    }
    const submit = () => {
        if (!title.trim()) return;
        props.onCreate(title.trim(), details.trim(), critical);
        setTitle("");
        setDetails("");
        setOpen(false);
    };
    return <div className={"mt-2 flex flex-col gap-2 rounded-md border bg-gray-50 p-3"}>
        <p className={"font-semibold"}>Fehler manuell anlegen</p>
        <Input placeholder={"Titel, z. B. Spielfeld wird repariert"} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
               onKeyDown={(e) => { if (e.key === "Enter") submit(); }}/>
        <Input placeholder={"Details (optional)"} value={details} onChange={(e) => setDetails(e.target.value)}/>
        <label className={"flex items-center gap-2 text-sm"}>
            <Checkbox checked={critical} onCheckedChange={(c) => setCritical(c === true)}/> kritisch, sperrt das Spiel bis zum Quittieren
        </label>
        <div className={"flex gap-2"}>
            <Button className={"cursor-pointer"} disabled={!title.trim()} onClick={submit}>Anlegen</Button>
            <Button variant={"outline"} className={"cursor-pointer"} onClick={() => setOpen(false)}>Abbrechen</Button>
        </div>
    </div>;
}

function FaultRow(props: { fault: FaultEntry, onAcknowledge?: () => void }) {
    const f = props.fault;
    const tone = f.severity === "fatal" ? "border-red-300" : "border-yellow-300";
    let status = <span className={"rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700"}>behoben, nicht quittiert</span>;
    if (f.active) status = <span className={"rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700"}>liegt an</span>;
    if (f.acknowledgedAt) status = <span className={"rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700"}>quittiert {formatDate(f.acknowledgedAt)}</span>;

    return <div className={`flex items-start justify-between gap-4 rounded-md border-l-4 border bg-white p-3 ${tone}`}>
        <div className={"flex flex-col gap-1"}>
            <div className={"flex flex-wrap items-center gap-2"}>
                {status}
                {f.critical && <span className={"rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white"}>kritisch</span>}
                <span className={"text-xs text-gray-500"}>{f.source}</span>
            </div>
            <p className={"font-semibold"}>{f.title}</p>
            {f.details && <p className={"text-sm text-gray-600"}>{f.details}</p>}
            <p className={"text-xs text-gray-400"}>
                {f.occurrences === 1 ? `Aufgetreten ${formatDate(f.firstSeen)}` : `${f.occurrences}× aufgetreten, zuerst ${formatDate(f.firstSeen)}, zuletzt ${formatDate(f.lastSeen)}`}
            </p>
        </div>
        {props.onAcknowledge && <Button className={"cursor-pointer"} disabled={f.active} onClick={props.onAcknowledge}
                                        title={f.active ? "Erst die Ursache beheben" : undefined}>Quittieren</Button>}
    </div>;
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleString("de-DE", {dateStyle: "short", timeStyle: "medium"});
}
