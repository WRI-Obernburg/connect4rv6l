"use client";


import {createContext, useCallback, useEffect, useState} from "react";
import {initTelemetry, logEvent, tracedMessage, wsTelemetry} from "@/lib/telemetry";
import useWebSocket from "react-use-websocket";
import {GameData} from "@/app/models/GameData";
import { toast } from "sonner";


export const GameDataContext = createContext<GameData | null>(null);
export const WebsocketSendContext = createContext<((message:string)=>void) | null>(null);

export default function WebsocketProvider({
  children,
}: {
  children: React.ReactNode;
}) {
    const [gameData, setGameData] = useState<GameData | null>(null);

    useEffect(() => {
        initTelemetry("connect4-controlpanel", `http://${window.location.hostname}:4000/telemetry`);
    }, []);

    const {
        sendMessage,
        sendJsonMessage,
        lastMessage,
        lastJsonMessage,
        readyState,
        getWebSocket,
    } = useWebSocket(`ws://${(typeof window !== "undefined")?window.location.hostname:""}:4000/controlpanel`, {
        onOpen: () => wsTelemetry.onOpen("/controlpanel"),
        onError: wsTelemetry.onError,
        onClose: (event) => {
            wsTelemetry.onClose(event);
            console.log('closed');
        },
        //Will attempt to reconnect on all close events, such as server shutting down
        shouldReconnect: (closeEvent) => true,
        onMessage: (event) => {
            try {
                const data = JSON.parse(event.data);
                if(data.type==="data") {
                  setGameData(data.data as GameData);
                }else if(data.type === "error") {
                  console.log("Error received from server:", data.error);
                  logEvent(data.error.errorType === 0 ? "ERROR" : "INFO", `Backend event shown: ${data.error.description}`);
                  toast.error(`${data.error.errorType===0?"Fehler: ":"Event: "}${data.error.description}`, {
                    description: `Eventart: ${data.error.errorType} | Datum: ${data.error.date}`,
                    duration: 7000,
                    style: {
                      backgroundColor: data.error.errorType === 0?'#f87171':'#fff', // Tailwind red-400
                      color: data.error.errorType === 0?'#fff':'#000',
                    },
                  });
                }

                console.log('Received message:', data);
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        }

    });

    // Every message sent from the control panel gets its own span + traceparent.
    const sendTracedMessage = useCallback((message: string) => {
        try {
            sendMessage(JSON.stringify(tracedMessage(JSON.parse(message))));
        } catch {
            sendMessage(message);
        }
    }, [sendMessage]);

    if(!gameData) {
        return <div className={"flex justify-center h-screen w-full items-center text-3xl text-gray-700"}>Verbinden...</div>
    }

  return (
    <GameDataContext value={gameData!}>
        <WebsocketSendContext value={sendTracedMessage}>

      <div className="flex-1 flex flex-col overflow-y-auto">{children}</div>
        </WebsocketSendContext>
    </GameDataContext>
  );
}