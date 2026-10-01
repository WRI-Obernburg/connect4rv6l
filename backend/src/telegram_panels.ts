import { sendState, state } from "./state.ts";
import { moveToBlue, moveToColumn, moveToRed, putBackToBlue, putBackToRed, RV6L_STATE } from "./rv6l_client.ts";
import { GameManager, getPendingStop } from "./game/game_manager.ts";
import { adminQueue, moveInQueue, removeFromQueue, renewOffer } from "./players.ts";
import { placeChipForPlayer } from "./game_server.ts";
import { ErrorType, logEvent } from "./errorHandler/error_handler.ts";

/**
 * Control panels in Telegram: messages with inline buttons that the bot edits after every click.
 * - hand: grip a chip from a magazine and drop it into a column, or put it back
 * - game: the game master (stop, restart, play for the player, difficulty)
 * - queue: move, remove and renew the offer of the waiting players
 * Only approved contacts get here (checked by the bot).
 */

export type PanelKind = "hand" | "game" | "queue";
type Call = (method: string, body?: object) => Promise<any>;
type Panel = { text: string, buttons: { text: string, callback_data: string }[][] };

let call: Call;
export function initPanels(api: Call) {
    call = api;
}

const STATE_TEXT: Record<string, string> = {
    IDLE: "Bereit, wartet auf einen Spieler", PLAYER_SELECTION: "Der Spieler ist am Zug",
    GRAP_BLUE_CHIP: "Roboter holt den Chip des Spielers", PLACE_BLUE_CHIP: "Roboter setzt den Chip des Spielers",
    ROBOT_SELECTION: "Roboter überlegt seinen Zug", GRAP_RED_CHIP: "Roboter holt seinen Chip", PLACE_RED_CHIP: "Roboter setzt seinen Chip",
    PLAYER_WIN: "Der Spieler hat gewonnen", ROBOT_WIN: "Der Roboter hat gewonnen", TIE: "Unentschieden",
    CLEAN_UP: "Spielfeld wird geleert", ERROR: "Gesperrt", SLEEP: "Schläft", TEST: "Testbetrieb",
};
const RUNNING_STATES = ["PLAYER_SELECTION", "GRAP_BLUE_CHIP", "PLACE_BLUE_CHIP", "ROBOT_SELECTION", "GRAP_RED_CHIP", "PLACE_RED_CHIP"];
const RESULT_STATES = ["PLAYER_WIN", "ROBOT_WIN", "TIE"];
const DIFFICULTIES: [string, string][] = [["easy", "Leicht"], ["medium", "Mittel"], ["hard", "Schwer"]];
const COLOR = { 1: "🔵 blau", 2: "🔴 rot" } as const;

export async function openPanel(kind: PanelKind, chatId: number) {
    const panel = render(kind);
    await call("sendMessage", { chat_id: chatId, text: panel.text, parse_mode: "HTML", reply_markup: { inline_keyboard: panel.buttons } });
}

/** Handles a click on a panel button; returns the short notice Telegram shows to the one who clicked. */
export async function handleCallback(query: any, name: string): Promise<string> {
    const [kind, action, ...args] = String(query.data ?? "").split(":") as [PanelKind, string, ...string[]];
    const chatId = query.message.chat.id, messageId = query.message.message_id;
    const refresh = () => edit(chatId, messageId, kind);
    let notice = "";
    if (kind === "hand") notice = handAction(action, args, name, refresh);
    else if (kind === "game") notice = gameAction(action, args);
    else if (kind === "queue") notice = queueAction(action, args);
    await refresh();
    return notice;
}

async function edit(chatId: number, messageId: number, kind: PanelKind) {
    const panel = render(kind);
    await call("editMessageText", { chat_id: chatId, message_id: messageId, text: panel.text, parse_mode: "HTML", reply_markup: { inline_keyboard: panel.buttons } })
        .catch((error) => { if (!/not modified/i.test(String(error))) throw error; });
}

function render(kind: PanelKind): Panel {
    return kind === "hand" ? renderHand() : kind === "game" ? renderGame() : renderQueue();
}

const refreshRow = (kind: PanelKind) => [{ text: "🔄 Aktualisieren", callback_data: `${kind}:refresh` }];

// ---------------------------------------------------------------------------------------------
// Manual control. Only while the game is locked (ERROR) or asleep, so no game starts and grips meanwhile.

let held: { color: 1 | 2, by: string } | null = null;
let busy: string | null = null;
let lastResult = "";

function handBlocker() {
    const current = GameManager.currentGameState.stateName;
    if (!["ERROR", "SLEEP"].includes(current)) return `Steuern geht nur in ERROR oder SLEEP, aktuell ${current}. Vorher /error &lt;Grund&gt; oder /sleep.`;
    if (!RV6L_STATE.mock && !RV6L_STATE.rv6l_connected) return "Keine Verbindung zur Robotersteuerung.";
    return null;
}

function renderHand(): Panel {
    const blocker = handBlocker();
    const board = (state.board ?? {}) as Record<string, number[]>;
    const lines = [
        "🦾 <b>Manuelle Steuerung</b>",
        `Greifer: ${held ? `hält ${COLOR[held.color]} (${escape(held.by)})` : "leer"}`,
        busy ? `⏳ ${escape(busy)} …` : null,
        lastResult || null,
        blocker ? `\n⚠️ ${blocker}` : null,
        held && !busy && !blocker ? "\nSpalte wählen (1 = links, von innen gesehen):" : null,
    ];
    const buttons: Panel["buttons"] = [];
    if (!blocker && !busy) {
        if (!held) {
            buttons.push([{ text: "🔵 Blau greifen", callback_data: "hand:grip:1" }, { text: "🔴 Rot greifen", callback_data: "hand:grip:2" }]);
        } else {
            const columns = [0, 1, 2, 3, 4, 5, 6].filter((column) => (board[column]?.length ?? 0) < 6);
            buttons.push(columns.map((column) => ({ text: String(column + 1), callback_data: `hand:place:${column}` })));
            buttons.push([{ text: "↩️ Zurück ins Magazin", callback_data: "hand:back" }]);
        }
    }
    buttons.push(refreshRow("hand"));
    return { text: lines.filter((line) => line != null).join("\n"), buttons };
}

function handAction(action: string, args: string[], name: string, refresh: () => Promise<void>): string {
    if (action === "refresh") return "";
    const blocker = handBlocker();
    if (blocker) return blocker.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    if (busy || RV6L_STATE.rv6l_moving) return "Der Roboter arbeitet gerade.";

    if (action === "grip") {
        if (held) return "Es ist schon ein Chip im Greifer.";
        const color = args[0] === "2" ? 2 : 1;
        run(`${COLOR[color]} greifen`, name, color === 1 ? moveToBlue : moveToRed, () => { held = { color, by: name }; }, refresh);
        return "Greife …";
    }
    if (action === "place") {
        const column = Number(args[0]);
        if (!held) return "Kein Chip im Greifer.";
        if (!Number.isInteger(column) || column < 0 || column > 6) return "Ungültige Spalte.";
        const board = (state.board ?? {}) as Record<string, number[]>;
        if ((board[column]?.length ?? 0) >= 6) return "Die Spalte ist voll.";
        const color = held.color;
        run(`in Spalte ${column + 1} einwerfen`, name, () => moveToColumn(column), () => {
            held = null;
            // keep the digital board in step, so a later clean-up takes this chip back as well
            const current = (state.board ?? {}) as Record<string, number[]>;
            const columns = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((c) => [c, [...(current[c] ?? [])]]));
            columns[column]!.push(color);
            state.board = columns;
            GameManager.isPhysicalBoardCleaned = false;
            sendState();
        }, refresh);
        return "Werfe ein …";
    }
    if (action === "back") {
        if (!held) return "Kein Chip im Greifer.";
        const color = held.color;
        run(`${COLOR[color]} zurück ins Magazin`, name, color === 1 ? putBackToBlue : putBackToRed, () => { held = null; }, refresh);
        return "Lege zurück …";
    }
    return "";
}

// Runs one robot action in the background (it takes 10 to 20 s) and shows the result in the panel
function run(label: string, name: string, action: () => Promise<void>, onDone: () => void, refresh: () => Promise<void>) {
    busy = label;
    lastResult = "";
    logEvent({ errorType: ErrorType.INFO, description: `Telegram: ${name} – ${label.replace(/^\S+ /, "")}`, date: new Date().toString() });
    action().then(() => {
        onDone();
        lastResult = `✅ ${label}`;
    }).catch((error) => {
        // after a failed grip or drop nobody knows where the chip is: look at the robot
        held = null;
        lastResult = `❌ ${label} fehlgeschlagen: ${escape(String(error?.message ?? error))}\nGreifer und Spielfeld am Roboter prüfen.`;
    }).finally(() => {
        busy = null;
        refresh().catch((error) => console.error("Telegram panel update failed", String(error)));
    });
}

// ---------------------------------------------------------------------------------------------
// Game master, like the card on the control panel overview

function renderGame(): Panel {
    const current = GameManager.currentGameState.stateName;
    const queue = adminQueue();
    const pending = getPendingStop();
    const board = (state.board ?? {}) as Record<string, number[]>;
    const chips = Object.values(board).reduce((sum, column) => sum + column.length, 0);
    const difficulty = DIFFICULTIES.find(([key]) => key === state.difficulty)?.[1] ?? state.difficulty;
    const lines = [
        "🎮 <b>Spielleitung</b>",
        `Zustand: ${escape(STATE_TEXT[current] ?? current)}`,
        `Spieler: ${queue.active ? escape(queue.active.nickname) : "niemand"}`,
        `Chips im Feld: ${chips} · Schwierigkeit: ${difficulty}`,
        pending ? `⏳ Spiel wird nach der aktuellen Roboterbewegung ${pending.restart ? "neu gestartet" : "beendet"}` : null,
        current === "PLAYER_SELECTION" ? "\nZug für den Spieler setzen (1 = links, von innen gesehen):" : null,
    ];
    const buttons: Panel["buttons"] = [];
    if (current === "PLAYER_SELECTION") {
        const columns = [0, 1, 2, 3, 4, 5, 6].filter((column) => (board[column]?.length ?? 0) < 6);
        buttons.push(columns.map((column) => ({ text: String(column + 1), callback_data: `game:place:${column}` })));
    }
    if (RUNNING_STATES.includes(current) && !pending) {
        buttons.push([{ text: "⏹ Beenden", callback_data: "game:stop" }, { text: "🔁 Neu starten", callback_data: "game:restart" }]);
    } else if (RESULT_STATES.includes(current)) {
        buttons.push([{ text: "🔁 Neu starten", callback_data: "game:restart" }]);
    }
    if (pending) buttons.push([{ text: "↩️ Abbruch zurücknehmen", callback_data: "game:cancel" }]);
    buttons.push(DIFFICULTIES.map(([key, label]) => ({ text: `${key === state.difficulty ? "✓ " : ""}${label}`, callback_data: `game:difficulty:${key}` })));
    buttons.push(refreshRow("game"));
    return { text: lines.filter((line) => line != null).join("\n"), buttons };
}

function gameAction(action: string, args: string[]): string {
    if (action === "stop" || action === "restart") {
        const result = GameManager.requestStop(action === "restart");
        return { stopped: "Erledigt.", pending: "Wird nach der aktuellen Roboterbewegung ausgeführt.", not_running: "Es läuft kein Spiel." }[result];
    }
    if (action === "cancel") return GameManager.cancelStop() ? "Abbruch zurückgenommen." : "Nichts zurückzunehmen.";
    if (action === "place") {
        const slot = Number(args[0]);
        if (!Number.isInteger(slot) || slot < 0 || slot > 6) return "Ungültige Spalte.";
        return placeChipForPlayer(slot) ? `Zug in Spalte ${slot + 1} gesetzt.` : "Der Spieler ist gerade nicht am Zug.";
    }
    if (action === "difficulty") {
        const key = args[0] ?? "";
        if (!DIFFICULTIES.some(([k]) => k === key)) return "";
        state.difficulty = key;
        logEvent({ errorType: ErrorType.INFO, description: `Spielleitung (Telegram): Schwierigkeit ${key}`, date: new Date().toString() });
        sendState();
        return "Schwierigkeit geändert.";
    }
    return "";
}

// ---------------------------------------------------------------------------------------------
// Queue. Button data is limited to 64 bytes, so an entry is addressed by its position and the start of its id,
// and a click is refused if the queue changed meanwhile.

const idPart = (clientId: string) => clientId.slice(0, 12);

function renderQueue(): Panel {
    const { active, queue } = adminQueue();
    const lines = [
        "👥 <b>Warteschlange</b>",
        `Spielt gerade: ${active ? escape(active.nickname) : "niemand"}`,
        queue.length ? "" : "Niemand wartet.",
        ...queue.map((e) => `${e.position}. ${escape(e.nickname)}${e.offeredAt && e.position === 1 ? " · ist dran" : ""}${e.connected ? "" : " · getrennt"}`),
    ];
    const buttons: Panel["buttons"] = queue.map((e, i) => [
        { text: `⬆️ ${e.position}`, callback_data: `queue:move:${i}:${idPart(e.clientId)}:-1` },
        { text: `⬇️ ${e.position}`, callback_data: `queue:move:${i}:${idPart(e.clientId)}:1` },
        { text: `❌ ${e.nickname.slice(0, 12)}`, callback_data: `queue:remove:${i}:${idPart(e.clientId)}` },
    ]);
    if (queue[0]?.offeredAt) buttons.push([{ text: `⏱ Mehr Zeit für ${queue[0].nickname.slice(0, 16)}`, callback_data: "queue:renew" }]);
    buttons.push(refreshRow("queue"));
    return { text: lines.join("\n"), buttons };
}

function queueAction(action: string, args: string[]): string {
    if (action === "renew") {
        renewOffer();
        sendState();
        return "Volle Zeit erneut gegeben.";
    }
    if (action !== "move" && action !== "remove") return "";
    const entry = adminQueue().queue[Number(args[0])];
    if (!entry || idPart(entry.clientId) !== args[1]) return "Die Warteschlange hat sich geändert, bitte nochmal.";
    if (action === "remove") {
        removeFromQueue(entry.clientId);
        sendState();
        return `${entry.nickname} entfernt.`;
    }
    const moved = moveInQueue(entry.clientId, Number(args[2]));
    if (moved) sendState();
    return moved ? "Verschoben." : "Geht nicht weiter.";
}

function escape(text: string) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
