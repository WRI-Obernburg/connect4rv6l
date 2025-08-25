import { GameManager, gameStates } from "../game/game_manager";
import { sendErrorToControlPanelClient } from "../internal_server";
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

        //await errorFile.write("[]");
    }
}

export async function logEvent(error: ErrorDescription) {
    errors.push(error);
    console.log(`#${errors.length} | Level ${error.errorType} | ${error.description}`)
    //write to file
  //  await errorFile.write(JSON.stringify(errors))

    if(error.errorType === ErrorType.FATAL) {
        GameManager.switchState(gameStates.ERROR, error);
    }


    sendErrorToControlPanelClient(error);
}

