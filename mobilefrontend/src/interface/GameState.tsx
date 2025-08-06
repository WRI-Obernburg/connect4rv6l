export interface GameState {
    isGameRunning: boolean;
    isPlayerConnected: boolean;
    isRobotInAction: boolean;
    isHumanTurn: boolean;
    isGameOver: boolean;
    winner: number | null,
    board: number[][] | null;
    difficulty: 'easy' | 'medium' | 'hard'; // Difficulty level for AI
    isPhysicalBoardClearing: boolean;
}