import {playerSelection, PlayerSelectionAbortError, waitForTimeout, withTimeout} from "./game_utils.ts";
import {onLockChange, recordEvent} from "../fault_memory.ts";
import {finishGame, releaseActivePlayer} from "../players.ts";
import {initChipPalletizing, moveToBlue, moveToColumn, moveToRed, putBackToBlue, putBackToRed, removeFromField} from "../rv6l_client.ts";
import {type ErrorDescription, ErrorType, logEvent} from "../errorHandler/error_handler.ts";
import {applyGameMove, checkGameState, playAIMove, playMove, resetGame} from "./game.ts";
import {sendState, state} from "../state.ts";
import type GameState from "./game_state.ts";
import type {GameStateOutput} from "./game_state.ts";
import EventEmitter from 'events';

const PlayerSelect: GameState<void, number> = {
    stateName: "PLAYER_SELECTION",
    expectedDuration: 1000 * 60 * 2, //2 mins
    startTime: null,
    endTime: null,
    action: async () => {
        const {promise, abort} = playerSelection();

        const abortFunction = () => {
            abort();
            GameManager.gameEvent.removeListener("stateChange", abortFunction);
        }

        GameManager.gameEvent.on("stateChange", abortFunction)

        try {
            const selection = await withTimeout(promise, PlayerSelect.expectedDuration!);
            GameManager.gameEvent.removeListener("stateChange", abortFunction);

            if (playMove(selection)) {
                sendState();
            } else {
                logEvent({
                    errorType: ErrorType.WARNING,
                    description: "Player selection failed, invalid column selected.",
                    date: new Date().toString()
                });
                recordEvent("game:invalid_move", {
                    title: "Ungültiger Spielzug", severity: "fatal", critical: true, source: "Spiel",
                    details: "Die gewählte Spalte konnte nicht gespielt werden.",
                });
                return {
                    canContinue: false,
                    subsequentState: Error,
                    output: -1
                }
            }

            return {
                canContinue: true,
                subsequentState: GrapBlueChip,
                output: selection,
            }

        } catch (e) {
            GameManager.gameEvent.removeListener("stateChange", abortFunction);

            if (e instanceof PlayerSelectionAbortError) {

                GameManager.raiseError({
                    errorType: ErrorType.WARNING,
                    description: "Player selection timed out, resetting game.",
                    date: new Date().toString()
                });
            } else {
                GameManager.raiseError({
                    errorType: ErrorType.WARNING,
                    description: "Unknown error during player selection",
                    date: new Date().toString()
                });

            }
            return {
                canContinue: true,
                subsequentState: CleanUp,
                output: 0 // Indicating that the game should not start instantly
            }

        }

    }
}

const GrapBlueChip: GameState<number, number> = {
    stateName: "GRAP_BLUE_CHIP",
    expectedDuration: 1000 * 20,
    startTime: null,
    endTime: null,
    action: async (column: number) => {
        await withTimeout(moveToBlue(), 1000 * 20);
        return {
            canContinue: true,
            subsequentState: PlaceBlueChip,
            output: column
        }
    }
}

const PlaceBlueChip: GameState<number, void> = {
    stateName: "PLACE_BLUE_CHIP",
    expectedDuration: 1000 * 20,
    startTime: null,
    endTime: null,
    action: async (column: number) => {
        await withTimeout(moveToColumn(column), 1000 * 20);
        GameManager.isPhysicalBoardCleaned = false;

        // Check for win or tie conditions here
        const gameStatus = checkGameState();

        if (gameStatus.isGameOver) {
            if (gameStatus.winner == null) {
                return {
                    canContinue: true,
                    subsequentState: Tie
                }
            }

            if (gameStatus.winner === 1) {
                return {
                    canContinue: true,
                    subsequentState: PlayerWin
                }
            }
        }

        return {
            canContinue: true,
            subsequentState: RobotSelect
        }
    }
}

const RobotSelect: GameState<void, number> = {
    stateName: "ROBOT_SELECTION",
    expectedDuration: 1000,
    startTime: null,
    endTime: null,
    action: async () => {
        const selection = playAIMove();

        return {
            canContinue: true,
            subsequentState: GrapRedChip,
            output: selection
        }
    }
}

const GrapRedChip: GameState<number, number> = {
    stateName: "GRAP_RED_CHIP",
    expectedDuration: 1000 * 20,
    startTime: null,
    endTime: null,
    action: async (column: number) => {
        await withTimeout(moveToRed(), GrapRedChip.expectedDuration!);
        applyGameMove();
        return {
            canContinue: true,
            subsequentState: PlaceRedChip,
            output: column
        }
    }
}

const PlaceRedChip: GameState<number, void> = {
    stateName: "PLACE_RED_CHIP",
    expectedDuration: 1000 * 20,
    startTime: null,
    endTime: null,
    action: async (column: number) => {
        await withTimeout(moveToColumn(column), PlaceRedChip.expectedDuration!);
        GameManager.isPhysicalBoardCleaned = false;
        // Check for win or tie conditions here
        const gameStatus = checkGameState();

        if (gameStatus.isGameOver) {
            if (gameStatus.winner == null) {
                return {
                    canContinue: true,
                    subsequentState: Tie
                }
            }

            if (gameStatus.winner === 2) {
                return {
                    canContinue: true,
                    subsequentState: RobotWin
                }
            }
        }

        return {
            canContinue: true,
            subsequentState: PlayerSelect
        }
    }
}

const Error: GameState<void, void> = {
    stateName: "ERROR",
    expectedDuration: null,
    startTime: null,
    endTime: null,
    stateData: {
        errorType: ErrorType.FATAL,
        description: "Dummy",
        date: new Date().toString()
    } satisfies ErrorDescription,
    action: async () => {
        return {
            canContinue: false,
            subsequentState: null
        }
    }

}

const CleanUp: GameState<boolean, void> = {
    stateName: "CLEAN_UP",
    expectedDuration: 1000 * 60 * 10, //10 mins
    startTime: null,
    endTime: null,
    action: async (instantRestart: boolean) => {

        // PALETTE #EIN counts on for gripping and for putting back alike. Reset the pallets so the chips go back
        // to the places they were taken from (0 .. n-1) instead of onto places that are still full.
        await initChipPalletizing();

        // iterate over a copy: the board shown to players and displays loses each chip as soon as the robot took it
        const board: Record<string, number[]> | null = state.board ? JSON.parse(JSON.stringify(state.board)) : null;
        for (let i = 0; i < 7; i++) {
            if (board == null) break;
            const column = board[i] ?? [];
            for (let row = column.length - 1; row >= 0; row--) {
                const element = column[row];
                await removeFromField(i, column.length - row - 1);
                const shown = state.board;
                if (shown?.[i]) {
                    state.board = {...shown, [i]: shown[i]!.slice(0, row)};
                    sendState();
                }
                if (element === 1) {
                    await putBackToBlue();
                } else if (element === 2) {
                    await putBackToRed();
                }
            }
        }

        // and again afterwards, so the next game starts gripping at place 0 of the refilled magazines
        await initChipPalletizing();

        resetGame();
        GameManager.isPhysicalBoardCleaned = true;

        if (instantRestart) {
            state.gameStartTime = Date.now();
        }

        return {
            canContinue: true,
            subsequentState: instantRestart ? PlayerSelect : Idle
        }
    }
}

const Idle: GameState<void, void> = {
    stateName: "IDLE",
    expectedDuration: null,
    startTime: null,
    endTime: null,
    action: async () => {
        return {
            canContinue: false,
            subsequentState: null
        }
    },

}

const RobotWin: GameState<void, boolean> = {
    stateName: "ROBOT_WIN",
    expectedDuration: null,
    startTime: null,
    endTime: null,
    // the result stays visible on the phone, the board is cleared right away so nobody has to wait
    action: async () => {
        finishGame("robot");
        return {
            canContinue: true,
            subsequentState: CleanUp,
            output: false
        }
    }
}

const Sleep: GameState<void, void> = {
    stateName: "SLEEP",
    expectedDuration: null,
    startTime: null,
    endTime: null,

    action: async () => {
        return {
            canContinue: false,
            subsequentState: null
        }
    }

}

const PlayerWin: GameState<void, boolean> = {
    stateName: "PLAYER_WIN",
    expectedDuration: null,
    startTime: null,
    endTime: null,
    // the result stays visible on the phone, the board is cleared right away so nobody has to wait
    action: async () => {
        finishGame("player");
        return {
            canContinue: true,
            subsequentState: CleanUp,
            output: false
        }
    }
}

const Tie: GameState<void, boolean> = {
    stateName: "TIE",
    expectedDuration: null,
    startTime: null,
    endTime: null,
    // the result stays visible on the phone, the board is cleared right away so nobody has to wait
    action: async () => {
        finishGame("tie");
        return {
            canContinue: true,
            subsequentState: CleanUp,
            output: false
        }
    }
}


export const gameStates = {
    IDLE: Idle,
    PLAYER_SELECTION: PlayerSelect,
    GRAP_BLUE_CHIP: GrapBlueChip,
    PLACE_BLUE_CHIP: PlaceBlueChip,
    ROBOT_SELECTION: RobotSelect,
    GRAP_RED_CHIP: GrapRedChip,
    PLACE_RED_CHIP: PlaceRedChip,
    ERROR: Error,
    CLEAN_UP: CleanUp,
    ROBOT_WIN: RobotWin,
    PLAYER_WIN: PlayerWin,
    TIE: Tie,
    SLEEP: Sleep
}

export let GameManager: {
    currentGameState: GameState<any, any>;
    switchState: Function;
    startNewGame: Function;
    isPhysicalBoardCleaned: boolean;
    resetGame: (instantRestart: boolean) => boolean;
    handleStateTransition: (dataPromise: Promise<GameStateOutput<any>>, callingState: GameState<any, any>) => Promise<void>;
    gameEvent: EventEmitter;
    raiseError: (error: ErrorDescription) => void;
    applyLock: (reasons: string[]) => void;
};
GameManager = {
    currentGameState: Idle,
    isPhysicalBoardCleaned: true,
    gameEvent: new EventEmitter(),

    switchState: (newState: GameState<any, any>, newStateData: any) => {
        logEvent({
            errorType: ErrorType.INFO,
            description: `Switching to state: ${newState.stateName}`,
            date: new Date().toString()
        })
        GameManager.gameEvent.emit("stateChange");
        GameManager.currentGameState.endTime = new Date();
        GameManager.currentGameState = newState;
        // back in IDLE the player's turn is over and the next one in the queue gets the offer
        if (newState === Idle) releaseActivePlayer();
        newState.startTime = new Date();
        newState.stateData = newStateData;
        state.stateName = newState.stateName;
        sendState();

    },

    startNewGame: () => {
        if (GameManager.currentGameState.stateName === "ERROR") {
            logEvent({
                errorType: ErrorType.WARNING,
                description: "Spielstart abgelehnt: Das Spiel ist gesperrt, bis keine Fehler mehr offen sind",
                date: new Date().toString()
            });
            return;
        }

        if (GameManager.currentGameState.stateName === "IDLE") {
            state.gameStartTime = Date.now();
            // a game stopped by an error may have left chips on the board, clear them before the new game
            if (boardHasChips()) {
                GameManager.switchState(CleanUp);
                GameManager.handleStateTransition(CleanUp.action(true), CleanUp);
                return;
            }
            GameManager.switchState(PlayerSelect)
            GameManager.handleStateTransition(PlayerSelect.action(), PlayerSelect);
        } else {
            GameManager.resetGame(true);
        }


    },

    resetGame: (instantRestart: boolean) => {
        if (["ROBOT_WIN", "PLAYER_WIN", "TIE", "PLAYER_SELECTION"].includes(GameManager.currentGameState.stateName)) {
            state.gameStartTime = Date.now();

            GameManager.switchState(CleanUp);
            GameManager.handleStateTransition(CleanUp.action(instantRestart), CleanUp);
            return true;
        }
        return false;
    },

    handleStateTransition: async (dataPromise: Promise<GameStateOutput<any>>, callingState: GameState<any, any>) => {
        let data: GameStateOutput<any>;
        try {
            data = await dataPromise;
        } catch (e: any) {
            const error: ErrorDescription = {
                errorType: ErrorType.FATAL,
                description: "An error occurred during state " + callingState.stateName + ": " + (e?.message ?? e),
                date: new Date().toString()
            };
            GameManager.raiseError(error);
            // a critical fault locks the game in ERROR, so no further robot command is sent
            recordEvent(`game:state_error:${callingState.stateName}`, {
                title: `Fehler im Spielablauf (${callingState.stateName})`,
                severity: "fatal", critical: true, source: "Spiel",
                details: String(e?.message ?? e),
            });
            return;
        }

        if (callingState !== GameManager.currentGameState) { // If the state has changed during the action execution, we ignore the result
            return;
        }

        if (data.canContinue) {
            if (data.subsequentState != null) {
                GameManager.switchState(data.subsequentState, data.output);
                GameManager.handleStateTransition(data.subsequentState.action(data.output), data.subsequentState);
            }
        }
    },
    raiseError: (error: ErrorDescription) => {
        logEvent(error);
    },

    /**
     * The only way into and out of ERROR: locked while a critical fault is open in the fault memory or the
     * robot is not ready, and back to IDLE on its own once nothing is open any more.
     */
    applyLock: (reasons: string[]) => {
        const inError = GameManager.currentGameState.stateName === "ERROR";
        if (reasons.length > 0) {
            const stateData = { reasons, description: reasons.join(", ") };
            if (!inError) {
                logEvent({
                    errorType: ErrorType.WARNING,
                    description: `Spiel gesperrt: ${stateData.description}`,
                    date: new Date().toString()
                });
                GameManager.switchState(Error, stateData);
            } else if (JSON.stringify(Error.stateData) !== JSON.stringify(stateData)) {
                Error.stateData = stateData;
                sendState();
            }
        } else if (inError) {
            logEvent({
                errorType: ErrorType.INFO,
                description: "Keine offenen Fehler mehr, das Spiel ist wieder freigegeben",
                date: new Date().toString()
            });
            GameManager.switchState(Idle);
        }
    },
};

function boardHasChips() {
    return state.board != null && Object.values(state.board as Record<string, number[]>).some((column) => column.length > 0);
}

onLockChange((reasons) => GameManager.applyLock(reasons));