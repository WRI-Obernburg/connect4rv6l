/**
 * Browser-side OpenTelemetry (traces + logs).
 *
 * Nothing is sent to Axiom directly: the backend exposes an OTLP proxy under
 * `/telemetry/v1/{traces,logs}` and adds the credentials. Every outgoing
 * WebSocket message can carry a `traceparent` (see `tracedMessage`) so the
 * backend span becomes a child of the user interaction that caused it.
 *
 * This file is identical in mobilefrontend, controlpanel and localfrontend.
 */
import {context, propagation, SpanStatusCode, trace, type Attributes, type Span} from "@opentelemetry/api";
import {logs, SeverityNumber} from "@opentelemetry/api-logs";
import {W3CTraceContextPropagator} from "@opentelemetry/core";
import {OTLPLogExporter} from "@opentelemetry/exporter-logs-otlp-http";
import {OTLPTraceExporter} from "@opentelemetry/exporter-trace-otlp-http";
import {resourceFromAttributes} from "@opentelemetry/resources";
import {BatchLogRecordProcessor, LoggerProvider} from "@opentelemetry/sdk-logs";
import {BatchSpanProcessor, WebTracerProvider} from "@opentelemetry/sdk-trace-web";

let serviceName = "connect4-frontend";
let initialized = false;
const sessionAttributes: Attributes = {};

/**
 * Initialise once per page. `proxyBase` is the backend URL that hosts the
 * telemetry proxy, e.g. `http://backend:3000/telemetry`.
 */
export function initTelemetry(name: string, proxyBase: string, extraAttributes: Attributes = {}) {
    if (initialized || typeof window === "undefined") return;
    initialized = true;
    serviceName = name;
    Object.assign(sessionAttributes, extraAttributes);

    const resource = resourceFromAttributes({
        "service.name": name,
        "browser.user_agent": navigator.userAgent,
        "browser.language": navigator.language,
        "page.url": window.location.href,
        ...extraAttributes,
    });

    const tracerProvider = new WebTracerProvider({
        resource,
        spanProcessors: [
            new BatchSpanProcessor(new OTLPTraceExporter({url: `${proxyBase}/v1/traces`}), {scheduledDelayMillis: 2000}),
        ],
    });
    tracerProvider.register({propagator: new W3CTraceContextPropagator()});

    const loggerProvider = new LoggerProvider({
        resource,
        processors: [
            new BatchLogRecordProcessor({exporter: new OTLPLogExporter({url: `${proxyBase}/v1/logs`}), scheduledDelayMillis: 2000}),
        ],
    });
    logs.setGlobalLoggerProvider(loggerProvider);

    window.addEventListener("error", (event) => {
        logEvent("ERROR", `Uncaught error: ${event.message}`, {
            "exception.message": event.message,
            "exception.stacktrace": event.error?.stack ?? "",
            "code.filepath": event.filename ?? "",
            "code.lineno": event.lineno ?? 0,
        });
    });
    window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        logEvent("ERROR", `Unhandled rejection: ${reason?.message ?? String(reason)}`, {
            "exception.stacktrace": reason?.stack ?? "",
        });
    });
    window.addEventListener("pagehide", () => {
        void tracerProvider.forceFlush();
        void loggerProvider.forceFlush();
    });
    logEvent("INFO", "Page loaded");
}

export function setTelemetryAttribute(key: string, value: string | number | boolean) {
    sessionAttributes[key] = value;
}

function tracer() {
    return trace.getTracer(serviceName);
}

/** Emit a structured log record, correlated with the active span if any. */
export function logEvent(severity: "DEBUG" | "INFO" | "WARN" | "ERROR", body: string, attributes: Attributes = {}) {
    const severityNumber = {
        DEBUG: SeverityNumber.DEBUG,
        INFO: SeverityNumber.INFO,
        WARN: SeverityNumber.WARN,
        ERROR: SeverityNumber.ERROR,
    }[severity];
    logs.getLogger(serviceName).emit({
        severityNumber,
        severityText: severity,
        body,
        attributes: {...sessionAttributes, ...attributes},
        context: context.active(),
    });
}

/** Run `fn` inside a UI span (e.g. a button tap). */
export function withUiSpan<T>(name: string, attributes: Attributes, fn: (span: Span) => T): T {
    return tracer().startActiveSpan(name, {attributes: {...sessionAttributes, ...attributes}}, (span) => {
        try {
            const result = fn(span);
            span.setStatus({code: SpanStatusCode.OK});
            return result;
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            span.recordException(error);
            span.setStatus({code: SpanStatusCode.ERROR, message: error.message});
            throw e;
        } finally {
            span.end();
        }
    });
}

/** The W3C trace headers for the currently active span, to embed in a message. */
export function traceCarrier(): { traceparent?: string; tracestate?: string } {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    return carrier;
}

/**
 * Wrap a WebSocket JSON message in a span named `ui.<message.type|action>` and
 * attach the trace context so the backend continues the trace.
 */
export function tracedMessage<T extends Record<string, unknown>>(message: T, spanName?: string): T & { traceparent?: string } {
    const name = spanName ?? `ui.${String(message.type ?? message.action ?? "message")}${message.command ? "." + String(message.command) : ""}`;
    const attributes: Attributes = {};
    for (const [k, v] of Object.entries(message)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") attributes[`message.${k}`] = v;
    }
    return withUiSpan(name, attributes, () => ({...message, ...traceCarrier()}));
}

/** Hooks for react-use-websocket lifecycle callbacks. */
export const wsTelemetry = {
    onOpen: (url: string) => logEvent("INFO", "WebSocket opened", {"ws.url": url}),
    onClose: (event: CloseEvent) => logEvent(event.code === 1000 ? "INFO" : "WARN", `WebSocket closed (${event.code})`, {"ws.close_code": event.code, "ws.close_reason": event.reason}),
    onError: () => logEvent("ERROR", "WebSocket error"),
};
