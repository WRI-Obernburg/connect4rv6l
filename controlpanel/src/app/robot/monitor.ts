"use client";
import {useCallback, useContext, useEffect, useState} from "react";
import {WebsocketSendContext, WebsocketSubscribeContext} from "@/provider/WebsocketProvider";

export type Tone = "ok" | "warn" | "error" | "info" | "neutral";

export const TONE_BADGE: Record<Tone, string> = {
    ok: "bg-green-100 text-green-800",
    warn: "bg-yellow-100 text-yellow-800",
    error: "bg-red-100 text-red-700",
    info: "bg-blue-50 text-blue-700",
    neutral: "bg-gray-100 text-gray-600",
};

export const TONE_ICON: Record<Tone, string> = {
    ok: "text-green-600",
    warn: "text-yellow-600",
    error: "text-red-600",
    info: "text-blue-600",
    neutral: "text-gray-400",
};

export type TaskState = { name: string, state?: string, filename?: string, step?: number, error?: string };

export type LogbookEntry = {
    index: number, date: string, type: string, key: string, number: number, level?: string, source?: string,
    parameters: string[], text?: string,
    related: { type: string, key: string, parameters: string[], text?: string }[],
};

/**
 * Sends a read only monitoring request over the control panel websocket and keeps the latest reply.
 * With an interval it repeats the request while the component is mounted.
 */
export function useMonitor<T>(action: string, reply: string, payload: object = {}, intervalMs?: number, lazy = false) {
    const send = useContext(WebsocketSendContext);
    const subscribe = useContext(WebsocketSubscribeContext);
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(!lazy);
    const payloadKey = JSON.stringify(payload);

    useEffect(() => subscribe?.((message) => {
        if (message.type !== reply) return;
        setLoading(false);
        if (message.error) setError(String(message.error));
        else {
            setError(null);
            setData(message as unknown as T);
        }
    }), [subscribe, reply]);

    const request = useCallback((extra: object = {}) => {
        setLoading(true);
        send?.(JSON.stringify({action, ...JSON.parse(payloadKey), ...extra}));
    }, [send, action, payloadKey]);

    useEffect(() => {
        if (lazy) return;
        request();
        if (!intervalMs) return;
        const id = setInterval(() => request(), intervalMs);
        return () => clearInterval(id);
    }, [request, intervalMs, lazy]);

    return {data, error, loading, refresh: request};
}

/** A value kept in localStorage, e.g. favourites; falls back to the default when storage is unavailable. */
export function useStoredState<T>(key: string, initial: T): [T, (value: T | ((old: T) => T)) => void] {
    const [value, setValue] = useState<T>(initial);
    useEffect(() => {
        try {
            const saved = localStorage.getItem(key);
            if (saved) setValue(JSON.parse(saved));
        } catch { /* private mode or blocked storage */ }
    }, [key]);
    const update = useCallback((next: T | ((old: T) => T)) => {
        setValue((old) => {
            const resolved = typeof next === "function" ? (next as (o: T) => T)(old) : next;
            try {
                localStorage.setItem(key, JSON.stringify(resolved));
            } catch { /* ignore */ }
            return resolved;
        });
    }, [key]);
    return [value, update];
}

export const formatDateTime = (value: string) => {
    const date = new Date(value.replace(" ", "T"));
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("de-DE", {dateStyle: "short", timeStyle: "medium"});
};
