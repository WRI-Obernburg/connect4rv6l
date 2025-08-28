import {GameManager, gameStates} from "./game/game_manager.ts";
import express from 'express';
import WebSocket from 'ws';
import {resetGame, setBoard} from './game/game.ts';
import {FRONTEND_ADDRESS} from './index';
import {sendState, state} from './state';
import cors from 'cors';
import expressWs from 'express-ws'
import {v4 as uuidv4} from 'uuid';
import {sessionState} from './session';
import {
    initChipPalletizing,
    interruptRV6LAction,
    moveToBlue,
    moveToColumn,
    moveToRed,
    moveToRefPosition,
    RV6L_STATE,
    toggleGripper,
    removeFromField,
    putBackToBlue,
    putBackToRed
} from "./rv6l_client.ts";
import {type ErrorDescription, errors, ErrorType, logEvent} from "./errorHandler/error_handler.ts";

const port = 4000;

const app = expressWs(express()).app;
app.use(cors());

export const connectionID = uuidv4();


let isInternalFrontendConnected = false;
let controlPanelConnections: Array<WebSocket> = [];
let internalConnections: Array<{
    ws: WebSocket,
    frontendID: string,
    indoor: boolean
}> = []; //connections to the internal frontend

export let sendStateToInternalClient: (() => void) = () => {
    internalConnections.forEach((connection) => {
        sendInternalState(connection.ws);
    });
};
export let sendStateToControlPanelClient: (() => void) = () => {
    controlPanelConnections.forEach((connection) => {
        sendControlPanelState(connection);
    });
};
export let sendErrorToControlPanelClient: ((error: ErrorDescription) => void) = (error => {
    controlPanelConnections.forEach((connection) => {
        sendNewErrorToControlPanel(connection, error);
    });
});

function toggleIdentifyModeOnDisplay(on: boolean) {
    internalConnections.forEach((connection) => {
        if (connection.ws.readyState === connection.ws.OPEN) {
            connection.ws.send(JSON.stringify({
                action: on ? "identifyStart" : "identifyEnd"
            }));
        }
    });
}

// Centralized control command handlers (was a long if/else chain under data.action === "control")
async function handleControlCommand(data: any) {
    const commandHandlers: Record<string, (payload: any) => Promise<void>> = {
        async gripper_on() {
            await toggleGripper(true);
            sendStateToControlPanelClient!();
        },
        async gripper_off() {
            await toggleGripper(false);
            sendStateToControlPanelClient!();
        },
        async move_to_blue() {
            await moveToBlue();
            sendStateToControlPanelClient!();
        },
        async move_to_red() {
            await moveToRed();
            sendStateToControlPanelClient!();
        },
        async move_to_column(payload) {
            if (payload.column != null && typeof payload.column === 'number') {
                await moveToColumn(payload.column);
                sendStateToControlPanelClient!();
            }
        },
        async init_chip_palletizing() {
            await initChipPalletizing();
            sendStateToControlPanelClient!();
        },
        async clean_board_at(payload) {
            if (payload.x == null || payload.y == null) {
                logEvent({
                    description: 'Invalid coordinates for cleanBoardAt command: ' + JSON.stringify({
                        x: payload.x,
                        y: payload.y
                    }),
                    errorType: ErrorType.WARNING,
                    date: new Date().toString()
                });
                return;
            }
            await removeFromField(payload.x, payload.y);
            sendStateToControlPanelClient!();
        },
        async put_back_blue() {
            await putBackToBlue();
            sendStateToControlPanelClient!();
        },
        async put_back_red() {
            await putBackToRed();
            sendStateToControlPanelClient!();
        },
        async move_to_ref_pos() {
            await moveToRefPosition();
            sendStateToControlPanelClient!();
        },
        async cancel_rv6l() {
            interruptRV6LAction();
            sendStateToControlPanelClient!();
        },
        async mock_rv6l(payload) {
            if (payload.mock != null && typeof payload.mock === 'boolean') {
                RV6L_STATE.mock = payload.mock;
                sendStateToControlPanelClient!();
            } else {
                logEvent({
                    description: 'Invalid mock value received: ' + payload.mock,
                    errorType: ErrorType.WARNING,
                    date: new Date().toString()
                });
            }
        }
    };

    const handler = commandHandlers[data.command as keyof typeof commandHandlers];
    if (handler) {
        await handler(data);
    } else {
        logEvent({
            description: 'Unknown control command received: ' + data.command,
            errorType: ErrorType.WARNING,
            date: new Date().toString()
        });
    }
}

// Centralized action handlers for control panel messages
async function handleControlPanelMessage(ws: WebSocket, data: any) {
    const actionHandlers: Record<string, (payload: any) => Promise<void>> = {
        async resetGame() {
            logEvent({
                description: `Resetting game state from control panel`,
                errorType: ErrorType.INFO,
                date: new Date().toString()
            })
            GameManager.resetGame(false);
        },
        async sendState() {
            sendControlPanelState(ws);
        },
        async switchToState(payload) {
            if (payload.stateName == null || !Object.keys(gameStates).includes(payload.stateName)) {
                logEvent({
                    description: 'Unknown state name received: ' + payload.stateName,
                    errorType: ErrorType.WARNING,
                    date: new Date().toString()
                })
                return;
            }
            logEvent({
                description: `Switching to state: ${payload.stateName}`,
                errorType: ErrorType.INFO,
                date: new Date().toString()
            })
            GameManager.switchState(gameStates[payload.stateName as keyof typeof gameStates], payload.stateData);
            GameManager.handleStateTransition(GameManager.currentGameState.action(payload.stateData), GameManager.currentGameState);
            sendStateToControlPanelClient!();
        },
        async control(payload) {
            await handleControlCommand(payload);
        },
        async setBoard(payload) {
            if (payload.board && typeof payload.board === 'object') {
                setBoard(payload.board);
                sendState();
            } else {
                logEvent({
                    description: 'Invalid board data received: ' + JSON.stringify(payload.board),
                    errorType: ErrorType.WARNING,
                    date: new Date().toString()
                });
            }
        },
        async start_identify() {
            toggleIdentifyModeOnDisplay(true);
        },
        async stop_identify() {
            toggleIdentifyModeOnDisplay(false);
        }
    };

    const handler = actionHandlers[data.action as keyof typeof actionHandlers];
    if (handler) {
        await handler(data);
    } else {
        logEvent({
            description: 'Unknown action received: ' + data.action,
            errorType: ErrorType.WARNING,
            date: new Date().toString()
        });
    }
}

export function initInternalServer() {

    //server localfrontend in /localfrontend/dist but only if the request is from localhost
    app.use('/localfrontend', (req, res, next) => {
        express.static('../localfrontend/dist')(req, res, next);
    });

    //server localfrontend in /localfrontend/dist but only if the request is from localhost
    app.use('/control', (req, res, next) => {
        express.static('../controlpanel/dist')(req, res, next);
    });


    app.ws('/ws', (ws, req) => {
        const frontendID = req.query.frontendID as string | undefined;
        const indoor = req.query.indoor as boolean | undefined;


        internalConnections.push({
            ws: ws,
            frontendID: frontendID ?? "",
            indoor: indoor ?? false
        });

        sendInternalState(ws);

        isInternalFrontendConnected = true;
        sendStateToControlPanelClient?.();


        logEvent({
            description: `Internal WebSocket connection established`,
            errorType: ErrorType.INFO,
            date: new Date().toString()
        })

        ws.on('message', () => {
            // no-op
        });

        ws.on('close', () => {
            internalConnections = internalConnections.filter(connection => connection.ws !== ws);
            isInternalFrontendConnected = internalConnections.length > 0;
            sendStateToControlPanelClient?.();
        });

    });


    app.ws('/controlpanel', (ws, req) => {

        controlPanelConnections.push(ws);


        sendControlPanelState(ws);


        logEvent({
            description: `Controlpanel WebSocket connection established`,
            errorType: ErrorType.INFO,
            date: new Date().toString()
        })

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message.toString());
                await handleControlPanelMessage(ws, data);
            } catch (error) {
                logEvent({
                    errorType: ErrorType.WARNING,
                    description: `Error processing message from control panel: ${message.toString()}`,
                    date: new Date().toString()
                });
            }

        });

        ws.on('close', () => {
            controlPanelConnections = controlPanelConnections.filter(connection => connection !== ws);
        });

    });

    app.listen(port, () => {

    })

}

function sendControlPanelState(ws: WebSocket) {
    if (ws.readyState === ws.OPEN) {
        const data = {
            gameState: state,
            sessionState: sessionState,
            gameManager: {
                isPhysicalBoardCleaned: GameManager.isPhysicalBoardCleaned,
            },
            gameStates: gameStates,
            rv6l: {
                connected: RV6L_STATE.rv6l_connected,
                messageCounter: RV6L_STATE.globalMessageCounter,
                moving: RV6L_STATE.rv6l_moving,
                blueChipsLeft: RV6L_STATE.blueChipsLeft,
                redChipsLeft: RV6L_STATE.redChipsLeft,
                mock: RV6L_STATE.mock,
                state: RV6L_STATE.state,

            },
            qrCodeLink: FRONTEND_ADDRESS + "/play?sessionID=" + sessionState.currentSessionID,
            errors: errors,
            isInternalFrontendConnected: isInternalFrontendConnected,
            displays: internalConnections.map(conn => {
                return {
                    frontendID: conn.frontendID,
                    indoor: conn.indoor
                }
            }).filter(frontend => frontend.frontendID !== "")
        }
        ws.send(JSON.stringify({
            "type": "data",
            "data": data
        }));
    } else {
        logEvent({
            errorType: ErrorType.WARNING,
            description: 'WebSocket is not open. Cannot send state.',
            date: new Date().toString()
        });
    }
}

function sendNewErrorToControlPanel(ws: WebSocket, error: ErrorDescription) {
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
            "type": "error",
            "error": error
        }));
    }
}

function sendInternalState(ws: WebSocket) {
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
            action: "data",
            gameState: state,
            qrCodeLink: FRONTEND_ADDRESS + "/play?sessionID=" + sessionState.currentSessionID,
        }));
    } else {
        logEvent({
            errorType: ErrorType.WARNING,
            description: 'WebSocket is not open. Cannot send state.',
            date: new Date().toString()
        });
    }
}