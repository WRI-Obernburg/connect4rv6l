#!/usr/bin/env python3
"""Builds backend/src/data/rsv_errors.json from the Reis manual rsv-fehlermeldungen.pdf.

Usage: python3 extract-rsv-errors.py <path to rsv-fehlermeldungen.pdf>
Needs PyMuPDF (pip install pymupdf) and pdftotext (poppler).
"""
import json, re, subprocess, sys
from pathlib import Path
import fitz

pdf = sys.argv[1]
out = Path(__file__).resolve().parent.parent / "backend/src/data/rsv_errors.json"
doc = fitz.open(pdf)

def clean(text):
    text = re.sub(r"\s+", " ", re.sub(r"[\uf000-\uf8ff]", "•", text or "")).strip()
    # undo hyphenation at line breaks: "Pro- gramm" -> "Programm", "USV- Status" -> "USV-Status"
    text = re.sub(r"([a-zäöüß])- ([a-zäöüß])", r"\1\2", text)
    return re.sub(r"([A-Za-zÄÖÜäöü])- ([A-ZÄÖÜ])", r"\1-\2", text)

def repair_underscores(text, tokens):
    # the table extraction moves "_" out of identifiers like IBIN_FUNC_IN[1]; put them back
    for token in tokens:
        spaced = re.escape(token.strip("_").replace("_", " "))
        if " " in token.strip("_") .replace("_", " ") and re.search(spaced, text):
            text = re.sub(spaced, token, text)
    text = re.sub(r"(\s_)+(?=\s|$)", "", text)
    return clean(text)

entries = {}
last = None
for page in doc:
    layout = subprocess.run(["pdftotext", "-layout", "-f", str(page.number + 1), "-l", str(page.number + 1), pdf, "-"],
                            capture_output=True, text=True).stdout
    tokens = sorted(set(re.findall(r"[A-Za-z0-9\[\]]*_[A-Za-z0-9_\[\]]+", layout)), key=len, reverse=True)
    for table in page.find_tables().tables:
        for row in table.extract():
            if len(row) < 4:
                continue
            code, message, cause, remedy = (repair_underscores(c or "", tokens) for c in row[:4])
            if code == "Code":
                continue
            if code:
                last = code
                entries[code] = {"code": code, "message": message, "cause": cause, "remedy": remedy}
            elif last:  # row continues on the next page
                entry = entries[last]
                for key, value in (("message", message), ("cause", cause), ("remedy", remedy)):
                    if value:
                        entry[key] = clean(entry[key] + " " + value)

# other tables in the manual (dates, ranges, parameter lists) end up here too, keep real message codes only
entries = {code: entry for code, entry in entries.items() if re.fullmatch(r"[A-Z]\d+(,\d+)?", code)}
out.write_text(json.dumps(entries, ensure_ascii=False, indent=1))
print(f"{len(entries)} entries -> {out}")
