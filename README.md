# Taktische Zeichen 3D Tools

Browserbasierte 3D-Tools zum Erzeugen taktischer Zeichen als 3MF-Dateien fuer den Mehrfarb-3D-Druck.

## Live-Version

Eine lauffaehige Instanz ist hier verfuegbar:

https://pq5.de/pq5/3D-Tools/TaktischeZeichen/

## Funktionen

- Taktische Zeichen als 3D-Tag exportieren
- Grundformen fuer MOLLE, C-Profil und kleine Schluesselanhaenger
- Mehrfarbige 3MF-Dateien mit getrennten Objekten im Objektbaum
- Stapelverarbeitung mit lokaler Speicherung im Browser
- Set-Export fuer mehrere Druckplatten
- Option fuer Oberseite auf Druckbett

## Entwicklung

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Datenschutz

Alle eingegebenen Daten werden lokal im Browser verarbeitet. Es findet keine serverseitige Verarbeitung der eingegebenen Daten statt.

## Credits

Die verwendeten taktischen Zeichen basieren auf:

https://github.com/jonas-koeritz/Taktische-Zeichen

Lizenz der taktischen Zeichen: CC0 1.0.

Verwendete Bibliotheken:

- React
- Three.js
- Vite
- fflate
- opentype.js
- polygon-clipping

## Projekt

Projekt von Philipp "goerdy" Guerth auf pq5.de.
