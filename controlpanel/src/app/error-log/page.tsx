"use client";
import {Card, CardContent, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {ErrorTable} from "@/app/error-log/ErrorTable";
import {useContext} from "react";
import {GameDataContext} from "@/provider/WebsocketProvider";
import {columns} from "@/app/error-log/columns";

export default function ErrorLogPage() {
    const gameDataContext = useContext(GameDataContext);

    if(!gameDataContext) {
        return <div className={"flex justify-center h-screen w-full items-center text-3xl text-gray-700"}>Verbinden...</div>
    }

    return <div>
        <Card className={"p-4"}>
            <CardHeader>
                <CardTitle>Error Log</CardTitle>

            </CardHeader>
            <CardContent>
                {
                    <ErrorTable columns={columns} data={gameDataContext!.errors}></ErrorTable>
                }

            </CardContent>
            <CardFooter className={"flex flex-col gap-2"}>
                <p>Auch die Fehler vorheriger Sessions werden hier angezeigt</p>
            </CardFooter>
        </Card>
    </div>
}