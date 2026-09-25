import type WebSocket from "ws";
import { ErrorType, logEvent } from "./errorHandler/error_handler.ts";

/**
 * Players and the queue. Every phone has its own client id (kept in its browser), the session id of the QR code
 * only proves that it is at the table. One client plays, the others wait in the queue or just watch.
 *
 * - A game can be started directly only if nobody plays and nobody waits.
 * - After a game the first one in the queue is offered the turn and has OFFER_TIMEOUT_MS to start, then the next.
 * - A client that closes the page keeps its place for RECONNECT_GRACE_MS.
 */

export const OFFER_TIMEOUT_MS = 60 * 1000;
const RECONNECT_GRACE_MS = 2 * 60 * 1000;
const MAX_QUEUE = 20;
const MAX_NICKNAME = 20;

export type QueueEntry = { clientId: string, nickname: string, joinedAt: number, offeredAt?: number, disconnectedAt?: number };
export type GameResult = { winner: "player" | "robot" | "tie", clientId: string | null, nickname: string, at: number };

const sockets = new Map<string, Set<WebSocket>>();
const nicknames = new Map<string, string>();
let queue: QueueEntry[] = [];
let active: { clientId: string, nickname: string } | null = null;
let lastResult: GameResult | null = null;
let guestCounter = 0;

export function cleanNickname(value: unknown): string {
    return String(value ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_NICKNAME);
}

function nicknameOf(clientId: string) {
    let nickname = nicknames.get(clientId);
    if (!nickname) {
        nickname = `Gast ${++guestCounter}`;
        nicknames.set(clientId, nickname);
    }
    return nickname;
}

export function setNickname(clientId: string, value: unknown) {
    const nickname = cleanNickname(value);
    if (!nickname) return;
    nicknames.set(clientId, nickname);
    const entry = queue.find((e) => e.clientId === clientId);
    if (entry) entry.nickname = nickname;
    if (active?.clientId === clientId) active.nickname = nickname;
}

// ---------------------------------------------------------------------------------------------
// Connections

export function addSocket(clientId: string, ws: WebSocket) {
    if (!sockets.has(clientId)) sockets.set(clientId, new Set());
    sockets.get(clientId)!.add(ws);
    const entry = queue.find((e) => e.clientId === clientId);
    if (entry) delete entry.disconnectedAt;
}

export function removeSocket(clientId: string, ws: WebSocket) {
    const set = sockets.get(clientId);
    set?.delete(ws);
    if (set && set.size === 0) {
        sockets.delete(clientId);
        const entry = queue.find((e) => e.clientId === clientId);
        if (entry) entry.disconnectedAt = Date.now();
    }
}

export const isAnyPlayerConnected = () => sockets.size > 0;

export function forEachSocket(send: (clientId: string, ws: WebSocket) => void) {
    for (const [clientId, set] of sockets) for (const ws of set) send(clientId, ws);
}

// ---------------------------------------------------------------------------------------------
// Queue

export function joinQueue(clientId: string): boolean {
    if (active?.clientId === clientId || queue.some((e) => e.clientId === clientId)) return false;
    if (queue.length >= MAX_QUEUE) return false;
    queue.push({ clientId, nickname: nicknameOf(clientId), joinedAt: Date.now() });
    return true;
}

export function leaveQueue(clientId: string) {
    queue = queue.filter((e) => e.clientId !== clientId);
}

/** Removes an entry from the control panel. */
export function removeFromQueue(clientId: string) {
    const entry = queue.find((e) => e.clientId === clientId);
    if (!entry) return;
    leaveQueue(clientId);
    logEvent({ errorType: ErrorType.INFO, description: `${entry.nickname} aus der Warteschlange entfernt`, date: new Date().toString() });
}

/**
 * Whether this client may start a game now. With `idle` false (a game or clean-up is running) nobody may.
 * Otherwise the first one in the queue may, or anyone if the queue is empty.
 */
export function mayStart(clientId: string, idle: boolean) {
    if (!idle) return false;
    if (queue.length === 0) return true;
    return queue[0]!.clientId === clientId;
}

/** A restart during or right after one's own game is only allowed while nobody waits. */
export function mayRestart(clientId: string) {
    return active?.clientId === clientId && queue.length === 0;
}

export function startPlaying(clientId: string) {
    leaveQueue(clientId);
    active = { clientId, nickname: nicknameOf(clientId) };
    lastResult = null;
}

export const isActivePlayer = (clientId: string) => active?.clientId === clientId;

/** The game has ended; the result stays visible while the board is cleared. */
export function finishGame(winner: GameResult["winner"]) {
    lastResult = { winner, clientId: active?.clientId ?? null, nickname: active?.nickname ?? "", at: Date.now() };
}

/** Called when the game is idle again: the player's turn is over, the next one in the queue gets the offer. */
export function releaseActivePlayer() {
    active = null;
}

/**
 * Housekeeping, called regularly: drops clients that did not come back and moves the offer on when the first
 * one in the queue did not start in time. Returns true when something changed.
 */
export function updateQueue(idle: boolean): boolean {
    const now = Date.now();
    const before = JSON.stringify(queue);
    queue = queue.filter((e) => !(e.disconnectedAt && now - e.disconnectedAt > RECONNECT_GRACE_MS));

    const first = queue[0];
    if (idle && !active && first) {
        if (!first.offeredAt) first.offeredAt = now;
        else if (now - first.offeredAt > OFFER_TIMEOUT_MS) {
            logEvent({ errorType: ErrorType.INFO, description: `${first.nickname} hat den Spielstart verpasst, der Nächste ist dran`, date: new Date().toString() });
            queue.shift();
            if (queue[0]) queue[0].offeredAt = now;
        }
    }
    return JSON.stringify(queue) !== before;
}

// ---------------------------------------------------------------------------------------------
// What the phones and the control panel get to see

export function publicQueue() {
    return {
        active: active ? { nickname: active.nickname } : null,
        queue: queue.map((e, i) => ({ nickname: e.nickname, position: i + 1, offered: !!e.offeredAt && i === 0, connected: !e.disconnectedAt })),
        lastResult: lastResult ? { winner: lastResult.winner, nickname: lastResult.nickname, at: lastResult.at } : null,
    };
}

/** The personal view of one phone. */
export function playerView(clientId: string, idle: boolean) {
    const position = queue.findIndex((e) => e.clientId === clientId);
    const offered = position === 0 && idle && !active ? queue[0]!.offeredAt ?? Date.now() : undefined;
    let role: "active" | "offered" | "queued" | "spectator" = "spectator";
    if (active?.clientId === clientId) role = "active";
    else if (offered) role = "offered";
    else if (position >= 0) role = "queued";
    return {
        role,
        nickname: nicknames.get(clientId) ?? "",
        position: position >= 0 ? position + 1 : null,
        offerEndsAt: offered ? offered + OFFER_TIMEOUT_MS : null,
        canStart: mayStart(clientId, idle) && !active,
        canRestart: mayRestart(clientId),
        // the result of this phone's own game, shown while the board is cleared
        ownResult: lastResult && lastResult.clientId === clientId ? lastResult.winner : null,
    };
}

/** For the control panel, including the client ids to remove entries. */
export function adminQueue() {
    return {
        active,
        queue: queue.map((e, i) => ({ ...e, position: i + 1, connected: !e.disconnectedAt })),
        lastResult,
    };
}
