import { useState } from 'react'

import './App.css'
import QRCodeComponent from './QRCode'
import useWebSocket from 'react-use-websocket';
import type { GameState } from './session';
import GameField from './components/GameField';
import Game from './components/Game';

function App() {
  const [qrCodeLink, setQrCodeLink] = useState<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  

  const {
    sendMessage,
    sendJsonMessage,
    lastMessage,
    lastJsonMessage,
    readyState,
    getWebSocket,
  } = useWebSocket("http://localhost:4000/ws", {
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
        if (data.qrCodeLink) {
          setQrCodeLink(data.qrCodeLink);
        }
        if (data.gameState) {
          setState(data.gameState);
        }
        console.log('Received message:', data);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    }

  });

  if(readyState !== 1 || state === null) {
    return <div className='flex flex-row items-center justify-center gap-16 w-screen"'>
       <h1 className='text-8xl text-gray-500 font-bold'>Connecting...</h1>
    </div>
  }

  if(!state.isPlayerConnected || (!state.isGameOver && !state.isGameRunning)) {
    return <QRCodeComponent qrCodeLink={qrCodeLink} isGameRunning={state.isGameRunning}/>
  }

  return (
    <>
      <Game gameState={state} qrCodeLink={qrCodeLink!}></Game>
    </>
  )
}


export default App
