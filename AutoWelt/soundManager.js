// Sound Manager für das Spiel
// Alle Sounds werden prozedural mit der Web Audio API generiert
// Ohne ES6 Module für file:// Kompatibilität

class SoundManager {
    constructor() {
        this.audioContext = null;
        this.sounds = {};
        this.musicNodes = {};
        this.engineSound = null;
        this.chargingSound = null;
        this.isMuted = false;

        // Audio Context initialisieren (muss durch User-Interaktion ausgelöst werden)
        this.initAudioContext();
    }

    initAudioContext() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('Web Audio API nicht unterstützt:', e);
        }
    }

    // Audio Context starten (nach User-Interaktion)
    resume() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    // 8-Bit Intro Jingle
    playIntroJingle() {
        if (!this.audioContext || this.isMuted) return;

        const now = this.audioContext.currentTime;

        // Melodie: C-E-G-C (Do-Mi-Sol-Do)
        const melody = [
            { freq: 523.25, start: 0, duration: 0.15 },    // C5
            { freq: 659.25, start: 0.15, duration: 0.15 }, // E5
            { freq: 783.99, start: 0.3, duration: 0.15 },  // G5
            { freq: 1046.5, start: 0.45, duration: 0.3 }   // C6
        ];

        melody.forEach(note => {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();

            oscillator.type = 'square'; // 8-Bit Sound
            oscillator.frequency.setValueAtTime(note.freq, now + note.start);

            gainNode.gain.setValueAtTime(0.3, now + note.start);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + note.start + note.duration);

            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            oscillator.start(now + note.start);
            oscillator.stop(now + note.start + note.duration);
        });
    }

    // Motor-Sound (kontinuierlich beim Fahren)
    startEngineSound(forward = true) {
        if (!this.audioContext || this.isMuted) return;

        // Stoppe vorherigen Engine-Sound
        this.stopEngineSound();

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        const filter = this.audioContext.createBiquadFilter();

        // Motor-Frequenz unterschiedlich für vorwärts/rückwärts
        const baseFreq = forward ? 80 : 60;
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(baseFreq, this.audioContext.currentTime);

        // Leichte Frequenz-Modulation für realistischeren Sound
        const lfo = this.audioContext.createOscillator();
        const lfoGain = this.audioContext.createGain();
        lfo.frequency.setValueAtTime(5, this.audioContext.currentTime);
        lfoGain.gain.setValueAtTime(forward ? 10 : 5, this.audioContext.currentTime);

        lfo.connect(lfoGain);
        lfoGain.connect(oscillator.frequency);

        // Filter für dumpferen Sound
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(forward ? 400 : 300, this.audioContext.currentTime);

        gainNode.gain.setValueAtTime(0.15, this.audioContext.currentTime);

        oscillator.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.start();
        lfo.start();

        this.engineSound = { oscillator, gainNode, lfo, lfoGain };
    }

    stopEngineSound() {
        if (this.engineSound) {
            try {
                this.engineSound.gainNode.gain.exponentialRampToValueAtTime(
                    0.01,
                    this.audioContext.currentTime + 0.1
                );
                this.engineSound.oscillator.stop(this.audioContext.currentTime + 0.15);
                this.engineSound.lfo.stop(this.audioContext.currentTime + 0.15);
            } catch (e) {
                // Bereits gestoppt
            }
            this.engineSound = null;
        }
    }

    // Brems-Geräusch
    playBrakeSound() {
        if (!this.audioContext || this.isMuted) return;

        const now = this.audioContext.currentTime;
        const duration = 0.3;

        // Weißes Rauschen für Reifen-Quietschen
        const bufferSize = this.audioContext.sampleRate * duration;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.audioContext.createBufferSource();
        noise.buffer = buffer;

        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(800, now);
        filter.Q.setValueAtTime(1, now);

        const gainNode = this.audioContext.createGain();
        gainNode.gain.setValueAtTime(0.2, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);

        noise.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        noise.start(now);
        noise.stop(now + duration);
    }

    // Quietsch-Geräusch beim scharfen Lenken
    playTireSqueal() {
        if (!this.audioContext || this.isMuted) return;

        const now = this.audioContext.currentTime;
        const duration = 0.2;

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(300, now);
        oscillator.frequency.exponentialRampToValueAtTime(200, now + duration);

        gainNode.gain.setValueAtTime(0.15, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.start(now);
        oscillator.stop(now + duration);
    }

    // Lade-Sound (elektrisches Summen) - einmalig (alt, nicht mehr verwendet)
    playChargingSound() {
        if (!this.audioContext || this.isMuted) return;

        const now = this.audioContext.currentTime;
        const duration = 0.5;

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(100, now);
        oscillator.frequency.exponentialRampToValueAtTime(150, now + duration);

        gainNode.gain.setValueAtTime(0.1, now);
        gainNode.gain.setValueAtTime(0.15, now + duration * 0.5);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.start(now);
        oscillator.stop(now + duration);
    }

    // Kontinuierlicher, pulsierender Lade-Sound (NEU)
    startChargingSound() {
        if (!this.audioContext || this.isMuted) return;

        // Stoppe vorherigen Lade-Sound
        this.stopChargingSound();

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        // Elektrisches Summen
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(120, this.audioContext.currentTime);

        // LFO für Pulsieren
        const lfo = this.audioContext.createOscillator();
        const lfoGain = this.audioContext.createGain();
        lfo.frequency.setValueAtTime(2, this.audioContext.currentTime); // 2 Hz = 2 Pulse pro Sekunde
        lfoGain.gain.setValueAtTime(0.08, this.audioContext.currentTime); // Amplitude des Pulsierens

        lfo.connect(lfoGain);
        lfoGain.connect(gainNode.gain);

        gainNode.gain.setValueAtTime(0.12, this.audioContext.currentTime);

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.start();
        lfo.start();

        this.chargingSound = { oscillator, gainNode, lfo, lfoGain };
    }

    stopChargingSound() {
        if (this.chargingSound) {
            try {
                this.chargingSound.gainNode.gain.exponentialRampToValueAtTime(
                    0.01,
                    this.audioContext.currentTime + 0.2
                );
                this.chargingSound.oscillator.stop(this.audioContext.currentTime + 0.25);
                this.chargingSound.lfo.stop(this.audioContext.currentTime + 0.25);
            } catch (e) {
                // Bereits gestoppt
            }
            this.chargingSound = null;
        }
    }

    // Erfolgs-Melodie beim Ziel erreichen
    playSuccessSound() {
        if (!this.audioContext || this.isMuted) return;

        const now = this.audioContext.currentTime;

        // Triumphale Melodie: C-E-G-C-G-E-C höher
        const melody = [
            { freq: 523.25, start: 0, duration: 0.1 },      // C5
            { freq: 659.25, start: 0.1, duration: 0.1 },    // E5
            { freq: 783.99, start: 0.2, duration: 0.1 },    // G5
            { freq: 1046.5, start: 0.3, duration: 0.15 },   // C6
            { freq: 783.99, start: 0.45, duration: 0.1 },   // G5
            { freq: 659.25, start: 0.55, duration: 0.1 },   // E5
            { freq: 1046.5, start: 0.65, duration: 0.3 }    // C6 (lang)
        ];

        melody.forEach(note => {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();

            oscillator.type = 'triangle'; // Weicherer Sound für Erfolg
            oscillator.frequency.setValueAtTime(note.freq, now + note.start);

            gainNode.gain.setValueAtTime(0.25, now + note.start);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + note.start + note.duration);

            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            oscillator.start(now + note.start);
            oscillator.stop(now + note.start + note.duration);
        });
    }

    // Kollisions-Sound
    playCollisionSound() {
        if (!this.audioContext || this.isMuted) return;

        const now = this.audioContext.currentTime;
        const duration = 0.3;

        // Tiefer Bass für Kollision
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(80, now);
        oscillator.frequency.exponentialRampToValueAtTime(40, now + duration);

        gainNode.gain.setValueAtTime(0.3, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.start(now);
        oscillator.stop(now + duration);
    }

    // Werkstatt-Musik (8-Bit, 100 Töne, sich wiederholend)
    startWorkshopMusic() {
        if (!this.audioContext || this.isMuted) return;

        // Stoppe vorherige Werkstatt-Musik
        this.stopWorkshopMusic();

        // 100 Töne lange Melodie für die Werkstatt
        // Verwende eine typische 8-Bit Spielmelodie-Struktur
        const melody = this.createWorkshopMelody();

        this.workshopMusicInterval = setInterval(() => {
            if (this.isMuted) return;
            this.playWorkshopMelodyOnce(melody);
        }, melody.totalDuration * 1000); // Wiederhole nach Ende der Melodie

        // Spiele sofort einmal ab
        this.playWorkshopMelodyOnce(melody);
    }

    createWorkshopMelody() {
        // Erstelle eine 100 Töne lange SCHÖNE 8-Bit Melodie
        // Mit variablen Notenlängen für melodischeren Sound
        const notes = [];
        let currentTime = 0;

        // Skala für 8-Bit Musik (C-Dur für harmonischen Sound)
        const scale = [
            261.63, // C4
            293.66, // D4
            329.63, // E4
            349.23, // F4
            392.00, // G4
            440.00, // A4
            493.88, // B4
            523.25, // C5
            587.33, // D5
            659.25, // E5
            698.46, // F5
            783.99, // G5
            880.00  // A5
        ];

        // Notenlängen (S=kurz, M=mittel, L=lang, XL=sehr lang)
        const S = 0.2;   // Kurz (200ms) - früher 120ms
        const M = 0.3;   // Mittel (300ms)
        const L = 0.5;   // Lang (500ms)
        const XL = 0.8;  // Sehr lang (800ms)

        // SCHÖNE MELODIE mit variablen Längen (100 Töne)
        // Format: [noteIndex, duration]

        // Hauptmelodie - Sanft und melodisch (24 Töne)
        const mainPattern = [
            [7, L],  [9, M],  [10, M], [9, M],  // C5-E5-F5-E5 (aufsteigend)
            [7, L],  [5, M],  [7, M],  [9, XL], // C5-A4-C5-E5 (lang am Ende)
            [9, M],  [10, M], [12, M], [10, M], // E5-F5-A5-F5
            [9, L],  [7, M],  [5, XL], [0, M],  // E5-C5-A4-pause
            [7, M],  [9, M],  [7, M],  [5, M],  // C5-E5-C5-A4
            [4, L],  [5, M],  [7, XL], [0, S]   // G4-A4-C5-pause
        ];

        // Brücke - Variation mit Kontrast (26 Töne)
        const bridgePattern = [
            [4, M],  [5, M],  [7, M],  [9, L],  // G4-A4-C5-E5
            [10, M], [9, M],  [7, M],  [5, L],  // F5-E5-C5-A4
            [7, M],  [9, M],  [10, M], [12, XL],// C5-E5-F5-A5 (Höhepunkt)
            [10, M], [9, M],  [7, L],  [9, M],  // F5-E5-C5-E5
            [5, M],  [4, M],  [2, L],  [0, M],  // A4-G4-E4-pause
            [4, M],  [5, M],  [7, L],  [5, M],  // G4-A4-C5-A4
            [4, XL], [0, M]                      // G4 (lang)-pause
        ];

        // Mittelteil - Ruhig und melodisch (25 Töne)
        const middlePattern = [
            [2, M],  [4, M],  [5, M],  [7, L],  // E4-G4-A4-C5
            [9, M],  [7, M],  [5, M],  [4, L],  // E5-C5-A4-G4
            [5, M],  [7, M],  [9, M],  [10, XL],// A4-C5-E5-F5 (lang)
            [9, M],  [7, M],  [9, M],  [10, M], // E5-C5-E5-F5
            [12, L], [10, M], [9, M],  [7, L],  // A5-F5-E5-C5
            [5, M],  [7, M],  [5, M],  [4, L],  // A4-C5-A4-G4
            [2, XL]                              // E4 (sehr lang)
        ];

        // Finale - Abschluss zum Loop (25 Töne)
        const finalePattern = [
            [7, M],  [9, M],  [10, M], [12, L], // C5-E5-F5-A5
            [12, M], [10, M], [9, M],  [7, L],  // A5-F5-E5-C5
            [9, M],  [10, M], [9, M],  [7, M],  // E5-F5-E5-C5
            [5, L],  [4, M],  [5, M],  [7, XL], // A4-G4-A4-C5 (lang)
            [7, M],  [5, M],  [4, M],  [2, L],  // C5-A4-G4-E4
            [0, M],  [7, M],  [7, L],  [7, M],  // pause-C5-C5-C5
            [0, XL]                              // Lange Pause für Loop
        ];

        // Kombiniere alle Patterns zu 100 Tönen
        const fullPattern = [...mainPattern, ...bridgePattern, ...middlePattern, ...finalePattern];

        fullPattern.forEach(([noteIndex, duration]) => {
            notes.push({
                freq: scale[noteIndex],
                start: currentTime,
                duration: duration
            });
            currentTime += duration;
        });

        return {
            notes: notes,
            totalDuration: currentTime
        };
    }

    playWorkshopMelodyOnce(melody) {
        if (!this.audioContext || this.isMuted) return;

        const now = this.audioContext.currentTime;

        melody.notes.forEach(note => {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            const filter = this.audioContext.createBiquadFilter();

            // Weicherer Sound - Triangle Wave statt Square für melodischeren Klang
            oscillator.type = 'triangle'; // Weicher als square
            oscillator.frequency.setValueAtTime(note.freq, now + note.start);

            // Lowpass Filter für sanfteren Sound
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(2000, now + note.start); // Weichere Obertöne
            filter.Q.setValueAtTime(1, now + note.start);

            // Sanfteres ADSR Envelope für melodischeren Sound
            const attackTime = Math.min(0.02, note.duration * 0.1);  // Sanfterer Attack
            const decayTime = Math.min(0.05, note.duration * 0.15);  // Weicher Decay
            const releaseTime = Math.min(0.1, note.duration * 0.2);  // Längerer Release

            gainNode.gain.setValueAtTime(0, now + note.start);
            gainNode.gain.linearRampToValueAtTime(0.12, now + note.start + attackTime); // Attack (sanfter)
            gainNode.gain.linearRampToValueAtTime(0.09, now + note.start + attackTime + decayTime); // Decay
            gainNode.gain.setValueAtTime(0.09, now + note.start + note.duration - releaseTime); // Sustain
            gainNode.gain.linearRampToValueAtTime(0, now + note.start + note.duration); // Release (sanft)

            oscillator.connect(filter);
            filter.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            oscillator.start(now + note.start);
            oscillator.stop(now + note.start + note.duration);
        });
    }

    stopWorkshopMusic() {
        if (this.workshopMusicInterval) {
            clearInterval(this.workshopMusicInterval);
            this.workshopMusicInterval = null;
        }
    }

    // Mute/Unmute
    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.isMuted) {
            this.stopEngineSound();
            this.stopChargingSound();
            this.stopWorkshopMusic();
        }
        return this.isMuted;
    }
}

