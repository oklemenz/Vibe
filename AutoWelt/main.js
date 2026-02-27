// Main Game - ohne ES6 Module für file:// Kompatibilität
// THREE wird global vom CDN geladen
// Alle anderen Klassen (GameState, SoundManager, CarModels, World) werden vorher geladen

class Game {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.clock = new THREE.Clock();

        this.gameState = new GameState();
        this.world = new World(this.scene);
        this.carModels = new CarModels();
        this.soundManager = new SoundManager();

        this.keys = {};
        this.currentCar = null;
        this.isPlaying = false;

        // AI-Autos
        this.aiCars = [];
        this.lastCollisionTime = 0; // Verhindert mehrfache Kollisions-Strafen

        // Energie-System
        this.energy = 100;
        this.maxEnergy = 100;
        this.energyDrainRate = 0.8; // Reduziert von 1.5 auf 0.8 pro Sekunde
        this.isCharging = false;
        this.currentChargingStation = null;
        this.energyGameOver = false;
        this.isAccelerating = false; // Track ob Gas gegeben wird (für Energie-Bonus)

        // Sound-Tracking
        this.isEngineRunning = false;
        this.lastSquealTime = 0;

        this.init();
    }

    init() {
        // Renderer Setup
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        // Scene Setup
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.Fog(0x87CEEB, 200, 600);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 50, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.camera.left = -200;
        directionalLight.shadow.camera.right = 200;
        directionalLight.shadow.camera.top = 200;
        directionalLight.shadow.camera.bottom = -200;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(directionalLight);

        // Camera Position - höher und weiter weg für bessere Sicht
        this.camera.position.set(0, 30, 40);
        this.camera.lookAt(0, 0, 0);

        // Build World
        this.world.build();

        // Event Listeners
        window.addEventListener('resize', () => this.onWindowResize());
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('keyup', (e) => this.onKeyUp(e));

        // UI Event Listeners
        document.getElementById('start-btn').addEventListener('click', () => this.startGame());
        document.getElementById('open-shop-btn').addEventListener('click', () => this.openShop());
        document.getElementById('close-shop').addEventListener('click', () => this.closeShop());
        document.getElementById('mute-btn').addEventListener('click', () => this.toggleMute());
        document.getElementById('shop-btn').addEventListener('click', () => this.openShop());

        // Create Shop
        this.createShop();

        // Start with first car
        this.gameState.unlockCar(0);
        this.selectCar(0);

        // Initial render so world is visible immediately
        this.renderer.render(this.scene, this.camera);
    }

    createShop() {
        const carGrid = document.getElementById('car-grid');

        this.carModels.carData.forEach((carData, index) => {
            const card = document.createElement('div');
            card.className = 'car-card';
            card.id = `car-${index}`;

            const isOwned = this.gameState.isCarUnlocked(index);
            if (isOwned) card.classList.add('owned');
            if (index === this.gameState.currentCarIndex) card.classList.add('active');

            card.innerHTML = `
                <h3>${carData.name}</h3>
                <div class="car-stats">
                    <p>⚡ Geschwindigkeit: ${carData.speed}</p>
                    <p>🎯 Handling: ${carData.handling}</p>
                    <p>💰 Wert: ${carData.value}</p>
                </div>
                ${index === 0 ? '<p class="car-price">Starterfahrzeug</p>' : `<p class="car-price">💰 ${carData.price} Münzen</p>`}
                <button class="car-btn" data-index="${index}">
                    ${isOwned ? (index === this.gameState.currentCarIndex ? 'Aktiv' : 'Auswählen') : 'Kaufen'}
                </button>
            `;

            const button = card.querySelector('.car-btn');
            button.addEventListener('click', () => this.handleCarAction(index));

            if (!isOwned && this.gameState.coins < carData.price) {
                button.disabled = true;
            }

            carGrid.appendChild(card);
        });
    }

    updateShop() {
        this.carModels.carData.forEach((carData, index) => {
            const card = document.getElementById(`car-${index}`);
            const button = card.querySelector('.car-btn');
            const isOwned = this.gameState.isCarUnlocked(index);

            card.className = 'car-card';
            if (isOwned) card.classList.add('owned');
            if (index === this.gameState.currentCarIndex) card.classList.add('active');

            if (isOwned) {
                button.textContent = index === this.gameState.currentCarIndex ? 'Aktiv' : 'Auswählen';
                button.disabled = false;
            } else {
                button.textContent = 'Kaufen';
                button.disabled = this.gameState.coins < carData.price;
            }
        });
    }

    handleCarAction(index) {
        if (this.gameState.isCarUnlocked(index)) {
            this.selectCar(index);
            this.closeShop(); // Schließe Werkstatt nach Auswahl
        } else {
            const carData = this.carModels.carData[index];
            if (this.gameState.coins >= carData.price) {
                this.gameState.coins -= carData.price;
                this.gameState.unlockCar(index);
                this.selectCar(index);
                this.updateUI();
                this.closeShop(); // Schließe Werkstatt nach Kauf
            }
        }
        this.updateShop();
    }

    selectCar(index) {
        if (this.currentCar) {
            this.scene.remove(this.currentCar.mesh);
        }

        this.gameState.currentCarIndex = index;
        this.currentCar = this.carModels.createCar(index);
        this.currentCar.mesh.position.copy(this.world.startPosition);
        // Keine Rotation mehr nötig - Kamera ist jetzt korrekt positioniert
        this.scene.add(this.currentCar.mesh);
    }

    openShop() {
        document.getElementById('shop-overlay').classList.remove('hidden');
        this.updateShop();
        // Starte 8-Bit Werkstatt-Musik
        this.soundManager.startWorkshopMusic();
    }

    closeShop() {
        document.getElementById('shop-overlay').classList.add('hidden');
        // Stoppe Werkstatt-Musik
        this.soundManager.stopWorkshopMusic();
    }

    startGame() {
        document.getElementById('start-screen').classList.add('hidden');
        this.isPlaying = true;

        // Audio Context aktivieren und Intro-Jingle spielen
        this.soundManager.resume();
        this.soundManager.playIntroJingle();

        // Erstelle AI-Autos
        this.createAICars();

        this.animate();
    }

    onKeyDown(event) {
        this.keys[event.key] = true;
    }

    onKeyUp(event) {
        this.keys[event.key] = false;
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    updateCarPhysics(deltaTime) {
        if (!this.currentCar) return;

        const car = this.currentCar;
        const carData = this.carModels.carData[this.gameState.currentCarIndex];

        // Prüfe ob Energie leer ist
        if (this.energy <= 0 && !this.isCharging) {
            // Auto bleibt stehen - Game Over
            car.velocity.set(0, 0, 0);
            car.angularVelocity = 0;

            // Game Over nur einmal auslösen
            if (!this.energyGameOver) {
                this.energyGameOver = true;
                this.showWarning('⚠️ Energie leer! Finde eine Ladestation! 🔋');
                setTimeout(() => {
                    this.showWarning('❌ GAME OVER - Keine Energie mehr!');
                    setTimeout(() => {
                        this.energyGameOver = false;
                        this.resetGame();
                    }, 3000);
                }, 2000);
            }
            return;
        }

        // Controls (nur wenn Energie vorhanden)
        this.isAccelerating = false; // Reset: Track ob Gas gegeben wird

        if (this.energy > 0) {
            // Berechne aktuelle Geschwindigkeit für realistische Physik
            const currentSpeed = Math.abs(car.velocity.z);

            if (this.keys['ArrowUp']) {
                // Vorwärts fahren - sehr kontrollierte Geschwindigkeit
                car.velocity.z += carData.speed * deltaTime * 2.0;
                this.isAccelerating = true; // GAS WIRD GEGEBEN!

                // Motor-Sound für Vorwärtsfahrt
                if (!this.isEngineRunning) {
                    this.soundManager.startEngineSound(true);
                    this.isEngineRunning = true;
                }
            } else if (this.keys['ArrowDown']) {
                // Rückwärts - sehr langsam und kontrolliert
                car.velocity.z -= carData.speed * deltaTime * 1.0;
                this.isAccelerating = true; // GAS WIRD GEGEBEN!

                // Motor-Sound für Rückwärtsfahrt
                if (!this.isEngineRunning) {
                    this.soundManager.startEngineSound(false);
                    this.isEngineRunning = true;
                }
            } else {
                // Kein Gas - Motor-Sound stoppen UND automatisch abbremsen!
                this.isAccelerating = false; // KEIN GAS!

                if (this.isEngineRunning) {
                    this.soundManager.stopEngineSound();
                    this.isEngineRunning = false;
                }

                // AUTOMATISCHES ABBREMSEN wenn kein Gas gegeben wird
                car.velocity.multiplyScalar(0.92); // Starkes Abbremsen - Auto kommt schnell zum Stehen
            }

            // REALISTISCHE LENKUNG: Abhängig von Geschwindigkeit
            // Je schneller das Auto, desto stärker die Lenkwirkung
            // Stehendes Auto lenkt NICHT!
            if (this.keys['ArrowLeft']) {
                if (currentSpeed > 0.7) { // Erhöht von 0.5 auf 0.7 - Auto muss noch schneller fahren zum Lenken
                    // Lenkung proportional zur Geschwindigkeit (realistisch!)
                    const speedFactor = Math.min(currentSpeed / 2.0, 1.5); // Begrenzt auf 1.5x
                    const steeringForce = carData.handling * deltaTime * 0.1 * speedFactor; // Von 0.15 auf 0.1 reduziert - noch sanfter!
                    car.angularVelocity += steeringForce;

                    // Quietsch-Sound bei scharfem Lenken
                    const now = Date.now();
                    if (currentSpeed > 3.0 && now - this.lastSquealTime > 500) { // Von 2.5 auf 3.0 erhöht
                        this.soundManager.playTireSqueal();
                        this.lastSquealTime = now;
                    }
                }
            }
            if (this.keys['ArrowRight']) {
                if (currentSpeed > 0.7) { // Erhöht von 0.5 auf 0.7 - Auto muss noch schneller fahren zum Lenken
                    // Lenkung proportional zur Geschwindigkeit (realistisch!)
                    const speedFactor = Math.min(currentSpeed / 2.0, 1.5); // Begrenzt auf 1.5x
                    const steeringForce = carData.handling * deltaTime * 0.1 * speedFactor; // Von 0.15 auf 0.1 reduziert - noch sanfter!
                    car.angularVelocity -= steeringForce;

                    // Quietsch-Sound bei scharfem Lenken
                    const now = Date.now();
                    if (currentSpeed > 3.0 && now - this.lastSquealTime > 500) { // Von 2.5 auf 3.0 erhöht
                        this.soundManager.playTireSqueal();
                        this.lastSquealTime = now;
                    }
                }
            }
            if (this.keys[' ']) {
                // VOLLBREMSUNG! Auto stoppt sofort!
                car.velocity.multiplyScalar(0.5); // Extrem starkes Abbremsen - 50% Geschwindigkeit pro Frame!

                // Bei niedriger Geschwindigkeit: Sofort komplett stoppen
                if (Math.abs(car.velocity.z) < 0.5) { // Erhöht von 0.2 auf 0.5 für schnelleren Stopp
                    car.velocity.z = 0; // VOLLSTÄNDIGER STOPP!
                    car.angularVelocity = 0; // Auch Rotation stoppen
                }

                // Brems-Sound
                if (Math.abs(car.velocity.z) > 0.1) { // Sound auch bei niedrigen Geschwindigkeiten
                    this.soundManager.playBrakeSound();
                }
            }
        } else {
            // Keine Energie - Motor-Sound stoppen
            if (this.isEngineRunning) {
                this.soundManager.stopEngineSound();
                this.isEngineRunning = false;
            }
        }

        // Energie auf 0 begrenzen
        if (this.energy < 0) this.energy = 0;

        // BEWEGUNGSBASIERTER ENERGIEVERBRAUCH
        // Energie wird verbraucht wenn sich das Auto bewegt (nicht nur beim Gas geben!)
        const currentSpeed = Math.abs(car.velocity.z);
        if (currentSpeed > 0.1) { // Auto bewegt sich
            // Energieverbrauch um Faktor 4 reduziert!
            const consumptionMultiplier = this.isAccelerating ? 0.75 : 0.375; // MIT Gas: 0.75, OHNE Gas: 0.375 (4x weniger als vorher!)
            this.energy -= this.energyDrainRate * deltaTime * currentSpeed * consumptionMultiplier;
        }

        this.updateEnergyDisplay();

        // Apply drag - stärker für kontrollierte Beschleunigung
        car.velocity.multiplyScalar(0.98); // Von 0.985 auf 0.98 - mehr Widerstand
        // Sehr starker Drag auf Lenkung für maximale Kontrolle
        car.angularVelocity *= 0.95; // Von 0.88 auf 0.95 - deutlich mehr Dämpfung!

        // Limit max speed - reduziert für kontrollierteres Fahren
        const maxSpeed = carData.speed * 2.0; // Von 3.0 auf 2.0 reduziert!
        if (car.velocity.length() > maxSpeed) {
            car.velocity.setLength(maxSpeed);
        }

        // REALISTISCHE ROTATION: Direkt und ohne Rutschen
        car.mesh.rotation.y += car.angularVelocity;

        // REALISTISCHE BEWEGUNG: Auto bewegt sich in Blickrichtung (kein Rutschen!)
        // Berechne Bewegungsvektor basierend auf Auto-Rotation
        const forward = new THREE.Vector3(0, 0, 1); // Forward-Richtung im lokalen Space
        forward.applyQuaternion(car.mesh.quaternion); // Rotiere in Welt-Richtung

        // Bewege Auto in seine Blickrichtung mit aktueller Geschwindigkeit
        car.mesh.position.x += forward.x * car.velocity.z;
        car.mesh.position.z += forward.z * car.velocity.z;

        // Keep car on ground - Räder auf Boden (y=0)
        car.mesh.position.y = 0;

        // Boundary check
        this.checkBoundaries();
    }

    checkBoundaries() {
        const pos = this.currentCar.mesh.position;
        const worldSize = 180; // Angepasst an neue Weltgröße

        if (Math.abs(pos.x) > worldSize || Math.abs(pos.z) > worldSize) {
            this.showWarning('⚠️ Fahrzeug verlässt die Straße! -10 Punkte');
            this.gameState.score -= 10;
            this.updateUI();

            // Reset position
            this.currentCar.mesh.position.copy(this.world.startPosition);
            this.currentCar.mesh.rotation.y = 0; // Keine Rotation
            this.currentCar.velocity.set(0, 0, 0);
            this.currentCar.angularVelocity = 0;
        }
    }

    checkCollisions() {
        if (!this.currentCar) return;

        const carPos = this.currentCar.mesh.position;

        // Check building collisions - mit besserer Distanz-Berechnung
        for (const building of this.world.buildings) {
            // Berechne Distanz nur auf x/z Ebene (2D), nicht mit y
            const buildingPos2D = new THREE.Vector2(building.position.x, building.position.z);
            const carPos2D = new THREE.Vector2(carPos.x, carPos.z);
            const distance = buildingPos2D.distanceTo(carPos2D);

            // Größere Kollisionsdistanz (Gebäude sind 10-14m groß)
            const collisionDistance = 8;

            if (distance < collisionDistance) {
                this.showWarning('💥 Kollision mit Gebäude! -15 Punkte');
                this.gameState.score -= 15;
                this.updateUI();

                // Kollisions-Sound
                this.soundManager.playCollisionSound();

                // Bounce back - stärker
                const direction = new THREE.Vector3().subVectors(carPos, building.position).normalize();
                this.currentCar.mesh.position.add(direction.multiplyScalar(1.5));
                this.currentCar.velocity.multiplyScalar(-0.3);

                // Motor-Sound stoppen bei Kollision
                if (this.isEngineRunning) {
                    this.soundManager.stopEngineSound();
                    this.isEngineRunning = false;
                }

                return;
            }
        }

        // Check charging stations
        let wasCharging = this.isCharging;
        this.isCharging = false;
        this.currentChargingStation = null;

        for (const station of this.world.chargingStations) {
            const distance = carPos.distanceTo(station.position);
            const chargingDistance = 5;

            if (distance < chargingDistance && this.energy < this.maxEnergy) {
                // Auto steht an Ladestation
                this.isCharging = true;
                this.currentChargingStation = station;

                // Lade-Sound starten (kontinuierlich pulsierend)
                if (!wasCharging) {
                    this.soundManager.startChargingSound();
                }

                // Lade Energie auf - EXTREM SCHNELL! 10x schneller!
                // NEUES FEATURE: 2x schneller wenn kein Gas gegeben wird!
                const chargeMultiplier = this.isAccelerating ? 1000 : 2000; // MIT Gas: 1000, OHNE Gas: 2000 (2x schneller!)
                this.energy += chargeMultiplier * this.clock.getDelta();
                if (this.energy > this.maxEnergy) {
                    this.energy = this.maxEnergy;
                }

                this.updateEnergyDisplay();

                // Zeige Lade-Status
                document.getElementById('charging-status').classList.remove('hidden');
                break;
            }
        }

        if (!this.isCharging) {
            // Lade-Sound stoppen wenn nicht mehr am Laden
            if (wasCharging) {
                this.soundManager.stopChargingSound();
            }
            document.getElementById('charging-status').classList.add('hidden');
        }

        // Check goal
        const goalDistance = carPos.distanceTo(this.world.goalPosition);
        if (goalDistance < 5) {
            this.reachGoal();
        }
    }

    reachGoal() {
        const reward = 50 + (this.gameState.level * 10);
        this.gameState.coins += reward;
        this.gameState.level++;
        this.gameState.score += 20;

        this.showWarning(`🎯 Ziel erreicht! +${reward} Münzen! +20 Punkte`);
        this.updateUI();

        // Erfolgs-Sound abspielen
        this.soundManager.playSuccessSound();

        // Move goal to new position
        this.world.moveGoal();

        // Reset car position
        setTimeout(() => {
            this.currentCar.mesh.position.copy(this.world.startPosition);
            this.currentCar.mesh.rotation.y = 0; // Keine Rotation
            this.currentCar.velocity.set(0, 0, 0);
            this.currentCar.angularVelocity = 0;
        }, 2000);
    }

    showWarning(message) {
        const warning = document.getElementById('warning');
        warning.textContent = message;
        warning.classList.remove('hidden');

        setTimeout(() => {
            warning.classList.add('hidden');
        }, 2000);
    }

    updateUI() {
        document.getElementById('coins').textContent = this.gameState.coins;
        document.getElementById('score').textContent = this.gameState.score;
        document.getElementById('level').textContent = this.gameState.level;

        if (this.gameState.score <= 0) {
            this.showWarning('❌ Game Over! Zu viele Fehler!');
            setTimeout(() => {
                this.resetGame();
            }, 3000);
        }
    }

    updateEnergyDisplay() {
        const percentage = Math.max(0, (this.energy / this.maxEnergy) * 100);
        const energyBar = document.getElementById('energy-bar-inner');
        const energyText = document.getElementById('energy-percentage');

        energyBar.style.width = percentage + '%';
        energyText.textContent = Math.round(percentage) + '%';

        // Farbe ändern basierend auf Energie-Level
        energyBar.classList.remove('low', 'critical');
        if (percentage <= 20) {
            energyBar.classList.add('critical');
        } else if (percentage <= 40) {
            energyBar.classList.add('low');
        }
    }

    resetGame() {
        // Reset Energie
        this.energy = this.maxEnergy;
        this.isCharging = false;
        this.updateEnergyDisplay();

        // Reset Game State
        this.gameState.score = 100;
        this.gameState.level = 1;
        this.updateUI();

        // Reset Auto Position
        if (this.currentCar) {
            this.currentCar.mesh.position.copy(this.world.startPosition);
            this.currentCar.mesh.rotation.y = 0; // Keine Rotation
            this.currentCar.velocity.set(0, 0, 0);
            this.currentCar.angularVelocity = 0;
        }

        // Reset Ziel
        this.world.moveGoal();

        document.getElementById('charging-status').classList.add('hidden');
    }

    createAICars() {
        // Erstelle 5-8 AI-Autos auf verschiedenen Straßen
        const numAICars = 5 + Math.floor(Math.random() * 4); // 5-8 Autos
        const aiCarColors = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0xa8e6cf, 0xff8b94, 0xc7ceea, 0xffd3b6, 0xdcedc1];

        // Straßen-Positionen (entlang der Hauptstraßen)
        // Horizontale Straßen (z=konstant, Auto fährt in +X Richtung, rotation=0)
        // Vertikale Straßen (x=konstant, Auto fährt in +Z Richtung, rotation=90°)
        const roadPositions = [
            // Horizontale Straßen - fahren in X-Richtung (nach rechts/links)
            { x: -100, z: -120, rotation: 0, isHorizontal: true },
            { x: 80, z: -80, rotation: 0, isHorizontal: true },
            { x: -60, z: -40, rotation: 0, isHorizontal: true },
            { x: 100, z: 0, rotation: 0, isHorizontal: true },
            { x: -80, z: 40, rotation: 0, isHorizontal: true },
            { x: 60, z: 80, rotation: 0, isHorizontal: true },
            { x: -40, z: 120, rotation: 0, isHorizontal: true },
            // Vertikale Straßen - fahren in Z-Richtung (nach oben/unten)
            { x: -120, z: -60, rotation: Math.PI / 2, isHorizontal: false },
            { x: -80, z: 80, rotation: Math.PI / 2, isHorizontal: false },
            { x: -40, z: -100, rotation: Math.PI / 2, isHorizontal: false },
            { x: 0, z: 60, rotation: Math.PI / 2, isHorizontal: false },
            { x: 40, z: -40, rotation: Math.PI / 2, isHorizontal: false },
            { x: 80, z: 100, rotation: Math.PI / 2, isHorizontal: false },
            { x: 120, z: -80, rotation: Math.PI / 2, isHorizontal: false },
        ];

        for (let i = 0; i < numAICars; i++) {
            const pos = roadPositions[i % roadPositions.length];
            const color = aiCarColors[i % aiCarColors.length];

            // Erstelle einfaches AI-Auto
            const aiCar = this.createSimpleAICar(color);
            aiCar.mesh.position.set(pos.x, 0, pos.z);
            aiCar.mesh.rotation.y = pos.rotation;

            // AI-Eigenschaften
            aiCar.speed = 0.15 + Math.random() * 0.1; // 0.15-0.25 Geschwindigkeit (EXTREM LANGSAM!)
            aiCar.nextTurn = null;
            aiCar.turnProgress = 0;

            // WICHTIG: Korrekte Bestimmung ob horizontal oder vertikal
            aiCar.isHorizontal = pos.isHorizontal;

            // Speichere aktuelle Straße für präzisen Check
            if (aiCar.isHorizontal) {
                // Horizontale Straße: Z ist fix, X variiert
                aiCar.currentRoadZ = pos.z;
                aiCar.currentRoadX = null;
            } else {
                // Vertikale Straße: X ist fix, Z variiert
                aiCar.currentRoadX = pos.x;
                aiCar.currentRoadZ = null;
            }

            this.scene.add(aiCar.mesh);
            this.aiCars.push(aiCar);
        }

        console.log(`Created ${numAICars} AI cars`);
    }

    createSimpleAICar(color) {
        const car = {
            mesh: new THREE.Group(),
            velocity: new THREE.Vector3(0, 0, 0)
        };

        // Einfacher Auto-Körper
        const bodyGeometry = new THREE.BoxGeometry(2, 1, 3.5);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: color,
            metalness: 0.6,
            roughness: 0.4
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.5;
        body.castShadow = true;
        car.mesh.add(body);

        // Dach
        const roofGeometry = new THREE.BoxGeometry(1.6, 0.8, 2);
        const roof = new THREE.Mesh(roofGeometry, bodyMaterial);
        roof.position.set(0, 1.3, -0.3);
        car.mesh.add(roof);

        // Räder
        const wheelGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16);
        const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });

        const wheelPositions = [
            { x: -0.9, y: 0.4, z: 1.2 },
            { x: 0.9, y: 0.4, z: 1.2 },
            { x: -0.9, y: 0.4, z: -1.2 },
            { x: 0.9, y: 0.4, z: -1.2 }
        ];

        wheelPositions.forEach(pos => {
            const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(pos.x, pos.y, pos.z);
            wheel.castShadow = true;
            car.mesh.add(wheel);
        });

        // Rücklichter (rot)
        const lightGeometry = new THREE.BoxGeometry(0.3, 0.2, 0.1);
        const lightMaterial = new THREE.MeshStandardMaterial({
            color: 0xff0000,
            emissive: 0xff0000,
            emissiveIntensity: 0.5
        });

        [-0.7, 0.7].forEach(x => {
            const light = new THREE.Mesh(lightGeometry, lightMaterial);
            light.position.set(x, 0.6, -1.75);
            car.mesh.add(light);
        });

        return car;
    }

    // SPEZIELLER VERBESSERTER STRASSEN-CHECK
    isOnRoad(position) {
        const roadPositions = [-120, -80, -40, 0, 40, 80, 120];
        const roadWidth = 8; // Engere Straßenbreite für präziseren Check (war 10)

        let onHorizontalRoad = false;
        let onVerticalRoad = false;

        // Prüfe horizontale Straßen (Auto kann sich in X bewegen, Z ist fix)
        roadPositions.forEach(roadZ => {
            if (Math.abs(position.z - roadZ) < roadWidth / 2) {
                onHorizontalRoad = true;
            }
        });

        // Prüfe vertikale Straßen (Auto kann sich in Z bewegen, X ist fix)
        roadPositions.forEach(roadX => {
            if (Math.abs(position.x - roadX) < roadWidth / 2) {
                onVerticalRoad = true;
            }
        });

        return onHorizontalRoad || onVerticalRoad;
    }

    // KORRIGIERE POSITION AUF NÄCHSTE STRASSE
    snapToNearestRoad(aiCar) {
        const roadPositions = [-120, -80, -40, 0, 40, 80, 120];

        if (aiCar.isHorizontal) {
            // Horizontale Fahrt - korrigiere Z auf nächste horizontale Straße
            let nearestRoadZ = roadPositions[0];
            let minDistance = Math.abs(aiCar.mesh.position.z - nearestRoadZ);

            roadPositions.forEach(roadZ => {
                const distance = Math.abs(aiCar.mesh.position.z - roadZ);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearestRoadZ = roadZ;
                }
            });

            // Sanft zur Straße zurückbewegen
            aiCar.mesh.position.z = nearestRoadZ;
            aiCar.currentRoadZ = nearestRoadZ;
        } else {
            // Vertikale Fahrt - korrigiere X auf nächste vertikale Straße
            let nearestRoadX = roadPositions[0];
            let minDistance = Math.abs(aiCar.mesh.position.x - nearestRoadX);

            roadPositions.forEach(roadX => {
                const distance = Math.abs(aiCar.mesh.position.x - roadX);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearestRoadX = roadX;
                }
            });

            // Sanft zur Straße zurückbewegen
            aiCar.mesh.position.x = nearestRoadX;
            aiCar.currentRoadX = nearestRoadX;
        }
    }

    updateAICars(deltaTime) {
        const roadPositions = [-120, -80, -40, 0, 40, 80, 120];

        this.aiCars.forEach(aiCar => {
            // Speichere alte Position für Kollisionsprüfung
            const oldX = aiCar.mesh.position.x;
            const oldZ = aiCar.mesh.position.z;

            // Bewege AI-Auto vorwärts in seine Richtung (LANGSAMER)
            const forward = new THREE.Vector3(0, 0, 1);
            forward.applyQuaternion(aiCar.mesh.quaternion);

            aiCar.mesh.position.x += forward.x * aiCar.speed * deltaTime * 60;
            aiCar.mesh.position.z += forward.z * aiCar.speed * deltaTime * 60;

            // SPEZIELLER STRASSEN-CHECK - Prüfe ob Auto noch auf Straße ist
            const onRoad = this.isOnRoad(aiCar.mesh.position);

            if (!onRoad) {
                // AUTO IST VON STRASSE ABGEKOMMEN!
                // Setze zurück zur alten Position
                aiCar.mesh.position.x = oldX;
                aiCar.mesh.position.z = oldZ;

                // Korrigiere Position auf nächste Straße
                this.snapToNearestRoad(aiCar);

                // Drehe um 180 Grad
                aiCar.mesh.rotation.y += Math.PI;
                aiCar.isHorizontal = !aiCar.isHorizontal;
            } else {
                // ZUSÄTZLICHE PRÄZISIONS-KORREKTUR
                // Halte Auto exakt auf der Straßenmitte
                if (aiCar.isHorizontal) {
                    // Korrigiere Z-Position wenn zu weit von Straßenmitte
                    if (aiCar.currentRoadZ !== null) {
                        const deviation = Math.abs(aiCar.mesh.position.z - aiCar.currentRoadZ);
                        if (deviation > 1) {
                            // Sanft zur Mitte korrigieren
                            aiCar.mesh.position.z += (aiCar.currentRoadZ - aiCar.mesh.position.z) * 0.1;
                        }
                    }
                } else {
                    // Korrigiere X-Position wenn zu weit von Straßenmitte
                    if (aiCar.currentRoadX !== null) {
                        const deviation = Math.abs(aiCar.mesh.position.x - aiCar.currentRoadX);
                        if (deviation > 1) {
                            // Sanft zur Mitte korrigieren
                            aiCar.mesh.position.x += (aiCar.currentRoadX - aiCar.mesh.position.x) * 0.1;
                        }
                    }
                }
            }

            // Prüfe Kollision mit Gebäuden
            let collidesWithBuilding = false;
            this.world.buildings.forEach(building => {
                const distance = aiCar.mesh.position.distanceTo(building.position);
                if (distance < 8) {
                    collidesWithBuilding = true;
                }
            });

            // Wenn Kollision mit Gebäude, bewege zurück und drehe um
            if (collidesWithBuilding) {
                aiCar.mesh.position.x = oldX;
                aiCar.mesh.position.z = oldZ;
                this.snapToNearestRoad(aiCar);
                aiCar.mesh.rotation.y += Math.PI;
                aiCar.isHorizontal = !aiCar.isHorizontal;
            }

            // Prüfe ob AI-Auto an Kreuzung ist und abbiegen sollte
            // NUR AN KREUZUNGEN ABBIEGEN (wo sich horizontale und vertikale Straßen kreuzen)
            if (!aiCar.nextTurn) {
                const roadPositionsArray = [-120, -80, -40, 0, 40, 80, 120];

                // Prüfe ob wir an einer KREUZUNG sind
                if (aiCar.isHorizontal) {
                    // Horizontale Fahrt: Kreuzung ist wo eine vertikale Straße ist (roadX)
                    roadPositionsArray.forEach(roadX => {
                        // Prüfe ob nahe an vertikaler Straße UND diese Straße kreuzt unsere horizontale Straße
                        if (Math.abs(aiCar.mesh.position.x - roadX) < 3) {
                            // Prüfe ob unsere Z-Position auf einer Straße ist (also echte Kreuzung)
                            const isAtIntersection = roadPositionsArray.some(roadZ =>
                                Math.abs(aiCar.currentRoadZ - roadZ) < 1
                            );

                            if (isAtIntersection && Math.random() < 0.15) { // 15% Chance an Kreuzungen
                                aiCar.nextTurn = Math.random() < 0.5 ? 'left' : 'right';
                                aiCar.turnProgress = 0;
                            }
                        }
                    });
                } else {
                    // Vertikale Fahrt: Kreuzung ist wo eine horizontale Straße ist (roadZ)
                    roadPositionsArray.forEach(roadZ => {
                        // Prüfe ob nahe an horizontaler Straße UND diese Straße kreuzt unsere vertikale Straße
                        if (Math.abs(aiCar.mesh.position.z - roadZ) < 3) {
                            // Prüfe ob unsere X-Position auf einer Straße ist (also echte Kreuzung)
                            const isAtIntersection = roadPositionsArray.some(roadX =>
                                Math.abs(aiCar.currentRoadX - roadX) < 1
                            );

                            if (isAtIntersection && Math.random() < 0.15) { // 15% Chance an Kreuzungen
                                aiCar.nextTurn = Math.random() < 0.5 ? 'left' : 'right';
                                aiCar.turnProgress = 0;
                            }
                        }
                    });
                }
            }

            // Führe Abbiegung aus
            if (aiCar.nextTurn) {
                aiCar.turnProgress += deltaTime * 1.0; // Langsame Abbiegung

                if (aiCar.turnProgress < 1) {
                    const turnAmount = (aiCar.nextTurn === 'left' ? 1 : -1) * Math.PI / 2 * deltaTime * 1.0;
                    aiCar.mesh.rotation.y += turnAmount;
                } else {
                    // Abbiegung abgeschlossen - korrigiere Rotation auf genau 90°
                    const currentRotation = aiCar.mesh.rotation.y % (Math.PI * 2);
                    const targetRotation = Math.round(currentRotation / (Math.PI / 2)) * (Math.PI / 2);
                    aiCar.mesh.rotation.y = targetRotation;

                    aiCar.nextTurn = null;
                    aiCar.isHorizontal = !aiCar.isHorizontal;

                    // Aktualisiere aktuelle Straße nach Abbiegung
                    this.snapToNearestRoad(aiCar);
                }
            }

            // Halte AI-Auto im Spielfeld (engere Grenzen)
            const boundary = 125; // Von 130 auf 125 reduziert
            if (Math.abs(aiCar.mesh.position.x) > boundary || Math.abs(aiCar.mesh.position.z) > boundary) {
                // Drehe um 180 Grad und korrigiere auf Straße
                aiCar.mesh.rotation.y += Math.PI;
                this.snapToNearestRoad(aiCar);
            }
        });
    }

    checkAICarCollisions() {
        if (!this.currentCar) return;

        const playerPos = this.currentCar.mesh.position;
        const collisionDistance = 4; // Kollisionsradius

        this.aiCars.forEach(aiCar => {
            const distance = playerPos.distanceTo(aiCar.mesh.position);

            if (distance < collisionDistance) {
                // Kollision mit AI-Auto!
                const now = Date.now();
                // Nur alle 2 Sekunden Strafe geben (verhindert mehrfache Strafen)
                if (now - this.lastCollisionTime > 2000) {
                    this.lastCollisionTime = now;
                    this.gameState.score -= 5;
                    this.updateUI();
                    this.showWarning('💥 Kollision mit anderem Auto! -5 Punkte');

                    // Spiele Crash-Sound (nutze Brems-Sound als Platzhalter)
                    this.soundManager.playBrakeSound();
                }
            }
        });
    }

    toggleMute() {
        const isMuted = this.soundManager.toggleMute();
        const muteBtn = document.getElementById('mute-btn');

        if (isMuted) {
            muteBtn.textContent = '🔇';
            muteBtn.classList.add('muted');
        } else {
            muteBtn.textContent = '🔊';
            muteBtn.classList.remove('muted');
        }
    }

    updateCamera() {
        if (!this.currentCar) return;

        const car = this.currentCar.mesh;

        // Kamera HINTER dem Auto - feste Position relativ zum Auto
        const cameraOffset = new THREE.Vector3(0, 12, -18); // Näher und tiefer für bessere Sicht
        cameraOffset.applyQuaternion(car.quaternion);

        const targetCameraPosition = new THREE.Vector3().addVectors(car.position, cameraOffset);

        // Sanfte Kamera-Bewegung mit reduziertem lerp für Stabilität
        this.camera.position.lerp(targetCameraPosition, 0.08);

        // Schaue direkt auf das Auto (einfach und stabil)
        const lookAtTarget = new THREE.Vector3(
            car.position.x,
            car.position.y + 2,
            car.position.z
        );

        this.camera.lookAt(lookAtTarget);
    }

    animate() {
        if (!this.isPlaying) return;

        requestAnimationFrame(() => this.animate());

        const deltaTime = this.clock.getDelta();

        this.updateCarPhysics(deltaTime);
        this.checkCollisions();
        this.updateAICars(deltaTime); // Update AI-Autos
        this.checkAICarCollisions(); // Prüfe Kollisionen mit AI-Autos
        this.updateCamera();
        this.world.animateGoal();

        this.renderer.render(this.scene, this.camera);
    }
}

// Start the game
new Game();

