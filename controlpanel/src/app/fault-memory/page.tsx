"use client";
import {useContext} from "react";
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

    const memory = gameData.faultMemory ?? {open: [], acknowledged: [], gameStartBlocked: false};
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
                    Quittieren geht erst, wenn der Fehler nicht mehr anliegt. Solange kritische Fehler offen sind, lassen sich keine neuen Spiele starten.
                </p>
                {memory.gameStartBlocked
                    ? <div className={"mt-2 rounded-md bg-red-500 p-3 text-white"}>
                        <p className={"font-bold"}>Spielstart gesperrt</p>
                        <p>Es gibt nicht quittierte kritische Fehler. Ursache beheben, prüfen und dann quittieren.</p>
                    </div>
                    : <div className={"mt-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800"}>
                        Keine offenen kritischen Fehler, Spiele können gestartet werden.
                    </div>}
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
