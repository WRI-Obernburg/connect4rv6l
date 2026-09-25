"use client";
import {useContext, useMemo, useState} from "react";
import {
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    SortingState,
    useReactTable,
} from "@tanstack/react-table";
import {ArrowDown, ArrowUp, ArrowUpDown, Download} from "lucide-react";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Checkbox} from "@/components/ui/checkbox";
import {GameDataContext} from "@/provider/WebsocketProvider";
import {ErrorType} from "@/app/models/GameData";
import {columns, LEVELS, LogRow} from "@/app/error-log/columns";

const TIME_RANGES = [
    {label: "Alles", ms: Infinity},
    {label: "Letzte Stunde", ms: 60 * 60 * 1000},
    {label: "Letzte 24 Stunden", ms: 24 * 60 * 60 * 1000},
    {label: "Letzte 7 Tage", ms: 7 * 24 * 60 * 60 * 1000},
];

export default function ErrorLogPage() {
    const gameData = useContext(GameDataContext);
    const [sorting, setSorting] = useState<SortingState>([{id: "number", desc: true}]);
    const [levels, setLevels] = useState<ErrorType[]>([ErrorType.FATAL, ErrorType.WARNING, ErrorType.INFO]);
    const [search, setSearch] = useState("");
    const [rangeMs, setRangeMs] = useState(Infinity);
    const [collapseRepeats, setCollapseRepeats] = useState(true);
    const [pageSize, setPageSize] = useState(50);

    const allRows = useMemo<LogRow[]>(() => (gameData?.errors ?? []).map((e, i) => ({
        ...e, number: i + 1, time: new Date(e.date).getTime(),
    })), [gameData?.errors]);

    const rows = useMemo(() => {
        const now = Date.now();
        // filter by level before collapsing, so repeats separated by hidden entries are merged as well
        let result = allRows.filter((r) => levels.includes(r.errorType) && (rangeMs === Infinity || now - r.time <= rangeMs));
        if (collapseRepeats) result = collapseRepeatedEntries(result);
        return result;
    }, [allRows, levels, rangeMs, collapseRepeats]);

    const table = useReactTable({
        data: rows,
        columns,
        state: {
            sorting,
            globalFilter: search,
        },
        onSortingChange: setSorting,
        globalFilterFn: (row, _columnId, value: string) =>
            row.original.description.toLowerCase().includes(value.toLowerCase()),
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        initialState: {pagination: {pageSize: 50}},
        autoResetPageIndex: false,
    });

    if (!gameData) {
        return <div className={"flex justify-center h-screen w-full items-center text-3xl text-gray-700"}>Verbinden...</div>;
    }

    const counts = Object.fromEntries(LEVELS.map((l) => [l.type, allRows.filter((r) => r.errorType === l.type).length]));
    const filteredCount = table.getFilteredRowModel().rows.length;
    const toggleLevel = (type: ErrorType) =>
        setLevels(levels.includes(type) ? levels.filter((l) => l !== type) : [...levels, type]);

    return <Card className={"p-4"}>
        <CardHeader>
            <CardTitle>Error Log</CardTitle>
            <p className={"text-sm text-gray-500"}>Alle Ereignisse des Backends seit dem letzten Start, auch aus früheren Sessions.
                Spalten zum Sortieren anklicken.</p>
        </CardHeader>
        <CardContent className={"flex flex-col gap-3"}>
            <div className={"flex flex-wrap items-center gap-2"}>
                {LEVELS.map((level) => <button key={level.type} onClick={() => toggleLevel(level.type)}
                                               className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm ${levels.includes(level.type) ? "border-gray-400 bg-white" : "border-gray-200 bg-gray-50 text-gray-400 line-through"}`}>
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${level.dot}`}/>
                    {level.label} <span className={"text-gray-400"}>{counts[level.type]}</span>
                </button>)}
                <select value={String(rangeMs)} onChange={(e) => setRangeMs(Number(e.target.value))}
                        className={"h-9 rounded-md border px-2 text-sm"}>
                    {TIME_RANGES.map((r) => <option key={r.label} value={String(r.ms)}>{r.label}</option>)}
                </select>
                <label className={"flex items-center gap-2 text-sm"}>
                    <Checkbox checked={collapseRepeats} onCheckedChange={(c) => setCollapseRepeats(c === true)}/>
                    Wiederholungen zusammenfassen
                </label>
                <div className={"ml-auto flex gap-2"}>
                    <Input placeholder={"Meldungen durchsuchen"} value={search} className={"w-64"}
                           onChange={(e) => { setSearch(e.target.value); table.setPageIndex(0); }}/>
                    <Button variant={"outline"} className={"cursor-pointer"} title={"Gefilterte Einträge als CSV herunterladen"}
                            onClick={() => downloadCsv(table.getPrePaginationRowModel().rows.map((r) => r.original))}>
                        <Download className={"h-4 w-4"}/> CSV
                    </Button>
                </div>
            </div>

            <p className={"text-xs text-gray-400"}>{filteredCount} von {allRows.length} Einträgen</p>

            <div className="overflow-hidden rounded-md border">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => {
                                const sorted = header.column.getIsSorted();
                                return <TableHead key={header.id}>
                                    <button className={"flex cursor-pointer items-center gap-1"} onClick={header.column.getToggleSortingHandler()}>
                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                        {sorted === "asc" ? <ArrowUp className={"h-3 w-3"}/> : sorted === "desc" ?
                                            <ArrowDown className={"h-3 w-3"}/> : <ArrowUpDown className={"h-3 w-3 text-gray-300"}/>}
                                    </button>
                                </TableHead>;
                            })}
                        </TableRow>)}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows.length ? table.getRowModel().rows.map((row) =>
                            <TableRow key={row.original.number}
                                      className={row.original.errorType === ErrorType.FATAL ? "bg-red-50/60" : ""}>
                                {row.getVisibleCells().map((cell) => <TableCell key={cell.id} className={"align-top whitespace-normal"}>
                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    {cell.column.id === "description" && (row.original as LogRow & { repeats?: number }).repeats
                                        ? <span className={"ml-2 rounded bg-gray-100 px-1.5 text-xs text-gray-500"}>
                                            {(row.original as LogRow & { repeats?: number }).repeats}× wiederholt</span> : null}
                                </TableCell>)}
                            </TableRow>) : <TableRow>
                            <TableCell colSpan={columns.length} className="h-24 text-center text-gray-400">Keine Einträge für diese Filter.</TableCell>
                        </TableRow>}
                    </TableBody>
                </Table>
            </div>

            <div className="flex items-center justify-between gap-2">
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); table.setPageSize(Number(e.target.value)); }}
                        className={"h-9 rounded-md border px-2 text-sm"}>
                    {[25, 50, 100, 250].map((n) => <option key={n} value={n}>{n} pro Seite</option>)}
                </select>
                <div className={"flex items-center gap-2"}>
                    <Button variant="outline" size="sm" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>Erste</Button>
                    <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Zurück</Button>
                    <span className={"text-sm text-gray-500"}>Seite {table.getState().pagination.pageIndex + 1} von {Math.max(table.getPageCount(), 1)}</span>
                    <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Weiter</Button>
                    <Button variant="outline" size="sm" onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>Letzte</Button>
                </div>
            </div>
        </CardContent>
    </Card>;
}

// Telemetry or reconnect loops can write the same message many times in a row; show it once with a counter
function collapseRepeatedEntries(rows: LogRow[]): (LogRow & { repeats?: number })[] {
    const result: (LogRow & { repeats?: number })[] = [];
    for (const row of rows) {
        const last = result[result.length - 1];
        if (last && last.description === row.description && last.errorType === row.errorType) {
            // keep the newest occurrence visible
            result[result.length - 1] = {...row, repeats: (last.repeats ?? 1) + 1};
        } else {
            result.push(row);
        }
    }
    return result;
}

function downloadCsv(rows: LogRow[]) {
    const level = (t: ErrorType) => LEVELS.find((l) => l.type === t)?.label ?? "Unbekannt";
    const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = ["Nr;Zeitpunkt;Stufe;Meldung", ...rows.map((r) =>
        [r.number, new Date(r.time).toLocaleString("de-DE"), level(r.errorType), escape(r.description)].join(";"))];
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], {type: "text/csv;charset=utf-8"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = `rv6l-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}
