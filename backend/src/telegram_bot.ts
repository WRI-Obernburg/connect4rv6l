import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { faultEvents, getFaultMemory, type FaultEntry } from "./fault_memory.ts";
import { sendState, state } from "./state.ts";
import { RV6L_STATE } from "./rv6l_client.ts";
import { GameManager, gameStates } from "./game/game_manager.ts";
import { ErrorType, logEvent } from "./errorHandler/error_handler.ts";

/**
 * Telegram bot that pushes critical faults to every approved contact, and an all-clear once the game is free
 * again. Approved contacts can also send the robot to sleep and wake it up. It polls the Bot API (long polling),
 * so it needs no open port or webhook on the Pi.
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

export type TelegramContact = { chatId: number, name: string, requestedAt: string, approvedAt?: string };

let contacts: TelegramContact[] = [];
let connected = false;
const lastSent = new Map<string, number>();

const isApproved = (chatId: number) => contacts.some((c) => c.chatId === chatId && c.approvedAt);

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
    poll();
}

export async function approveContact(chatId: number) {
    const contact = contacts.find((c) => c.chatId === chatId);
    if (!contact || contact.approvedAt) return;
    contact.approvedAt = new Date().toISOString();
    changed();
    logEvent({ errorType: ErrorType.INFO, description: `Telegram: ${contact.name} freigegeben`, date: new Date().toString() });
    await send(chatId, `✅ Du bist freigegeben. Ab jetzt bekommst du eine Nachricht, sobald am RV6L ein kritischer Fehler auftritt.\n\n${HELP}`).catch(() => {});
}

export async function removeContact(chatId: number) {
    const contact = contacts.find((c) => c.chatId === chatId);
    if (!contact) return;
    contacts = contacts.filter((c) => c !== contact);
    changed();
    logEvent({ errorType: ErrorType.INFO, description: `Telegram: ${contact.name} entfernt`, date: new Date().toString() });
    await send(chatId, contact.approvedAt
        ? "Du wurdest von den RV6L-Benachrichtigungen abgemeldet."
        : "Deine Anfrage für RV6L-Benachrichtigungen wurde abgelehnt.").catch(() => {});
}

const HELP = "/status – aktueller Zustand\n/sleep – Roboter schlafen legen (nur aus IDLE)\n/wake – Roboter aufwecken\n/stop – abmelden";

async function poll() {
    let offset = 0;
    while (true) {
        try {
            const updates = await call("getUpdates", { offset, timeout: POLL_TIMEOUT_S, allowed_updates: ["message"] }, (POLL_TIMEOUT_S + 10) * 1000);
            setConnected(true);
            for (const update of updates) {
                offset = update.update_id + 1;
                if (update.message?.text) await handleMessage(update.message).catch((error) => console.error("Telegram message failed", String(error)));
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
    // in groups commands come as /start@botname
    const command = String(message.text).trim().split(/\s+/)[0]!.split("@")[0];
    const person = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ");
    const name: string = message.chat.title ?? (person || String(chatId));

    if (command === "/start") {
        if (isApproved(chatId)) {
            await send(chatId, `Du bist bereits freigegeben.\n\n${HELP}`);
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
        await send(chatId, "Abgemeldet, du bekommst keine Nachrichten mehr. Mit /start kannst du eine neue Freigabe anfragen.");
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
        default:
            await send(chatId, HELP);
    }
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

async function send(chatId: number, text: string) {
    await call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true });
}

async function call(method: string, body: object, timeoutMs = 15_000): Promise<any> {
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
    return new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "medium" });
}

// Telegram HTML: only these three characters must be escaped
function escape(text: string) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
