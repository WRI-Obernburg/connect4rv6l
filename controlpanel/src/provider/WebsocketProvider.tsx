"use client";


import {createContext, useState} from "react";
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

    const {
        sendMessage,
        sendJsonMessage,
        lastMessage,
        lastJsonMessage,
        readyState,
        getWebSocket,
    } = useWebSocket(`ws://${(typeof window !== "undefined")?window.location.hostname:""}:4000/controlpanel`, {
        onOpen: () => console.log('opened'),
        onClose: () => {

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
                  toast.error(`Fehler: ${data.error.description}`, {
                    description: `Fehlerart: ${data.error.errorType} | Datum: ${data.error.date}`,
                    duration: 7000,
                    style: {
                      backgroundColor: '#f87171', // Tailwind red-400
                      color: '#fff',
                    },
                  });
                }

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
        <WebsocketSendContext value={sendMessage}>

      <div className="flex-1 flex flex-col overflow-y-auto">{children}</div>
        </WebsocketSendContext>
    </GameDataContext>
  );
}