# Werkzeuge für die RV6L-Steuerung

Hilfsprogramme, die direkt über die RSVCMD-XML-Schnittstelle mit der Robotersteuerung sprechen. Sie brauchen nur Node.js oder Bun, keine Abhängigkeiten.

| Datei | Zweck |
|---|---|
| `rsvcmd.mjs` | Gemeinsamer Client für das RSVCMD-Protokoll |
| `read-robot-programs.mjs` | Liest die Roboterprogramme als Quelltext aus. Sendet nur lesende Befehle |
| `rv6l-test.mjs` | Test vor Ort: Merker-Zuordnung prüfen und Programmstopp über die Schnittstelle testen |

## Ausführen

Die Steuerung nimmt XML-Befehle nur von der IP an, die in `S:/$CONFIG/$CNF/PROTECT` unter `OP_XML_PASS` eingetragen ist. Die Tools laufen deshalb auf dem Backend-Pi.

```bash
# Ordner auf den Pi kopieren
scp -r tools wri@rv6l-application.local:~

# auf dem Pi: Backend stoppen, damit keine zweite Sitzung parallel läuft (Roboter muss stehen)
cd ~/connect4rv6l-deployment && docker compose stop connect4

# Tool mit Bun aus Docker starten
cd ~/tools && docker run --rm -it --network host -v "$PWD":/w -w /w oven/bun:alpine bun rv6l-test.mjs

# danach Backend wieder starten
cd ~/connect4rv6l-deployment && docker compose start connect4
```

Standardadresse der Steuerung ist `192.168.2.1:80`, andere über `ROBOT_HOST` und `ROBOT_PORT` (bei Docker mit `-e ROBOT_HOST=...`).

## Test vor Ort mit `rv6l-test.mjs`

Ziel: klären, ob sich das Roboterprogramm über die Schnittstelle zuverlässig anhalten lässt und welche Merker den Zustand der Steuerung zeigen. Die Zuordnung der Merker ist aus der Dokumentation abgeleitet und noch nicht am echten Roboter bestätigt.

Alle Ausgaben landen zusätzlich in `rv6l-test-<Zeitstempel>.log`. Diese Datei bitte nach dem Test sichern.

### Teil A: Merker prüfen (nur lesen, ohne Risiko)

1. Befehl `watch` starten. Angezeigt werden `I_Aktion`, die Rohwerte von `_IPLC[234]` und `_IPLC[243]` sowie diese Merker:
   - M935.6 Programm läuft
   - M968.1 / M968.2 Start- und Stopp-Anforderung
   - M970.2 / M970.3 Kollisionserkennung aktiv / Kollision erkannt
2. Am Bedienpanel das Programm stoppen und wieder starten. Erwartung: M935.6 wechselt zwischen 0 und 1.
3. Betriebsart wechseln (AUTO, T1) und beobachten, welche Bits sich dabei ändern.
4. Die Anzeige mit Enter beenden.

Ändert sich M935.6 nicht, stimmt die abgeleitete Zuordnung nicht. Dann zeigen die Rohwerte, welches Bit sich stattdessen ändert.

### Teil B: Programmstopp über die Schnittstelle (`stoptest`)

In T1/T2 reagiert die Steuerung nicht auf Fernbefehle. Der Test ist deshalb nur in **AUTO** sinnvoll. Voraussetzungen:

- Override niedrig, zum Beispiel 10 %
- niemand im Gefahrenbereich
- eine Person hat die Hand am NOT-HALT
- Backend gestoppt, Roboterprogramm läuft, `I_Aktion` ist 0

Ablauf:

1. Nach Bestätigung schreibt das Tool `I_Aktion = 90`, der Roboter fährt in die Referenzposition.
2. Sobald er fährt, Enter drücken. Das Tool sendet sofort `_IPLC[243] OR 4` (Programmstopp laut Handbuch Kap. 9.2.19.4).
3. Das Tool zeichnet die nächsten 5 Sekunden auf und fragt, ob der Roboter angehalten hat.
4. Es meldet, ob das STOP-Bit von selbst zurückfällt oder gesetzt bleibt.
5. Fortsetzen am besten am Bedienpanel. Alternativ mit `clearstop` (STOP-Bit löschen, falls es gesetzt blieb) und `start` (`_IPLC[243] OR 2`).

Wichtig zu beobachten und zu notieren:

- Hält der Roboter sofort an, bremst er bahntreu, oder fährt er die Bewegung zu Ende?
- Geht M935.6 (Programm läuft) auf 0?
- Setzt das Programm nach dem Fortsetzen die unterbrochene Bewegung fort, oder bleibt `I_Aktion` auf 90 stehen?

Nie den Merker **M935.0** beschreiben, er fährt die Steuerung herunter.
