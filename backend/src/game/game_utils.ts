import {playerDataStream} from "../game_server.ts";


export function playerSelection(): {promise: Promise<number>, abort: () => void} {
    let abort: Function | null = null;
    const promise = new Promise((resolve: (arg:number) => void, reject) => {
        abort = () => {
            playerDataStream.off("data", onDataCallback);
            reject(new PlayerSelectionAbortError());
        };
        const onDataCallback = (data: string) => {
            const jsonObj = JSON.parse(data.toString());
            if (jsonObj.type === "placeChip") {
                resolve(jsonObj.slot as number);
                playerDataStream.off("data", onDataCallback);
            }
        };
        playerDataStream.on("data", onDataCallback);
    })

    return {
        promise,
        abort: () => {
            if (abort) {
                abort();
            }
        }
    }

}

export class PlayerSelectionAbortError extends Error {
    constructor() {
        super("Player selection aborted");
        this.name = "PlayerSelectionAbortError";
    }
}

const raceTimeout = (ms: number) => new Promise((_, reject) => setTimeout(reject, ms));

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return await Promise.race([promise, raceTimeout(ms)]) as Promise<T>;

}

export async function waitForTimeout(ms:number) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(true);
        }, ms);
    });
}