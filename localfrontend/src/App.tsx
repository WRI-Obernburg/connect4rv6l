import { useState } from 'react'

import './App.css'
import QRCodeComponent from './QRCode'
import useWebSocket from 'react-use-websocket';
import type { GameState } from './session';
import Game from './components/Game';
import { useQueryParam } from './lib/utils';
import { useEffect } from 'react';
import sleeping from "./assets/sleeping_rv6l.png";
import { v4 as uuidv4 } from 'uuid';


function App() {
  const [qrCodeLink, setQrCodeLink] = useState<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const indoor = useQueryParam('indoor') != null;
  const [frontendID, setFrontendID] = useState<string>(window.localStorage.getItem("frontendID") ?? uuidv4());
  const [identifyMode, setIdentifyMode] = useState<boolean>(false);


  const {
    sendMessage,
    sendJsonMessage,
    lastMessage,
    lastJsonMessage,
    readyState,
    getWebSocket,
  } = useWebSocket(`ws://${(typeof window !== "undefined")?window.location.hostname:""}:4000/ws?frontendID=${frontendID}${indoor?"&indoor=true":""}`, {
    onOpen: () => console.log('opened'),
    onClose: () => {
      setQrCodeLink(null);
      setState(null);
      console.log('closed');
    },
    //Will attempt to reconnect on all close events, such as server shutting down
    shouldReconnect: (closeEvent) => true,
    onMessage: (event) => {
      try {
        const data = JSON.parse(event.data);
        if(data.action === "data") {
            if (data.qrCodeLink) {
                setQrCodeLink(data.qrCodeLink);
            }
            if (data.gameState) {
                setState(data.gameState);
            }
        }else if(data.action === "identifyStart") {
            setIdentifyMode(true);
        }else if(data.action === "identifyEnd") {
            setIdentifyMode(false);
        }

        console.log('Received message:', data);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    }

  });

    useEffect(() => {
        window.localStorage.setItem("frontendID", frontendID);
        setTimeout(()=>{
            // @ts-ignore
            window.location.reload(true);
        },60*60*1000) // Refresh every 60 minutes to make sure its always the newst version
    }, []);

  if (readyState !== 1 || state === null) {
    return <div className='flex flex-row items-center justify-center gap-16 w-screen"'>
      <h1 className='text-8xl text-gray-500 font-bold'>Connecting...</h1>
    </div>
  }

  if(identifyMode) {
    return <div className='flex flex-col items-center justify-center gap-4 w-screen h-screen'>
      <h1 className='text-8xl text-blue-500 font-bold'>Identify Display</h1>
      <p className='text-gray-600 text-4xl font-bold'>{frontendID}</p>
      <p className='text-gray-600 text-4xl'>Das Display ist im {indoor?"Indoor-":"Outdoor-"}Betrieb</p>
        <p className={"text-gray-600 text-4xl"}>Daten:</p>
        <div className={"max-h-[50vh] overflow-y-auto bg-gray-100 p-4 rounded-lg"}>
            <pre className={"text-gray-600 text-2xl"}>{JSON.stringify(state, null, 2)}</pre>
        </div>
    </div>
  }

  if (state.stateName === "ERROR") {
    return <div className='flex flex-col items-center justify-center gap-4 w-screen h-screen'>
      <h1 className='text-8xl text-red-500 font-bold'>Fehler</h1>
      <p className='text-gray-600 text-4xl font-bold'>Aktuell ist das System außer Betrieb.</p>
      <p className='text-gray-600 text-3xl'>Bitte versuche es später erneut</p>
    </div>
  }

  if (state.stateName === "SLEEP") {
    return <div className="flex flex-row items-center justify-center gap-16 w-screen">


      <img src={sleeping} className="h-[40rem] w-auto" />

      <div>
        <p className="text-gray-600 text-7xl font-bold">RV6L-Gewinnt</p>
        <p className="text-4xl text-gray-500 max-w-[40vw] mt-2">
          Pssst! Der Roboter schläft gerade. Schau gerne morgen wieder vorbei!
        </p>

      </div>
    </div>
  }

  if (!state.isPlayerConnected || (state.stateName === "IDLE")) {
    return <QRCodeComponent qrCodeLink={qrCodeLink + (indoor ? "&indoor" : "")} isGameRunning={state.stateName !== "IDLE"} />
  }

  return (
    <>
      <Game gameState={state} qrCodeLink={qrCodeLink! + (indoor ? "&indoor" : "")}></Game>
    </>
  )
}


export default App
