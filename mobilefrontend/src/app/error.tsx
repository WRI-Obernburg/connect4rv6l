"use client";

import { Panel, RetryButton } from "@/components/Game";

// Shown instead of a blank page when rendering fails
export default function ErrorPage({ reset }: { error: Error & { digest?: string }, reset: () => void }) {
    return <div className="mt-6">
        <h1 className="text-[2.6rem] leading-[1.02] text-white">Vier Gewinnt<br/>gegen den Roboter.</h1>
        <Panel title="Da ist etwas schiefgelaufen" text="Die Seite konnte nicht angezeigt werden. Versuche es noch einmal oder scanne den QR-Code am Spieltisch erneut.">
            <RetryButton onClick={reset} />
        </Panel>
    </div>
}
