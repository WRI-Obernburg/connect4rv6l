"use client";
import {useMonitor} from "@/app/robot/monitor";

type InfoRow = { section: string, label: string, value: string };

const SECTION_LABELS: Record<string, string> = {Software: "Software", Hardware: "Hardware", Roboter: "Roboter"};

/** Robot name, project and the version tree of the controller, useful when talking to the Reis/KUKA service. */
export function SystemTab() {
    const info = useMonitor<{ rows: InfoRow[] }>("monitor_system", "monitor:system");
    const rows = info.data?.rows ?? [];
    const sections = [...new Set(rows.map((r) => r.section))];

    return <div className={"grid grid-cols-1 gap-3 p-3 lg:grid-cols-2"}>
        {info.error && <p className={"text-sm text-red-600"}>{info.error}</p>}
        {!info.data && !info.error && <p className={"text-sm text-gray-400"}>Lade Systeminformationen…</p>}
        {sections.map((section) => <div key={section} className={"rounded-md border bg-white"}>
            <h3 className={"border-b bg-gray-50 px-3 py-1.5 text-xs font-semibold tracking-wide text-gray-500 uppercase"}>
                {SECTION_LABELS[section] ?? section}
            </h3>
            <dl className={"grid grid-cols-[minmax(8rem,14rem)_1fr] gap-x-3 px-3 py-2 text-sm"}>
                {rows.filter((r) => r.section === section).map((r, i) => <div key={i} className={"contents"}>
                    <dt className={"py-0.5 text-gray-500"}>{r.label}</dt>
                    <dd className={"py-0.5 font-mono break-all"}>{r.value}</dd>
                </div>)}
            </dl>
        </div>)}
    </div>;
}
