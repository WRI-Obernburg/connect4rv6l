import QRCode from "react-qr-code"
import type { GameState } from "../session"
import {GameField} from "./GameField";

export default function Game(props: { gameState: GameState, qrCodeLink: string, indoor: boolean }) {

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
                    <p className="text-3xl font-semibold leading-tight max-w-[14ch]">Revanche? Code scannen und neu starten.</p>
                  </div>
                : <p className="text-2xl text-wri-grey mt-8">Schwierigkeit: <DisplayDifficulty difficulty={props.gameState.difficulty}/></p>}
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

function DisplayDifficulty(props: {difficulty: string}) {
    const label = props.difficulty === "hard" ? "Schwer" : props.difficulty === "medium" ? "Mittel" : "Leicht";
    return <span className="font-bold text-wri-petrol">{label}</span>
}
