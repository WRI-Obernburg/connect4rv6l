"use client";

import Game from "@/components/Game";
import { useSearchParams } from "next/navigation";

export default function Home() {
    const searchParams = useSearchParams()
    const sessionID = searchParams.get("sessionID");
    const indoor = searchParams.get("indoor") != null;

    return <div className="mt-6">
        <h1 className="text-[2.6rem] leading-[1.02] text-white">Vier Gewinnt<br/>gegen den Roboter.</h1>
        <p className="mt-3 text-white/80 max-w-[34ch] font-medium">Der RV6L setzt jeden Zug mit dem Arm auf das echte Spielfeld. Du wählst die Spalte hier.</p>

        {sessionID
            ? <Game indoor={indoor} sessionID={sessionID} />
            : <div className="panel rounded-2xl p-6 mt-8">
                <p className="text-2xl font-extrabold">Kein Spiel gefunden</p>
                <p className="mt-1 text-wri-grey">Der Link enthält keine Spiel-ID. Scanne den QR-Code am Spieltisch erneut.</p>
              </div>}
    </div>
};
