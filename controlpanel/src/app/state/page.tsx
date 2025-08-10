"use client";
import '@xyflow/react/dist/style.css';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {ReactFlow, Handle, Position, Edge, Node} from '@xyflow/react';
import {useContext, useEffect, useState, useReducer} from "react";
import {GameDataContext, WebsocketSendContext} from "@/provider/WebsocketProvider";
import {Card, CardContent, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {GameField} from "component-lib";
import {Braces} from "lucide-react";
import {Button} from "@/components/ui/button";

type CustomNodeProps = {

    "label": string;
    "active": boolean;
    "expectedDuration": number;
    "startTime": string | null;
    "endTime": string | null;
    stateData: unknown

}

// @ts-expect-error doesn't work
const CustomNode: React.FC<CustomNodeProps> = ({data}) => {

    const [timeInState, setTimeInState] = useState(0);
    const [isSwitchingDialogOpen, setIsSwitchingDialogOpen] = useState(false);
    const websocketSendContext = useContext(WebsocketSendContext);

    useEffect(()=>{
        if(data.active) {
            const id = setInterval(() => {
                if (data.label === "IDLE") {
                    setTimeInState(0);
                    return;
                }
                setTimeInState(Date.now() - new Date(data.startTime).getTime());

            },100);

            return () => clearInterval(id);
        }else{
            const deltaTime = new Date(data.endTime).getTime() - new Date(data.startTime).getTime();
            if(isNaN(deltaTime)) {
                setTimeInState(0);
            }else{
                setTimeInState(deltaTime);

            }
        }
    },[data.active, data.endTime, data.label, data.startTime])
    const stateData = JSON.stringify(data.stateData) ?? "Keine";
    let shortData = stateData;
    if (shortData.length > 12) {
        shortData = stateData.substring(0, 12) + "...";
    }
    return (
        <Dialog open={isSwitchingDialogOpen} onOpenChange={setIsSwitchingDialogOpen}>
            <div
                style={{
                    padding: 10,
                    border: '1px solid #555',
                    borderRadius: 8,
                    background: data.active ? "#e1ef1e" : "#efefef",
                    fontWeight: 'bold',
                    textAlign: 'center',
                    position: 'relative',
                    width: 180,
                }}
                onDoubleClick={()=>{
                    setIsSwitchingDialogOpen(true);

                }}

                className={"flex flex-col justify-center gap-1"}
            >
                <Handle isConnectable={false} type="target" style={{opacity: "0%"}} position={Position.Top} id="top"/>
                <Handle isConnectable={false} type="target" style={{opacity: "0%"}} position={Position.Left} id="left"/>
                <Handle isConnectable={false} type="target" style={{opacity: "0%"}} position={Position.Right} id="right"/>
                <Handle isConnectable={false} type="target" style={{opacity: "0%"}} position={Position.Bottom} id="bottom"/>
                <p> {data.label}</p>
                <p>{`${(Math.floor(timeInState / 100)/10).toFixed(1)} s / ${data.expectedDuration ? Math.floor(data.expectedDuration/1000) + " s" : "unbekannt"}`}</p>
                <p className={"flex flex-row gap-2 justify-center "}><Braces className={"p-0 inline"}/>{shortData}</p>
                <Handle isConnectable={false} type="source" style={{opacity: "0%"}} position={Position.Right} id="right"/>
                <Handle isConnectable={false} type="source" style={{opacity: "0%"}} position={Position.Bottom} id="bottom"/>
                <Handle isConnectable={false} type="source" style={{opacity: "0%"}} position={Position.Top} id="top"/>
                <Handle isConnectable={false} type="source" style={{opacity: "0%"}} position={Position.Left} id="left"/>
            </div>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{data.label}</DialogTitle>
                    <DialogDescription className={"flex flex-col justify-start gap-2"}>
                        <p>Zeitbudget: {data.expectedDuration ? Math.floor(data.expectedDuration/1000) + " s" : "Unbegrenzt"}</p>
                        <p>Zuletzt benötigte Zeit: {(Math.floor(timeInState / 100)/10).toFixed(1)} s </p>
                        <p>Daten: {stateData}</p>
                        <Button onClick={()=>{
                            websocketSendContext?.(JSON.stringify({
                                action: "switchToState",
                                stateName: data.label
                            }));
                            setIsSwitchingDialogOpen(false);
                        }} className={"cursor-pointer self-end mt-4"}>Zum State wechseln</Button>
                    </DialogDescription>
                </DialogHeader>
            </DialogContent>
        </Dialog>

    );
};
const nodeTypes = {custom: CustomNode};


const edges: Edge[] = [
    {id: 'e1-2', source: '1', target: '2', type: 'smoothstep', sourceHandle: 'right', targetHandle: 'left'},
    {id: 'e2-3', source: '2', target: '3', type: 'smoothstep', sourceHandle: 'right', targetHandle: 'left'},
    {id: 'e3-4', source: '3', target: '4', type: 'smoothstep', sourceHandle: 'right', targetHandle: 'left'},
    {id: 'e4-5', source: '4', target: '5', type: 'smoothstep', sourceHandle: 'right', targetHandle: 'left'},
    {id: 'e5-6', source: '5', target: '6', type: 'smoothstep', sourceHandle: 'right', targetHandle: 'left'},
    {id: 'e3-7', source: '3', target: '7', type: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'top'},
    {id: 'e4-8', source: '4', target: '8', type: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'top'},
    {id: 'e6-9', source: '6', target: '9', type: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'top'},
    {id: 'e7-10', source: '7', target: '10', type: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'top'},
    {id: 'e8-10', source: '8', target: '10', type: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'top'},
    {id: 'e9-10', source: '9', target: '10', type: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'top'},
    {id: 'e11-1', source: '11', target: '1', type: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'left'},

    {id: 'e4-1', source: '6', target: '1', type: 'smoothstep', sourceHandle: 'top', targetHandle: 'top'},


    {id: 'e10-1', source: '10', target: '1', type: 'smoothstep', sourceHandle: 'left', targetHandle: 'bottom'},

    {id: 'e10-11', source: '10', target: '11', type: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'top'},


];
const initialNodes: Node<CustomNodeProps>[] = [
    {id: '1', type: 'custom', position: {x: 0, y: 100}, data: {label: 'PLAYER_SELECTION', active: false, endTime: null, startTime: null, expectedDuration: 0, stateData: null}},
    {id: '2', type: 'custom', position: {x: 250, y: 100}, data: {label: 'GRAP_BLUE_CHIP', active: false, endTime: null, startTime: null, expectedDuration: 0, stateData: null}},
    {id: '3', type: 'custom', position: {x: 500, y: 100}, data: {label: 'PLACE_BLUE_CHIP', active: false, endTime: null, startTime: null, expectedDuration: 0, stateData: null}},
    {id: '4', type: 'custom', position: {x: 750, y: 100}, data: {label: 'ROBOT_SELECTION', active: false, endTime: null, startTime: null, expectedDuration: 0, stateData: null}},
    {id: '5', type: 'custom', position: {x: 1000, y: 100}, data: {label: 'GRAP_RED_CHIP', active: false, endTime: null, startTime: null, expectedDuration: 0, stateData: null}},
    {id: '6', type: 'custom', position: {x: 1250, y: 100}, data: {label: 'PLACE_RED_CHIP', active: false, endTime: null, startTime: null, expectedDuration: 0, stateData: null}},
    {id: '7', type: 'custom', position: {x: 500, y: 300}, data: {label: 'PLAYER_WIN', active: false, endTime: null, startTime: null, expectedDuration: 0, stateData: null}},
    {id: '8', type: 'custom', position: {x: 750, y: 300}, data: {label: 'TIE', active: false, endTime: null, startTime: null, expectedDuration: 0, stateData: null}},
    {id: '9', type: 'custom', position: {x: 1250, y: 300}, data: {label: 'ROBOT_WIN', active: false, endTime: null, startTime: null, expectedDuration: 0, stateData: null}},
    {id: '10', type: 'custom', position: {x: 750, y: 500}, data: {label: 'CLEAN_UP', active: false, endTime: null, startTime: null, expectedDuration: 0, stateData: null}},
    {id: '11', type: 'custom', position: {x: 750, y: 700}, data: {label: 'IDLE', active: false, endTime: null, startTime: null, expectedDuration: 0, stateData: null}},
    {id: '12', type: 'custom', position: {x: 1500, y: 100}, data: {label: 'ERROR', active: false, endTime: null, startTime: null, expectedDuration: 0, stateData: null}},
];

function StateGraph() {
    const gameDataContext = useContext(GameDataContext);
    const [renderingNodes, setRenderingNodes] = useState<Node<CustomNodeProps>[]>(initialNodes);
    const [, forceUpdate] = useReducer(x => x + 1, 0);


    useEffect(() => {

        if (gameDataContext != null) {
            setRenderingNodes((nodes) => {
                 return nodes.map((node) => {

                     const stateData = gameDataContext?.gameStates[node.data.label as keyof typeof gameDataContext.gameStates];

                    return {
                        ...node,
                        data: {
                            label: stateData?.stateName,
                            active: gameDataContext!.gameState.stateName === node.data.label,
                            expectedDuration: stateData!.expectedDuration!,
                            startTime: stateData.startTime != null ? stateData.startTime.toString() : null,
                            endTime: stateData!.endTime != null ? stateData!.endTime.toString() : null,
                            stateData: stateData.stateData
                        }
                    } satisfies Node<CustomNodeProps>
                })
            })
        }

    }, [gameDataContext, gameDataContext?.gameStates])

    useEffect(() => {
        //on resize window
        function recenter(){
            forceUpdate();
        }

        addEventListener("resize", recenter);

        return ()=>{
            removeEventListener("resize", recenter);
        }
    }, []);

    if (!gameDataContext) {
            return <div className={"flex self-center text-3xl text-gray-700"}>Loading...</div>;

    }

    return (

        <div className={"h-[50vh]"}>
            <ReactFlow
                key={new Date().getTime()}
                proOptions={{
                    hideAttribution: true,
                }}
                nodes={renderingNodes}
                edges={edges}
                // @ts-expect-error NodeType not working
                nodeTypes={nodeTypes}
                contentEditable={false}
                zoomOnScroll={false}
                draggable={false}
                panOnDrag={false}
                connectOnClick={false}
                edgesReconnectable={false}
                nodesFocusable={true}
                zoomOnPinch={false}
                zoomOnDoubleClick={false}

                fitView
            >

            </ReactFlow>
        </div>);
}

export default function StatePage() {


    return <div>
        <Card className={"p-4"}>
            <CardHeader>
                <CardTitle>State-Graph</CardTitle>

            </CardHeader>
            <CardContent>
               <StateGraph />
            </CardContent>
            <CardFooter className={"flex flex-col gap-2"}>
                <p>Tipp: Doppelklicke auf einen Zustand, um zu ihm zu wechseln</p>
            </CardFooter>
        </Card>
    </div>

}

/*
 <div className="flex flex-col items-center justify-center h-screen ">
      <h1 className="text-2xl font-bold mb-4">Willkommen im Control Panel</h1>
      <p className="text-lg">Hier kannst du die Einstellungen für das Spiel anpassen.</p>
      <p className="text-lg mt-2">Bitte wähle eine Option aus dem Menü auf der linken Seite.</p>
    </div>
 */