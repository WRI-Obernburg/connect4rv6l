export interface GameState {
    isPlayerConnected: boolean;
    board: Dict<number[]> | null;
    difficulty: 'easy' | 'medium' | 'hard'; // Difficulty level for AI
    stateName: string; // Current state name
}