import QRCode from "react-qr-code";

export default function QRCodeComponent(props: { qrCodeLink: string | null, isGameRunning: boolean }) {
    return (
        <div className="flex flex-row items-stretch justify-center gap-10">
            {
                props.qrCodeLink && <div className="panel rounded-3xl p-8 flex items-center">
                    <QRCode value={props.qrCodeLink} fgColor="#0d4453" bgColor="transparent" className="h-[28rem] w-[28rem]"/>
                </div>
            }
            <div className="panel rounded-3xl p-14 max-w-[44vw] flex flex-col justify-center">
                <p className="text-7xl font-extrabold tracking-[-0.02em] leading-[1.02]">Spiel gegen den Roboter.</p>
                <p className="text-3xl text-wri-grey mt-6 max-w-[30ch]">
                    Scanne den Code mit deinem Handy. Du wählst die Spalte, der RV6L setzt die Chips auf das echte Spielfeld.
                </p>
                {
                    props.isGameRunning &&
                    <p className="mt-8 text-2xl font-semibold text-wri-cyan-dark">Verbindung verloren? Code erneut scannen und weiterspielen.</p>
                }
            </div>
        </div>
    );
}
