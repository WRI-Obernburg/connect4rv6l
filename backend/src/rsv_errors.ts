import errors from "./data/rsv_errors.json";

// Error reference from the Reis manual rsv-fehlermeldungen.pdf, built with tools/extract-rsv-errors.py
export type RsvError = { code: string, message: string, cause: string, remedy: string };

const reference = errors as Record<string, RsvError>;

// The controller reports messages by number, the manual lists them as S<number>
export function lookupRsvError(number: number): RsvError | null {
    return reference[`S${number}`] ?? null;
}
