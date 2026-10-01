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
// The log is kept in memory and sent to every control panel with each state update, so it must not grow
// without limit (an unbounded log filled the Pi's memory within days while the robot was switched off)
const MAX_ENTRIES = 1000;
export let errors: Array<ErrorDescription> = [];
// counts all events since the start, the log itself only keeps the newest MAX_ENTRIES
let eventCount = 0;
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
    if (errors.length > MAX_ENTRIES) errors.splice(0, errors.length - MAX_ENTRIES);
    eventCount++;
    console.log(`#${eventCount} | Level ${error.errorType} | ${error.description}`)
    //write to file
  //  await errorFile.write(JSON.stringify(errors))

    // Whether the game goes into ERROR is decided by the fault memory (GameManager.applyLock), not by log levels


    sendErrorToControlPanelClient(error);
}

