import * as c4 from "connect4-ai";
import {resetGameState, state} from "../state.ts";

export const game = new c4.Connect4AI();

export function resetGame() {
    game.reset();
    resetGameState();
    applyGameMove();
}

export function playMove(column: number):boolean {

    if(!game.canPlay(column)) {
        console.error("Cannot play move: Invalid column or column is full.");
        return false;
    }

    console.log(`Player placed chip in column: ${column}`);

    game.play(column);

    applyGameMove();

    return true;

    
}

export function playAIMove(): number {
    const moveByAI = game.playAI(state.difficulty);

    console.log(`Robot played column: ${moveByAI}`);

    return moveByAI;
}

export function applyGameMove() {
    //game.board is a dictionary with keys as column numbers and values as arrays of chips
    // clone it to avoid mutating the original object
    state.board = JSON.parse(JSON.stringify(game.board));
}

export function setBoard(board: Dict<number[]>) {
    game.board = board;
    applyGameMove();
}

export function checkGameState() {
    const gameStatus = game.gameStatus();

    return {
        isGameOver: gameStatus.gameOver,
        winner: gameStatus.winner
    }

}