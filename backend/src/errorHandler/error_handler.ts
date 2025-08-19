import { GameManager, gameStates } from "../game/game_manager";
export interface ErrorDescription {
    errorType: ErrorType,
    description: string,
    date: string
}

export enum ErrorType {
    FATAL, WARNING, INFO
}
const ERROR_LOG_FILE = "logs/rv6l_error.json"
export let errors: Array<ErrorDescription> = [];
const errorFile = Bun.file(ERROR_LOG_FILE);

export async function initErrorHandler() {
    try {
        const errorFileContent = await errorFile.text();
        errors = JSON.parse(errorFileContent);
    } catch (e) {
        console.log("Could not load error file");
        await errorFile.write("[]");
    }
}

export async function throwError(error: ErrorDescription) {
    errors.push(error);
    console.log(`#${errors.length} | Level ${error.errorType} | ${error.description}`)
    //write to file
    await errorFile.write(JSON.stringify(errors))

    if(error.errorType === ErrorType.FATAL) {
        GameManager.switchState(gameStates.ERROR, error);
    }
}

