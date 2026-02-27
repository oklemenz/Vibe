// GameState - ohne ES6 Module für file:// Kompatibilität
class GameState {
    constructor() {
        this.coins = 0;
        this.score = 100;
        this.level = 1;
        this.unlockedCars = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // ALLE AUTOS ZUM TESTEN FREIGESCHALTET!
        this.currentCarIndex = 0;

        this.loadState();
    }

    unlockCar(index) {
        if (!this.unlockedCars.includes(index)) {
            this.unlockedCars.push(index);
            this.saveState();
        }
    }

    isCarUnlocked(index) {
        return this.unlockedCars.includes(index);
    }

    saveState() {
        const state = {
            coins: this.coins,
            score: this.score,
            level: this.level,
            unlockedCars: this.unlockedCars,
            currentCarIndex: this.currentCarIndex
        };

        try {
            localStorage.setItem('autoWeltSave', JSON.stringify(state));
        } catch (e) {
            console.warn('Could not save game state:', e);
        }
    }

    loadState() {
        try {
            const saved = localStorage.getItem('autoWeltSave');
            if (saved) {
                const state = JSON.parse(saved);
                this.coins = state.coins || 0;
                this.score = state.score || 100;
                this.level = state.level || 1;
                this.unlockedCars = [0]; // ALLE AUTOS ZUM TESTEN!
                this.currentCarIndex = state.currentCarIndex || 0;
            }
        } catch (e) {
            console.warn('Could not load game state:', e);
        }
    }

    reset() {
        this.coins = 0;
        this.score = 100;
        this.level = 1;
        this.unlockedCars = [0]; // ALLE AUTOS ZUM TESTEN!
        this.currentCarIndex = 0;
        this.saveState();
    }
}

