import * as c4 from "connect4-ai";
import {resetGameState, state} from "../state.ts";
import {ErrorType, logEvent} from "../errorHandler/error_handler.ts";
import {getTargetPlays, getTop3ScoreTiers, getRandomEle} from "connect4-ai/lib/helperFunctions.js";
import difficultyRatios from "connect4-ai/lib/difficultyRatiosForAI.js";
import {type AIDecision, recordMove} from "./game_analysis.ts";

export const game = new c4.Connect4AI();

export function resetGame() {
    game.reset();
    resetGameState();
    applyGameMove();
}

export function playMove(column: number):boolean {

    if(!game.canPlay(column)) {
        logEvent({
            errorType: ErrorType.WARNING,
            description: `Player attempted to play in invalid column: ${column}`,
            date: new Date().toString()
        });
        return false;
    }

    logEvent({
        errorType: ErrorType.INFO,
        description: `Player placed chip in column: ${column}`,
        date: new Date().toString()
    })

    recordMove("player", column, game.board);
    game.play(column);

    applyGameMove();

    return true;

    
}

/**
 * The same as game.playAI of connect4-ai, step by step, so the control panel can show how the move was chosen:
 * negamax scores per column, the three best score tiers, a random draw that picks the tier by the difficulty,
 * and a random column among those with that tier's score.
 */
export function playAIMove(): number {
    const started = Date.now();
    const scores: (number | null)[] = game.negamaxScores();
    const tiers = getTop3ScoreTiers(scores) as [number, number, number];
    const ratios = difficultyRatios[state.difficulty.toLowerCase()] ?? difficultyRatios.hard!;
    // like getTargetScore of the library, but keeping the random number and the tier it picked
    const draw = Math.random();
    const tier: 1 | 2 | 3 = draw >= 1 - ratios.tier1Ratio ? 1 : draw >= ratios.tier3Ratio ? 2 : 3;
    const candidates: number[] = getTargetPlays(scores, tiers[tier - 1]!);
    const moveByAI: number = getRandomEle(candidates);
    const decision: AIDecision = {
        difficulty: state.difficulty, scores, tiers, draw, tier, candidates, durationMs: Date.now() - started,
        ratios: { tier1: ratios.tier1Ratio, tier2: ratios.tier2Ratio, tier3: ratios.tier3Ratio },
    };
    recordMove("robot", moveByAI, game.board, decision);
    game.play(moveByAI);

    logEvent({
        errorType: ErrorType.INFO,
        description: `Robot placed chip in column: ${moveByAI}`,
        date: new Date().toString()
    });

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