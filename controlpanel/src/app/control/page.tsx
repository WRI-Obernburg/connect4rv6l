"use client";
import {Card, CardContent, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";

import {Button} from "@/components/ui/button";
import {useContext} from "react";
import {GameDataContext, WebsocketSendContext} from "@/provider/WebsocketProvider";
import {Checkbox} from "@/components/ui/checkbox";
import {GameData} from "@/app/models/GameData";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"

export default function ManualControlPage() {
    const gameDataContext = useContext(GameDataContext);

    if (!gameDataContext) {
        return <div
            className={"flex justify-center h-screen w-full items-center text-3xl text-gray-700"}>Verbinden...</div>;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Manuelle Steuerung</CardTitle>
                <p>{gameDataContext!.rv6l.connected ? "RV6L verbunden" : "ACHTUNG: Keine Verbindung zum RV6L!"}</p>
                <p className={"text-red-500"}>{gameDataContext!.rv6l.mock && "RV6L Verbindung wird gemockt!"}</p>

            </CardHeader>
            <CardContent>
                <div className={"flex flex-col justify-center items-center gap-4"}>
                    <div className={"flex flex-row justify-center items-center gap-4"}>
                        <SystemWideController gameDataContext={gameDataContext!}></SystemWideController>
                        <GripperController isMoving={gameDataContext!.rv6l.moving}/>
                        <GrapChip isMoving={gameDataContext!.rv6l.moving}/>
                    </div>
                    <PlaceChip isMoving={gameDataContext!.rv6l.moving}/>

                </div>
            </CardContent>
            <CardFooter>
                <p className={"text-red-500"}>Hinweis: Es ist sinnvoll, das System vor einem manuellen Eingriff in den
                    Error Zustand zu versetzen, um ungewollte Steuereingaben zu vermeinden</p>
            </CardFooter>
        </Card>
    );
}

function SystemWideController(props: { gameDataContext: GameData }) {
    const websocketSendContext = useContext(WebsocketSendContext);

    return <Card className={"p-4 grow "}>
        <CardHeader>
            <CardTitle>System</CardTitle>


        </CardHeader>
        <CardContent className={"flex flex-col justify-center items-center gap-4"}>

            <div className={"flex flex-row justify-center items-center gap-4"}>
                <Checkbox defaultChecked={props.gameDataContext.rv6l.mock} onCheckedChange={(checked) => {
                    websocketSendContext!(JSON.stringify({
                        action: "control",
                        command: "mock_rv6l",
                        mock: checked,
                    }));
                }} className={"cursor-pointer"}/><p> RV6L Verbindung mocken</p>

            </div>

            <div className={"flex flex-row justify-center items-center gap-4"}>
                <Button onClick={() => {
                    websocketSendContext!(JSON.stringify({
                        action: "control",
                        command: "move_to_ref_pos",
                    }))
                }} disabled={props.gameDataContext.rv6l.moving}
                        className={"cursor-pointer bg-yellow-500 text-red-50 shadow hover:bg-yellow-600"}>Ref
                    Pos</Button>

                <Button onClick={() => {
                    websocketSendContext!(JSON.stringify({
                        action: "control",
                        command: "cancel_rv6l",
                    }))
                }} className={"cursor-pointer bg-red-500 text-red-50 shadow hover:bg-red-600"}>Cancel Move</Button>
            </div>


        </CardContent>

    </Card>
}

function GripperController(props: { isMoving: boolean }) {
    const websocketSendContext = useContext(WebsocketSendContext);

    return <Card className={"p-4 grow "}>
        <CardHeader>
            <CardTitle>Gripper Controller</CardTitle>


        </CardHeader>
        <CardContent>

            <div className={"flex flex-row justify-center items-center gap-4"}>
                <Button onClick={() => {
                    websocketSendContext!(JSON.stringify({
                        action: "control",
                        command: "gripper_on",
                    }))
                }} className={"cursor-pointer bg-green-500 text-green-50 shadow hover:bg-green-600"}>Gripper ON</Button>
                <Button onClick={() => {
                    websocketSendContext!(JSON.stringify({
                        action: "control",
                        command: "gripper_off",
                    }))
                }} className={"cursor-pointer bg-red-500 text-red-50 shadow hover:bg-red-600"}>Gripper OFF</Button>
            </div>


        </CardContent>

    </Card>
}

function GrapChip(props: { isMoving: boolean }) {
    const websocketSendContext = useContext(WebsocketSendContext);

    return <Card className={"p-4"}>
        <CardHeader>
            <CardTitle>Chips</CardTitle>


        </CardHeader>
        <CardContent className={"flex flex-col justify-center items-center gap-4"}>

            <div className={"flex flex-row justify-center items-center gap-4"}>
                <Button disabled={props.isMoving} onClick={() => {
                    websocketSendContext!(JSON.stringify({
                        action: "control",
                        command: "move_to_blue",
                    }))
                }} className={"cursor-pointer bg-blue-500 text-blue-50 shadow hover:bg-blue-600"}>Blau holen</Button>
                <Button disabled={props.isMoving} onClick={() => {
                    websocketSendContext!(JSON.stringify({
                        action: "control",
                        command: "move_to_red",
                    }))
                }} className={"cursor-pointer bg-red-500 text-red-50 shadow hover:bg-red-600"}>Rot holen</Button>
                <Button disabled={props.isMoving} onClick={() => {
                    websocketSendContext!(JSON.stringify({
                        action: "control",
                        command: "init_chip_palletizing",
                    }))
                }} className={"cursor-pointer bg-green-500 text-blue-50 shadow hover:bg-green-600"}>Reset
                    Palletierung</Button>

            </div>

            <div className={"flex flex-row justify-center items-center gap-4"}>

                <Button disabled={props.isMoving} onClick={() => {
                    websocketSendContext!(JSON.stringify({
                        action: "control",
                        command: "put_back_blue",
                    }))
                }} className={"cursor-pointer bg-blue-500 text-blue-50 shadow hover:bg-blue-600"}>Blau ablegen</Button>
                <Button disabled={props.isMoving} onClick={() => {
                    websocketSendContext!(JSON.stringify({
                        action: "control",
                        command: "put_back_red",
                    }))
                }} className={"cursor-pointer bg-red-500 text-red-50 shadow hover:bg-red-600"}>Rot ablegen</Button>


                <Dialog>
                    <DialogTrigger asChild><Button disabled={props.isMoving}
                                                   className={"cursor-pointer bg-yellow-500 text-yellow-50 shadow hover:bg-yellow-600"}>Chip
                        aus Board holen</Button></DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Position wählen</DialogTitle>
                            <DialogDescription className={"flex flex-col justify-center items-center gap-4"}>
                                Wähle die Position des Chips, der vom Spielfeld geholt werden soll.
                                <div className={"grid grid-cols-7 gap-2 mt-4"}>
                                    {Array.from({length: 7*6}).map((_, colIndex) => (
                                        <Button key={colIndex} disabled={props.isMoving} onClick={() => {
                                            websocketSendContext!(JSON.stringify({
                                                action: "control",
                                                command: "clean_board_at",
                                                x: colIndex % 7,
                                                y: 5 - Math.floor(colIndex / 7),
                                            }))
                                        }}
                                                className={"cursor-pointer bg-gray-500 text-white shadow hover:bg-yellow-600"}>{`${colIndex % 7 },${5-Math.floor(colIndex / 7) }`}</Button>
                                    ))

                                    }
                                </div>
                                <div className={"flex flex-row justify-center items-center gap-4 mt-4"}>
                                    <Button disabled={props.isMoving} onClick={() => {
                                        websocketSendContext!(JSON.stringify({
                                            action: "control",
                                            command: "put_back_blue",
                                        }))
                                    }} className={"cursor-pointer bg-blue-500 text-blue-50 shadow hover:bg-blue-600"}>Blau ablegen</Button>
                                    <Button disabled={props.isMoving} onClick={() => {
                                        websocketSendContext!(JSON.stringify({
                                            action: "control",
                                            command: "put_back_red",
                                        }))
                                    }} className={"cursor-pointer bg-red-500 text-red-50 shadow hover:bg-red-600"}>Rot ablegen</Button>
                                </div>
                            </DialogDescription>
                        </DialogHeader>
                    </DialogContent>
                </Dialog>
            </div>


        </CardContent>

    </Card>
}

function PlaceChip(props: { isMoving: boolean }) {
    const websocketSendContext = useContext(WebsocketSendContext);

    return <Card className={"p-4"}>
        <CardHeader>
            <CardTitle>Chip in Spalte ablegen</CardTitle>


        </CardHeader>
        <CardContent>

            <div className={"flex flex-row justify-center items-center gap-4"}>
                {Array.from({length: 7}).map((_, index) => (
                    <Button disabled={props.isMoving} key={index} onClick={() => {
                        websocketSendContext!(JSON.stringify({
                            action: "control",
                            command: `move_to_column`,
                            column: index,
                        }))
                    }}
                            className={"cursor-pointer bg-yellow-500 text-yellow-50 shadow hover:bg-yellow-600"}>Spalte {index + 1}</Button>
                ))}
            </div>


        </CardContent>

    </Card>
}