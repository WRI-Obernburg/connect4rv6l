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
    toggleGripper
} from "./rv6l_client.ts";
import {type ErrorDescription, errors, ErrorType, logEvent} from "./errorHandler/error_handler.ts";

const port = 4000;

const app = expressWs(express()).app;
app.use(cors());

export const connectionID = uuidv4();



let isInternalFrontendConnected = false;
let controlPanelConnections:Array<WebSocket> = [];
let internalConnections:Array<WebSocket> = []; //connections to the internal frontend

export let sendStateToInternalClient: (() => void) = () => {
    internalConnections.forEach((connection) => {
        sendInternalState(connection);
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
        const incomingConnectionID = req.query.connectionID;

        internalConnections.push(ws);
        
        sendInternalState(ws);

        isInternalFrontendConnected = true;
        sendStateToControlPanelClient?.();


        logEvent({
            description: `Internal WebSocket connection established`,
            errorType: ErrorType.INFO,
            date: new Date().toString()
        })

        ws.on('message', (message) => {
            
        });

        ws.on('close', () => {
            internalConnections = internalConnections.filter(connection => connection !== ws);
            isInternalFrontendConnected = internalConnections.length > 0;
            sendStateToControlPanelClient?.();
        });

    });

    


    app.ws('/controlpanel', (ws, req) => {
        const incomingConnectionID = req.query.connectionID;

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
                if (data.action === 'resetGame') {
                    logEvent({
                        description: `Resetting game state from control panel`,
                        errorType: ErrorType.INFO,
                        date: new Date().toString()
                    })
                  GameManager.resetGame(false);
                } else if (data.action === 'sendState') {
                    sendControlPanelState(ws);
                } else if (data.action === 'switchToState' && data.stateName != null) {
                    if (!Object.keys(gameStates).includes(data.stateName)) {
                        logEvent({
                            description: 'Unknown state name received: ' + data.stateName,
                            errorType: ErrorType.WARNING,
                            date: new Date().toString()
                        })
                        return;
                    } else {
                        logEvent({
                            description: `Switching to state: ${data.stateName}`,
                            errorType: ErrorType.INFO,
                            date: new Date().toString()
                        })
                        GameManager.switchState(gameStates[data.stateName as keyof typeof gameStates], data.stateData);
                        GameManager.handleStateTransition(GameManager.currentGameState.action(data.stateData), GameManager.currentGameState);
                        sendStateToControlPanelClient!();
                    }
                } else if(data.action === "control") {
                    if (data.command === "gripper_on") {
                        await toggleGripper(true);
                        sendStateToControlPanelClient!();
                    } else if (data.command === "gripper_off") {
                        await toggleGripper(false);
                        sendStateToControlPanelClient!();
                    } else if (data.command === "move_to_blue") {
                        await moveToBlue();
                        sendStateToControlPanelClient!();
                    } else if (data.command === "move_to_red") {
                        await moveToRed()
                        sendStateToControlPanelClient!();
                    } else if (data.command === "move_to_column") {
                        if (data.column != null && typeof data.column === 'number') {
                            await moveToColumn(data.column);
                            sendStateToControlPanelClient!();
                        }
                    } else if (data.command === "init_chip_palletizing") {
                        await initChipPalletizing();
                        sendStateToControlPanelClient!();
                    } else if (data.command === "move_to_ref_pos") {
                        await moveToRefPosition();
                        sendStateToControlPanelClient!();
                    } else if(data.command === "cancel_rv6l") {
                        interruptRV6LAction();
                        sendStateToControlPanelClient!();
                    } else if (data.command === "mock_rv6l") {
                        if (data.mock != null && typeof data.mock === 'boolean') {
                            RV6L_STATE.mock = data.mock;
                            sendStateToControlPanelClient!();
                        } else {
                            logEvent({
                                description: 'Invalid mock value received: ' + data.mock,
                                errorType: ErrorType.WARNING,
                                date: new Date().toString()
                            });
                        }
                    }
                }else if(data.action === "setBoard") {
                    if (data.board && typeof data.board === 'object') {
                        setBoard(data.board);
                        sendState()

                    } else {
                        logEvent({
                            description: 'Invalid board data received: ' + JSON.stringify(data.board),
                            errorType: ErrorType.WARNING,
                            date: new Date().toString()
                        });
                    }
                } else {
                    logEvent({
                        description: 'Unknown action received: ' + data.action,
                        errorType: ErrorType.WARNING,
                        date: new Date().toString()
                    });
                }
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
            isInternalFrontendConnected: isInternalFrontendConnected
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