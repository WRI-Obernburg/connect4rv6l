"use client";
import {
    AlertTriangle, BookOpen, Box, Cable, CircleCheck, Crosshair, Gauge, Hand, Layers, type LucideIcon, Play, Power,
    Search, Settings2, ShieldAlert, Star, Timer, Workflow, Zap,
} from "lucide-react";
import {useMemo, useState} from "react";
import {GameData, TelemetryValue} from "@/app/models/GameData";
import {TaskState, Tone, TONE_BADGE, TONE_ICON, useStoredState} from "@/app/robot/monitor";
import {Input} from "@/components/ui/input";

type Group = "verbindung" | "roboter" | "tasks" | "spiel" | "stoerungen";

const GROUPS: { id: Group, label: string, icon: LucideIcon }[] = [
    {id: "stoerungen", label: "Störungen und Prüfungen", icon: ShieldAlert},
    {id: "roboter", label: "Roboter", icon: Power},
    {id: "tasks", label: "Tasks der Steuerung", icon: Workflow},
    {id: "spiel", label: "Spiel", icon: Box},
    {id: "verbindung", label: "Verbindung", icon: Cable},
];

type Item = { id: string, group: Group, icon: LucideIcon, label: string, value: string, tone: Tone, detail?: string };
type Filter = "all" | "favorites" | "problems";

const DEFAULT_FAVORITES = ["roboter.drives_state", "roboter.run_mode", "roboter.game_program", "tasks.Interpreter", "spiel.readiness"];

function telemetryItem(group: Group, v: TelemetryValue, icon: LucideIcon): Item {
    let tone: Tone = "neutral";
    if (!v.available) tone = "neutral";
    else if (v.alarm) tone = v.severity === "fatal" ? "error" : "warn";
    else if (v.okText !== undefined || v.severity) tone = "ok";
    const value = !v.available ? "nicht verfügbar" : v.alarm ? (v.alarmText ?? String(v.value)) : v.okText ?? `${v.value ?? "–"}${v.unit ? ` ${v.unit}` : ""}`;
    return {id: `${group}.${v.id}`, group, icon, label: v.label, value, tone, detail: v.alarm ? v.note : undefined};
}

function buildItems(game: GameData, tasks: TaskState[] | undefined, coincidence: string | undefined): Item[] {
    const items: Item[] = [];
    const values = game.rv6l.telemetry?.values ?? [];
    const byId = (id: string) => values.find((v) => v.id === id);
    const add = (item: Item) => items.push(item);

    // Störungen: every check with a clear ok / problem state
    for (const v of values.filter((v) => v.group === "Störungen")) add(telemetryItem("stoerungen", v, AlertTriangle));
    for (const m of game.rv6l.telemetry?.messages ?? []) {
        add({
            id: `stoerungen.message_${m.source}`, group: "stoerungen", icon: AlertTriangle,
            label: m.source === "displayed" ? "Meldung am Bedienpanel" : "Aktiver Fehler",
            value: `S${m.number}${m.reference ? `: ${m.reference.message}` : ""}`,
            tone: m.level === "Error" ? "error" : "warn",
            detail: m.reference?.remedy ? `Abhilfe: ${m.reference.remedy}` : undefined,
        });
    }
    const open = game.faultMemory?.open ?? [];
    add({
        id: "stoerungen.fault_memory", group: "stoerungen", icon: ShieldAlert, label: "Fehlerspeicher",
        value: open.length ? `${open.length} offen${open.some((f) => f.critical) ? ", davon kritisch: " + open.filter((f) => f.critical).length : ""}` : "leer",
        tone: open.some((f) => f.critical) ? "error" : open.length ? "warn" : "ok",
    });

    // Roboter
    const icons: Record<string, LucideIcon> = {drives_state: Zap, run_mode: Settings2, game_program: Play, override_zero: Gauge};
    for (const v of values.filter((v) => v.group === "Steuerung")) add(telemetryItem("roboter", v, icons[v.id] ?? Settings2));
    add({
        id: "roboter.coincidence", group: "roboter", icon: Crosshair, label: "Roboter referenziert",
        value: coincidence === undefined ? "…" : coincidence === "coincident" ? "ja" : coincidence,
        tone: coincidence === undefined ? "neutral" : coincidence === "coincident" ? "ok" : "warn",
    });
    const vacuum = byId("vacuum");
    if (vacuum) add({...telemetryItem("roboter", vacuum, Hand), value: vacuum.available ? (vacuum.value ? "an" : "aus") : "nicht verfügbar", tone: "neutral"});

    // Tasks
    for (const t of tasks ?? [{name: "Interpreter"}, {name: "Executor"}, {name: "ParallelExecutor"}, {name: "StatusExecutor"}] as TaskState[]) {
        const base = {id: `tasks.${t.name}`, group: "tasks" as Group, icon: t.name === "Interpreter" ? Play : Workflow, label: t.name.replace(/([a-z])([A-Z])/g, "$1 $2")};
        if (!tasks) add({...base, value: "…", tone: "neutral"});
        else if (t.error) add({...base, value: "nicht verfügbar", tone: "error", detail: t.error});
        else {
            const state = t.state ?? "?";
            add({
                ...base,
                value: [state, t.filename?.split("/").pop(), t.step ? `Schritt ${t.step}` : undefined].filter(Boolean).join(" · "),
                tone: /^(active|running)$/i.test(state) ? "ok" : /err|fault/i.test(state) ? "error" : /stop|halt|break/i.test(state) ? "warn" : "neutral",
            });
        }
    }

    // Spiel
    add({id: "spiel.state", group: "spiel", icon: Workflow, label: "Spielzustand", value: game.gameState.stateName, tone: game.gameState.stateName === "ERROR" ? "error" : "neutral"});
    const reasons = game.faultMemory?.lockReasons ?? [];
    add({
        id: "spiel.readiness", group: "spiel", icon: Play, label: "Spiel",
        value: reasons.length ? "gesperrt" : "freigegeben", tone: reasons.length ? "error" : "ok",
        detail: reasons.length ? `Offene kritische Fehler: ${reasons.join(", ")}` : undefined,
    });
    add({
        id: "spiel.rv6l_action", group: "spiel", icon: Timer, label: "Aktion des Backends",
        value: game.rv6l.moving ? `${game.rv6l.state} läuft` : "keine", tone: game.rv6l.moving ? "info" : "neutral",
    });
    for (const id of ["action", "pallet_blue", "pallet_red"]) {
        const v = byId(id);
        if (v) add(telemetryItem("spiel", v, Layers));
    }

    // Verbindung
    add({
        id: "verbindung.rv6l", group: "verbindung", icon: Cable, label: "Robotersteuerung",
        value: game.rv6l.mock ? "Mock-Modus" : game.rv6l.connected ? "verbunden" : "keine Verbindung",
        tone: game.rv6l.mock ? "warn" : game.rv6l.connected ? "ok" : "error",
    });
    const updatedAt = game.rv6l.telemetry?.updatedAt;
    const age = updatedAt ? Math.round((Date.now() - new Date(updatedAt).getTime()) / 1000) : null;
    add({
        id: "verbindung.telemetry", group: "verbindung", icon: BookOpen, label: "Telemetrie",
        value: age === null ? "noch keine Werte" : `Stand vor ${age} s`, tone: age === null ? "neutral" : age > 5 ? "warn" : "ok",
    });
    return items;
}

export function StatusTab(props: { game: GameData, tasks?: TaskState[], coincidence?: string }) {
    const [filter, setFilter] = useStoredState<Filter>("robot.status.filter", "all");
    const [favorites, setFavorites] = useStoredState<string[]>("robot.status.favorites", DEFAULT_FAVORITES);
    const [search, setSearch] = useState("");

    const items = useMemo(() => buildItems(props.game, props.tasks, props.coincidence), [props.game, props.tasks, props.coincidence]);
    const needle = search.trim().toLowerCase();
    const visible = items.filter((i) =>
        (filter === "all" || (filter === "favorites" ? favorites.includes(i.id) : i.tone === "warn" || i.tone === "error"))
        && (!needle || i.label.toLowerCase().includes(needle) || i.value.toLowerCase().includes(needle)));
    const count = (tone: Tone) => items.filter((i) => i.tone === tone).length;
    const problems = count("warn") + count("error");
    const toggleFavorite = (id: string) => setFavorites((f) => f.includes(id) ? f.filter((x) => x !== id) : [...f, id]);

    return <div className={"flex flex-col"}>
        <div className={"flex flex-wrap items-center gap-2 border-b bg-white px-3 py-2"}>
            {([["ok", "OK", CircleCheck], ["warn", "Warnungen", AlertTriangle], ["error", "Fehler", AlertTriangle]] as [Tone, string, LucideIcon][])
                .map(([tone, label, Icon]) => <span key={tone}
                                                    className={`inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-medium ${count(tone) ? TONE_BADGE[tone] : TONE_BADGE.neutral}`}>
                    <Icon className={"size-4"}/><span className={"tabular-nums"}>{count(tone)}</span> {label}
                </span>)}
            <div className={"ml-2 flex overflow-hidden rounded-md border"}>
                {([["all", "Alle"], ["favorites", "Favoriten"], ["problems", `Probleme${problems ? ` (${problems})` : ""}`]] as [Filter, string][])
                    .map(([f, label]) => <button key={f} onClick={() => setFilter(f)}
                                                 className={`cursor-pointer px-3 py-1 text-sm ${filter === f ? "bg-gray-900 text-white" : "bg-white hover:bg-gray-50"}`}>{label}</button>)}
            </div>
            <div className={"relative ml-auto w-full sm:w-64"}>
                <Search className={"absolute top-2.5 left-2 size-4 text-gray-400"}/>
                <Input className={"pl-8"} placeholder={"Einträge filtern"} value={search} onChange={(e) => setSearch(e.target.value)}/>
            </div>
        </div>

        {visible.length === 0 && <p className={"p-6 text-center text-sm text-gray-400"}>
            {filter === "favorites" ? "Noch keine Favoriten. Mit dem Stern Einträge anheften." : filter === "problems" ? "Nichts braucht Aufmerksamkeit." : "Keine passenden Einträge."}
        </p>}

        {GROUPS.filter((g) => visible.some((i) => i.group === g.id)).map((g) => <section key={g.id}>
            <h2 className={"sticky top-0 z-10 flex items-center gap-2 border-b bg-gray-50 px-3 py-1.5 text-xs font-semibold tracking-wide text-gray-500 uppercase"}>
                <g.icon className={"size-4"}/>{g.label}
            </h2>
            <ul>
                {visible.filter((i) => i.group === g.id).map((item) =>
                    <li key={item.id} className={"grid grid-cols-[2.5rem_minmax(10rem,18rem)_minmax(0,1fr)_2.5rem] items-center gap-x-3 border-b border-gray-100 px-3 py-2 even:bg-gray-50/50"}>
                        <span className={`flex size-9 items-center justify-center rounded-md bg-gray-100 ${TONE_ICON[item.tone]}`}>
                            <item.icon className={"size-5"}/>
                        </span>
                        <span className={"truncate text-sm font-medium"}>{item.label}</span>
                        <span className={"min-w-0"}>
                            <span className={`inline-block max-w-full truncate rounded px-1.5 py-0.5 font-mono text-xs font-medium ${TONE_BADGE[item.tone]}`}
                                  title={item.value}>{item.value}</span>
                        </span>
                        <button onClick={() => toggleFavorite(item.id)} title={favorites.includes(item.id) ? "Aus Favoriten entfernen" : "Zu Favoriten"}
                                className={"flex size-9 cursor-pointer items-center justify-center rounded-md text-gray-400 hover:bg-gray-100"}>
                            <Star className={`size-5 ${favorites.includes(item.id) ? "fill-orange-400 text-orange-400" : ""}`}/>
                        </button>
                        {item.detail && <p className={"col-start-2 col-end-5 mt-1 text-xs break-words text-gray-500"}>{item.detail}</p>}
                    </li>)}
            </ul>
        </section>)}
    </div>;
}
