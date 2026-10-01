import QRCode from "react-qr-code"
import type { GameState } from "../session"
import {GameField} from "./GameField";

export default function Game(props: { gameState: GameState, qrCodeLink: string, indoor: boolean, waiting: number }) {

    let gameBoard = props.gameState.board;
    if(!props.indoor && gameBoard) {
        // Flip the board for outdoor play
        gameBoard = {
            0: gameBoard[6],
            1: gameBoard[5],
            2: gameBoard[4],
            3: gameBoard[3],
            4: gameBoard[2],
            5: gameBoard[1],
            6: gameBoard[0],
        };
    }
    const gameOver = ["TIE", "PLAYER_WIN", "ROBOT_WIN"].includes(props.gameState.stateName);

    return <div className="flex flex-row justify-center items-stretch gap-10">
        <div className="panel rounded-3xl p-8 flex items-center">
            <GameField board={gameBoard} interactive={false} xl={true}></GameField>
        </div>
        <div className="panel rounded-3xl p-12 w-[40vw] flex flex-col justify-between">
            <div>
                <CurrentAction gameState={props.gameState}></CurrentAction>
            </div>
            {gameOver
                ? <div className="flex items-center gap-8 mt-8">
                    <div className="bg-white rounded-2xl p-4"><QRCode value={props.qrCodeLink} fgColor="#0d4453" bgColor="transparent" size={200}></QRCode></div>
                    {/* with people waiting the next one in the queue plays, a rematch is only possible without */}
                    <div>
                        <p className="text-3xl font-semibold leading-tight max-w-[16ch]">
                            {props.waiting > 0 ? "Mitspielen? Code scannen und anstellen." : "Revanche? Code scannen und neu starten."}
                        </p>
                        {props.waiting > 0 && <p className="text-2xl text-wri-grey mt-3"><Waiting count={props.waiting}/></p>}
                    </div>
                  </div>
                : <div className="mt-8 flex flex-col gap-6">
                    <p className="text-2xl text-wri-grey">Schwierigkeit: <DisplayDifficulty difficulty={props.gameState.difficulty}/></p>
                    {/* the next ones can queue up on their phone while this game runs */}
                    <div className="flex items-center gap-6">
                        <div className="bg-white rounded-xl p-2"><QRCode value={props.qrCodeLink} fgColor="#0d4453" bgColor="transparent" size={110}></QRCode></div>
                        <div>
                            <p className="text-2xl font-semibold leading-tight">Mitspielen? Code scannen und anstellen.</p>
                            <p className="text-xl text-wri-grey mt-1"><Waiting count={props.waiting}/></p>
                        </div>
                    </div>
                  </div>}
        </div>
    </div>
}


function CurrentAction(props: { gameState: GameState }) {
    const s = props.gameState.stateName;
    let title = "", hint = "", accent = false;

    if (s === "CLEAN_UP") { title = "Das Spielfeld wird geleert."; hint = "Der Roboter räumt die Chips zurück."; }
    else if (s === "ROBOT_WIN") { title = "Der Roboter gewinnt."; hint = "Vier in einer Reihe für Rot."; }
    else if (s === "PLAYER_WIN") { title = "Gewonnen!"; hint = "Vier in einer Reihe für Blau."; accent = true; }
    else if (s === "TIE") { title = "Unentschieden."; hint = "Das Feld ist voll."; }
    else if (["GRAP_BLUE_CHIP", "PLACE_BLUE_CHIP"].includes(s)) { title = "Der Roboter setzt den blauen Chip."; hint = "Bitte nicht in den Arbeitsbereich greifen."; }
    else if (["ROBOT_SELECTION", "GRAP_RED_CHIP", "PLACE_RED_CHIP"].includes(s)) { title = "Der Roboter ist am Zug."; hint = "Er überlegt und setzt Rot."; }
    else if (s === "PLAYER_SELECTION") { title = "Du bist am Zug."; hint = "Wähle die Spalte auf deinem Handy."; accent = true; }

    return <>
        <p className={`text-7xl font-extrabold tracking-[-0.02em] leading-[1.02] ${accent ? "text-wri-cyan-dark" : ""}`}>{title}</p>
        <p className="text-3xl text-wri-grey mt-5">{hint}</p>
    </>
}

function Waiting(props: { count: number }) {
    if (props.count === 0) return <>Noch niemand wartet.</>;
    return <>{props.count === 1 ? "Eine Person wartet" : `${props.count} Personen warten`}.</>;
}

function DisplayDifficulty(props: {difficulty: string}) {
    const label = props.difficulty === "hard" ? "Schwer" : props.difficulty === "medium" ? "Mittel" : "Leicht";
    return <span className="font-bold text-wri-petrol">{label}</span>
}
