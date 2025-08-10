"use client";
import {Card, CardContent, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";

import {Button} from "@/components/ui/button";
import {useContext} from "react";
import {GameDataContext, WebsocketSendContext} from "@/provider/WebsocketProvider";

export default function ManualControlPage() {
    const gameDataContext = useContext(GameDataContext);

    if (!gameDataContext) {
        return <div className={"flex justify-center h-screen w-full items-center text-3xl text-gray-700"}>Verbinden...</div>;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Manuelle Steuerung</CardTitle>
                <p>{gameDataContext!.rv6l.connected ? "RV6L verbunden" : "ACHTUNG: Keine Verbindung zum RV6L!"}</p>

            </CardHeader>
            <CardContent>
                <div className={"flex flex-col justify-center items-center gap-4"}>
                    <div className={"flex flex-row justify-center items-center gap-4"}>
                        <GripperController isMoving={gameDataContext!.rv6l.moving}/>
                        <GrapChip isMoving={gameDataContext!.rv6l.moving}/>
                    </div>
                    <PlaceChip isMoving={gameDataContext!.rv6l.moving}/>

                </div>
            </CardContent>
            <CardFooter>
                <p className={"text-red-500"}>Hinweis: Es ist sinnvoll, das System vor einem manuellen Eingriff in den Error Zustand zu versetzen, um ungewollte Steuereingaben zu vermeinden</p>
            </CardFooter>
        </Card>
    );
}

function GripperController(props: {isMoving: boolean}) {
    const websocketSendContext = useContext(WebsocketSendContext);

    return <Card className={"p-4 grow "}>
        <CardHeader>
            <CardTitle>Gripper Controller</CardTitle>


        </CardHeader>
        <CardContent>

                <div className={"flex flex-row justify-center items-center gap-4"}>
                    <Button onClick={()=>{
                        websocketSendContext!(JSON.stringify({
                            action: "control",
                            command: "gripper_on",
                        }))
                    }} className={"cursor-pointer bg-green-500 text-green-50 shadow hover:bg-green-600"}>Gripper ON</Button>
                    <Button onClick={()=>{
                        websocketSendContext!(JSON.stringify({
                            action: "control",
                            command: "gripper_off",
                        }))
                    }} className={"cursor-pointer bg-red-500 text-red-50 shadow hover:bg-red-600"}>Gripper OFF</Button>
                </div>


        </CardContent>

    </Card>
}

function GrapChip(props: {isMoving: boolean}) {
    const websocketSendContext = useContext(WebsocketSendContext);

    return <Card className={"p-4"}>
        <CardHeader>
            <CardTitle>Chip holen</CardTitle>


        </CardHeader>
        <CardContent>

                <div className={"flex flex-row justify-center items-center gap-4"}>
                    <Button disabled={props.isMoving} onClick={()=>{
                        websocketSendContext!(JSON.stringify({
                            action: "control",
                            command: "move_to_blue",
                        }))
                    }} className={"cursor-pointer bg-blue-500 text-blue-50 shadow hover:bg-blue-600"}>Blauer Chip</Button>
                    <Button disabled={props.isMoving} onClick={()=>{
                        websocketSendContext!(JSON.stringify({
                            action: "control",
                            command: "move_to_red",
                        }))
                    }} className={"cursor-pointer bg-red-500 text-red-50 shadow hover:bg-red-600"}>Roter Chip</Button>
                </div>


        </CardContent>

    </Card>
}

function PlaceChip(props: {isMoving: boolean}) {
    const websocketSendContext = useContext(WebsocketSendContext);

    return <Card className={"p-4"}>
        <CardHeader>
            <CardTitle>Chip in Spalte ablegen</CardTitle>


        </CardHeader>
        <CardContent>

            <div className={"flex flex-row justify-center items-center gap-4"}>
                { Array.from({length: 7}).map((_, index) => (
                    <Button disabled={props.isMoving} key={index} onClick={()=>{
                        websocketSendContext!(JSON.stringify({
                            action: "control",
                            command: `move_to_column`,
                            column: index,
                        }))
                    }} className={"cursor-pointer bg-yellow-500 text-yellow-50 shadow hover:bg-yellow-600"}>Spalte {index + 1}</Button>
                ))}
            </div>


        </CardContent>

    </Card>
}