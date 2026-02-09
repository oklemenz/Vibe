# 🚗 AutoWelt - Fahrschule Simulator

Ein 3D-Fahrschul-Spiel mit Three.js, featuring **10 verschiedene Autos**, ein **Energie-Management-System**, und eine **riesige offene Welt**!

## 🎮 Spielanleitung

### 🌟 NEU: Energie-System ⚡

Dein Auto verbraucht **Energie beim Fahren**!
- ⚡ **100% Startenergie**
- 📉 **1.5% Verbrauch pro Sekunde** beim Vorwärtsfahren
- 🔌 **16 Ladestationen** in der Stadt verteilt
- ❌ **Game Over** wenn Energie auf 0% fällt

### Ziel des Spiels
- 🎯 Finde und erreiche das **goldene Ziel** in der Stadt
- 💰 Sammle **Münzen** durch Ziel-Erreichen
- 🚗 Kaufe **bessere Autos** mit deinen Münzen
- ⚡ **Manage deine Energie** - finde Ladestationen!
- 🏆 Vermeide **Kollisionen** und **Regelverstöße**
- 📈 Steige in **Levels** auf

### Steuerung
- **↑ Pfeil nach oben** - Vorwärts fahren
- **↓ Pfeil nach unten** - Rückwärts fahren
- **← → Pfeile links/rechts** - Lenken (sehr agil!)
- **LEERTASTE** - Bremse

### 🔋 Energie-Management

**Energie-Anzeige (HUD oben links):**
- 🟢 **Grün (100%-40%):** Alles in Ordnung
- 🟠 **Orange (40%-20%):** Bald nachladen!
- 🔴 **Rot blinkend (<20%):** KRITISCH - Ladestation suchen!

**Ladestationen finden:**
- 🟢 Grüne leuchtende Säulen
- 🔵 Blaue Basis-Plattform
- ⚡ Gelbes Blitz-Symbol
- 💡 Heller Lichtschein

**Aufladen:**
- Fahre **nahe zur Ladestation** (5 Meter Radius)
- 🔌 **"Lädt..."** erscheint automatisch im HUD
- ⚡ **15% pro Sekunde** Ladegeschwindigkeit
- Bleibe stehen oder fahre weiter während des Ladens

### Punktesystem
- **Start-Punkte:** 100
- **Ziel erreichen:** +20 Punkte + Münzen (50 + Level×10)
- **Kollision mit Gebäude:** -15 Punkte
- **Fahrzeug verlässt Straße:** -10 Punkte
- **Bei 0 Punkten:** Game Over mit Reset

### 🌍 Die Welt

**Größe:** 500x500 Meter - Eine riesige Stadt!

**Features:**
- 🛣️ **100+ Kreuzungen** mit Grid-System
- 🏢 **Hunderte von Gebäuden** mit beleuchteten Fenstern
- ⚡ **16 Ladestationen** strategisch platziert
- 🎯 **Dynamisches Ziel** (bewegt sich nach Erreichen)
- 🌳 **Bäume** und Vegetation
- 💡 **Straßenlaternen** für Atmosphäre

### Die 10 Autos

Jedes Auto wird mit steigendem Preis **komplexer und schneller**:

1. **🚗 Starter Auto** (Gratis)
   - Geschwindigkeit: ⭐⭐
   - Handling: ⭐⭐
   - Einfaches Design
   
2. **🚙 Kompaktwagen** (100 Münzen)
   - Geschwindigkeit: ⭐⭐⭐
   - Handling: ⭐⭐⭐
   - Mit Lichtern & Windschutzscheibe

3. **🚕 Limousine** (250 Münzen)
   - Geschwindigkeit: ⭐⭐⭐
   - Handling: ⭐⭐⭐
   - Elegantes Design mit Spoiler

4. **🚗 Sportwagen** (500 Münzen)
   - Geschwindigkeit: ⭐⭐⭐⭐
   - Handling: ⭐⭐⭐⭐
   - Tief, aerodynamisch

5. **🏎️ Rennwagen** (800 Münzen)
   - Geschwindigkeit: ⭐⭐⭐⭐
   - Handling: ⭐⭐⭐⭐
   - Racing-Streifen & Flügel

6. **🚙 SUV Premium** (1200 Münzen)
   - Geschwindigkeit: ⭐⭐⭐
   - Handling: ⭐⭐⭐⭐
   - Groß mit Dachgepäckträger

7. **🏎️ Super Sport** (1800 Münzen)
   - Geschwindigkeit: ⭐⭐⭐⭐⭐
   - Handling: ⭐⭐⭐⭐⭐
   - Diffuser & Side Vents

8. **🚗 Luxus GT** (2500 Münzen)
   - Geschwindigkeit: ⭐⭐⭐⭐⭐
   - Handling: ⭐⭐⭐⭐⭐
   - Chrom-Akzente

9. **🏎️ Hyper Car** (3500 Münzen)
   - Geschwindigkeit: ⭐⭐⭐⭐⭐⭐
   - Handling: ⭐⭐⭐⭐⭐
   - Jet-Fighter Cockpit

10. **🏎️ Formula Racer** (5000 Münzen)
    - Geschwindigkeit: ⭐⭐⭐⭐⭐⭐⭐
    - Handling: ⭐⭐⭐⭐⭐⭐
    - Formel-1 Design mit offenen Rädern

## 🚀 Installation & Start

```bash
# Dependencies installieren
npm install

# Entwicklungsserver starten
npm run dev

# Build für Produktion
npm run build
```

Dann öffne deinen Browser und navigiere zu **http://localhost:5173**

## 🎨 Features

### Gameplay
- ⚡ **Energie-Management-System** mit 16 Ladestationen
- 🚗 **10 einzigartige 3D-Autos** - zunehmend detaillierter
- 🌍 **Riesige offene Welt** (500x500m) mit 100+ Kreuzungen
- 🎯 **Dynamisches Ziel-System** - Ziel bewegt sich
- 💰 **Münz-System** zum Freischalten neuer Autos
- 📊 **Fahrschul-Punktesystem** - Fehler kosten Punkte
- 🏆 **Level-System** - steigendes Münz-Belohnungen
- 💾 **Auto-Save** - Fortschritt wird gespeichert

### Visuals
- 🌆 **Realistische Stadt** mit hunderten Gebäuden
- 💡 **Dynamische Beleuchtung** (Scheinwerfer, Straßenlaternen)
- 🌫️ **Nebel-Effekt** für Atmosphäre
- ✨ **Schatten** für Realismus
- 🔵 **Blaue Windschutzscheiben** an allen Autos
- 🟢 **Leuchtende Ladestationen**
- 🎨 **Beleuchtete Fenster** in Gebäuden

### Technisch
- ⚡ **Three.js** für 3D-Rendering
- 🔥 **Vite** für schnelles HMR
- 🎮 **Realistische Physik** für Autosteuerung
- 📷 **Smooth Camera** folgt dem Auto
- 💥 **Kollisionserkennung** (Gebäude, Ladestationen, Ziel)
- 🌐 **LocalStorage** für Spielstand-Speicherung

## 💡 Strategie-Tipps

1. 🗺️ **Merke dir Ladestation-Positionen** - Sie sind an Hauptkreuzungen
2. ⚡ **Lade bei ~30% Energie** - Nicht bis 0% warten!
3. 🎯 **Plane deine Route** - Ziel + Ladestation berücksichtigen
4. 🏎️ **Investiere in bessere Autos** - Schneller = Zeit gespart
5. 🛑 **Vermeide Kollisionen** - Sie kosten wertvolle Punkte
6. 💰 **Sammle systematisch Münzen** - Jedes Level bringt mehr
7. 📊 **Behalte deine Punkte im Auge** - Bei 0 ist Game Over!

## 📝 Spielmodi

### Hauptspiel
- Sammle Münzen und kaufe alle 10 Autos
- Erreiche höchstmögliches Level
- Maximale Punktzahl erreichen

### Herausforderung
- Überlebe so lange wie möglich mit begrenzter Energie
- Finde alle Ladestationen
- Erkunde die gesamte Stadt

## 🏗️ Technologie

- **Three.js** (0.160.0) - 3D Rendering Engine
- **Vite** (5.0.0) - Build Tool & Dev Server
- **Vanilla JavaScript** - ES6 Module
- **HTML5 & CSS3** - UI & Styling
- **LocalStorage API** - Spielstand-Speicherung

## 📂 Projektstruktur

```
AutoWelt/
├── index.html          # Haupt-Spiel
├── anleitung.html      # Detaillierte Anleitung
├── start.html          # Start-Bildschirm
├── style.css           # Komplettes Styling
├── main.js             # Haupt-Spiellogik & Energie-System
├── carModels.js        # 10 verschiedene 3D Auto-Modelle
├── world.js            # Welt, Straßen, Gebäude, Ladestationen
├── gameState.js        # Spielstand-Verwaltung
├── package.json        # Dependencies
└── README.md           # Diese Datei
```

## 🎯 Achievements (Inoffiziell)

- 🥉 **Anfänger:** Erreiche Level 5
- 🥈 **Fortgeschritten:** Kaufe 5 Autos
- 🥇 **Profi:** Kaufe alle 10 Autos
- 🏆 **Meister:** Erreiche Level 20
- ⚡ **Energie-Meister:** Schaffe 3 Ziele ohne Laden
- 💰 **Münz-Sammler:** Sammle 10.000 Münzen gesamt
- 🎯 **Perfektionist:** Erreiche 200 Punkte

## 🐛 Bekannte Features (keine Bugs!)

- Autos sind schnell und agil - das ist Absicht!
- Energie-Verbrauch ist herausfordernd - Teil des Gameplays
- Große Welt - erkunden erwünscht!

## 🔮 Mögliche zukünftige Features

- Verschiedene Schwierigkeitsstufen
- Unterschiedlicher Energie-Verbrauch pro Auto
- Solar-Panel Power-Ups
- Tag/Nacht-Zyklus
- Wetter-Effekte
- Multiplayer-Modus
- Bestenlisten

## 📜 Lizenz

Freies Projekt - Viel Spaß beim Spielen und Modifizieren!

---

**Entwickelt mit ❤️ und Three.js**

**Viel Spaß beim Fahren! 🏁🚗💨⚡**


