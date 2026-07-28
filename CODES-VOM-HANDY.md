# Freischaltcodes unterwegs verwalten

Der Mac zu Hause muss dafür nicht eingeschaltet sein. GitHub verarbeitet den
Code, veröffentlicht nur dessen Prüfsumme und aktualisiert GitHub Pages.

## Einmalige Vorbereitung

1. Öffne im Handy-Browser:
   <https://github.com/vocalat/latein/settings/secrets/actions>
2. Tippe auf **New repository secret**.
3. Als Namen trägst du exakt `VOCALAT_NEW_ACCESS_CODE` ein.
4. Als Wert trägst du den Freischaltcode ein und speicherst ihn.

## Einen Code aktivieren

1. Öffne:
   <https://github.com/vocalat/latein/actions/workflows/manage-access-code.yml>
2. Tippe auf **Run workflow**.
3. Wähle `activate` und starte den Ablauf.
4. Sobald der Lauf grün ist, ist der Code normalerweise nach etwa einer
   Minute auf GitHub Pages verfügbar.

Für den nächsten Code ersetzt du zuerst den Wert des Secrets
`VOCALAT_NEW_ACCESS_CODE` und startest den Ablauf erneut.

## Einen Code sperren

Speichere den zu sperrenden Code wieder als `VOCALAT_NEW_ACCESS_CODE`. Starte
danach denselben Ablauf mit `revoke`. Bestehende Sitzungen dieses Codes werden
dadurch ebenfalls ungültig.

## Erlaubte Codes

Eigene Codes dürfen aus einem einzigen Zeichen, nur Buchstaben, nur Zahlen
oder Sonderzeichen bestehen. Groß- und Kleinschreibung wird nicht
unterschieden; Leerzeichen und Bindestriche dienen weiterhin nur als
Trennzeichen.

Sehr kurze Codes sind auf einer statischen Website leicht zu erraten. Nutze
ein- oder zweistellige Codes deshalb nur kurz zum Testen. Für echte Zugänge
sollte der Code mindestens zwölf zufällige Zeichen haben.

## Weitere Änderungen vom Handy

Kleine Text- oder Datendateien kannst du direkt auf GitHub über das
Stiftsymbol bearbeiten. Für mehrere Dateien öffnest du
<https://github.dev/vocalat/latein>. Änderungen aus dem Code-Manager benötigen
weder den Mac zu Hause noch ein geöffnetes Terminal.
