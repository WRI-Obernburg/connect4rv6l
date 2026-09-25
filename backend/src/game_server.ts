import express from "express";
import {sendState, state} from "./state";
import expressWs from 'express-ws'
import cors from 'cors';
import {initSession, sessionState} from "./session";
import {sendStateToControlPanelClient, sendStateToInternalClient} from "./internal_server";
import stream from "stream";
import {GameManager, gameStates} from "./game/game_manager.ts";
import {ErrorType, logEvent} from "./errorHandler/error_handler.ts";
import { game } from "./game/game.ts";
import {
    addSocket, forEachSocket, isActivePlayer, isAnyPlayerConnected, joinQueue, leaveQueue, mayRestart, mayStart,
    playerView, publicQueue, removeSocket, setNickname, startPlaying, updateQueue,
} from "./players.ts";

const port = 3000

const app = expressWs(express()).app;

app.use(cors());

export const playerDataStream = new stream.PassThrough();


export let sendStateToClient: (() => void) | null = null;

const isIdle = () => GameManager.currentGameState.stateName === "IDLE";

// Every phone gets the common game state plus the queue and its own role in it
function broadcastState() {
    const idle = isIdle();
    const common = { ...state, ...publicQueue() };
    forEachSocket((clientId, ws) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ ...common, player: playerView(clientId, idle) }));
    });
}

// Centralized player message handlers; only the active player may play, the others wait or watch
function handlePlayerMessage(clientId: string, parsedMSG: any) {
    if (!parsedMSG?.type) return;

    const handlers: Record<string, (payload: any) => void> = {
        placeChip(payload) {
            if (!isActivePlayer(clientId)) return;
            state.lastUserInteraction = Date.now();
            handlePlaceChip(payload);
        },
        startGame() {
            if (isActivePlayer(clientId)) {
                // a new game from within one's own game, only while nobody waits
                if (mayRestart(clientId)) GameManager.startNewGame();
                return;
            }
            if (!mayStart(clientId, isIdle())) return;
            startPlaying(clientId);
            GameManager.startNewGame();
            logEvent({
                errorType: ErrorType.INFO,
                description: `${publicQueue().active?.nickname} startet ein Spiel`,
                date: new Date().toString()
            });
            sendState();
        },
        setDifficulty(payload) {
            // the player, or the one allowed to start next, chooses the difficulty
            if (!isActivePlayer(clientId) && !mayStart(clientId, isIdle())) return;
            if (payload.difficulty && ['easy', 'medium', 'hard'].includes(payload.difficulty)) {
                state.lastUserInteraction = Date.now();
                state.difficulty = payload.difficulty;
                sendState();
            } else {
                logEvent({
                    errorType: ErrorType.WARNING,
                    description: `Invalid difficulty level provided: ${payload.difficulty}`,
                    date: new Date().toString()
                });
            }
        },
        setNickname(payload) {
            setNickname(clientId, payload.nickname);
            sendState();
        },
        joinQueue(payload) {
            if (payload.nickname) setNickname(clientId, payload.nickname);
            if (joinQueue(clientId)) sendState();
        },
        leaveQueue() {
            leaveQueue(clientId);
            sendState();
        },
    };

    const handler = handlers[parsedMSG.type as keyof typeof handlers];
    if (handler) handler(parsedMSG);
}

export function initServer() {

    initSession();

    // every phone gets its state; the queue moves on when an offer runs out or a client does not come back
    sendStateToClient = broadcastState;
    setInterval(() => {
        if (updateQueue(isIdle())) sendState();
    }, 1000);

    app.get('/state', (req, res) => {
        res.json(state)
    })

    app.ws('/play', function (ws, req) {
        const sessionID = req.query.sessionID;
        if (!(sessionID && (sessionID === sessionState.previousSessionID || sessionID === sessionState.currentSessionID))) {
            ws.close(4422, 'Invalid session ID');
            logEvent({
                errorType: ErrorType.WARNING,
                description: `WebSocket connection closed due to invalid session ID: ${sessionID}`,
                date: new Date().toString()
            })
            return;
        }

        // the phone's own id from its browser; older pages without one get an id for this connection only
        const requested = String(req.query.clientID ?? "");
        const clientId = /^[\w-]{8,64}$/.test(requested) ? requested : `anon-${crypto.randomUUID()}`;

        addSocket(clientId, ws);
        state.isPlayerConnected = isAnyPlayerConnected();
        sendState();

        ws.on('message', function (msg) {
            try {
                const parsedMSG = JSON.parse(msg.toString());
                handlePlayerMessage(clientId, parsedMSG);
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
            removeSocket(clientId, ws);
            state.isPlayerConnected = isAnyPlayerConnected();
            sendState();
        });
    });


    app.listen(port, () => {

    })
}

function handlePlaceChip(parsedMSG: any) {
    if (parsedMSG.slot != null && !isNaN(parsedMSG.slot) && parsedMSG.slot >= 0 && parsedMSG.slot < 7) {
        
        //check if the slot isn't already full
        if(game.board[parsedMSG.slot].length > 6) {
            logEvent({
                errorType: ErrorType.WARNING,
                description: `Player attempted to place chip in full column: ${parsedMSG.slot}`,
                date: new Date().toString()
            });
            return;
        }

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
