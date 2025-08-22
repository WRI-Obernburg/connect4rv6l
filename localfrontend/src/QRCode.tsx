import QRCode from "react-qr-code";

export default function QRCodeComponent(props: { qrCodeLink: string | null, isGameRunning: boolean }) {
    return (
        <div className="flex flex-row items-center justify-center gap-16 w-screen">
            
            {
                props.qrCodeLink && <QRCode value={props.qrCodeLink} className="h-[40rem] w-[40rem]"/>
            }
            <div>
                <p className="text-gray-600 text-7xl font-bold">RV6L-Gewinnt</p>
                <p className="max-w-[40vw] text-3xl text-gray-500 mt-2">
                    Scanne den QR-Code mit dem Handy um ein Spiel gegen den Roboter zu spielen.
                </p>
                {
                    props.isGameRunning && 
                    <p className="pt-4 font-bold text-2xl">Verbindung verloren? Einfach QR-Code scannen und weiterspielen!</p>
                }
            </div>
        </div>
    );
}

