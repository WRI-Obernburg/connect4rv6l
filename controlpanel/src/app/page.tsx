"use client";
import {Card, CardContent, CardFooter, CardHeader, CardTitle,} from "@/components/ui/card"
import QRCode from "react-qr-code"

import {GameField} from "component-lib";
import {useContext, useEffect, useState} from "react";
import {GameDataContext} from "@/provider/WebsocketProvider";
import Link from "next/link";
import {ExternalLink} from "lucide-react";
import {ErrorType, GameData} from "@/app/models/GameData";

export default function Overview() {
    const gameDataContext = useContext(GameDataContext);
    if (!gameDataContext) {
        return <div>Loading...</div>;
    }
    return (
    <div className={"flex flex-col gap-4 justify-evenly w-fit self-center"}>
        <div className={"flex justify-center gap-4"}>
            <GameFieldCard gameData={gameDataContext!}></GameFieldCard>
            <FrontendConnectQRCode gameData={gameDataContext!}></FrontendConnectQRCode>
        </div>
        <GeneralInfos gameData={gameDataContext!}/>
    </div>
  );
}

function GameFieldCard(props: {gameData: GameData}) {
    const [timeInState, setTimeInState] = useState(0);
    const expectedDuration = props.gameData.gameStates[props.gameData.gameState.stateName as keyof typeof props.gameData.gameStates].expectedDuration;
    useEffect(()=>{
        const id = setInterval(() => {
            if (props.gameData.gameState.stateName === "IDLE") {
                setTimeInState(0);
                return;
            }
            setTimeInState(Date.now() - new Date(props.gameData.gameStates[props.gameData.gameState.stateName! as keyof typeof props.gameData.gameStates]!.startTime!).getTime());

        },100);

        return () => clearInterval(id);
    },[props, props.gameData.gameState.gameStartTime, props.gameData.gameState.stateName, timeInState])
    return <Card className={"p-4"}>
        <CardHeader>
            <CardTitle>Gameboard</CardTitle>

        </CardHeader>
        <CardContent>
            {
                <GameField board={props.gameData.gameState.board} xl={false} interactive={false}></GameField>
            }
        </CardContent>
        <CardFooter className={"flex flex-col gap-2"}>
            <p>Zustand: {props.gameData.gameState.stateName}</p>
            <p>{
                `Aktuelle Dauer: ${(Math.floor(timeInState / 100)/10).toFixed(1)} s / ${expectedDuration ? Math.floor(expectedDuration/1000) + " s" : "unbekannt"}`
            }</p>
        </CardFooter>
    </Card>
}

function FrontendConnectQRCode(props: {gameData: GameData}) {
    return <Card className={"p-4"}>
        <CardHeader>
            <CardTitle>Connect to Frontend</CardTitle>

        </CardHeader>
        <CardContent>
            {
                <QRCode value={props.gameData.qrCodeLink}></QRCode>
            }
        </CardContent>
        <CardFooter>
            <p className={"flex flex-col gap-2"}>
                <Link className={"flex flex-row gap-2 underline underline-offset-4"} target={"_blank"} href={props.gameData.qrCodeLink}><ExternalLink/> Mobilefrontend</Link>
                <Link className={"flex flex-row gap-2 underline underline-offset-4"} target={"_blank"} href={"http://localhost:4000/localfrontend"}><ExternalLink/> Localfronted</Link>
            </p>
        </CardFooter>
    </Card>
}

function GeneralInfos(props: {gameData: GameData}) {
    return <Card className={"p-4 grow"}>
        <CardHeader>
            <CardTitle>Übersicht</CardTitle>
        </CardHeader>
        <CardContent>
            <p>RV6L: {`${props.gameData.rv6l.connected?"Verbunden":"Getrennt"} | ${props.gameData.rv6l.moving?"Bewegung":"Stillstand"} | MSG-Counter: ${props.gameData.rv6l.messageCounter}`}</p>
            <p>Schwierigkeitsgrad: {props.gameData.gameState.difficulty}</p>
            <p>Spieler: {props.gameData.gameState.isPlayerConnected?"verbunden":"Kein Spieler verbunden"}</p>
            <p>Letztes Spiel um: {new Date(props.gameData.gameState.gameStartTime).toLocaleString()}</p>
            <p>Kritische Fehler: {props.gameData.errors.reduce((acc, e)=>{
                if(e.errorType === ErrorType.FATAL) {
                    return acc+ 1;
                }else{
                    return acc;
                }
            },0)}</p>
            <p>Internes Frontend: {props.gameData.isInternalFrontendConnected?"Verbunden":"Getrennt"}</p>
        </CardContent>
    </Card>
}