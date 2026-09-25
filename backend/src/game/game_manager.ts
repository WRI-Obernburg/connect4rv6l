import {playerSelection, PlayerSelectionAbortError, waitForTimeout, withTimeout} from "./game_utils.ts";
import {moveToBlue, moveToColumn, moveToRed, putBackToBlue, putBackToRed, removeFromField} from "../rv6l_client.ts";
import {type ErrorDescription, ErrorType, logEvent} from "../errorHandler/error_handler.ts";
import {applyGameMove, checkGameState, playAIMove, playMove, resetGame} from "./game.ts";
import {sendState, state} from "../state.ts";
import type GameState from "./game_state.ts";
import type {GameStateOutput} from "./game_state.ts";
import EventEmitter from 'events';
import {context, gameContext, SpanStatusCode, trace, tracer, type Span} from "../telemetry.ts";
import {v4 as uuidv4} from 'uuid';

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
                GameManager.raiseError({
                    errorType: ErrorType.FATAL,
                    description: "Player selection failed, invalid column selected.",
                    date: new Date().toString()
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

        for (let i = 0; i < 7; i++) {
            if (state.board == null) break;
            for (let row = (state.board![i] as number[]).length - 1; row >= 0; row--) {
                const element = (state.board![i] as number[])[row];
                await removeFromField(i, (state.board![i] as number[]).length - row - 1);
                if (element === 1) {
                    await putBackToBlue();
                } else if (element === 2) {
                    await putBackToRed();
                }
            }
        }

        resetGame();

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

const RobotWin: GameState<void, void> = {
    stateName: "ROBOT_WIN",
    expectedDuration: 1000 * 60 * 2,
    startTime: null,
    endTime: null,
    action: async () => {

        await waitForTimeout(RobotWin.expectedDuration!);
        if (GameManager.currentGameState === RobotWin) {
            GameManager.resetGame(false);
        }

        return {
            canContinue: false,
            subsequentState: null
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

const PlayerWin: GameState<void, void> = {
    stateName: "PLAYER_WIN",
    expectedDuration: 1000 * 60 * 2,
    startTime: null,
    endTime: null,
    action: async () => {

        await waitForTimeout(PlayerWin.expectedDuration!);
        if (GameManager.currentGameState === PlayerWin) {
            GameManager.resetGame(false);
        }

        return {
            canContinue: false,
            subsequentState: null
        }
    }
}

const Tie: GameState<void, void> = {
    stateName: "TIE",
    expectedDuration: 1000 * 60 * 2,
    startTime: null,
    endTime: null,
    action: async () => {

        await waitForTimeout(Tie.expectedDuration!);
        if (GameManager.currentGameState === Tie) {
            GameManager.resetGame(false);
        }

        return {
            canContinue: false,
            subsequentState: null
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
    enterState: (newState: GameState<any, any>, newStateData?: any) => void;
    startNewGame: Function;
    isPhysicalBoardCleaned: boolean;
    resetGame: (instantRestart: boolean) => boolean;
    handleStateTransition: (dataPromise: Promise<GameStateOutput<any>>, callingState: GameState<any, any>) => Promise<void>;
    gameEvent: EventEmitter;
    raiseError: (error: ErrorDescription) => void;
};

// --- Telemetry: one span per game, one child span per state -----------------
let gameSpan: Span | null = null;
let stateSpan: Span | null = null;
const GAME_END_STATES = ["IDLE", "ERROR", "SLEEP"];

function endGameSpan(reason: string) {
    if (!gameSpan) return;
    gameSpan.setAttribute("game.end_reason", reason);
    if (reason === "ERROR") gameSpan.setStatus({code: SpanStatusCode.ERROR, message: "Game ended in ERROR state"});
    gameSpan.end();
    gameSpan = null;
    gameContext.gameId = null;
}

function startGameSpan() {
    gameContext.gameId = uuidv4();
    // A game is a root trace of its own (it can run for minutes); the span that
    // triggered it (player tap, control panel action) is attached as a link.
    const trigger = trace.getActiveSpan()?.spanContext();
    gameSpan = tracer.startSpan("game", {
        root: true,
        attributes: {"game.difficulty": state.difficulty},
        links: trigger ? [{context: trigger}] : [],
    });
    trace.getActiveSpan()?.addEvent("game.started", {"game.id": gameContext.gameId!});
}

function beginStateSpan(newState: GameState<any, any>, newStateData: any, previousStateName: string) {
    const parent = gameSpan ? trace.setSpan(context.active(), gameSpan) : context.active();
    let dataAttr: string | undefined;
    try {
        dataAttr = newStateData === undefined ? undefined : JSON.stringify(newStateData);
    } catch {
        dataAttr = String(newStateData);
    }
    stateSpan = tracer.startSpan(`state.${newState.stateName}`, {
        attributes: {
            "game.state.name": newState.stateName,
            "game.state.previous": previousStateName,
            "game.state.expected_duration_ms": newState.expectedDuration ?? -1,
            "game.state.data": dataAttr ?? "",
            "game.board": JSON.stringify(state.board),
        },
    }, parent);
    if (newState.stateName === "ERROR") {
        stateSpan.setStatus({code: SpanStatusCode.ERROR, message: newStateData?.description ?? "ERROR state"});
    }
    // Terminal states have no action and may stay active for hours: export them right away.
    if (GAME_END_STATES.includes(newState.stateName)) {
        stateSpan.end();
        stateSpan = null;
    }
}

function endStateSpan() {
    if (!stateSpan) return;
    stateSpan.setAttribute("game.board.after", JSON.stringify(state.board));
    stateSpan.end();
    stateSpan = null;
}

/** Context in which a state's action runs, so robot commands nest under the state span. */
function stateContext() {
    return stateSpan ? trace.setSpan(context.active(), stateSpan) : context.active();
}
// ---------------------------------------------------------------------------

GameManager = {
    currentGameState: Idle,
    isPhysicalBoardCleaned: true,
    gameEvent: new EventEmitter(),

    switchState: (newState: GameState<any, any>, newStateData: any) => {
        const previousStateName = GameManager.currentGameState.stateName;

        endStateSpan();
        if (newState.stateName === "PLAYER_SELECTION" && (gameSpan == null || previousStateName === "CLEAN_UP")) {
            endGameSpan("RESTART");
            startGameSpan();
        }
        gameContext.stateName = newState.stateName;
        beginStateSpan(newState, newStateData, previousStateName);
        if (GAME_END_STATES.includes(newState.stateName)) {
            endGameSpan(newState.stateName);
        }

        logEvent({
            errorType: ErrorType.INFO,
            description: `Switching to state: ${newState.stateName}`,
            date: new Date().toString()
        })
        GameManager.gameEvent.emit("stateChange");
        GameManager.currentGameState.endTime = new Date();
        GameManager.currentGameState = newState;
        newState.startTime = new Date();
        newState.stateData = newStateData;
        state.stateName = newState.stateName;
        sendState();

    },

    /** Switch to a state and run its action inside the state's trace context. */
    enterState: (newState: GameState<any, any>, newStateData?: any) => {
        GameManager.switchState(newState, newStateData);
        context.with(stateContext(), () => {
            GameManager.handleStateTransition(newState.action(newStateData), newState);
        });
    },

    startNewGame: () => {

        if (GameManager.currentGameState.stateName === "IDLE") {
            state.gameStartTime = Date.now();
            GameManager.enterState(PlayerSelect);
        } else {
            GameManager.resetGame(true);
        }


    },

    resetGame: (instantRestart: boolean) => {
        if (["ROBOT_WIN", "PLAYER_WIN", "TIE", "PLAYER_SELECTION"].includes(GameManager.currentGameState.stateName)) {
            state.gameStartTime = Date.now();

            GameManager.enterState(CleanUp, instantRestart);
            return true;
        }
        return false;
    },

    handleStateTransition: async (dataPromise: Promise<GameStateOutput<any>>, callingState: GameState<any, any>) => {
        let data: GameStateOutput<any>;
        try {
            data = await dataPromise;
        } catch (e: any) {
            trace.getActiveSpan()?.recordException(e instanceof globalThis.Error ? e : new globalThis.Error(String(e)));
            GameManager.raiseError({
                errorType: ErrorType.FATAL,
                description: "An error occurred during state " + callingState.stateName + (e?.message ? `: ${e.message}` : ""),
                date: new Date().toString()
            });
            return;
        }

        if (callingState !== GameManager.currentGameState) { // If the state has changed during the action execution, we ignore the result
            trace.getActiveSpan()?.addEvent("state.result_ignored", {"game.state.current": GameManager.currentGameState.stateName});
            return;
        }

        if (data.canContinue) {
            if (data.subsequentState != null) {
                GameManager.enterState(data.subsequentState, data.output);
            }
        }
    },
    raiseError: (error: ErrorDescription) => {
        logEvent(error);
    }
};
