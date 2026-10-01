"use client";
import {useContext, useState} from "react";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {GameDataContext, WebsocketSendContext} from "@/provider/WebsocketProvider";
import {TelegramContact} from "@/app/models/GameData";

export default function TelegramPage() {
    const gameData = useContext(GameDataContext);
    const send = useContext(WebsocketSendContext);

    if (!gameData) {
        return <div className={"flex justify-center h-screen w-full items-center text-3xl text-gray-700"}>Verbinden...</div>;
    }

    const telegram = gameData.telegram;
    const contacts = telegram?.contacts ?? [];
    const pending = contacts.filter((c) => !c.approvedAt).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    const approved = contacts.filter((c) => c.approvedAt).sort((a, b) => a.name.localeCompare(b.name));
    const approve = (chatId: number) => send?.(JSON.stringify({action: "telegram_approve", chatId}));
    const remove = (chatId: number) => send?.(JSON.stringify({action: "telegram_remove", chatId}));

    return <div className={"flex flex-col gap-4"}>
        <Card>
            <CardHeader>
                <CardTitle>Telegram-Benachrichtigungen</CardTitle>
                <p className={"text-sm text-gray-500"}>
                    Freigegebene Kontakte bekommen bei jedem kritischen Fehler eine Nachricht (derselbe Fehler höchstens alle
                    15 Minuten) und eine Entwarnung, sobald das Spiel wieder frei ist. Sie können außerdem mit /status den
                    Zustand abfragen und den Roboter mit /sleep schlafen legen bzw. mit /wake aufwecken (nur zwischen IDLE und
                    SLEEP). Wer dem Bot /start schreibt, erscheint hier und bekommt erst nach der Freigabe Nachrichten.
                </p>
                {!telegram?.enabled
                    ? <div className={"mt-2 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900"}>
                        Der Bot ist aus: Im Backend ist <code>TELEGRAM_BOT_TOKEN</code> nicht gesetzt.
                    </div>
                    : <div className={`mt-2 rounded-md border p-3 text-sm ${telegram.connected
                        ? "border-green-200 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-800"}`}>
                        {telegram.connected ? "Bot läuft und ist mit Telegram verbunden." : "Bot läuft, erreicht Telegram aber gerade nicht."}
                    </div>}
            </CardHeader>
        </Card>

        <Card>
            <CardHeader><CardTitle>Warten auf Freigabe ({pending.length})</CardTitle></CardHeader>
            <CardContent className={"flex flex-col gap-2"}>
                {pending.length === 0 && <p className={"text-sm text-gray-400"}>Keine offenen Anfragen.</p>}
                {pending.map((contact) => <ContactRow key={contact.chatId} contact={contact}>
                    <Button className={"cursor-pointer"} onClick={() => approve(contact.chatId)}>Freigeben</Button>
                    <ConfirmButton label={"Ablehnen"} onConfirm={() => remove(contact.chatId)}/>
                </ContactRow>)}
            </CardContent>
        </Card>

        <Card>
            <CardHeader><CardTitle>Freigegeben ({approved.length})</CardTitle></CardHeader>
            <CardContent className={"flex flex-col gap-2"}>
                {approved.length === 0 && <p className={"text-sm text-gray-400"}>Noch niemand freigegeben.</p>}
                {approved.map((contact) => <ContactRow key={contact.chatId} contact={contact}>
                    <ConfirmButton label={"Entfernen"} onConfirm={() => remove(contact.chatId)}/>
                </ContactRow>)}
            </CardContent>
        </Card>
    </div>;
}

function ContactRow(props: { contact: TelegramContact, children: React.ReactNode }) {
    const c = props.contact;
    return <div className={"flex items-center justify-between gap-4 rounded-md border bg-white p-3"}>
        <div className={"flex flex-col"}>
            <span className={"font-semibold"}>{c.name}</span>
            <span className={"text-xs text-gray-500"}>
                {c.chatId < 0 ? "Gruppe" : "Person"} · angefragt {formatDate(c.requestedAt)}{c.approvedAt && ` · freigegeben ${formatDate(c.approvedAt)}`}
            </span>
        </div>
        <div className={"flex gap-2"}>{props.children}</div>
    </div>;
}

function ConfirmButton(props: { label: string, onConfirm: () => void }) {
    const [asking, setAsking] = useState(false);
    if (!asking) return <Button variant={"outline"} className={"cursor-pointer"} onClick={() => setAsking(true)}>{props.label}</Button>;
    return <>
        <Button variant={"destructive"} className={"cursor-pointer"} onClick={() => { setAsking(false); props.onConfirm(); }}>{props.label}?</Button>
        <Button variant={"outline"} className={"cursor-pointer"} onClick={() => setAsking(false)}>Nein</Button>
    </>;
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleString("de-DE", {dateStyle: "short", timeStyle: "short"});
}
