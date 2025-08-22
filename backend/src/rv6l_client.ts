import * as net from 'net';
import { XMLParser } from 'fast-xml-parser';
import * as stream from 'stream';
import { sendStateToControlPanelClient } from "./internal_server.ts";
import { ErrorType, throwError } from "./errorHandler/error_handler.ts";
import EventEmitter from "events";

var client = new net.Socket();
const parser = new XMLParser();
const incommingStream = new stream.PassThrough();

export let RV6L_STATE = {
    globalMessageCounter: 0,
    rv6l_connected: false,
    rv6l_moving: false,
    state: "IDLE",
    blueChipsLeft: 21,
    redChipsLeft: 21,
    mock: false,
    actionStartTime: new Date().toString()
}

export const abortSignal = new EventEmitter();

function startAction(actionName: string) {
    RV6L_STATE.actionStartTime = new Date().toString();
    RV6L_STATE.state = actionName;
    RV6L_STATE.rv6l_moving = true;
    sendStateToControlPanelClient?.();
    console.log(`Starting action: ${actionName}`);
}

function stopAction(actionName: string) {
    if (RV6L_STATE.state === actionName) {
        const duration = new Date().getTime() - new Date(RV6L_STATE.actionStartTime).getTime();
        console.log(`Action ${actionName} completed in ${duration}ms`);
        RV6L_STATE.state = "IDLE";
        RV6L_STATE.rv6l_moving = false;
        sendStateToControlPanelClient?.();
    }
}

export function interruptRV6LAction() {
    console.log("Interrupting RV6L action");
    abortSignal.emit('abort'); // Emit the abort signal to cancel any ongoing operations
    RV6L_STATE.rv6l_moving = false;
    sendStateToControlPanelClient?.();
}

export function initRV6LClient() {
    if (RV6L_STATE.mock) {
        console.log("WARNING: MOCK_RV6L is enabled, using mock data instead of real RV6L connection.");
        throwError({
            errorType: ErrorType.WARNING,
            description: "RV6L is in MOCK mode, using mock data instead of real RV6L connection.",
            date: new Date().toString()
        })
        return;
    }
    client.connect(80, '192.168.2.1', async function () {

        console.log('Connected');
        RV6L_STATE.rv6l_connected = true;
        sendStateToControlPanelClient?.();

        // START SESSION	const getVariable = "<RSVCMD><clientStamp>123</clientStamp><symbolApi><readSymbolValue><name>IMOVE</name><prog>S:/PROG/4GEWINNT/4GEWINNT</prog></readSymbolValue></symbolApi></RSVCMD>"
        // SEND COMMAND
        const startSessionCommand = 'SYMTABLE_SESSION / \n';
        client.write(startSessionCommand);

        await initSymTable()
        await initChipPalletizing();

        /*await moveToBlue();
        await moveToColumn(1);
	
        await moveToRed();
        await moveToColumn(1)*/


    });

    client.on('data', function (data) {
        //console.log('Received: ' + data);

        //seperate data string after </RSVRES> and process each
        const dataString = data.toString();
        const messages = dataString.split('</RSVRES>');
        messages.forEach((message) => {
            if (message.trim()) { // Check if the message is not empty
                const completeMessage = message + '</RSVRES>';
                const jsonObj = parser.parse(completeMessage);
                incommingStream.write(JSON.stringify(jsonObj)); // Write the complete message to the stream
            }
        });

    });

    client.on('close', function () {
        console.log('Connection closed');
        RV6L_STATE.rv6l_connected = false;
        throwError({
            errorType: ErrorType.FATAL,
            description: "RV6L connection closed unexpectedly. Reconnecting...",
            date: new Date().toString()
        })
        sendStateToControlPanelClient?.();
        console.log("Reconnecting to RV6L...");
        setTimeout(() => {
            initRV6LClient();
        }
        , 5000); // Reconnect after 5 seconds

    });
}


export async function moveToBlue() {

    startAction("MoveToBlue");

    if (RV6L_STATE.mock) {
        await wait(1000); // Simulate delay for mock
    } else {
        try {
            await writeVariableInProc("IMOVE", "1");
            await movementDone();
        } catch (error) {
            console.error("Couldn't complete blue chip graping", error);
            throwError({
                errorType: ErrorType.FATAL,
                description: "Couldn't complete blue chip graping",
                date: new Date().toString()
            });
        }
    }

    RV6L_STATE.blueChipsLeft--;

    stopAction("MoveToBlue");
}

export async function moveToRed() {

    startAction("MoveToRed");
    if (RV6L_STATE.mock) {
        await wait(1000); // Simulate delay for mock
    } else {
        try {
            await writeVariableInProc("IMOVE", "2");
            await movementDone();
        } catch (error) {
            console.error("Couldn't complete red chip graping", error);
            throwError({
                errorType: ErrorType.FATAL,
                description: "Couldn't complete red chip graping",
                date: new Date().toString()
            });
        }
    }

    RV6L_STATE.redChipsLeft--;

    stopAction("MoveToRed");
}

export async function moveToColumn(column: number) {

    if (column != 1) {
        //throw new Error("Only column 1 is supported at the moment");
    }

    if (column < 0 || column > 6) {
        throw new Error("Column must be between 0 and 6");
    }


    startAction("MoveToColumn" + column);

    if (RV6L_STATE.mock) {
        await wait(1000); // Simulate delay for mock
    } else {
        try {
            await writeVariableInProc("IMOVE", (11 + column).toString());
            await movementDone();
        } catch (error) {
            console.error("Couldn't complete move to column " + column, error);
            throwError({
                errorType: ErrorType.FATAL,
                description: "Couldn't complete move to column " + column,
                date: new Date().toString()
            });
        }
    }

    stopAction("MoveToColumn" + column);
}

export async function initChipPalletizing() {

    startAction("InitChipPalletizing");

    if (RV6L_STATE.mock) {
        await wait(1000); // Simulate delay for mock
    } else {
        try {
            await writeVariableInProc("IMOVE", "3");
            await movementDone()
        } catch (error) {
            console.error("Couldn't complete chip palletizing initialization", error);
            throwError({
                errorType: ErrorType.FATAL,
                description: "Couldn't complete chip palletizing initialization",
                date: new Date().toString()
            });
        }
    }

    RV6L_STATE.blueChipsLeft = 21;
    RV6L_STATE.redChipsLeft = 21;
    stopAction("InitChipPalletizing");
}

export async function moveToRefPosition() {
    startAction("MoveToRefPosition");
    if (RV6L_STATE.mock) {
        await wait(1000); // Simulate delay for mock
    } else {
        try {
            await writeVariableInProc("IMOVE", "4");
            await movementDone();
        } catch (error) {
            console.error("Couldn't complete move to reference position", error);
            throwError({
                errorType: ErrorType.FATAL,
                description: "Couldn't complete move to reference position",
                date: new Date().toString()
            });
        }
    }

    stopAction("MoveToRefPosition");
}

async function movementDone() {
    try {
        await waitForVariablePolling("IMOVE", "0");
    } catch (error) {
        throwError({
            errorType: ErrorType.FATAL,
            description: "Error while waiting for movement to complete",
            date: new Date().toString()
        });
    }
}

async function waitForVariablePolling(variable: string, value: string) {
    let startTime = Date.now();

    return new Promise((resolve, reject) => {
        let abort = false;
        async function poll() {
            try {
                const currentValue = await readVariableInProc(variable);
                if (currentValue.toString() === value) {
                    let deltaTime = Date.now() - startTime;
                    process.stdout.write(` done Took ${deltaTime}ms\n`);
                    clearTimeout(timeoutID);
                    abortSignal.removeListener('abort', cancel); // Remove the abort listener
                    resolve(true);
                    return;
                } else {
                    if (!abort) {
                        process.stdout.write(".")
                        setTimeout(() => {
                            poll();
                        }, 200);
                    }
                }
            } catch (error) {
                cancel();
                reject();
            }

        }
        poll();
        const cancel = () => {
            abort = true;
            abortSignal.removeListener('abort', cancel); // Remove the abort listener
            clearTimeout(timeoutID); // Clear the timeout if cancelled
            throwError({
                errorType: ErrorType.FATAL,
                description: `Canceled waiting for variable ${variable} to be ${value}`,
                date: new Date().toString()
            });
            reject(new Error(`Canceled waiting for variable ${variable} to be ${value}`));

        }
        const timeoutID = setTimeout(() => {
            cancel();
        }, 30000); // 30 seconds timeout
        abortSignal.once('abort', cancel); // Listen for abort signal
    });
}

async function readVariableInProc(name: string): Promise<string> {
    let messageId = getNextMessageId();
    const getVariable = `<RSVCMD><clientStamp>${messageId}</clientStamp><symbolApi><readSymbolValue><name>IMOVE</name></readSymbolValue></symbolApi></RSVCMD>`
    client.write(getVariable);

    const result = await waitForMessage(messageId);

    return result.RSVRES.symbolApi.readSymbolValue.value;
}

async function initSymTable() {
    console.log("Initializing symbol table...");
    let messageId = getNextMessageId();
    const initSymbolsCommand = `<RSVCMD><clientStamp>${messageId}</clientStamp><symbolApi><initSymbolTable/></symbolApi></RSVCMD>`;
    client.write(initSymbolsCommand);

    await waitForMessage(messageId); // Wait for the response to ensure the write was successful

}


async function writeVariableInProc(name: string, value: string) {
    let messageId = getNextMessageId();
    const setVariable = `<RSVCMD><clientStamp>${messageId}</clientStamp><symbolApi><writeSymbolValue><name>${name}</name><value>${value}</value></writeSymbolValue></symbolApi></RSVCMD>`;
    client.write(setVariable);

    await waitForMessage(messageId); // Wait for the response to ensure the write was successful

}

export async function toggleGripper(on: boolean) {
    console.log("Toggling gripper to " + (on ? "ON" : "OFF"));

    if (RV6L_STATE.mock) {
        await wait(1000); // Simulate delay for mock
        return;
    }
    let messageId = getNextMessageId();
    const setVariable = `<RSVCMD><clientStamp>${messageId}</clientStamp><symbolApi><writeSymbolValue><name>_IBIN_OUT[6]</name><value>${on ? "1" : "0"}</value></writeSymbolValue></symbolApi></RSVCMD>`;
    client.write(setVariable);

    await waitForMessage(messageId); // Wait for the response to ensure the write was successful

}

async function waitForMessage(id: number): Promise<any> {


    return new Promise((resolve, reject) => {
        const onDataCallback = (data: any) => {
            const jsonObj = JSON.parse(data.toString());
            if (jsonObj.RSVRES.clientStamp !== id) {
                return; // Ignore messages with different clientStamp
            }
            resolve(jsonObj);
            incommingStream.off('data', onDataCallback); // Remove the listener after resolving
            abortSignal.removeListener('abort', cancel); // Remove the abort listener
        };
        const cancel = () => {
            incommingStream.off('data', onDataCallback); // Remove the listener if cancelled
            abortSignal.removeListener('abort', cancel); // Remove the abort listener
            reject(new Error(`Canceled waiting for message with id ${id}`));
            clearTimeout(timeoutID); // Clear the timeout if cancelled
        }
        incommingStream.on('data', onDataCallback);

        const timeoutID = setTimeout(() => {
            cancel();
            reject(new Error(`Timeout waiting for message with id ${id}`));
        }, 5000); // 30 seconds timeout
        abortSignal.once('abort', cancel); // Listen for abort signal

    });
}

function getNextMessageId(): number {
    if (RV6L_STATE.globalMessageCounter >= 1000) {
        RV6L_STATE.globalMessageCounter = 0;
    }
    return RV6L_STATE.globalMessageCounter++;
}

async function wait(ms: number) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(true);
        }, ms);
    });
}