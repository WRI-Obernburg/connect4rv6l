"use client";
import {useEffect, useState} from "react";
import {ChevronDown, ChevronRight, RefreshCw} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Checkbox} from "@/components/ui/checkbox";
import {Input} from "@/components/ui/input";
import {formatDateTime, LogbookEntry, Tone, TONE_BADGE, useMonitor} from "@/app/robot/monitor";

const TYPE_TONE: Record<string, Tone> = {Meldung: "warn", Befehl: "info", Programm: "neutral", Betriebsart: "ok"};
const PAGE = 50;

/** The logbook of the controller: commands, program events, mode changes and messages, newest first. */
export function LogbookTab() {
    const [live, setLive] = useState(true);
    const [older, setOlder] = useState<LogbookEntry[]>([]);
    const [types, setTypes] = useState<string[]>([]);
    const [search, setSearch] = useState("");
    const [collapse, setCollapse] = useState(true);
    const newest = useMonitor<{ size: number, entries: LogbookEntry[] }>("monitor_logbook", "monitor:logbook", {count: PAGE}, live ? 5000 : undefined);
    const olderPage = useMonitor<{ size: number, entries: LogbookEntry[], before?: number }>("monitor_logbook", "monitor:logbook_older", {}, undefined, true);

    useEffect(() => {
        if (olderPage.data?.entries) setOlder((o) => [...o, ...olderPage.data!.entries.filter((e) => !o.some((x) => x.index === e.index))]);
    }, [olderPage.data]);

    const entries = [...(newest.data?.entries ?? []), ...older.filter((e) => !newest.data?.entries.some((n) => n.index === e.index))];
    const allTypes = [...new Set(entries.map((e) => e.type))];
    const needle = search.trim().toLowerCase();
    const filtered = entries.filter((e) => (types.length === 0 || types.includes(e.type))
        && (!needle || [e.key, e.text, ...e.parameters, ...e.related.flatMap((r) => [r.key, r.text, ...r.parameters])].join(" ").toLowerCase().includes(needle)));
    const visible = collapse ? collapseRepeats(filtered) : filtered.map((entry) => ({entry, repeats: 1}));
    const oldestIndex = entries.length ? Math.min(...entries.map((e) => e.index)) : undefined;

    return <div className={"flex flex-col"}>
        <div className={"flex flex-wrap items-center gap-2 border-b bg-white px-3 py-2"}>
            {allTypes.map((type) => <button key={type} onClick={() => setTypes(types.includes(type) ? types.filter((t) => t !== type) : [...types, type])}
                                            className={`cursor-pointer rounded px-2 py-1 text-sm ${types.length === 0 || types.includes(type) ? TONE_BADGE[TYPE_TONE[type] ?? "neutral"] : "bg-gray-50 text-gray-300 line-through"}`}>
                {type}
            </button>)}
            <label className={"ml-2 flex items-center gap-2 text-sm"}>
                <Checkbox checked={live} onCheckedChange={(c) => setLive(c === true)}/> alle 5 s aktualisieren
            </label>
            <label className={"flex items-center gap-2 text-sm"}>
                <Checkbox checked={collapse} onCheckedChange={(c) => setCollapse(c === true)}/> Wiederholungen zusammenfassen
            </label>
            <Input className={"ml-auto w-64"} placeholder={"Logbuch durchsuchen"} value={search} onChange={(e) => setSearch(e.target.value)}/>
            <Button variant={"outline"} size={"sm"} className={"cursor-pointer"} onClick={() => newest.refresh()}><RefreshCw className={"size-4"}/></Button>
        </div>
        <p className={"px-3 py-1 text-xs text-gray-400"}>
            {newest.data ? `${filtered.length} von ${entries.length} geladenen Einträgen, insgesamt ${newest.data.size.toLocaleString("de-DE")} im Logbuch` : "Lade Logbuch…"}
        </p>
        {newest.error && <p className={"px-3 text-sm text-red-600"}>{newest.error}</p>}
        <ul>{visible.map(({entry, repeats}) => <LogbookRow key={entry.index} entry={entry} repeats={repeats}/>)}</ul>
        {oldestIndex !== undefined && oldestIndex > 0 && <div className={"p-3"}>
            <Button variant={"outline"} className={"cursor-pointer"} disabled={olderPage.loading && older.length > 0}
                    onClick={() => olderPage.refresh({count: PAGE, before: oldestIndex, replyAs: "monitor:logbook_older"})}>
                Ältere Einträge laden
            </Button>
        </div>}
    </div>;
}

// Jogging at the pendant writes a pair of entries per key press; runs of the same entries become one row
function collapseRepeats(entries: LogbookEntry[]) {
    const signature = (e: LogbookEntry) => `${e.type}|${e.key}|${e.parameters.join(",")}`;
    const result: { entry: LogbookEntry, repeats: number }[] = [];
    for (let i = 0; i < entries.length; i++) {
        const last = result[result.length - 1];
        // also treat alternating pairs like LGB_COMMAND15/16 as one run
        const pairStart = result.length >= 2 ? result[result.length - 2] : undefined;
        if (last && signature(last.entry) === signature(entries[i])) last.repeats++;
        else if (pairStart && last && signature(pairStart.entry) === signature(entries[i]) && last.repeats === pairStart.repeats) {
            pairStart.repeats++;
            if (i + 1 < entries.length && signature(entries[i + 1]) === signature(last.entry)) { last.repeats++; i++; }
        } else result.push({entry: entries[i], repeats: 1});
    }
    return result;
}

function LogbookRow({entry, repeats}: { entry: LogbookEntry, repeats: number }) {
    const [open, setOpen] = useState(false);
    const tone = entry.level && /err/i.test(entry.level) ? "error" : TYPE_TONE[entry.type] ?? "neutral";
    return <li className={"border-b border-gray-100 px-3 py-2 text-sm even:bg-gray-50/50"}>
        <div className={"grid grid-cols-[1.25rem_9.5rem_6.5rem_minmax(0,1fr)] items-start gap-x-3"}>
            <button className={"cursor-pointer pt-0.5 text-gray-400"} onClick={() => setOpen(!open)} disabled={entry.related.length === 0}
                    title={entry.related.length ? "Zugehörige Einträge anzeigen" : undefined}>
                {entry.related.length ? (open ? <ChevronDown className={"size-4"}/> : <ChevronRight className={"size-4"}/>) : null}
            </button>
            <span className={"font-mono text-xs text-gray-500"}>{formatDateTime(entry.date)}</span>
            <span><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${TONE_BADGE[tone]}`}>{entry.type}</span></span>
            <span className={"min-w-0"}>
                {entry.text ? <><b>S{entry.number}</b> {entry.text}</> : <span className={"font-mono text-xs"}>{entry.key}</span>}
                {entry.parameters.length > 0 && <span className={"ml-2 text-xs text-gray-500"}>{entry.parameters.join(" · ")}</span>}
                {repeats > 1 && <span className={"ml-2 rounded bg-gray-100 px-1.5 text-xs text-gray-500"}>{repeats}× wiederholt</span>}
            </span>
        </div>
        {open && <ul className={"mt-1 ml-[1.25rem] border-l pl-3"}>
            {entry.related.map((r, i) => <li key={i} className={"text-xs text-gray-600"}>
                <span className={`mr-2 rounded px-1 ${TONE_BADGE[TYPE_TONE[r.type] ?? "neutral"]}`}>{r.type}</span>
                {r.text ?? <span className={"font-mono"}>{r.key}</span>}
                {r.parameters.length > 0 && <span className={"ml-2 text-gray-500"}>{r.parameters.join(" · ")}</span>}
            </li>)}
        </ul>}
    </li>;
}
