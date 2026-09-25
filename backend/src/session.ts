import { FRONTEND_ADDRESS } from ".";
import {sendStateToControlPanelClient, sendStateToInternalClient} from "./internal_server";
import { state } from "./state";
import { v4 as uuidv4 } from 'uuid';
import { emitLog, gameContext } from "./telemetry";

var qrcode = require('qrcode-terminal');

export const sessionState = {
    currentSessionID: "",
    previousSessionID: "",
}

export function initSession() {
    sessionState.currentSessionID = uuidv4();
    sessionState.previousSessionID = sessionState.currentSessionID;
    gameContext.sessionId = sessionState.currentSessionID;
    printSessionInfo();

    setInterval(() => {
    
            if (state.isPlayerConnected) return;
    
            sessionState.previousSessionID = sessionState.currentSessionID;
            sessionState.currentSessionID = uuidv4();
            gameContext.sessionId = sessionState.currentSessionID;
            emitLog("INFO", "Session rotated", {"session.id.previous": sessionState.previousSessionID});
            //TODO refresh frontend
            printSessionInfo();
            sendStateToInternalClient?.();
            sendStateToControlPanelClient?.();
        }, 1000 * 60 * 10); // 10 minutes
}

function printSessionInfo() {
        console.log(FRONTEND_ADDRESS + "/play?sessionID=" + sessionState.currentSessionID);
       // qrcode.generate(FRONTEND_ADRESS + "/play?sessionID=" + sessionState.currentSessionID);
}