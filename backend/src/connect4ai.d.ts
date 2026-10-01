declare module 'connect4-ai';

// helpers of the library's playAI, used to show how the robot chose its move
declare module 'connect4-ai/lib/helperFunctions.js' {
    export function getTargetPlays(scores: (number | null)[], targetScore: number): number[];
    export function getRandomEle<T>(array: T[]): T;
}

declare module 'connect4-ai/lib/difficultyRatiosForAI.js' {
    const ratios: Record<string, { tier1Ratio: number, tier2Ratio: number, tier3Ratio: number }>;
    export default ratios;
}
