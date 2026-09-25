import * as net from 'net';
import { XMLParser } from 'fast-xml-parser';
import * as stream from 'stream';
import { sendStateToControlPanelClient } from "./internal_server.ts";
import { ErrorType, logEvent } from "./errorHandler/error_handler.ts";
import EventEmitter from "events";

var client = new net.Socket();
const parser = new XMLParser();
const incommingStream = new stream.PassThrough();

// TCP has no message boundaries: a response can arrive split over several chunks,
// so unfinished data is kept here until its closing tag arrives
const RESPONSE_END = '</RSVRES>';
let receiveBuffer = '';

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
}

function stopAction(actionName: string) {
    if (RV6L_STATE.state === actionName) {
        const duration = new Date().getTime() - new Date(RV6L_STATE.actionStartTime).getTime();
        logEvent({
            errorType: ErrorType.INFO,
            description: `Action ${actionName} completed in ${duration}ms`,
            date: new Date().toString()
        });
        RV6L_STATE.state = "IDLE";
        RV6L_STATE.rv6l_moving = false;
        sendStateToControlPanelClient?.();
    }
}

export function interruptRV6LAction() {
    logEvent({
        errorType: ErrorType.WARNING,
        description: "Interrupting RV6L action",
        date: new Date().toString()
    })
    // Only stops waiting in this process, the robot itself finishes its current movement.
    // The running action rejects and releases its lock; the next command waits until I_Aktion is 0 again.
    abortSignal.emit('abort');
}

export async function initRV6LClient() {
    if (RV6L_STATE.mock) {
        logEvent({
            errorType: ErrorType.WARNING,
            description: "RV6L is in MOCK mode, using mock data instead of real RV6L connection.",
            date: new Date().toString()
        })
        return;
    }
    client = new net.Socket();
    client.setEncoding('utf8'); // don't split multi-byte characters between chunks
    receiveBuffer = '';
    try {
        const ROBOT_HOST = process.env.ROBOT_HOST || '192.168.2.1';
        const ROBOT_PORT = parseInt(process.env.ROBOT_PORT || '80');
        client.connect(ROBOT_PORT, ROBOT_HOST, async function () {

            logEvent({
                errorType: ErrorType.INFO,
                description: "Connected to RV6L",
                date: new Date().toString()
            })

            RV6L_STATE.rv6l_connected = true;
            sendStateToControlPanelClient?.();

            const startSessionCommand = 'SYMTABLE_SESSION / \n';
            client.write(startSessionCommand);

            await initSymTable().catch((err) => {
            })
            // await initChipPalletizing()


        });

        client.on('data', function (data) {
            receiveBuffer += data.toString();

            // process every complete response, keep the incomplete rest for the next chunk
            let end;
            while ((end = receiveBuffer.indexOf(RESPONSE_END)) !== -1) {
                const completeMessage = receiveBuffer.slice(0, end + RESPONSE_END.length);
                receiveBuffer = receiveBuffer.slice(end + RESPONSE_END.length);
                try {
                    const jsonObj = parser.parse(completeMessage);
                    incommingStream.write(JSON.stringify(jsonObj));
                } catch (e) {
                    logEvent({
                        errorType: ErrorType.WARNING,
                        description: `Could not parse RV6L response: ${completeMessage}`,
                        date: new Date().toString()
                    });
                }
            }
        });

        client.on('close', async function () {

            RV6L_STATE.rv6l_connected = false;
            logEvent({
                errorType: ErrorType.WARNING,
                description: "RV6L connection closed unexpectedly. Reconnecting...",
                date: new Date().toString()
            })
            client.destroy(); // Destroy the current client connection
            client.removeAllListeners(); // Remove all listeners to avoid duplicate events
            sendStateToControlPanelClient?.();
            await new Promise(resolve => setTimeout(resolve, 5000));
            logEvent({
                errorType: ErrorType.INFO,
                description: "Reconnecting to RV6L...",
                date: new Date().toString()
            })

            RV6L_STATE.globalMessageCounter = 0; // Reset the message counter
            initRV6LClient(); // Reinitialize the RV6L client

        });

        client.on("error",async (err) => {
            //ignore error cause close event will be triggered
        });

    }catch (e) {

        //ignore error cause close event will be triggered

    }
}


export class RV6LBusyError extends Error {
    constructor() {
        super("RV6L is already executing an action");
        this.name = "RV6LBusyError";
    }
}

/**
 * Runs one robot action. Only one action may run at a time, and a command is only sent
 * when the robot reports that it has finished its previous movement (I_Aktion == 0).
 * Errors are passed on to the caller so the game stops instead of sending the next command.
 */
async function runAction(actionName: string, robotSteps: () => Promise<void>) {
    if (RV6L_STATE.rv6l_moving) {
        logEvent({
            errorType: ErrorType.WARNING,
            description: `Rejected ${actionName}: RV6L is busy with ${RV6L_STATE.state}`,
            date: new Date().toString()
        });
        throw new RV6LBusyError();
    }

    startAction(actionName);
    try {
        if (RV6L_STATE.mock) {
            await wait(1000); // Simulate delay for mock
        } else {
            await ensureRobotReady();
            await robotSteps();
        }
        stopAction(actionName);
    } catch (error) {
        logEvent({
            errorType: ErrorType.FATAL,
            description: `Couldn't complete ${actionName}: ${error}`,
            date: new Date().toString()
        });
        throw error;
    } finally {
        // release the lock; if the robot is still moving, ensureRobotReady blocks the next command
        if (RV6L_STATE.state === actionName) {
            RV6L_STATE.state = "IDLE";
            RV6L_STATE.rv6l_moving = false;
            sendStateToControlPanelClient?.();
        }
    }
}

async function ensureRobotReady() {
    if (!RV6L_STATE.rv6l_connected) {
        throw new Error("RV6L is not connected");
    }
    const currentAction = await readVariableInProc("I_Aktion");
    if (String(currentAction) !== "0") {
        throw new Error(`RV6L is not ready, I_Aktion is ${currentAction}`);
    }
}

export async function moveToBlue() {
    await runAction("MoveToBlue", async () => {
        await writeVariableInProc("I_Aktion", "11");
        await movementDone();
    });
    RV6L_STATE.blueChipsLeft--;
}

export async function moveToRed() {
    await runAction("MoveToRed", async () => {
        await writeVariableInProc("I_Aktion", "21");
        await movementDone();
    });
    RV6L_STATE.redChipsLeft--;
}

export async function moveToColumn(column: number) {
    if (!Number.isInteger(column) || column < 0 || column > 6) {
        throw new Error("Column must be an integer between 0 and 6");
    }

    await runAction("MoveToColumn" + column, async () => {
        await writeVariableInProc("IX_Schacht", column.toString());
        await writeVariableInProc("I_Aktion", "31");
        await movementDone();
    });
}

export async function initChipPalletizing() {
    await runAction("InitChipPalletizing", async () => {
        await writeVariableInProc("I_Aktion", "10");
        await movementDone();
        await writeVariableInProc("I_Aktion", "20");
        await movementDone();
    });
    RV6L_STATE.blueChipsLeft = 21;
    RV6L_STATE.redChipsLeft = 21;
}

export async function moveToRefPosition() {
    await runAction("MoveToRefPosition", async () => {
        await writeVariableInProc("I_Aktion", "90");
        await movementDone();
    });
}

export async function removeFromField(x: number, y:number) {
    if (!Number.isInteger(x) || x < 0 || x > 6 || !Number.isInteger(y) || y < 0 || y > 5) {
        throw new Error("Field position must be integers with x between 0 and 6 and y between 0 and 5");
    }

    await runAction("RemoveFromField", async () => {
        await writeVariableInProc("IX_Feld", x.toString());
        await writeVariableInProc("IZ_Feld", y.toString());
        await writeVariableInProc("I_Aktion", "41");
        await movementDone();
    });
}

export async function putBackToBlue() {
    await runAction("PutBackToBlue", async () => {
        await writeVariableInProc("I_Aktion", "12");
        await movementDone();
    });
    RV6L_STATE.blueChipsLeft++;
}

export async function putBackToRed() {
    await runAction("PutBackToRed", async () => {
        await writeVariableInProc("I_Aktion", "22");
        await movementDone();
    });
    RV6L_STATE.redChipsLeft++;
}

async function movementDone() {
    await waitForVariablePolling("I_Aktion", "0");
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
                reject(error);
                //log error
                logEvent({
                    errorType: ErrorType.FATAL,
                    description: `Error while polling variable ${variable}: ${error}`,
                    date: new Date().toString()
                });
            }

        }
        poll();
        const cancel = () => {
            abort = true;
            abortSignal.removeListener('abort', cancel); // Remove the abort listener
            clearTimeout(timeoutID); // Clear the timeout if cancelled
            logEvent({
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

// Values end up inside XML commands, so they must never be able to close a tag and inject further commands
function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

async function readVariableInProc(name: string): Promise<string> {
    let messageId = getNextMessageId();
    const getVariable = `<RSVCMD><clientStamp>${messageId}</clientStamp><symbolApi><readSymbolValue><name>${escapeXml(name)}</name></readSymbolValue></symbolApi></RSVCMD>`
    client.write(getVariable);

    const result = await waitForMessage(messageId);

    return result.RSVRES.symbolApi.readSymbolValue.value;
}

async function initSymTable() {
    let messageId = getNextMessageId();
    const initSymbolsCommand = `<RSVCMD><clientStamp>${messageId}</clientStamp><symbolApi><initSymbolTable/></symbolApi></RSVCMD>`;
    client.write(initSymbolsCommand);

    await waitForMessage(messageId); // Wait for the response to ensure the write was successful

}


async function writeVariableInProc(name: string, value: string) {
    let messageId = getNextMessageId();
    const setVariable = `<RSVCMD><clientStamp>${messageId}</clientStamp><symbolApi><writeSymbolValue><name>${escapeXml(name)}</name><value>${escapeXml(value)}</value></writeSymbolValue></symbolApi></RSVCMD>`;
    client.write(setVariable);

    await waitForMessage(messageId); // Wait for the response to ensure the write was successful

}

// Only while the robot is standing still, opening the gripper during a movement would drop the chip
export async function toggleGripper(on: boolean) {
    await runAction(on ? "GripperOn" : "GripperOff", async () => {
        await writeVariableInProc("_IBIN_OUT[6]", on ? "1" : "0");
    });
}

async function waitForMessage(id: number): Promise<any> {

    return new Promise((resolve, reject) => {
        const onDataCallback = (data: any) => {
            const jsonObj = JSON.parse(data.toString());
            try{
                if (jsonObj.RSVRES.clientStamp !== id) {
                    return; // Ignore messages with different clientStamp
                }
            }catch(e){
                return;
            }
            resolve(jsonObj);
            incommingStream.off('data', onDataCallback); // Remove the listener after resolving
            abortSignal.removeListener('abort', cancel); // Remove the abort listener
            clearTimeout(timeoutID);
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
        }, 5000);
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