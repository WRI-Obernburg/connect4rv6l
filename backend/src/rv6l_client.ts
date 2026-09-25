import * as net from 'net';
import { XMLParser } from 'fast-xml-parser';
import * as stream from 'stream';
import { sendStateToControlPanelClient } from "./internal_server.ts";
import { ErrorType, logEvent } from "./errorHandler/error_handler.ts";
import EventEmitter from "events";
import {context, gameContext, SpanKind, SpanStatusCode, trace, tracer, withSpan, type Span} from "./telemetry.ts";

// Span of the robot action currently executing (actions are sequential).
let currentActionSpan: Span | null = null;
/** Parent context for low-level robot commands: the running action span, or whatever is active. */
function commandContext() {
    return currentActionSpan ? trace.setSpan(context.active(), currentActionSpan) : context.active();
}

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

/** Log a FATAL event and mark the running robot action span as failed. */
function failAction(description: string) {
    currentActionSpan?.setStatus({code: SpanStatusCode.ERROR, message: description});
    currentActionSpan?.addEvent("error", {"error.description": description});
    logEvent({
        errorType: ErrorType.FATAL,
        description,
        date: new Date().toString()
    });
}

function startAction(actionName: string) {
    if (currentActionSpan) {
        currentActionSpan.addEvent("action.overlapped", {"rv6l.next_action": actionName});
    }
    currentActionSpan = tracer.startSpan(`rv6l.${actionName}`, {
        attributes: {
            "rv6l.action": actionName,
            "rv6l.connected": RV6L_STATE.rv6l_connected,
            "rv6l.blue_chips_left": RV6L_STATE.blueChipsLeft,
            "rv6l.red_chips_left": RV6L_STATE.redChipsLeft,
        },
    });
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
    if (currentActionSpan) {
        currentActionSpan.setAttribute("rv6l.duration_ms", new Date().getTime() - new Date(RV6L_STATE.actionStartTime).getTime());
        currentActionSpan.end();
        currentActionSpan = null;
    }
}

export function interruptRV6LAction() {
    logEvent({
        errorType: ErrorType.WARNING,
        description: "Interrupting RV6L action",
        date: new Date().toString()
    })
    currentActionSpan?.addEvent("rv6l.interrupted");
    abortSignal.emit('abort'); // Emit the abort signal to cancel any ongoing operations
    RV6L_STATE.rv6l_moving = false;
    sendStateToControlPanelClient?.();
}

export async function initRV6LClient() {
    gameContext.rv6lMock = RV6L_STATE.mock;
    if (RV6L_STATE.mock) {
        logEvent({
            errorType: ErrorType.WARNING,
            description: "RV6L is in MOCK mode, using mock data instead of real RV6L connection.",
            date: new Date().toString()
        })
        return;
    }
    client = new net.Socket();
    try {
        const ROBOT_HOST = process.env.ROBOT_HOST || '192.168.2.1';
        const ROBOT_PORT = parseInt(process.env.ROBOT_PORT || '80');
        client.connect(ROBOT_PORT, ROBOT_HOST, async function () {
            trace.getActiveSpan()?.addEvent("rv6l.connected", {"net.peer.name": ROBOT_HOST, "net.peer.port": ROBOT_PORT});

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


export async function moveToBlue() {

    startAction("MoveToBlue");

    if (RV6L_STATE.mock) {
        await wait(1000); // Simulate delay for mock
    } else {
        try {
            await writeVariableInProc("I_Aktion", "11");
            await movementDone();
        } catch (error) {
            failAction("Couldn't complete blue chip graping");
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
            await writeVariableInProc("I_Aktion", "21");
            await movementDone();
        } catch (error) {
            failAction("Couldn't complete red chip graping");
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
            await writeVariableInProc("IX_Schacht", column.toString());
            await writeVariableInProc("I_Aktion", "31");
            await movementDone();
        } catch (error) {
            failAction("Couldn't complete move to column " + column);
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
            await writeVariableInProc("I_Aktion", "10");
            await movementDone()
            await writeVariableInProc("I_Aktion", "20");
            await movementDone()
        } catch (error) {
            failAction("Couldn't complete chip palletizing initialization");
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
            await writeVariableInProc("I_Aktion", "90");
            await movementDone();
        } catch (error) {
            failAction("Couldn't complete move to reference position");
        }
    }

    stopAction("MoveToRefPosition");
}

export async function removeFromField(x: number, y:number) {
    startAction("RemoveFromField");
    if( RV6L_STATE.mock) {
        await wait(1000); // Simulate delay for mock
    }else {
        try {
            await writeVariableInProc("IX_Feld", x.toString());
            await writeVariableInProc("IZ_Feld", y.toString());
            await writeVariableInProc("I_Aktion", "41");
            await movementDone();
        } catch (error) {
            failAction("Couldn't complete remove from field at position X:" + x + " Y:" + y);
        }
    }

    stopAction("RemoveFromField");
}

export async function putBackToBlue() {
    startAction("PutBackToBlue");
    if( RV6L_STATE.mock) {
        await wait(1000); // Simulate delay for mock
    }else {
        try {
            await writeVariableInProc("I_Aktion", "12");
            await movementDone();
        } catch (error) {
            failAction("Couldn't complete put back to blue");
        }
    }
    RV6L_STATE.blueChipsLeft++;
    stopAction("PutBackToBlue");
}

export async function putBackToRed() {
    startAction("PutBackToRed");
    if( RV6L_STATE.mock) {
        await wait(1000); // Simulate delay for mock
    }else {
        try {
            await writeVariableInProc("I_Aktion", "22");
            await movementDone();
        } catch (error) {
            failAction("Couldn't complete put back to red");
        }
    }
    RV6L_STATE.redChipsLeft++;
    stopAction("PutBackToRed");
}

async function movementDone() {
    try {
        await waitForVariablePolling("I_Aktion", "0");
    } catch (error) {
        failAction("Error while waiting for movement to complete");
    }
}

async function waitForVariablePolling(variable: string, value: string) {
    let startTime = Date.now();
    const waitSpan = tracer.startSpan("rv6l.wait", {
        attributes: {"rv6l.symbol": variable, "rv6l.expected_value": value},
    }, commandContext());
    const waitCtx = trace.setSpan(context.active(), waitSpan);
    let polls = 0;
    const finish = (ok: boolean, message?: string) => {
        waitSpan.setAttribute("rv6l.polls", polls);
        waitSpan.setAttribute("rv6l.duration_ms", Date.now() - startTime);
        if (!ok) waitSpan.setStatus({code: SpanStatusCode.ERROR, message});
        waitSpan.end();
    };

    return new Promise((resolve, reject) => {
        let abort = false;
        async function poll() {
            try {
                polls++;
                const currentValue = await context.with(waitCtx, () => readVariableInProc(variable));
                if (currentValue.toString() === value) {
                    let deltaTime = Date.now() - startTime;
                    process.stdout.write(` done Took ${deltaTime}ms\n`);
                    abort = true;
                    clearTimeout(timeoutID);
                    abortSignal.removeListener('abort', onAbort); // Remove the abort listener
                    finish(true);
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
                cancel("poll failed: " + error);
                reject(error);
                //log error
                failAction(`Error while polling variable ${variable}: ${error}`);
            }

        }
        poll();
        const cancel = (reason: string = "cancelled or timed out") => {
            if (abort) return;
            abort = true;
            abortSignal.removeListener('abort', onAbort); // Remove the abort listener
            clearTimeout(timeoutID); // Clear the timeout if cancelled
            finish(false, reason);
            failAction(`Canceled waiting for variable ${variable} to be ${value}`);
            reject(new Error(`Canceled waiting for variable ${variable} to be ${value}`));

        }
        const timeoutID = setTimeout(() => {
            cancel("timeout after 30000ms");
        }, 30000); // 30 seconds timeout
        const onAbort = () => cancel("interrupted");
        abortSignal.once('abort', onAbort); // Listen for abort signal
    });
}

async function readVariableInProc(name: string): Promise<string> {
    let messageId = getNextMessageId();
    return withSpan("rv6l.read", {"rv6l.symbol": name, "rv6l.message_id": messageId}, async (span) => {
        const getVariable = `<RSVCMD><clientStamp>${messageId}</clientStamp><symbolApi><readSymbolValue><name>${name}</name></readSymbolValue></symbolApi></RSVCMD>`
        client.write(getVariable);

        const result = await waitForMessage(messageId);
        const value = result.RSVRES.symbolApi.readSymbolValue.value;
        span.setAttribute("rv6l.value", String(value));
        return value;
    }, {kind: SpanKind.CLIENT, parent: commandContext()});
}

async function initSymTable() {
    let messageId = getNextMessageId();
    await withSpan("rv6l.initSymbolTable", {"rv6l.message_id": messageId}, async () => {
        const initSymbolsCommand = `<RSVCMD><clientStamp>${messageId}</clientStamp><symbolApi><initSymbolTable/></symbolApi></RSVCMD>`;
        client.write(initSymbolsCommand);

        await waitForMessage(messageId); // Wait for the response to ensure the write was successful
    }, {kind: SpanKind.CLIENT, parent: commandContext()});
}


async function writeVariableInProc(name: string, value: string) {
    let messageId = getNextMessageId();
    await withSpan("rv6l.write", {"rv6l.symbol": name, "rv6l.value": value, "rv6l.message_id": messageId}, async () => {
        const setVariable = `<RSVCMD><clientStamp>${messageId}</clientStamp><symbolApi><writeSymbolValue><name>${name}</name><value>${value}</value></writeSymbolValue></symbolApi></RSVCMD>`;
        client.write(setVariable);

        await waitForMessage(messageId); // Wait for the response to ensure the write was successful
    }, {kind: SpanKind.CLIENT, parent: commandContext()});
}

export async function toggleGripper(on: boolean) {
    await withSpan("rv6l.ToggleGripper", {"rv6l.action": "ToggleGripper", "rv6l.gripper_on": on}, async () => {
        if (RV6L_STATE.mock) {
            await wait(1000); // Simulate delay for mock
            return;
        }
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
            trace.getActiveSpan()?.addEvent("rv6l.response", {"rv6l.response": JSON.stringify(jsonObj.RSVRES).slice(0, 2000)});
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
            trace.getActiveSpan()?.addEvent("rv6l.response_timeout", {"rv6l.message_id": id});
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