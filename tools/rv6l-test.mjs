#!/usr/bin/env node
// On-site test tool for the RV6L: verifies the PLC flag mapping and whether the program can be
// stopped via the XML interface. Every writing step needs its own confirmation.
// Procedure and safety requirements: see README.md in this folder.
//
// Usage: node rv6l-test.mjs   (ROBOT_HOST/ROBOT_PORT as for read-robot-programs.mjs)
// Commands: watch | stoptest | start | clearstop | quit

import fs from "node:fs";
import readline from "node:readline/promises";
import { connect } from "./rsvcmd.mjs";

// _IPLC[n] holds the flags M(4(n-1)) .. M(4(n-1)+3), lowest byte first (derived from the docs, to be verified here)
const flagIndex = (byte, bit) => ({ symbol: `_IPLC[${Math.floor(byte / 4) + 1}]`, bit: (byte % 4) * 8 + bit });

const WATCHED_FLAGS = [
    ["M935.6 program running (interpreter active)", flagIndex(935, 6)],
    ["M968.1 START request", flagIndex(968, 1)],
    ["M968.2 STOP request", flagIndex(968, 2)],
    ["M970.2 collision detection active", flagIndex(970, 2)],
    ["M970.3 collision detected", flagIndex(970, 3)],
];
const WATCHED_SYMBOLS = ["I_Aktion", ...new Set(WATCHED_FLAGS.map(([, f]) => f.symbol))];
const STOP = flagIndex(968, 2);
const START = flagIndex(968, 1);

const logFile = `rv6l-test-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
function log(line) {
    const entry = `${new Date().toISOString()} ${line}`;
    console.log(line);
    fs.appendFileSync(logFile, entry + "\n");
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const confirm = async (question) => (await rl.question(`${question} Zum Bestätigen "JA" tippen: `)).trim() === "JA";

const robot = await connect();
await robot.initSymbolTable();
log(`Verbunden, Log: ${logFile}`);

async function snapshot() {
    const values = {};
    for (const s of WATCHED_SYMBOLS) values[s] = await robot.read(s);
    return values;
}

function describe(values) {
    const lines = [`I_Aktion = ${values.I_Aktion}`];
    for (const s of WATCHED_SYMBOLS.filter((s) => s.startsWith("_IPLC"))) {
        const v = Number(values[s]) >>> 0;
        lines.push(`${s} = ${v} (0b${v.toString(2).padStart(32, "0")})`);
    }
    for (const [name, f] of WATCHED_FLAGS) {
        lines.push(`  ${(Number(values[f.symbol]) >>> f.bit) & 1}  ${name}  [${f.symbol} Bit ${f.bit}]`);
    }
    return lines.join("\n");
}

// Prints the watched values whenever something changes, until Enter is pressed
async function watch(durationMs) {
    let last = "";
    let running = true;
    const stopper = durationMs ? null : rl.question("(Enter beendet die Anzeige)\n").then(() => (running = false));
    const until = durationMs ? Date.now() + durationMs : Infinity;
    while (running && Date.now() < until) {
        const text = describe(await snapshot());
        if (text !== last) {
            log(`--- ${new Date().toLocaleTimeString()}\n${text}`);
            last = text;
        }
        await new Promise((r) => setTimeout(r, 300));
    }
    if (stopper) await stopper;
}

async function stopTest() {
    console.log(`
Stopptest: Der Roboter fährt in die Referenzposition (I_Aktion = 90), und während der Fahrt
wird der Programmstopp über ${STOP.symbol} OR ${1 << STOP.bit} gesendet.
Voraussetzungen:
  - Betriebsart AUTO (in T1/T2 reagiert die Steuerung nicht auf Fernbefehle)
  - Override niedrig (z. B. 10 %), niemand im Gefahrenbereich
  - eine Person hat die Hand am NOT-HALT
  - Backend gestoppt (docker compose stop connect4), Roboterprogramm läuft
`);
    if (!(await confirm("Sind alle Voraussetzungen erfüllt?"))) return log("Stopptest abgebrochen");

    const before = await snapshot();
    log("Zustand vorher:\n" + describe(before));
    if (String(before.I_Aktion) !== "0") return log("Abbruch: I_Aktion ist nicht 0, der Roboter ist nicht bereit");

    if (!(await confirm("I_Aktion = 90 schreiben, der Roboter fährt in die Referenzposition?"))) return log("Stopptest abgebrochen");
    await robot.write("I_Aktion", "90");
    log("I_Aktion = 90 geschrieben");

    await rl.question("Enter drücken, sobald der Roboter fährt, dann wird sofort der Stopp gesendet: ");
    const t = Date.now();
    await robot.bitsetOr(STOP.symbol, 1 << STOP.bit);
    log(`Stopp gesendet (${STOP.symbol} OR ${1 << STOP.bit}), Antwort nach ${Date.now() - t} ms`);

    log("Verlauf der nächsten 5 Sekunden:");
    await watch(5000);

    const stopped = await rl.question("Hat der Roboter angehalten? (j/n): ");
    log(`Beobachtung: Roboter angehalten = ${stopped.trim()}`);
    const after = await snapshot();
    const stopStillSet = ((Number(after[STOP.symbol]) >>> STOP.bit) & 1) === 1;
    log(`STOP-Bit danach ${stopStillSet ? "noch gesetzt, fällt nicht von selbst zurück" : "wieder 0, fällt von selbst zurück"}`);
    console.log("Fortsetzen am besten am Bedienpanel. Alternativ: Befehl 'start' (und bei gesetztem STOP-Bit vorher 'clearstop').");
}

async function setFlag(label, flag, on) {
    if (!(await confirm(`${label}: ${flag.symbol} ${on ? "OR" : "AND NOT"} ${1 << flag.bit} senden?`))) return;
    if (on) await robot.bitsetOr(flag.symbol, 1 << flag.bit);
    else await robot.bitsetAnd(flag.symbol, ~(1 << flag.bit)); // clears only this bit
    log(`${label} gesendet`);
    await watch(3000);
}

try {
    for (;;) {
        const cmd = (await rl.question("\nBefehl (watch | stoptest | start | clearstop | quit): ")).trim();
        if (cmd === "watch") await watch();
        else if (cmd === "stoptest") await stopTest();
        else if (cmd === "start") await setFlag("Programmstart", START, true);
        else if (cmd === "clearstop") await setFlag("STOP-Bit löschen", STOP, false);
        else if (cmd === "quit") break;
    }
} catch (err) {
    log(`Fehler: ${err.message}`);
    process.exitCode = 1;
}
robot.close();
rl.close();
