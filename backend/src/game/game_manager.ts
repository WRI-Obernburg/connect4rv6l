import {playerSelection, PlayerSelectionAbortError, waitForTimeout, withTimeout} from "./game_utils.ts";
import {moveToBlue, moveToColumn, moveToRed} from "../rv6l_client.ts";
import {type ErrorDescription, ErrorType, throwError} from "../errorHandler/error_handler.ts";
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
                console.error("Player selection failed, resetting game.");
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
                return {
                    canContinue: false,
                    subsequentState: null,
                    output: -1
                }
            } else {
                console.error("Player selection timed out, resetting game.");
                GameManager.raiseError({
                    errorType: ErrorType.WARNING,
                    description: "Player selection timed out, resetting game.",
                    date: new Date().toString()
                });
                return {
                    canContinue: true,
                    subsequentState: CleanUp,
                    output: 0 // Indicating that the game should start instantly
                }
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
    expectedDuration: 1000 * 60 * 2,
    startTime: null,
    endTime: null,
    action: async (instantRestart: boolean) => {
        resetGame();
        if (!GameManager.isPhysicalBoardCleaned) {
            await withTimeout(new Promise<void>((resolve) => {
                setTimeout(resolve, 1000 * 3);
            }), CleanUp.expectedDuration!);
        }

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
};
GameManager = {
    currentGameState: Idle,
    isPhysicalBoardCleaned: true,
    gameEvent: new EventEmitter(),

    switchState: (newState: GameState<any, any>, newStateData: any) => {
        console.log(`Switching state from ${GameManager.currentGameState.stateName} to ${newState.stateName}`);
        GameManager.gameEvent.emit("stateChange");
        GameManager.currentGameState.endTime = new Date();
        GameManager.currentGameState = newState;
        newState.startTime = new Date();
        newState.stateData = newStateData;
        state.stateName = newState.stateName;
        sendState();

    },

    startNewGame: () => {

        if (GameManager.currentGameState.stateName === "IDLE") {
            state.gameStartTime = Date.now();
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
            console.error("Error during state transition:", e);
            GameManager.raiseError({
                errorType: ErrorType.FATAL,
                description: "An error occurred during state " + callingState.stateName + " error: " + e.name,
                date: new Date().toString()
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
        console.error(`Error raised: ${error.description} (${error.errorType})`);
        throwError(error).then(() => {
            if (error.errorType === ErrorType.FATAL) {
                GameManager.switchState(Error, error);
            }
        })
    }
};