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

export interface TelemetryValue {
    id: string
    group: string
    label: string
    symbol: string
    kind: "number" | "flag" | "position" | "bits" | "text"
    unit?: string
    note?: string
    available: boolean
    value: number | string | null
    alarm: boolean
    alarmText?: string
    okText?: string
    severity?: "fatal" | "warning"
    position?: { x: number, y: number, z: number, axes: number[] }
}

export interface ControllerMessage {
    number: number
    source: "active" | "displayed"
    level: string | null
    reference: { code: string, message: string, cause: string, remedy: string } | null
}

export interface FaultEntry {
    key: string
    title: string
    severity: "fatal" | "warning"
    critical: boolean
    source: string
    details?: string
    active: boolean
    firstSeen: string
    lastSeen: string
    occurrences: number
    acknowledgedAt?: string
    // comes from the robot or its controller; ignored for the lock while the RV6L connection is mocked
    hardware?: boolean
}

export interface QueueEntry {
    clientId: string
    nickname: string
    joinedAt: number
    offeredAt?: number
    disconnectedAt?: number
    position: number
    connected: boolean
}

export interface PlayersState {
    active: { clientId: string, nickname: string } | null
    queue: QueueEntry[]
    lastResult: { winner: "player" | "robot" | "tie" | "aborted", nickname: string, at: number } | null
}

export type TestMode = "fill" | "clear" | "cycle"

export interface TestConfig {
    mode: TestMode
    // only for "cycle"; 0 runs until stopped
    cycles: number
    minChips: number
    maxChips: number
    pauseSeconds: number
}

export interface TestStatus {
    running: boolean
    phase: "idle" | "init" | "fill" | "clear" | "pause"
    config: TestConfig | null
    cycle: number
    cyclesDone: number
    chipsPlaced: number
    chipsRemoved: number
    targetChips: number
    startedAt: string | null
    finishedAt: string | null
    stopRequested: boolean
    result: "done" | "stopped" | "aborted" | "failed" | null
    error: string | null
    actions: Record<string, { count: number, totalMs: number, minMs: number, maxMs: number }>
    cycles: Array<{ cycle: number, chips: number, fillMs: number, clearMs: number, finishedAt: string }>
}

export interface TelegramContact {
    chatId: number
    name: string
    requestedAt: string
    // not set while the contact waits for approval
    approvedAt?: string
}

export interface AIDecision {
    difficulty: string
    // negamax score per column, null for a full column (positive: the robot can force a win)
    scores: (number | null)[]
    // scores of tier 1 to 3 as the library computed them
    tiers: [number, number, number]
    ratios: { tier1: number, tier2: number, tier3: number }
    // the random number that picked the tier, and the tier it picked
    draw: number
    tier: 1 | 2 | 3
    candidates: number[]
    durationMs: number
}

export interface AnalysisMove {
    number: number
    by: "player" | "robot"
    column: number
    // board before the move, columns from the bottom (1 player, 2 robot)
    boardBefore: Record<string, number[]>
    at: string
    decision?: AIDecision
}

export interface CleanupStep {
    column: number
    row: number
    color: 1 | 2
    status: "pending" | "removing" | "returning" | "done" | "failed"
    startedAt?: string
    durationMs?: number
}

export interface Analysis {
    game: { startedAt: string, moves: AnalysisMove[], result: string | null } | null
    cleanup: {
        reason: string
        startedAt: string
        finishedAt: string | null
        phase: "init" | "chips" | "reinit" | "done" | "failed"
        steps: CleanupStep[]
        error: string | null
    } | null
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
        // a stop requested by the game master, taken after the current robot movement
        pendingStop?: { restart: boolean, requestedAt: number } | null
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
        state: string,
        telemetry?: {
            updatedAt: string | null
            values: TelemetryValue[]
            messages?: ControllerMessage[]
        }
    },
    faultMemory?: {
        open: FaultEntry[]
        acknowledged: FaultEntry[]
        // open critical faults; while there are any, the game is locked in ERROR
        lockReasons: string[]
        mock?: boolean
    },
    players?: PlayersState,
    testRun?: TestStatus,
    analysis?: Analysis,
    telegram?: { enabled: boolean, connected: boolean, contacts: TelegramContact[] },
    qrCodeLink: string,
    errors: ErrorDescription[],
    isInternalFrontendConnected: boolean,
    displays: Array<{
        frontendID: string,
        indoor: boolean
    }>
}