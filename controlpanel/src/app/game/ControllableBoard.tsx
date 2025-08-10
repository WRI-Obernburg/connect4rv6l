"use client";

import React, {useContext, useEffect} from "react";
import {Card, CardContent, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {GameDataContext, WebsocketSendContext} from "@/provider/WebsocketProvider";
import {Button} from "@/components/ui/button";

type Board = {
    [key: number]: number[];
}

export function ControllableBoard(){
    const gameDataContext = useContext(GameDataContext);
    const websocketSendContext = useContext(WebsocketSendContext);

    const [board, setBoard] = React.useState<Board | null>(gameDataContext?.gameState.board || {
        0: [],
        1: [],
        2: [],
        3: [],
        4: [],
        5: [],
        6: []
    });


    const [modified, setModified] = React.useState(false);

    useEffect(()=>{
        if(!modified) {
            setBoard(gameDataContext?.gameState.board || {
                0: [],
                1: [],
                2: [],
                3: [],
                4: [],
                5: [],
                6: []
            });
        }

    }, [gameDataContext?.gameState.board, modified]);

    if( !board) {
        return <div className={"flex justify-center h-screen w-full items-center text-3xl text-gray-700"}>Verbinden...</div>;
    }


    return (
        <Card>
            <CardHeader>
                <CardTitle>Spielzustand</CardTitle>
                <p>Es ist sinnvoll, erst in den Error Zustand zu wechseln, um ungewollte Einflüsse zu vermeiden.</p>
            </CardHeader>
            <CardContent>

                    <div className="flex flex-row justify-center gap-4">
                        {
                            Array(7).fill(0).map((_, column) => (
                                <div key={column} className="flex flex-col-reverse justify-center gap-2">
                                    {
                                        Array(6).fill(0).map((_, row) => (
                                            <Cell
                                                key={`${column}-${row}`}
                                                value={board[column][row] || 0}
                                                onClick={() => {
                                                    setBoard(prevBoard => {
                                                        const newColumn = [...(prevBoard![column] || [])];
                                                        // make sure the column is filled from the bottom to this row
                                                        console.log(row)
                                                        if (newColumn.length >= row) {
                                                            newColumn[row] = newColumn[row] === 0 ? 1 : (newColumn[row] === 1 ? 2 : (newColumn[row] === 2 ? 0 : 1));
                                                            //if the value is 0 again delete the array until the row
                                                            if (newColumn[row] === 0) {
                                                                newColumn.splice(row, newColumn.length - row);
                                                            }
                                                            setModified(true);
                                                        }
                                                        return {
                                                            ...prevBoard,
                                                            [column]: newColumn
                                                        };
                                                    });
                                                }}
                                            />
                                        ))

                                    }

                                </div>
                            ))
                        }
                    </div>
            </CardContent>
            <CardFooter className={"flex flex-col gap-2"}>
                <p>Klicke auf ein Feld, um eine Farbe festzulegen</p>
                <div className={"flex flex-row justify-center gap-4"}>
                    <Button className={"cursor-pointer"} disabled={!modified} onClick={()=>{
                        setModified(false);
                        setBoard(gameDataContext?.gameState.board || {
                            0: [],
                            1: [],
                            2: [],
                            3: [],
                            4: [],
                            5: [],
                            6: []
                        });
                    }}>Änderungen verwerfen</Button>
                    <Button className={"cursor-pointer"} disabled={!modified} onClick={()=>{
                        websocketSendContext?.(JSON.stringify({
                            action: "setBoard",
                            board: board
                        }));


                        setModified(false);
                    }}>Übernehmen</Button>
                </div>
            </CardFooter>
        </Card>
        );


}

function Cell({value, onClick}: {value: number, onClick: () => void}) {
    return (
        <div className={"rounded-full w-12 h-12 flex items-center justify-center cursor-pointer border border-gray-700 " + (value === 0 ? "bg-gray-300": value===1?"bg-red-600 ":"bg-blue-600")} onClick={onClick}>

        </div>
    );
}