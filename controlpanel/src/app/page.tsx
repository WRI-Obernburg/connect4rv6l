"use client";
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import QRCode from "react-qr-code"

import {GameField} from "component-lib";
import {useContext, useEffect, useRef, useState} from "react";
import {GameData, GameDataContext} from "@/provider/WebsocketProvider";
import Link from "next/link";
import {ExternalLink} from "lucide-react";
export default function Overview() {
    const gameDataContext = useContext(GameDataContext);
    if (!gameDataContext) {
        return <div>Loading...</div>;
    }
    return (
    <div className={"flex justify-center gap-4"}>
        <GameFieldCard gameData={gameDataContext!}></GameFieldCard>
        <FrontendConnectQRCode gameData={gameDataContext!}></FrontendConnectQRCode>
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
            <p><Link className={"flex flex-row gap-2 underline underline-offset-4"} target={"_blank"} href={props.gameData.qrCodeLink}><ExternalLink/> Mobilefrontend</Link></p>
        </CardFooter>
    </Card>
}

