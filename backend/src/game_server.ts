import express from "express";
import { sendState, state } from "./state";
import expressWs from 'express-ws'
import { playMove, resetGame } from "./game";
import cors from 'cors';
import { initSession, sessionState } from "./session";
import { sendStateToInternalClient } from "./internal_server";

const port = 3000

const app = expressWs(express()).app;

app.use(cors());


export let sendStateToClient: (() => void) | null = null;
let previousSessionID = "";

export function initServer() {

    initSession();

    setInterval(async () => {
        if (Date.now() - state.lastUserInteraction > 1000 * 60 * 2 && !state.isGameFieldReady) { // 2 minutes
            console.log("No user interaction for 2 minutes, resetting game state.");
            resetGame();
            await prepareNewGame();
            state.isGameRunning = false;
            state.isHumanTurn = true;
            state.isGameOver = false;
            state.isGameFieldReady = true;
            sendState();
        }
    }, 1000 * 60); // Check every minute



    app.get('/state', (req, res) => {
        res.json(state)
    })

    app.ws('/play', function (ws, req) {
        const sessionID = req.query.sessionID;
        let isPlayer = false;
        if (sessionID && (sessionID === previousSessionID || sessionID === sessionState.currentSessionID)) { //TODO remove true here
            console.log(`WebSocket connection established with session ID: ${sessionID}`);

            state.isPlayerConnected = true;
            isPlayer = true;

            sendStateToClient = () => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify(state));
                } else {
                    console.error('WebSocket is not open. Cannot send state.');
                }
            };

            sendState();

        } else {
            ws.close(4422, 'Invalid session ID');
            console.log(`WebSocket connection closed due to invalid session ID: ${sessionID}`);
            return;
        }
        ws.on('message', function (msg) {
            try {
                const parsedMSG = JSON.parse(msg.toString());

                if (!parsedMSG.type) return;

                if (parsedMSG.type === "placeChip") {
                    handlePlaceChip(parsedMSG);
                }

                if (parsedMSG.type === "startGame") {
                    prepareNewGame();
                }

                if (parsedMSG.type === "setDifficulty") {
                    if (parsedMSG.difficulty && ['easy', 'medium', 'hard'].includes(parsedMSG.difficulty)) {
                        state.lastUserInteraction = Date.now();
                        state.difficulty = parsedMSG.difficulty;
                        console.log(`Difficulty set to: ${state.difficulty}`);
                        sendState();
                    } else {
                        console.error('Invalid difficulty level provided.');
                    }
                }

            } catch (e) {
                console.error('Error parsing message:', e);
                return;
            }
        });

        ws.on('close', function () {

            if (isPlayer) {
                sendStateToClient = null; // Clear the function when the connection is closed
                state.isPlayerConnected = false;
                if (state.isGameOver) {
                    state.isGameRunning = false;
                }

                sendStateToInternalClient?.();

            }
        });
    });


    app.listen(port, () => {
        console.log(`RV6L app listening on port ${port}`)
    })
}

function handlePlaceChip(parsedMSG: any) {
    if (parsedMSG.slot != null && !isNaN(parsedMSG.slot) && parsedMSG.slot >= 0 && parsedMSG.slot < 7) {
        if (state.isGameRunning && state.isHumanTurn && !state.isRobotInAction && !state.isGameOver) {
            state.lastUserInteraction = Date.now();
            playMove(parsedMSG.slot);
            sendState();

        } else {
            console.log('Game is not running or it is not the player\'s turn.');
        }
    } else {
        console.error('Invalid slot number provided for placing chip. ' + parsedMSG.slot);
    }
}

function prepareNewGame(): Promise<void> {
    return new Promise((resolve) => {
        if (!state.isRobotInAction) {
            resetGame();
            //TODO clear physical board

            state.isGameRunning = true;
            state.gameStartTime = Date.now();
            if (state.isGameFieldReady) {
                state.isGameFieldReady = false;
            } else {
                state.isPhysicalBoardClearing = true;
                setTimeout(() => {
                    state.isPhysicalBoardClearing = false;
                    sendState();
                    resolve();
                }, 1000 * 5); // Clear physical board after 5 seconds

            }
            sendState();
        }
    });
}