import {GameManager, gameStates} from "./game/game_manager.ts";

const port = 4000;
import express from 'express';
import WebSocket from 'ws';
import {resetGame, setBoard} from './game/game.ts';
import { FRONTEND_ADDRESS } from './index';
import {sendState, state} from './state';
import cors from 'cors';
import expressWs from 'express-ws'
import { v4 as uuidv4 } from 'uuid';
import { sessionState } from './session';
import {
    RV6L_STATE,
    moveToBlue, moveToColumn,
    moveToRed,
    toggleGripper, interruptRV6LAction, initChipPalletizing, moveToRefPosition
} from "./rv6l_client.ts";
import {errors} from "./errorHandler/error_handler.ts";

const app = expressWs(express()).app;
app.use(cors());

export const connectionID = uuidv4();

export let sendStateToInternalClient: (() => void) | null = null;
export let sendStateToControlPanelClient: (() => void) | null = null;

let isInternalFrontendConnected = false;

export function initInternalServer() {

    //server localfrontend in /localfrontend/dist but only if the request is from localhost
    app.use('/localfrontend', (req, res, next) => {
        if (req.hostname === 'localhost') {
            express.static('../localfrontend/dist')(req, res, next);
        } else {
            res.status(403).send('Forbidden');
        }
    });

    //server localfrontend in /localfrontend/dist but only if the request is from localhost
    app.use('/control', (req, res, next) => {
        express.static('../controlpanel/dist')(req, res, next);
    });

    app.use('/controlpanel', (req, res, next) => {
        if (req.hostname === 'localhost') {
            express.static('../controlpanel/dist')(req, res, next);
        } else {
            res.status(403).send('Forbidden');
        }
    });

    app.ws('/ws', (ws, req) => {
        const incomingConnectionID = req.query.connectionID;
        

        sendStateToInternalClient = () => {
            sendInternalState(ws);
        }
        sendInternalState(ws);

        isInternalFrontendConnected = true;
        sendStateToControlPanelClient?.();


        console.log('Internal WebSocket connection established');

        ws.on('message', (message) => {
            
        });

        ws.on('close', () => {
            console.log('WebSocket connection closed');
            sendStateToInternalClient = null;
            isInternalFrontendConnected = false;
            sendStateToControlPanelClient?.();
        });

    });

    app.ws('/controlpanel', (ws, req) => {
        const incomingConnectionID = req.query.connectionID;


        sendStateToControlPanelClient = () => {
            sendControlPanelState(ws);
        }
        sendControlPanelState(ws);


        console.log('Internal WebSocket connection established');

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message.toString());
                if (data.action === 'resetGame') {
                    console.log('Resetting game state from control panel');
                  GameManager.resetGame(false);
                } else if (data.action === 'sendState') {
                    sendControlPanelState(ws);
                } else if (data.action === 'switchToState' && data.stateName != null) {
                    if (!Object.keys(gameStates).includes(data.stateName)) {
                        console.warn('Unknown state name received:', data.stateName);
                        return;
                    } else {
                        console.log('Switching to state:', data.stateName);
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
                            console.warn('Invalid mock value received:', data.mock);
                        }
                    }
                }else if(data.action === "setBoard") {
                    if (data.board && typeof data.board === 'object') {
                        setBoard(data.board);
                        sendState()

                    } else {
                        console.warn('Invalid board data received:', data.board);
                    }
                } else {
                    console.warn('Unknown action received:', data.action);
                }
            } catch (error) {
                console.error('Error processing message:', error);
            }

        });

        ws.on('close', () => {
            console.log('WebSocket connection closed');
            sendStateToControlPanelClient = null;
        });

    });

    app.listen(port, () => {
        console.log(`Internal server listening on port ${port}`)
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
        ws.send(JSON.stringify(data));
    } else {
        console.error('WebSocket is not open. Cannot send state.');
    }
}

function sendInternalState(ws: WebSocket) {
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
            gameState: state,
            qrCodeLink: FRONTEND_ADDRESS + "/play?sessionID=" + sessionState.currentSessionID,
        }));
    } else {
        console.error('WebSocket is not open. Cannot send state.');
    }
}