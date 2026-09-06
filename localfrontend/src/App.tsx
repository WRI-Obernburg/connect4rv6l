import { useState } from 'react'

import './App.css'
import QRCodeComponent from './QRCode'
import useWebSocket from 'react-use-websocket';
import type { GameState } from './session';
import Game from './components/Game';
import { useQueryParam } from './lib/utils';
import { useEffect } from 'react';
import sleeping from "./assets/sleeping_rv6l.png";
import Layout from './components/Layout';
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
    return <Layout>
      <h1 className='text-6xl font-extrabold text-white'>Verbindung wird aufgebaut</h1>
    </Layout>
  }

  if(identifyMode) {
    return <Layout>
      <div className='panel rounded-3xl p-12 flex flex-col items-center justify-center gap-3'>
        <h1 className='text-7xl font-extrabold'>Dieses Display</h1>
        <p className='text-4xl font-semibold'>{frontendID}</p>
        <p className='text-wri-grey text-3xl'>{indoor?"Indoor":"Outdoor"}-Betrieb</p>
        <div className='max-h-[40vh] overflow-y-auto bg-white rounded-xl p-4 mt-2'>
          <pre className='text-wri-grey text-xl'>{JSON.stringify(state, null, 2)}</pre>
        </div>
      </div>
    </Layout>
  }

  if (state.stateName === "ERROR") {
    return <Layout>
      <div className='panel rounded-3xl p-14 flex flex-col justify-center gap-4 max-w-[60vw]'>
        <h1 className='text-7xl font-extrabold leading-[1.02]'>Der Roboter macht Pause.</h1>
        <p className='text-wri-grey text-3xl'>Das System ist gerade außer Betrieb. Bitte versuche es später noch einmal.</p>
      </div>
    </Layout>
  }

  if (state.stateName === "SLEEP") {
    return <Layout>
      <div className="flex flex-row items-stretch justify-center gap-10">
        <div className="panel rounded-3xl p-6 flex items-center"><img src={sleeping} className="h-[30rem] w-auto rounded-2xl" /></div>
        <div className="panel rounded-3xl p-12 max-w-[42vw] flex flex-col justify-center">
          <p className="text-7xl font-extrabold leading-[1.02]">Der Roboter schläft.</p>
          <p className="text-3xl text-wri-grey mt-6">
            Morgen ist er wieder bereit für eine Partie.
          </p>
        </div>
      </div>
    </Layout>
  }

  if (!state.isPlayerConnected || (state.stateName === "IDLE")) {
    return <Layout>
      <QRCodeComponent qrCodeLink={qrCodeLink + (indoor ? "&indoor" : "")} isGameRunning={state.stateName !== "IDLE"} />
    </Layout>
  }

  return (
    <Layout>
      <Game gameState={state} indoor={indoor} qrCodeLink={qrCodeLink! + (indoor ? "&indoor" : "")}></Game>
    </Layout>
  )
}


export default App
