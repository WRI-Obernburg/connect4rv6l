import express from "express";
import {sendState, state} from "./state";
import expressWs from 'express-ws'
import cors from 'cors';
import {initSession, sessionState} from "./session";
import {sendStateToControlPanelClient, sendStateToInternalClient} from "./internal_server";
import stream from "stream";
import {GameManager} from "./game/game_manager.ts";
import {ErrorType, logEvent} from "./errorHandler/error_handler.ts";

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
        let isPlayer = false;
        if (sessionID && (sessionID === previousSessionID || sessionID === sessionState.currentSessionID)) {

            state.isPlayerConnected = true;
            isPlayer = true;

            sendStateToClient = () => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify(state));
                } else {
                    logEvent({
                        errorType: ErrorType.WARNING,
                        description: 'WebSocket is not open. Cannot send state.',
                        date: new Date().toString()
                    })
                }
            };

            sendState();

        } else {
            ws.close(4422, 'Invalid session ID');
            logEvent({
                errorType: ErrorType.WARNING,
                description: `WebSocket connection closed due to invalid session ID: ${sessionID}`,
                date: new Date().toString()
            })
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
                        sendState();
                    } else {
                        logEvent({
                            errorType: ErrorType.WARNING,
                            description: `Invalid difficulty level provided: ${parsedMSG.difficulty}`,
                            date: new Date().toString()
                        });
                    }
                }

            } catch (e) {
                logEvent({
                    errorType: ErrorType.WARNING,
                    description: `Error parsing message from player: ${msg.toString()}`,
                    date: new Date().toString()
                });
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

    })
}

function handlePlaceChip(parsedMSG: any) {
    if (parsedMSG.slot != null && !isNaN(parsedMSG.slot) && parsedMSG.slot >= 0 && parsedMSG.slot < 7) {
        playerDataStream.write(JSON.stringify({
            slot: parsedMSG.slot,
            type: "placeChip"
        }));
    } else {
        logEvent({
            errorType: ErrorType.WARNING,
            description: `Invalid slot number provided for placing chip: ${parsedMSG.slot}`,
            date: new Date().toString()
        })
    }
}

