"use client"

import {ColumnDef} from "@tanstack/react-table"
import {ErrorDescription, ErrorType} from "@/app/models/GameData";

// The backend numbers log entries in order of occurrence (#254 in the console), keep that number
export type LogRow = ErrorDescription & { number: number, time: number };

export const LEVELS = [
    {type: ErrorType.FATAL, label: "Fehler", badge: "bg-red-100 text-red-700", dot: "bg-red-500"},
    {type: ErrorType.WARNING, label: "Warnung", badge: "bg-yellow-100 text-yellow-800", dot: "bg-yellow-400"},
    {type: ErrorType.INFO, label: "Info", badge: "bg-blue-50 text-blue-700", dot: "bg-blue-400"},
];

export const columns: ColumnDef<LogRow>[] = [
    {
        accessorKey: "number",
        header: "#",
        cell: ({row}) => <span className="font-mono text-gray-400">{row.original.number}</span>,
    },
    {
        accessorKey: "time",
        header: "Zeitpunkt",
        cell: ({row}) => <TimeCell time={row.original.time}/>,
    },
    {
        accessorKey: "errorType",
        header: "Stufe",
        cell: ({row}) => {
            const level = LEVELS.find((l) => l.type === row.original.errorType);
            return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${level?.badge ?? "bg-gray-100"}`}>
                {level?.label ?? "Unbekannt"}
            </span>;
        },
    },
    {
        accessorKey: "description",
        header: "Meldung",
        cell: ({row}) => <span className="whitespace-pre-wrap break-words">{row.original.description}</span>,
    },
]

function TimeCell({time}: { time: number }) {
    if (Number.isNaN(time)) return <span className="text-gray-400">–</span>;
    const date = new Date(time);
    return <span className="whitespace-nowrap text-gray-600" title={date.toLocaleString("de-DE")}>
        {date.toLocaleDateString("de-DE", {day: "2-digit", month: "2-digit"})}{" "}
        <span className="font-mono">{date.toLocaleTimeString("de-DE")}</span>
    </span>;
}
