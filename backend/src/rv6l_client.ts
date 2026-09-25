import * as net from 'net';
import { XMLParser } from 'fast-xml-parser';
import { sendStateToControlPanelClient } from "./internal_server.ts";
import { ErrorType, logEvent } from "./errorHandler/error_handler.ts";
import EventEmitter from "events";

var client = new net.Socket();
const parser = new XMLParser();

// TCP has no message boundaries: a response can arrive split over several chunks,
// so unfinished data is kept here until its closing tag arrives
const RESPONSE_END = '</RSVRES>';
let receiveBuffer = '';

// The controller answers every command before it accepts the next one, so commands are sent strictly
// one after another and the next response always belongs to the command in flight. This also matches
// error responses, which carry no clientStamp.
type PendingCommand = {
    body: string,
    timeoutMs: number,
    resolve: (response: any) => void,
    reject: (error: Error) => void,
    timer?: ReturnType<typeof setTimeout>
};
const commandQueue: PendingCommand[] = [];
let commandInFlight: PendingCommand | null = null;

// Incremented by interruptRV6LAction; a running action stops at its next step when it changed
let abortGeneration = 0;

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
    abortGeneration++;
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
                logEvent({
                    errorType: ErrorType.WARNING,
                    description: `Could not initialize the RV6L symbol table: ${err}`,
                    date: new Date().toString()
                });
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
                handleResponse(completeMessage);
            }
        });

        client.on('close', async function () {

            RV6L_STATE.rv6l_connected = false;
            failAllCommands(new Error("RV6L connection closed"));
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
let activeActionGeneration = 0;

function throwIfAborted() {
    if (abortGeneration !== activeActionGeneration) {
        throw new Error("RV6L action was aborted");
    }
}

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
    activeActionGeneration = abortGeneration;
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
                throwIfAborted();
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
        poll();
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

function sendCommand(body: string, timeoutMs = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
        commandQueue.push({ body, timeoutMs, resolve, reject });
        sendNextCommand();
    });
}

function sendNextCommand() {
    if (commandInFlight || commandQueue.length === 0) return;
    if (!RV6L_STATE.rv6l_connected) {
        failAllCommands(new Error("RV6L is not connected"));
        return;
    }
    const command = commandQueue.shift()!;
    commandInFlight = command;
    command.timer = setTimeout(() => {
        // without an answer it is unclear which response belongs to which command, so start over
        commandInFlight = null;
        command.reject(new Error(`No response from RV6L within ${command.timeoutMs} ms`));
        client.destroy();
    }, command.timeoutMs);
    client.write(`<RSVCMD><clientStamp>${getNextMessageId()}</clientStamp>${command.body}</RSVCMD>`);
}

function handleResponse(message: string) {
    const command = commandInFlight;
    if (!command) {
        logEvent({
            errorType: ErrorType.WARNING,
            description: `Unexpected RV6L response without a pending command: ${message}`,
            date: new Date().toString()
        });
        return;
    }
    commandInFlight = null;
    clearTimeout(command.timer);

    try {
        const response = parser.parse(message);
        if (response?.RSVRES?.error !== undefined) {
            const details = [response.RSVRES.error].flat().join(" ");
            command.reject(new Error(`RV6L error: ${details}`));
        } else {
            command.resolve(response);
        }
    } catch (e) {
        command.reject(new Error(`Could not parse RV6L response: ${message}`));
    }
    sendNextCommand();
}

function failAllCommands(error: Error) {
    if (commandInFlight) {
        clearTimeout(commandInFlight.timer);
        commandInFlight.reject(error);
        commandInFlight = null;
    }
    commandQueue.splice(0).forEach((command) => command.reject(error));
}

async function readVariableInProc(name: string): Promise<string> {
    const result = await sendCommand(`<symbolApi><readSymbolValue><name>${escapeXml(name)}</name></readSymbolValue></symbolApi>`);
    return result.RSVRES.symbolApi.readSymbolValue.value;
}

async function initSymTable() {
    // building the symbol table takes several seconds on the controller
    await sendCommand(`<symbolApi><initSymbolTable/></symbolApi>`, 30000);
}

async function writeVariableInProc(name: string, value: string) {
    throwIfAborted();
    await sendCommand(`<symbolApi><writeSymbolValue><name>${escapeXml(name)}</name><value>${escapeXml(value)}</value></writeSymbolValue></symbolApi>`);
}

// Read only access for the telemetry and the variable explorer of the control panel
export async function readSymbols(names: string[]): Promise<Record<string, string>> {
    const body = names.map((name) => `<symbol><name>${escapeXml(name)}</name></symbol>`).join("");
    const result = await sendCommand(`<symbolApi><readSymbolValues>${body}</readSymbolValues></symbolApi>`);
    const symbols = [result.RSVRES.symbolApi.readSymbolValues.symbol].flat();
    return Object.fromEntries(symbols.map((symbol: any) => [String(symbol.name), String(symbol.value ?? "").trim()]));
}

export async function readSymbol(name: string, machineData = false): Promise<string> {
    const result = await sendCommand(`<symbolApi><readSymbolValue><name>${escapeXml(name)}</name>${machineData ? "<machineData/>" : ""}</readSymbolValue></symbolApi>`);
    return String(result.RSVRES.symbolApi.readSymbolValue.value ?? "").trim();
}

export type SymbolListType = "sysVar" | "var" | "input" | "output" | "marker" | "machineData";

export async function getSymbolList(type: SymbolListType): Promise<string[]> {
    const result = await sendCommand(`<symbolApi><getSymbolList><${type}/></getSymbolList></symbolApi>`, 30000);
    const symbols = result.RSVRES.symbolApi.symbolList?.symbol ?? [];
    return [symbols].flat().map((symbol: any) => String(symbol.name));
}

// Only while the robot is standing still, opening the gripper during a movement would drop the chip
export async function toggleGripper(on: boolean) {
    await runAction(on ? "GripperOn" : "GripperOff", async () => {
        await writeVariableInProc("_IBIN_OUT[6]", on ? "1" : "0");
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