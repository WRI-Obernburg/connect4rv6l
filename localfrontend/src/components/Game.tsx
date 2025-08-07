import QRCode from "react-qr-code"
import type { GameState } from "../session"
import {GameField} from "component-lib";

export default function Game(props: { gameState: GameState, qrCodeLink: string }) {
    return <div className="flex flex-row justify-center gap-16 items-center">
        <div className="flex flex-col justify-center gap-16">
            <div className="text-7xl text-gray-600">
                <CurrentAction gameState={props.gameState}></CurrentAction>
            </div>
            <GameField board={props.gameState.board} interactive={false} xl={true}></GameField>
            <p className="font-bold self-center text-gray-600 text-4xl inline">Schwierigkeitsgrad: <DisplayDifficulty difficulty={props.gameState.difficulty}/></p>

        </div>
        {
            props.gameState.isGameOver && <div className="flex flex-col justify-center gap-4 items-center">
                <div className="text-4xl font-bold text-gray-500">Revanche?</div>
                <QRCode value={props.qrCodeLink}></QRCode>
            </div>
        }
    </div>
}


function CurrentAction(props: { gameState: GameState }) {

    if(props.gameState.isPhysicalBoardClearing) {
        return <div className="text-center font-bold">Das Spielfeld wird geleert...</div>
    }

    if (props.gameState.isGameOver && props.gameState.winner === 2) {
        return <div className="text-center  font-bold">Der Roboter hat gewonnen!</div>
    }

    if (props.gameState.isGameOver && props.gameState.winner === 1) {
        return <div className="text-center  font-bold">Du hast gewonnen!</div>
    }

    if (props.gameState.isRobotInAction && props.gameState.isHumanTurn) {
        return <div className="text-center  font-bold">Der Roboter setzt deinen Chip...</div>
    }

    if (!props.gameState.isHumanTurn) {
        return <div className="text-center  font-bold">Der Roboter ist am Zug...</div>
    }

    if (props.gameState.isHumanTurn) {
        return <div className="text-center  font-bold">Du bist am Zug!</div>
    }

}

function DisplayDifficulty(props: {difficulty: string}) {
    if(props.difficulty==="hard") {
        return <p className="text-center inline font-bold">Schwer</p>
    }else if(props.difficulty === "medium") {
        return <p className="text-center inline font-bold">Mittel</p>
    }else{
        return <p className="text-center inline font-bold">Leicht</p>
    }
}