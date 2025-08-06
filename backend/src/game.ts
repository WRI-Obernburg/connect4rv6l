import * as c4 from "connect4-ai";
import { resetGameState, sendState, state } from "./state";

export const game = new c4.Connect4AI();

export function resetGame() {
    game.reset();
    resetGameState();
    state.board = game.board;
}

export async function playMove(column: number) {
    if(!state.isGameRunning || state.isGameOver || !state.isHumanTurn) {
        console.error("Cannot play move: Game is not running or it's not the human's turn.");
        return;
    }

    if(!game.canPlay(column)) {
        console.error("Cannot play move: Invalid column or column is full.");
        return;
    }

    console.log(`Player placed chip in column: ${column}`);
    console.log("Human played move, now it's the robot's turn.");

    game.play(column);

    state.board = game.board;
    state.isRobotInAction = true;
    checkGameState();

    sendState();
    //TODO drive to column and put chip in

    //simulate robot move
    await new Promise(resolve => setTimeout(resolve, 1000));


    state.isRobotInAction = false;
    state.isHumanTurn = false;
    
    playAIMove();
    
}

async function playAIMove() {
    const moveByAI = game.playAI(state.difficulty);

    state.isRobotInAction = true;
    state.board = game.board;
    sendState();

    //TODO await drive to column and put chip in

    console.log(`Robot played column: ${moveByAI}`);

    //simulate robot move
    await new Promise(resolve => setTimeout(resolve, 1000));

    state.isHumanTurn = true;
    state.isRobotInAction = false;
    checkGameState();

    sendState();


}

function checkGameState() {
    const gameStatus = game.gameStatus();
    state.isGameOver = gameStatus.gameOver;
    state.winner = gameStatus.winner;

    if (state.isGameOver) {
        state.isGameRunning = false;
        console.log(`Game over! Winner: ${state.winner}`);
    }
}