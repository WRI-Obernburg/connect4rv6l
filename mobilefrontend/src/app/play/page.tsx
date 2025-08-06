"use client";

import Game from "@/components/Game";
import { useSearchParams } from "next/navigation";

export default function Home() {
      const searchParams = useSearchParams()
    const sessionID = searchParams.get("sessionID");


    return <div className="flex flex-col justify-center mt-4">
        <h1 className="text-3xl font-bold text-center mb-4">RV6L-Gewinnt</h1>
        <p className="text-center text-lg">Beweise dich jetzt in einem Spiel gegen den Viergewinnt-Roboter</p>

        {sessionID ? <Game sessionID={sessionID} /> : <div className="text-red-500 text-center font-bold">Spiel ID fehlt</div>}
        
    </div>
};