"use client";
import {useContext, useEffect, useState} from "react";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Checkbox} from "@/components/ui/checkbox";
import {TelemetryValue} from "@/app/models/GameData";
import {WebsocketSendContext, WebsocketSubscribeContext} from "@/provider/WebsocketProvider";

const GROUP_ORDER = ["Störungen", "Steuerung", "Programm", "Bewegung", "Ein-/Ausgänge", "SPS-Rohwerte"];

export function RobotTelemetry(props: { telemetry?: { updatedAt: string | null, values: TelemetryValue[] }, connected: boolean, mock: boolean }) {
    const now = useNow();
    const values = props.telemetry?.values ?? [];
    const age = props.telemetry?.updatedAt ? Math.round((now - new Date(props.telemetry.updatedAt).getTime()) / 1000) : null;
    const active = values.filter((v) => v.available && v.alarm);
    const faults = active.filter((v) => v.severity === "fatal");
    const warnings = active.filter((v) => v.severity !== "fatal");

    let status = age === null ? "Noch keine Werte gelesen" : `Stand vor ${age} s`;
    if (props.mock) status = "Mock-Modus: keine echten Werte vom Roboter";
    else if (!props.connected) status = "Keine Verbindung zum RV6L, Werte veraltet";
    else if (age !== null && age > 5) status = `Werte veraltet (vor ${age} s)`;

    return <Card>
        <CardHeader>
            <CardTitle>Robotertelemetrie</CardTitle>
            <p className={"text-sm text-gray-500"}>{status}. Wird jede Sekunde von der Steuerung gelesen.</p>
            {faults.length > 0 && <div className={"mt-2 rounded-md bg-red-500 p-3 text-white"}>
                <p className={"font-bold"}>{faults.length === 1 ? "1 Störung" : `${faults.length} Störungen`}</p>
                <ul className={"list-disc pl-5"}>
                    {faults.map((a) => <li key={a.id}>{a.alarmText ?? a.label}</li>)}
                </ul>
            </div>}
            {warnings.length > 0 && <div className={"mt-2 rounded-md bg-yellow-100 p-3 text-yellow-900"}>
                <p className={"font-bold"}>{warnings.length === 1 ? "1 Warnung" : `${warnings.length} Warnungen`}</p>
                <ul className={"list-disc pl-5"}>
                    {warnings.map((a) => <li key={a.id}>{a.alarmText ?? a.label}</li>)}
                </ul>
            </div>}
        </CardHeader>
        <CardContent className={"grid grid-cols-1 gap-4 xl:grid-cols-2"}>
            {GROUP_ORDER.map((group) => {
                const items = values.filter((v) => v.group === group);
                if (items.length === 0) return null;
                return <Card key={group} className={"p-4 gap-3"}>
                    <CardTitle>{group}</CardTitle>
                    {group === "Bewegung" ? <MotionGroup items={items}/> :
                        <div className={"flex flex-col gap-1"}>
                            {items.map((item) => <TelemetryRow key={item.id} item={item}/>)}
                        </div>}
                </Card>;
            })}
        </CardContent>
    </Card>;
}

function TelemetryRow({item}: { item: TelemetryValue }) {
    return <div className={"flex flex-col gap-1 border-b border-gray-100 py-1 last:border-0"} title={item.note ?? item.symbol}>
        <div className={"flex items-center justify-between gap-3"}>
            <span className={"text-sm"}>{item.label}</span>
            <ValueDisplay item={item}/>
        </div>
        {item.kind === "bits" && item.available && <BitGrid value={Number(item.value)}/>}
        {item.note && <span className={"text-xs text-gray-400"}>{item.note}</span>}
    </div>;
}

function ValueDisplay({item}: { item: TelemetryValue }) {
    if (!item.available) return <span className={"text-xs text-gray-400"}>nicht verfügbar</span>;
    if (item.kind === "flag") {
        const color = item.alarm ? (item.severity === "fatal" ? "bg-red-500" : "bg-yellow-400") : item.value ? "bg-green-500" : "bg-gray-300";
        return <span className={"flex items-center gap-2 text-sm font-mono"}>
            <span className={`inline-block h-3 w-3 rounded-full ${color}`}/>{String(item.value)}
        </span>;
    }
    if (item.kind === "bits") return <span className={"text-sm font-mono"}>{String(item.value)}</span>;
    if (item.kind === "text") return <span className={"text-sm font-mono"}>{String(item.value) || "–"}</span>;
    const alarmColor = item.alarm ? (item.severity === "fatal" ? "text-red-600 font-bold" : "text-yellow-600 font-bold") : "";
    return <span className={`text-sm font-mono ${alarmColor}`}>{formatNumber(item.value)}{item.unit ? ` ${item.unit}` : ""}</span>;
}

// Bit 0 on the right like in the controller's documentation
function BitGrid({value}: { value: number }) {
    return <div className={"grid grid-cols-[repeat(32,minmax(0,1fr))] gap-px"}>
        {Array.from({length: 32}).map((_, i) => {
            const bit = 31 - i;
            const on = ((value >>> bit) & 1) === 1;
            return <span key={bit} title={`Bit ${bit}`}
                         className={`flex h-4 items-center justify-center text-[8px] ${on ? "bg-green-500 text-white" : "bg-gray-100 text-gray-400"}`}>
                {bit % 8 === 0 ? bit : ""}
            </span>;
        })}
    </div>;
}

function MotionGroup({items}: { items: TelemetryValue[] }) {
    const position = items.find((i) => i.kind === "position");
    const speeds = items.filter((i) => i.id.startsWith("speed_axis_"));
    const currents = items.filter((i) => i.id.startsWith("current_axis_"));
    const axes = [1, 2, 3, 4, 5, 6];

    return <div className={"flex flex-col gap-3"}>
        <div>
            <p className={"text-sm"}>Istposition (_PACTPOS)</p>
            {position?.available && position.position ?
                <div className={"grid grid-cols-3 gap-2 font-mono text-sm"}>
                    <span>X {formatNumber(position.position.x)}</span>
                    <span>Y {formatNumber(position.position.y)}</span>
                    <span>Z {formatNumber(position.position.z)}</span>
                </div> : <span className={"text-xs text-gray-400"}>nicht verfügbar</span>}
        </div>
        <table className={"w-full text-sm"}>
            <thead>
            <tr className={"text-left text-gray-500"}>
                <th className={"font-normal"}>Achse</th>
                <th className={"font-normal"}>Winkel</th>
                <th className={"font-normal"}>Geschwindigkeit</th>
                <th className={"font-normal"}>Motorstrom</th>
            </tr>
            </thead>
            <tbody className={"font-mono"}>
            {axes.map((axis) => <tr key={axis}>
                <td>A{axis}</td>
                <td>{position?.available && position.position ? formatNumber(position.position.axes[axis - 1]) : "–"}</td>
                <td>{cell(speeds[axis - 1])}</td>
                <td>{cell(currents[axis - 1])}</td>
            </tr>)}
            </tbody>
        </table>
    </div>;
}

const cell = (item?: TelemetryValue) => item?.available ? formatNumber(item.value) : "–";

function formatNumber(value: unknown) {
    const n = Number(value);
    if (value === null || value === undefined || Number.isNaN(n)) return String(value ?? "–");
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function useNow() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);
    return now;
}

const LIST_TYPES = [
    {value: "sysVar", label: "Systemvariablen"},
    {value: "var", label: "Anwendervariablen"},
    {value: "marker", label: "Merker"},
    {value: "input", label: "Eingänge"},
    {value: "output", label: "Ausgänge"},
    {value: "machineData", label: "Maschinendaten"},
];

/**
 * Read only view of any symbol on the controller, to find values that are not in the telemetry yet,
 * e.g. the current error message. It can never write anything.
 */
export function VariableExplorer() {
    const send = useContext(WebsocketSendContext);
    const subscribe = useContext(WebsocketSubscribeContext);
    const [listType, setListType] = useState("sysVar");
    const [symbols, setSymbols] = useState<string[]>([]);
    const [listError, setListError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState("");
    const [watched, setWatched] = useState<string[]>([]);
    const [results, setResults] = useState<Record<string, { value?: string, error?: string }>>({});
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [manualName, setManualName] = useState("");

    useEffect(() => subscribe?.((message) => {
        if (message.type === "symbolList") {
            setLoading(false);
            setListError((message.error as string) ?? null);
            setSymbols(((message.symbols as string[]) ?? []).sort());
        } else if (message.type === "symbolValues" && message.values) {
            setResults((r) => ({...r, ...(message.values as typeof results)}));
        }
    }), [subscribe]);

    useEffect(() => {
        if (watched.length === 0) return;
        const read = () => send?.(JSON.stringify({action: "read_symbols", names: watched}));
        read();
        if (!autoRefresh) return;
        const id = setInterval(read, 1000);
        return () => clearInterval(id);
    }, [watched, autoRefresh, send]);

    const addWatch = (name: string) => {
        const trimmed = name.trim();
        if (trimmed && !watched.includes(trimmed) && watched.length < 50) setWatched([...watched, trimmed]);
    };
    const filtered = symbols.filter((s) => s.toLowerCase().includes(filter.toLowerCase())).slice(0, 200);

    return <Card>
        <CardHeader>
            <CardTitle>Variablen-Explorer</CardTitle>
            <p className={"text-sm text-gray-500"}>Liest beliebige Werte der Steuerung, nur lesend. Nützlich, um Werte zu finden,
                die noch nicht in der Telemetrie stehen, zum Beispiel die aktuelle Fehlermeldung.</p>
        </CardHeader>
        <CardContent className={"grid grid-cols-1 gap-4 xl:grid-cols-2"}>
            <div className={"flex flex-col gap-2"}>
                <div className={"flex gap-2"}>
                    <select value={listType} onChange={(e) => setListType(e.target.value)}
                            className={"h-9 rounded-md border px-2 text-sm"}>
                        {LIST_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <Button className={"cursor-pointer"} disabled={loading} onClick={() => {
                        setLoading(true);
                        send?.(JSON.stringify({action: "list_symbols", listType}));
                    }}>{loading ? "Lädt..." : "Liste laden"}</Button>
                </div>
                <Input placeholder={"Filtern, z. B. ERR, FEHL, MELD"} value={filter} onChange={(e) => setFilter(e.target.value)}/>
                {listError && <p className={"text-sm text-red-500"}>{listError}</p>}
                <p className={"text-xs text-gray-400"}>{symbols.length} Symbole{symbols.length > 200 ? ", maximal 200 angezeigt" : ""}. Klick fügt zur Beobachtung hinzu.</p>
                <div className={"h-72 overflow-y-auto rounded-md border"}>
                    {filtered.map((s) => <button key={s} onClick={() => addWatch(s)}
                                                 className={"block w-full cursor-pointer px-2 py-0.5 text-left font-mono text-sm hover:bg-gray-100"}>{s}</button>)}
                </div>
            </div>
            <div className={"flex flex-col gap-2"}>
                <div className={"flex gap-2"}>
                    <Input placeholder={"Symbolname, z. B. _IUSER[1]"} value={manualName}
                           onChange={(e) => setManualName(e.target.value)}
                           onKeyDown={(e) => { if (e.key === "Enter") { addWatch(manualName); setManualName(""); } }}/>
                    <Button className={"cursor-pointer"} onClick={() => { addWatch(manualName); setManualName(""); }}>Beobachten</Button>
                </div>
                <label className={"flex items-center gap-2 text-sm"}>
                    <Checkbox checked={autoRefresh} onCheckedChange={(c) => setAutoRefresh(c === true)}/> jede Sekunde aktualisieren
                </label>
                <div className={"flex flex-col"}>
                    {watched.length === 0 && <p className={"text-sm text-gray-400"}>Noch keine Variablen beobachtet.</p>}
                    {watched.map((name) => <div key={name} className={"flex items-start justify-between gap-2 border-b py-1 text-sm"}>
                        <span className={"font-mono"}>{name}</span>
                        <span className={`max-w-[60%] whitespace-pre-wrap break-all text-right font-mono ${results[name]?.error ? "text-red-500" : ""}`}>
                            {results[name]?.error ?? results[name]?.value ?? "…"}
                        </span>
                        <button className={"cursor-pointer text-gray-400 hover:text-red-500"} title={"Entfernen"}
                                onClick={() => setWatched(watched.filter((w) => w !== name))}>×</button>
                    </div>)}
                </div>
            </div>
        </CardContent>
    </Card>;
}
