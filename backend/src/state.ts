import { sendStateToClient } from "./game_server";
import { sendStateToInternalClient } from "./internal_server";

export const state = {
    isGameRunning: false,
    isPlayerConnected: false,
    isRobotInAction: false,
    isHumanTurn: true,
    isGameOver: false,
    winner: null,
    board: null,
    difficulty: 'hard', // Default difficulty for AI
    gameStartTime: 0,
    isPhysicalBoardClearing: false,
    isGameFieldReady: true,
    lastUserInteraction: Date.now(),
}

export function resetGameState() {
    state.isGameRunning = false;
    state.isRobotInAction = false;
    state.isHumanTurn = true;
    state.isGameOver = false;
    state.board = null;
    state.winner = null;
    state.gameStartTime = Date.now();
    state.lastUserInteraction = Date.now();
}

export function sendState() {
    sendStateToClient?.();
    sendStateToInternalClient?.();
}