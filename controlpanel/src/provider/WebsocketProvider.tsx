"use client";


import {createContext, useState} from "react";
import useWebSocket from "react-use-websocket";

interface GameState {
    expectedDuration: number | null;
    startTime: Date | null;
    endTime: Date | null;
    stateName: string;
    stateData?: never;
}

export interface GameData {
    gameState: {
        isPlayerConnected: boolean
        board: null
        difficulty: string
        gameStartTime: number
        lastUserInteraction: number
        stateName: string
    }
    sessionState: {
        currentSessionID: string
        previousSessionID: string
    }
    gameManager: {
        isPhysicalBoardCleaned: boolean
    },
    gameStates: {
        IDLE: GameState
        PLAYER_SELECTION: GameState
        GRAP_BLUE_CHIP: GameState
        PLACE_BLUE_CHIP: GameState
        ROBOT_SELECTION: GameState
        GRAP_RED_CHIP: GameState
        PLACE_RED_CHIP: GameState
        ERROR: GameState
        CLEAN_UP: GameState
        ROBOT_WIN: GameState
        PLAYER_WIN: GameState
        TIE: GameState
    },
    rv6l: {
        connected: boolean
        messageCounter: number
    },
    qrCodeLink: string
}

export const GameDataContext = createContext<GameData | null>(null);

export default function WebsocketProvider({
  children,
}: {
  children: React.ReactNode;
}) {
    const [gameData, setGameData] = useState<GameData | null>(null);

    const {
        sendMessage,
        sendJsonMessage,
        lastMessage,
        lastJsonMessage,
        readyState,
        getWebSocket,
    } = useWebSocket("http://localhost:4000/controlpanel", {
        onOpen: () => console.log('opened'),
        onClose: () => {

            console.log('closed');
        },
        //Will attempt to reconnect on all close events, such as server shutting down
        shouldReconnect: (closeEvent) => true,
        onMessage: (event) => {
            try {
                const data = JSON.parse(event.data);
                setGameData(data);

                console.log('Received message:', data);
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        }

    });

    if(!gameData) {
        return <div className={"flex justify-center h-screen w-full items-center text-3xl text-gray-700"}>Verbinden...</div>
    }

  return (
    <GameDataContext value={gameData!}>

      <div className="flex-1 overflow-y-auto">{children}</div>
    </GameDataContext>
  );
}