const port = 4000;
import express from 'express';
import WebSocket from 'ws';
import { resetGame } from './game';
import { FRONTEND_ADRESS } from './index';
import { state } from './state';
import cors from 'cors';
import expressWs from 'express-ws'
import { v4 as uuidv4 } from 'uuid';
import { sessionState } from './session';

const app = expressWs(express()).app;
app.use(cors());

export const connectionID = uuidv4();

export let sendStateToInternalClient: (() => void) | null = null;


export function initInternalServer() {


    //server localfrontend in /localfrontend/dist but only if the request is from localhost
    app.use('/localfrontend', (req, res, next) => {
        if (req.hostname === 'localhost') {
            express.static('localfrontend/dist')(req, res, next);
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


        console.log('Internal WebSocket connection established');

        ws.on('message', (message) => {
            
        });

        ws.on('close', () => {
            console.log('WebSocket connection closed');
            sendStateToInternalClient = null;
        });

    });

    app.listen(port, () => {
        console.log(`Internal server listening on port ${port}`)
    })

}

function sendInternalState(ws: WebSocket) {
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
            gameState: state,
            qrCodeLink: FRONTEND_ADRESS + "/play?sessionID=" + sessionState.currentSessionID,
        }));
    } else {
        console.error('WebSocket is not open. Cannot send state.');
    }
}