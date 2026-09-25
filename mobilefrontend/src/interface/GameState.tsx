export type Winner = "player" | "robot" | "tie";

export interface PlayerView {
    // active: plays now, offered: first in the queue and may start, queued: waits, spectator: only watches
    role: "active" | "offered" | "queued" | "spectator";
    nickname: string;
    position: number | null;
    offerEndsAt: number | null;
    canStart: boolean;
    canRestart: boolean;
    // result of this phone's own last game, shown while the board is cleared
    ownResult: Winner | null;
}

export interface GameState {
    isPlayerConnected: boolean;
    board: Dict<number[]> | null;
    difficulty: 'easy' | 'medium' | 'hard'; // Difficulty level for AI
    stateName: string; // Current state name
    active: { nickname: string } | null;
    queue: { nickname: string, position: number, offered: boolean, connected: boolean }[];
    lastResult: { winner: Winner, nickname: string, at: number } | null;
    player: PlayerView;
}
