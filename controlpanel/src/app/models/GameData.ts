export interface GameState {
    expectedDuration: number | null;
    startTime: Date | null;
    endTime: Date | null;
    stateName: string;
    stateData?: never;
}

export interface ErrorDescription {
    errorType: ErrorType,
    description: string,
    date: string
}

export enum ErrorType {
    FATAL, WARNING, INFO
}

export interface GameData {
    gameState: {
        isPlayerConnected: boolean
        board: null
        difficulty: string
        gameStartTime: number
        lastUserInteraction: number
        stateName: string
    }
    sessionState: {
        currentSessionID: string
        previousSessionID: string
    }
    gameManager: {
        isPhysicalBoardCleaned: boolean
    },
    gameStates: {
        IDLE: GameState
        PLAYER_SELECTION: GameState
        GRAP_BLUE_CHIP: GameState
        PLACE_BLUE_CHIP: GameState
        ROBOT_SELECTION: GameState
        GRAP_RED_CHIP: GameState
        PLACE_RED_CHIP: GameState
        ERROR: GameState
        CLEAN_UP: GameState
        ROBOT_WIN: GameState
        PLAYER_WIN: GameState
        TIE: GameState
    },
    rv6l: {
        connected: boolean
        messageCounter: number
        moving: boolean,
        blueChipsLeft: number,
        redChipsLeft: number,
        mock: boolean,
        state: string
    },
    qrCodeLink: string,
    errors: ErrorDescription[],
    isInternalFrontendConnected: boolean
}