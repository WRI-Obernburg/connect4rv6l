/**
 * OpenTelemetry setup for the backend.
 *
 * Traces and logs are exported via OTLP/HTTP to Axiom. Configuration is
 * entirely env-driven:
 *
 *   AXIOM_TOKEN      API token with ingest permission (required to export)
 *   AXIOM_DATASET    Dataset name (required to export)
 *   AXIOM_URL        Axiom API base URL, default https://api.axiom.co
 *                    (use https://api.eu.axiom.co for EU region)
 *   OTEL_SERVICE_NAME  default "connect4-backend"
 *   OTEL_DEBUG       "1" prints spans/logs to stdout as well
 *
 * Without AXIOM_TOKEN/AXIOM_DATASET the SDK still runs (so instrumentation code
 * needs no guards), but nothing leaves the process.
 *
 * Every span gets the current game/session context attached by
 * GameContextProcessor so a single filter in Axiom (game.id = "...") shows
 * everything that happened during one game across robot, state machine,
 * player device and control panel.
 */
import {
    context,
    propagation,
    SpanKind,
    SpanStatusCode,
    trace,
    type Attributes,
    type Context,
    type Span,
} from "@opentelemetry/api";
import { logs, SeverityNumber, type Logger } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
    BatchLogRecordProcessor,
    ConsoleLogRecordExporter,
    LoggerProvider,
    SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
    BasicTracerProvider,
    BatchSpanProcessor,
    ConsoleSpanExporter,
    SimpleSpanProcessor,
    type ReadableSpan,
    type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

export const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "connect4-backend";
const AXIOM_URL = (process.env.AXIOM_URL || "https://api.axiom.co").replace(/\/$/, "");
const AXIOM_TOKEN = process.env.AXIOM_TOKEN;
const AXIOM_DATASET = process.env.AXIOM_DATASET;
const OTEL_DEBUG = process.env.OTEL_DEBUG === "1";

export const telemetryEnabled = Boolean(AXIOM_TOKEN && AXIOM_DATASET);

/** Headers used for direct export and for the frontend proxy. */
export function axiomHeaders(): Record<string, string> {
    return {
        Authorization: `Bearer ${AXIOM_TOKEN}`,
        "X-Axiom-Dataset": AXIOM_DATASET ?? "",
    };
}

export const AXIOM_TRACES_URL = `${AXIOM_URL}/v1/traces`;
export const AXIOM_LOGS_URL = `${AXIOM_URL}/v1/logs`;

/**
 * Mutable "what is going on right now" context that is stamped onto every
 * span and log record. Updated by the game manager / session code.
 */
export const gameContext: {
    gameId: string | null;
    sessionId: string;
    stateName: string;
    rv6lMock: boolean;
} = {
    gameId: null,
    sessionId: "",
    stateName: "IDLE",
    rv6lMock: false,
};

export function gameContextAttributes(): Attributes {
    const attrs: Attributes = {
        "game.state": gameContext.stateName,
        "session.id": gameContext.sessionId,
        "rv6l.mock": gameContext.rv6lMock,
    };
    if (gameContext.gameId) attrs["game.id"] = gameContext.gameId;
    return attrs;
}

class GameContextProcessor implements SpanProcessor {
    onStart(span: Span): void {
        span.setAttributes(gameContextAttributes());
    }
    onEnd(_span: ReadableSpan): void {}
    forceFlush(): Promise<void> {
        return Promise.resolve();
    }
    shutdown(): Promise<void> {
        return Promise.resolve();
    }
}

const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "dev",
    "deployment.environment": process.env.NODE_ENV ?? "development",
});

const spanProcessors: SpanProcessor[] = [new GameContextProcessor()];
const logProcessors = [];

if (telemetryEnabled) {
    spanProcessors.push(
        new BatchSpanProcessor(
            new OTLPTraceExporter({ url: AXIOM_TRACES_URL, headers: axiomHeaders() }),
            { scheduledDelayMillis: 2000 },
        ),
    );
    logProcessors.push(
        new BatchLogRecordProcessor({
            exporter: new OTLPLogExporter({ url: AXIOM_LOGS_URL, headers: axiomHeaders() }),
            scheduledDelayMillis: 2000,
        }),
    );
}
if (OTEL_DEBUG) {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
    logProcessors.push(new SimpleLogRecordProcessor({ exporter: new ConsoleLogRecordExporter() }));
}

const tracerProvider = new BasicTracerProvider({ resource, spanProcessors });
const loggerProvider = new LoggerProvider({ resource, processors: logProcessors });

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
propagation.setGlobalPropagator(new W3CTraceContextPropagator());
trace.setGlobalTracerProvider(tracerProvider);
logs.setGlobalLoggerProvider(loggerProvider);

export const tracer = trace.getTracer(SERVICE_NAME);
export const otelLogger: Logger = logs.getLogger(SERVICE_NAME);

export function initTelemetry() {
    if (telemetryEnabled) {
        console.log(`[telemetry] exporting traces and logs to ${AXIOM_URL} (dataset ${AXIOM_DATASET})`);
    } else {
        console.log("[telemetry] AXIOM_TOKEN/AXIOM_DATASET not set, telemetry export disabled");
    }
    const shutdown = async () => {
        await Promise.allSettled([tracerProvider.shutdown(), loggerProvider.shutdown()]);
    };
    process.once("SIGINT", async () => {
        await shutdown();
        process.exit(0);
    });
    process.once("SIGTERM", async () => {
        await shutdown();
        process.exit(0);
    });
}

export async function flushTelemetry() {
    await Promise.allSettled([tracerProvider.forceFlush(), loggerProvider.forceFlush()]);
}

/**
 * Run `fn` inside a new span that is a child of the currently active span.
 * Exceptions are recorded on the span, mark it as errored and are re-thrown.
 */
export async function withSpan<T>(
    name: string,
    attributes: Attributes,
    fn: (span: Span) => Promise<T>,
    options: { kind?: SpanKind; parent?: Context } = {},
): Promise<T> {
    const parent = options.parent ?? context.active();
    return tracer.startActiveSpan(name, { attributes, kind: options.kind ?? SpanKind.INTERNAL }, parent, async (span) => {
        try {
            const result = await fn(span);
            if (span.isRecording() && !spanHasErrorStatus(span)) span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (e: any) {
            span.recordException(e instanceof Error ? e : new Error(String(e)));
            span.setStatus({ code: SpanStatusCode.ERROR, message: e?.message ?? String(e) });
            throw e;
        } finally {
            span.end();
        }
    });
}

function spanHasErrorStatus(span: Span): boolean {
    // ReadableSpan exposes status; the API Span type does not. Guard at runtime.
    return (span as unknown as { status?: { code: SpanStatusCode } }).status?.code === SpanStatusCode.ERROR;
}

/** Extract a W3C trace context from a `traceparent` carried inside a JSON message. */
export function contextFromMessage(msg: { traceparent?: string; tracestate?: string } | null | undefined): Context {
    if (!msg?.traceparent) return context.active();
    return propagation.extract(context.active(), {
        traceparent: msg.traceparent,
        tracestate: msg.tracestate,
    });
}

/** Emit a structured log record correlated with the active span. */
export function emitLog(
    severity: "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL",
    body: string,
    attributes: Attributes = {},
) {
    const severityNumber = {
        DEBUG: SeverityNumber.DEBUG,
        INFO: SeverityNumber.INFO,
        WARN: SeverityNumber.WARN,
        ERROR: SeverityNumber.ERROR,
        FATAL: SeverityNumber.FATAL,
    }[severity];
    otelLogger.emit({
        severityNumber,
        severityText: severity,
        body,
        attributes: { ...gameContextAttributes(), ...attributes },
        context: context.active(),
    });
}

export { SpanKind, SpanStatusCode, context, trace, type Span };
