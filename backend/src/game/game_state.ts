export default interface GameState<Input, Output> {
    expectedDuration: number | null;
    startTime: Date | null;
    endTime: Date | null;
    stateName: string;
    stateData?: any;


    action: (arg: Input) => Promise<GameStateOutput<Output>>
}

export interface GameStateOutput<Output> {
    output?: Output,
    subsequentState: GameState<any, any> | null,
    canContinue: boolean,
}