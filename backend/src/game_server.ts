import express from "express";
import {sendState, state} from "./state";
import expressWs from 'express-ws'
import {playMove, resetGame} from "./game/game.ts";
import cors from 'cors';
import {initSession, sessionState} from "./session";
import {sendStateToControlPanelClient, sendStateToInternalClient} from "./internal_server";
import stream from "stream";
import {GameManager} from "./game/game_manager.ts";

const port = 3000

const app = expressWs(express()).app;

app.use(cors());

export const playerDataStream = new stream.PassThrough();


export let sendStateToClient: (() => void) | null = null;
let previousSessionID = "";

export function initServer() {

    initSession();


    app.get('/state', (req, res) => {
        res.json(state)
    })

    app.ws('/play', function (ws, req) {
        const sessionID = req.query.sessionID;
        console.log("sessionID", sessionID);
        let isPlayer = false;
        if (sessionID && (sessionID === previousSessionID || sessionID === sessionState.currentSessionID) || true) { //TODO remove true here
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
                    GameManager.startNewGame();
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
                console.log("ERROR")
                return;
            }
        });

        ws.on('close', function () {

            if (isPlayer) {
                sendStateToClient = null; // Clear the function when the connection is closed
                state.isPlayerConnected = false;
                sendStateToInternalClient?.();
                sendStateToControlPanelClient?.();
            }
        });
    });


    app.listen(port, () => {
        console.log(`RV6L app listening on port ${port}`)
    })
}

function handlePlaceChip(parsedMSG: any) {
    if (parsedMSG.slot != null && !isNaN(parsedMSG.slot) && parsedMSG.slot >= 0 && parsedMSG.slot < 7) {
        playerDataStream.write(JSON.stringify({
            slot: parsedMSG.slot,
            type: "placeChip"
        }));
    } else {
        console.error('Invalid slot number provided for placing chip. ' + parsedMSG.slot);
    }
}

