"use client";
import {Card, CardContent, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {TanStackTable} from "@/app/error-log/TanStackTable";
import {useContext} from "react";
import {GameDataContext, WebsocketSendContext} from "@/provider/WebsocketProvider";
import {columns} from "@/app/display/columns";
import {Button} from "@/components/ui/button";

export default function ErrorLogPage() {
    const gameDataContext = useContext(GameDataContext);
    const websocketSendContext = useContext(WebsocketSendContext);

    if (!gameDataContext) {
        return <div
            className={"flex justify-center h-screen w-full items-center text-3xl text-gray-700"}>Verbinden...</div>
    }

    return <div>
        <Card className={"p-4"}>
            <CardHeader>
                <CardTitle>Display-Controller</CardTitle>

            </CardHeader>
            <CardContent className={"flex flex-col gap-4"}>
                <TanStackTable data={gameDataContext.displays} columns={columns} />
                <div>Klicke auf einen Button, um die Display-Identifikation zu starten</div>
                <div className={"flex flex-row gap-4"}>
                    <Button className={"cursor-pointer"} onClick={()=>{
                        websocketSendContext!(JSON.stringify({action: "start_identify"}))
                    }}>Identifikation starten</Button>
                    <Button className={"cursor-pointer"} onClick={()=>{
                        websocketSendContext!(JSON.stringify({action: "stop_identify"}))
                    }}>Identifikation beenden</Button>
                </div>


            </CardContent>

        </Card>
    </div>
}