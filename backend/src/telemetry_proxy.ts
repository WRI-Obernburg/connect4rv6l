/**
 * OTLP/HTTP proxy for browser clients.
 *
 * The frontends must not carry the Axiom token, so they export their spans and
 * logs to `<backend>/telemetry/v1/{traces,logs}`; the backend forwards the raw
 * OTLP payload to Axiom with the proper headers.
 */
import express, {type Router} from "express";
import {AXIOM_LOGS_URL, AXIOM_TRACES_URL, axiomHeaders, telemetryEnabled} from "./telemetry";

const MAX_BODY = "2mb";

export function telemetryProxyRouter(): Router {
    const router = express.Router();
    router.use(express.raw({type: () => true, limit: MAX_BODY}));

    const forward = (target: string) => async (req: express.Request, res: express.Response) => {
        if (!telemetryEnabled) {
            res.status(204).end();
            return;
        }
        try {
            const upstream = await fetch(target, {
                method: "POST",
                headers: {
                    ...axiomHeaders(),
                    "Content-Type": req.headers["content-type"] ?? "application/json",
                },
                body: req.body as Buffer,
            });
            res.status(upstream.status).end();
        } catch (e) {
            console.error("[telemetry] proxy error", e);
            res.status(502).end();
        }
    };

    router.post("/v1/traces", forward(AXIOM_TRACES_URL));
    router.post("/v1/logs", forward(AXIOM_LOGS_URL));
    return router;
}
