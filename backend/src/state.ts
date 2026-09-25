import { sendStateToClient } from "./game_server";
import {sendStateToControlPanelClient, sendStateToInternalClient} from "./internal_server";

export const state = {
    isPlayerConnected: false,
    board: null,
    difficulty: 'hard', // Default difficulty for AI
    gameStartTime: 0,
    lastUserInteraction: Date.now(),
    stateName: "IDLE",
}

export function resetGameState() {
    state.board = null;
    state.gameStartTime = Date.now();
    state.lastUserInteraction = Date.now();
}

export function sendState() {
    sendStateToClient?.();
    sendStateToInternalClient?.();
    sendStateToControlPanelClient?.();
}