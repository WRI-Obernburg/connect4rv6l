import errors from "./data/rsv_errors.json";
import messages from "./data/rsv_messages.json";

/**
 * Explains controller messages by number.
 *
 * 1. The handbook reference from rsv-fehlermeldungen.pdf (tools/extract-rsv-errors.py), with cause and remedy.
 *    It is from 2010 and misses about 1300 newer messages, e.g. most of the SafetyController ones.
 * 2. For those, the message catalog of the teach pendant (tools/extract-rsv-messages.mjs). It only has the
 *    message text.
 *
 * The number shown on the pendant (S3332) matches the catalog key (M3332); this is inferred from matching
 * texts, not documented.
 */
export type RsvError = {
    code: string,
    message: string,
    cause: string,
    remedy: string,
    source: "handbook" | "catalog",
};

const reference = errors as Record<string, Omit<RsvError, "source">>;

const catalog = (messages as { de: Record<string, string> }).de;

export function lookupRsvError(number: number, parameters: string[] = []): RsvError | null {
    const handbook = reference[`S${number}`];
    if (handbook) return { ...handbook, source: "handbook" };
    const text = catalog[`M${number}`];
    if (!text) return null;
    return { code: `S${number}`, message: formatCatalogText(text, parameters), cause: "", remedy: "", source: "catalog" };
}

// Catalog texts use Java MessageFormat placeholders like {0} or {1,number,#}; fill in known parameters
function formatCatalogText(text: string, parameters: string[]) {
    return text
        .replace(/\{(\d+)(,[^}]*)?\}/g, (_, index) => parameters[Number(index)] ?? "…")
        // words hyphenated at a line break, e.g. "ein-\ngestellt"
        .replace(/([a-zäöüß])-\n([a-zäöüß])/g, "$1$2")
        .replace(/\s*\n\s*/g, " ")
        .trim();
}
