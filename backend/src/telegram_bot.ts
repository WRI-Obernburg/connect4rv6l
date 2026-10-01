import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { createManualFault, faultEvents, getFaultMemory, type FaultEntry } from "./fault_memory.ts";
import { sendState, state } from "./state.ts";
import { RV6L_STATE } from "./rv6l_client.ts";
import { GameManager, gameStates } from "./game/game_manager.ts";
import { publicQueue } from "./players.ts";
import { ErrorType, logEvent } from "./errorHandler/error_handler.ts";
import { handleCallback, initPanels, openPanel } from "./telegram_panels.ts";

/**
 * Telegram bot for the RV6L. Every approved contact
 * - gets a push for every critical fault and an all-clear once the game is free again,
 * - has a status message pinned at the top of the chat that the bot keeps up to date,
 * - can use /status, /sleep and /wake (also as buttons) and lock the game with /error <message>,
 * - can steer the robot by hand, act as game master and manage the queue (/hand, /spiel, /warteschlange).
 * It polls the Bot API (long polling), so it needs no open port or webhook on the Pi.
 *
 * Whoever writes /start is only a request: the contact gets nothing until it is approved in the control panel,
 * so not everyone who finds the bot receives the faults of the robot or can control it.
 *
 * TELEGRAM_BOT_TOKEN   token from @BotFather; without it the bot is off
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// TELEGRAM_API_URL only to test against a local stand-in of the Bot API
const API = `${process.env.TELEGRAM_API_URL || "https://api.telegram.org"}/bot${TOKEN}`;
const FILE = process.env.TELEGRAM_SUBSCRIBERS_FILE || "logs/telegram_subscribers.json";
// the same fault (e.g. a flapping connection) is pushed at most once in this time
const REPEAT_AFTER_MS = 15 * 60 * 1000;
const POLL_TIMEOUT_S = 50;
// how often the pinned status is compared with the current one; Telegram allows about one edit per second per chat
const STATUS_CHECK_MS = 3000;

export type TelegramContact = {
    chatId: number,
    name: string,
    requestedAt: string,
    // not set while the contact waits for approval
    approvedAt?: string,
    // the pinned message that shows the live status
    statusMessageId?: number,
};

let contacts: TelegramContact[] = [];
let connected = false;
let shownStatus = "";
const lastSent = new Map<string, number>();

const isApproved = (chatId: number) => contacts.some((c) => c.chatId === chatId && c.approvedAt);

// buttons below the input field, so the common commands need no typing
const BUTTONS = { status: "📊 Status", sleep: "😴 Schlafen", wake: "☀️ Aufwecken", hand: "🦾 Steuerung", game: "🎮 Spielleitung", queue: "👥 Warteschlange" };
const KEYBOARD = {
    keyboard: [[{ text: BUTTONS.status }, { text: BUTTONS.game }, { text: BUTTONS.queue }], [{ text: BUTTONS.sleep }, { text: BUTTONS.wake }, { text: BUTTONS.hand }]],
    resize_keyboard: true,
    is_persistent: true,
};
const COMMANDS = [
    { command: "status", description: "Aktueller Zustand" },
    { command: "sleep", description: "Roboter schlafen legen (nur aus IDLE)" },
    { command: "wake", description: "Roboter aufwecken" },
    { command: "error", description: "Spiel sofort sperren: /error <Meldung>" },
    { command: "spiel", description: "Spielleitung: beenden, neu starten, Zug setzen" },
    { command: "warteschlange", description: "Warteschlange verwalten" },
    { command: "hand", description: "Roboter von Hand steuern (nur in ERROR oder SLEEP)" },
    { command: "stop", description: "Abmelden" },
];
const HELP = "/status – aktueller Zustand\n/sleep – Roboter schlafen legen (nur aus IDLE)\n/wake – Roboter aufwecken\n/error &lt;Meldung&gt; – Spiel sofort sperren\n/spiel – Spielleitung\n/warteschlange – Warteschlange verwalten\n/hand – Roboter von Hand steuern (nur in ERROR oder SLEEP)\n/stop – abmelden";

/** For the control panel: whether the bot runs and who is approved or waits for approval. */
export function getTelegramState() {
    return { enabled: !!TOKEN, connected, contacts };
}

export function initTelegramBot() {
    if (!TOKEN) {
        console.log("Telegram bot off: TELEGRAM_BOT_TOKEN is not set");
        return;
    }
    try {
        contacts = JSON.parse(readFileSync(FILE, "utf8"));
    } catch {
        contacts = [];
    }
    faultEvents.on("critical", (entry: FaultEntry) => {
        const last = lastSent.get(entry.key) ?? 0;
        if (Date.now() - last < REPEAT_AFTER_MS) return;
        lastSent.set(entry.key, Date.now());
        broadcast(faultMessage(entry));
    });
    faultEvents.on("unlocked", () => {
        broadcast("✅ <b>RV6L wieder freigegeben</b>\nKeine offenen kritischen Fehler mehr, das Spiel ist wieder spielbar.");
    });
    // tells the control panel right away whether the token works, the first long poll may take 50 s
    call("getMe").then(() => setConnected(true)).catch((error) => console.error("Telegram getMe failed", String(error)));
    call("setMyCommands", { commands: COMMANDS }).catch((error) => console.error("Telegram setMyCommands failed", String(error)));
    initPanels(call);
    setInterval(() => updatePinnedStatus().catch((error) => console.error("Telegram status update failed", String(error))), STATUS_CHECK_MS);
    poll();
}

export async function approveContact(chatId: number) {
    const contact = contacts.find((c) => c.chatId === chatId);
    if (!contact || contact.approvedAt) return;
    contact.approvedAt = new Date().toISOString();
    changed();
    logEvent({ errorType: ErrorType.INFO, description: `Telegram: ${contact.name} freigegeben`, date: new Date().toString() });
    await send(chatId, `✅ Du bist freigegeben. Ab jetzt bekommst du eine Nachricht, sobald am RV6L ein kritischer Fehler auftritt. Oben im Chat ist der aktuelle Status angepinnt.\n\n${HELP}`, KEYBOARD).catch(() => {});
    await pinStatus(contact).catch((error) => console.error(`Telegram pin for ${contact.name} failed`, String(error)));
}

export async function removeContact(chatId: number) {
    const contact = contacts.find((c) => c.chatId === chatId);
    if (!contact) return;
    contacts = contacts.filter((c) => c !== contact);
    changed();
    logEvent({ errorType: ErrorType.INFO, description: `Telegram: ${contact.name} entfernt`, date: new Date().toString() });
    await send(chatId, contact.approvedAt
        ? "Du wurdest von den RV6L-Benachrichtigungen abgemeldet."
        : "Deine Anfrage für RV6L-Benachrichtigungen wurde abgelehnt.", { remove_keyboard: true }).catch(() => {});
}

async function poll() {
    let offset = 0;
    while (true) {
        try {
            const updates = await call("getUpdates", { offset, timeout: POLL_TIMEOUT_S, allowed_updates: ["message", "callback_query"] }, (POLL_TIMEOUT_S + 10) * 1000);
            setConnected(true);
            for (const update of updates) {
                offset = update.update_id + 1;
                if (update.message?.text) await handleMessage(update.message).catch((error) => console.error("Telegram message failed", String(error)));
                if (update.callback_query) await handleButton(update.callback_query).catch((error) => console.error("Telegram button failed", String(error)));
            }
        } catch (error) {
            setConnected(false);
            console.error("Telegram polling failed", String(error));
            await new Promise((resolve) => setTimeout(resolve, 10_000));
        }
    }
}

async function handleMessage(message: any) {
    const chatId: number = message.chat.id;
    const text = String(message.text).trim();
    // in groups commands come as /start@botname; the buttons send their label
    const command = ({ [BUTTONS.status]: "/status", [BUTTONS.sleep]: "/sleep", [BUTTONS.wake]: "/wake", [BUTTONS.hand]: "/hand", [BUTTONS.game]: "/spiel", [BUTTONS.queue]: "/warteschlange" } as Record<string, string>)[text]
        ?? text.split(/\s+/)[0]!.split("@")[0];
    const argument = text.slice(text.split(/\s+/)[0]!.length).trim();
    const person = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ");
    const name: string = message.chat.title ?? (person || String(chatId));

    if (command === "/start") {
        if (isApproved(chatId)) {
            await send(chatId, `Du bist bereits freigegeben.\n\n${HELP}`, KEYBOARD);
            return;
        }
        if (!contacts.some((c) => c.chatId === chatId)) {
            contacts.push({ chatId, name, requestedAt: new Date().toISOString() });
            changed();
            logEvent({ errorType: ErrorType.WARNING, description: `Telegram: ${name} möchte Benachrichtigungen bekommen, im Control Panel unter Telegram freigeben`, date: new Date().toString() });
            broadcast(`👤 <b>${escape(name)}</b> möchte RV6L-Benachrichtigungen bekommen. Freigeben im Control Panel unter Telegram.`);
        }
        await send(chatId, "Deine Anfrage ist eingegangen. Sobald sie im Control Panel freigegeben ist, bekommst du Nachrichten.");
        return;
    }
    if (command === "/stop") {
        if (contacts.some((c) => c.chatId === chatId)) {
            contacts = contacts.filter((c) => c.chatId !== chatId);
            changed();
            logEvent({ errorType: ErrorType.INFO, description: `Telegram: ${name} hat sich abgemeldet`, date: new Date().toString() });
        }
        await send(chatId, "Abgemeldet, du bekommst keine Nachrichten mehr. Mit /start kannst du eine neue Freigabe anfragen.", { remove_keyboard: true });
        return;
    }
    if (!isApproved(chatId)) {
        await send(chatId, contacts.some((c) => c.chatId === chatId)
            ? "Deine Anfrage wartet noch auf Freigabe im Control Panel."
            : "Bitte zuerst mit /start eine Freigabe anfragen.");
        return;
    }
    switch (command) {
        case "/status":
            await send(chatId, statusMessage());
            return;
        case "/sleep":
            await send(chatId, switchSleep(true, name));
            return;
        case "/wake":
            await send(chatId, switchSleep(false, name));
            return;
        case "/error":
            await send(chatId, raiseError(argument, name));
            return;
        case "/hand":
            await openPanel("hand", chatId);
            return;
        case "/spiel":
            await openPanel("game", chatId);
            return;
        case "/warteschlange":
            await openPanel("queue", chatId);
            return;
        default:
            await send(chatId, HELP, KEYBOARD);
    }
}

// A click on a button of a panel (manual control, game master, queue); only approved chats may use them
async function handleButton(query: any) {
    const chatId: number = query.message?.chat?.id;
    const person = [query.from?.first_name, query.from?.last_name].filter(Boolean).join(" ");
    let notice: string;
    if (chatId == null || !isApproved(chatId)) notice = "Nicht freigegeben.";
    else notice = await handleCallback(query, person || String(query.from?.id ?? chatId));
    await call("answerCallbackQuery", { callback_query_id: query.id, text: notice.slice(0, 200) });
}

// Only between IDLE and SLEEP, so a running game, test or a locked game is never interrupted from the phone
function switchSleep(sleep: boolean, name: string) {
    const current = GameManager.currentGameState.stateName;
    const from = sleep ? "IDLE" : "SLEEP";
    if (current === (sleep ? "SLEEP" : "IDLE")) return sleep ? "Der Roboter schläft bereits." : "Der Roboter ist bereits wach.";
    if (current !== from) return `Geht nur aus ${from}, der Roboter ist gerade im Zustand ${current}.`;
    const target = sleep ? gameStates.SLEEP : gameStates.IDLE;
    logEvent({ errorType: ErrorType.INFO, description: `Telegram: ${name} ${sleep ? "legt den Roboter schlafen" : "weckt den Roboter auf"}`, date: new Date().toString() });
    GameManager.switchState(target);
    GameManager.handleStateTransition(target.action(undefined), target);
    return sleep ? "😴 Der Roboter schläft jetzt, es kann kein Spiel gestartet werden." : "☀️ Der Roboter ist wach und bereit für Spiele.";
}

// Locks the game at any time like a fault created by hand in the control panel; it is acknowledged there
function raiseError(message: string, name: string) {
    const title = message.slice(0, 200);
    if (!title) return "Bitte eine Meldung angeben, z. B. <code>/error Spielfeld klemmt</code>";
    createManualFault(title, `Per Telegram von ${name}`, true);
    return `🔴 Spiel gesperrt: <b>${escape(title)}</b>\nDer Roboter beendet nur noch seine aktuelle Bewegung. Freigeben durch Quittieren im Control Panel unter Fehlerspeicher.`;
}

// ---------------------------------------------------------------------------------------------
// Pinned live status: one message per contact, edited whenever the status text changes

function liveStatus() {
    const name = GameManager.currentGameState.stateName;
    const memory = getFaultMemory();
    const chips = state.board ? Object.values(state.board).reduce((sum, column) => sum + column.length, 0) : 0;
    const player = publicQueue().active?.nickname;
    let head: string;
    if (name === "ERROR") head = "🔴 <b>Gesperrt</b>";
    else if (name === "IDLE") head = "🟢 <b>Bereit</b>";
    else if (name === "SLEEP") head = "😴 <b>Schläft</b>";
    else if (name === "TEST") head = "🧪 <b>Testbetrieb</b>";
    else if (name === "CLEAN_UP") head = "🧹 <b>Spielfeld wird geleert</b>";
    else head = `🎮 <b>Partie läuft</b>${player ? ` (${escape(player)})` : ""}`;
    const lines = [`RV6L: ${head}`, `Zustand: ${escape(name)} · ${chips} Chips im Feld`];
    if (!RV6L_STATE.mock && !RV6L_STATE.rv6l_connected) lines.push("⚠️ Keine Verbindung zur Robotersteuerung");
    if (memory.lockReasons.length) lines.push(...memory.lockReasons.map((reason) => `• ${escape(reason)}`));
    return lines.join("\n");
}

async function updatePinnedStatus() {
    const status = liveStatus();
    if (status === shownStatus) return;
    shownStatus = status;
    for (const contact of contacts.filter((c) => c.approvedAt)) {
        await pinStatus(contact).catch((error) => console.error(`Telegram status for ${contact.name} failed`, String(error)));
    }
}

async function pinStatus(contact: TelegramContact) {
    const text = `${shownStatus || liveStatus()}\n<i>Stand ${time(new Date().toISOString())}</i>`;
    if (contact.statusMessageId) {
        try {
            await call("editMessageText", { chat_id: contact.chatId, message_id: contact.statusMessageId, text, parse_mode: "HTML" });
            return;
        } catch (error) {
            if (/not modified/i.test(String(error))) return;
            // deleted by the user: post and pin a new one
            if (!/not found|can't be edited/i.test(String(error))) throw error;
        }
    }
    const message = await call("sendMessage", { chat_id: contact.chatId, text, parse_mode: "HTML", disable_notification: true });
    contact.statusMessageId = message.message_id;
    changed();
    // in groups the bot needs the right to pin; the status message is still sent without it
    await call("pinChatMessage", { chat_id: contact.chatId, message_id: message.message_id, disable_notification: true })
        .catch((error) => console.error(`Telegram pin for ${contact.name} failed`, String(error)));
}

// ---------------------------------------------------------------------------------------------

function faultMessage(entry: FaultEntry) {
    const lines = [
        `🚨 <b>Kritischer Fehler am RV6L</b>`,
        `<b>${escape(entry.title)}</b>`,
        entry.details ? escape(entry.details) : null,
        `${escape(entry.source)} · ${time(entry.lastSeen)}${entry.occurrences > 1 ? ` · ${entry.occurrences}× aufgetreten` : ""}`,
        `Das Spiel ist gesperrt, bis der Fehler behoben und im Control Panel quittiert ist.`,
    ];
    return lines.filter((line) => line != null).join("\n");
}

function statusMessage() {
    const memory = getFaultMemory();
    const lines = [
        `<b>RV6L-Status</b>`,
        `Zustand: ${escape(state.stateName)}`,
        `Robotersteuerung: ${RV6L_STATE.mock ? "gemockt" : RV6L_STATE.rv6l_connected ? "verbunden" : "nicht verbunden"}`,
    ];
    if (memory.lockReasons.length) {
        lines.push("", "<b>Gesperrt wegen:</b>", ...memory.lockReasons.map((reason) => `• ${escape(reason)}`));
    } else {
        lines.push("Keine kritischen Fehler offen.");
    }
    const warnings = memory.open.filter((entry) => !entry.critical).length;
    if (warnings) lines.push(`${warnings} ${warnings === 1 ? "Warnung" : "Warnungen"} im Fehlerspeicher.`);
    return lines.join("\n");
}

// to approved contacts only
function broadcast(text: string) {
    for (const contact of contacts.filter((c) => c.approvedAt)) {
        send(contact.chatId, text).catch((error) => {
            // the bot was blocked or removed from the group: stop sending there
            if (/blocked|kicked|not found|deactivated/i.test(String(error))) {
                contacts = contacts.filter((c) => c.chatId !== contact.chatId);
                changed();
            }
            console.error(`Telegram message to ${contact.name} failed`, String(error));
        });
    }
}

async function send(chatId: number, text: string, replyMarkup?: object) {
    await call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: replyMarkup });
}

async function call(method: string, body: object = {}, timeoutMs = 15_000): Promise<any> {
    const response = await fetch(`${API}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const data: any = await response.json();
    if (!data.ok) throw new Error(`${data.error_code} ${data.description}`);
    return data.result;
}

function setConnected(value: boolean) {
    if (connected === value) return;
    connected = value;
    sendState();
}

function changed() {
    try {
        mkdirSync(dirname(FILE), { recursive: true });
        writeFileSync(FILE, JSON.stringify(contacts, null, 1));
    } catch (error) {
        console.error("Could not save the Telegram contacts", error);
    }
    sendState();
}

function time(iso: string) {
    return new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
}

// Telegram HTML: only these three characters must be escaped
function escape(text: string) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
