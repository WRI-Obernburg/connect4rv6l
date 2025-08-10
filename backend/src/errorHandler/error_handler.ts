const ERROR_LOG_FILE = "~/rv6l_error.json"
let errors: Array<ErrorDescription> = [];
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
    console.log(`${error.errorType} | ${error.description}`)
    //write to file
    await errorFile.write(JSON.stringify(errors))
}

export interface ErrorDescription {
    errorType: ErrorType,
    description: string
}

export enum ErrorType {
    FATAL, WARNING, INFO
}