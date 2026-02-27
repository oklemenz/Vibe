// World - ohne ES6 Module für file:// Kompatibilität
// THREE wird global vom CDN geladen

class World {
    constructor(scene) {
        this.scene = scene;
        this.buildings = [];
        this.roads = [];
        this.chargingStations = [];
        this.goalPosition = new THREE.Vector3(0, 0, 0);
        this.goalMesh = null;
        this.startPosition = new THREE.Vector3(0, 0, 0); // Räder auf dem Boden
    }

    build() {
        console.log('Building world...');
        this.createGround();
        console.log('Ground created');
        this.createRoads();
        console.log('Roads created');
        this.createBuildings();
        console.log('Buildings created');
        this.createChargingStations();
        console.log('Charging stations created');
        this.createGoal();
        console.log('Goal created');
        this.createEnvironment();
        console.log('World build complete!');
    }

    createGround() {
        const groundGeometry = new THREE.PlaneGeometry(400, 400);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x2d5016,
            roughness: 0.8
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);
    }

    createRoads() {
        const roadMaterial = new THREE.MeshStandardMaterial({
            color: 0x2c3e50,
            roughness: 0.9
        });

        const lineMaterial = new THREE.MeshStandardMaterial({
            color: 0xf1c40f
        });

        // Reduziertes aber immer noch großes Straßennetzwerk
        const roadWidth = 10;
        const roadLength = 300;

        // Horizontale Straßen (alle 40 Einheiten, aber kleinerer Bereich)
        for (let z = -120; z <= 120; z += 40) {
            const roadGeometry = new THREE.PlaneGeometry(roadLength, roadWidth);
            const road = new THREE.Mesh(roadGeometry, roadMaterial);
            road.rotation.x = -Math.PI / 2;
            road.position.set(0, 0.05, z);
            road.receiveShadow = true;
            this.scene.add(road);
            this.roads.push(road);

            // Straßenmarkierungen - LÄNGS auf horizontalen Straßen
            const numLines = Math.floor(roadLength / 15);
            for (let i = -numLines / 2; i < numLines / 2; i++) {
                const lineGeometry = new THREE.PlaneGeometry(4, 0.4); // Längs: 4m lang, 0.4m breit
                const line = new THREE.Mesh(lineGeometry, lineMaterial);
                line.rotation.x = -Math.PI / 2;
                line.position.set(i * 15, 0.06, z);
                this.scene.add(line);
            }
        }

        // Vertikale Straßen (alle 40 Einheiten)
        for (let x = -120; x <= 120; x += 40) {
            const roadGeometry = new THREE.PlaneGeometry(roadWidth, roadLength);
            const road = new THREE.Mesh(roadGeometry, roadMaterial);
            road.rotation.x = -Math.PI / 2;
            road.position.set(x, 0.05, 0);
            road.receiveShadow = true;
            this.scene.add(road);
            this.roads.push(road);

            // Straßenmarkierungen - LÄNGS auf vertikalen Straßen
            const numLines = Math.floor(roadLength / 15);
            for (let i = -numLines / 2; i < numLines / 2; i++) {
                const lineGeometry = new THREE.PlaneGeometry(0.4, 4); // Längs: 4m lang, 0.4m breit
                const line = new THREE.Mesh(lineGeometry, lineMaterial);
                line.rotation.x = -Math.PI / 2;
                line.position.set(x, 0.06, i * 15);
                this.scene.add(line);
            }
        }

        // Kreuzungs-Marker (gelbe Linien an Kreuzungen)
        for (let x = -120; x <= 120; x += 40) {
            for (let z = -120; z <= 120; z += 40) {
                // Kleine gelbe Markierungen an Kreuzungen
                const intersectionGeometry = new THREE.PlaneGeometry(1, 1);
                const intersection = new THREE.Mesh(intersectionGeometry, lineMaterial);
                intersection.rotation.x = -Math.PI / 2;
                intersection.position.set(x, 0.07, z);
                this.scene.add(intersection);
            }
        }
    }

    createBuildings() {
        const buildingPositions = [];

        // Gebäude ZWISCHEN den Straßen platzieren
        // Straßen sind bei: -120, -80, -40, 0, 40, 80, 120
        // Also Gebäude bei: -100, -60, -20, 20, 60, 100

        const buildingBlocks = [
            // Obere Reihe
            { x: -100, z: -100 }, { x: -60, z: -100 }, { x: -20, z: -100 },
            { x: 20, z: -100 }, { x: 60, z: -100 }, { x: 100, z: -100 },

            // Mittlere Reihen
            { x: -100, z: -60 }, { x: -60, z: -60 }, { x: -20, z: -60 },
            { x: 20, z: -60 }, { x: 60, z: -60 }, { x: 100, z: -60 },

            { x: -100, z: -20 }, { x: -60, z: -20 }, { x: -20, z: -20 },
            { x: 20, z: -20 }, { x: 60, z: -20 }, { x: 100, z: -20 },

            { x: -100, z: 20 }, { x: -60, z: 20 }, { x: -20, z: 20 },
            { x: 20, z: 20 }, { x: 60, z: 20 }, { x: 100, z: 20 },

            { x: -100, z: 60 }, { x: -60, z: 60 }, { x: -20, z: 60 },
            { x: 20, z: 60 }, { x: 60, z: 60 }, { x: 100, z: 60 },

            // Untere Reihe
            { x: -100, z: 100 }, { x: -60, z: 100 }, { x: -20, z: 100 },
            { x: 20, z: 100 }, { x: 60, z: 100 }, { x: 100, z: 100 }
        ];

        buildingBlocks.forEach((block) => {
            // Überspringen des Zentrums (Startposition)
            if (Math.abs(block.x) < 30 && Math.abs(block.z) < 30) return;

            const height = 15 + Math.random() * 15;
            const width = 10 + Math.random() * 4; // Etwas kleiner
            const depth = 10 + Math.random() * 4;
            const colors = [0x95a5a6, 0x7f8c8d, 0xbdc3c7, 0x34495e];

            buildingPositions.push({
                x: block.x,
                z: block.z,
                w: width,
                h: height,
                d: depth,
                color: colors[Math.floor(Math.random() * colors.length)]
            });
        });

        console.log(`Creating ${buildingPositions.length} buildings...`);

        buildingPositions.forEach(pos => {
            const building = this.createBuilding(pos.w, pos.h, pos.d, pos.color);
            building.position.set(pos.x, pos.h / 2, pos.z);
            this.scene.add(building);
            this.buildings.push(building);
        });

        console.log('Buildings created!');
    }

    createBuilding(width, height, depth, color) {
        const building = new THREE.Group();

        // Main structure
        const buildingGeometry = new THREE.BoxGeometry(width, height, depth);
        const buildingMaterial = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.7
        });
        const buildingMesh = new THREE.Mesh(buildingGeometry, buildingMaterial);
        buildingMesh.castShadow = true;
        buildingMesh.receiveShadow = true;
        building.add(buildingMesh);

        // Blaue Fenster hinzufügen - reduziert für Performance
        const windowMaterial = new THREE.MeshStandardMaterial({
            color: 0x3498db, // Blau
            emissive: 0x2980b9,
            emissiveIntensity: 0.3,
            metalness: 0.5
        });

        const floors = Math.min(2, Math.floor(height / 6)); // Max 2 Etagen
        const windowsPerFloor = Math.min(2, Math.floor(width / 5)); // Max 2 Fenster pro Seite

        // Gemeinsame Geometrie für alle Fenster
        const windowGeometry = new THREE.BoxGeometry(1.2, 1.8, 0.1);

        for (let floor = 0; floor < floors; floor++) {
            for (let w = 0; w < windowsPerFloor; w++) {
                // Vorderseite
                const windowFront = new THREE.Mesh(windowGeometry, windowMaterial);
                windowFront.position.set(
                    -width / 2 + (w + 1) * (width / (windowsPerFloor + 1)),
                    -height / 2 + (floor + 0.5) * (height / floors),
                    depth / 2 + 0.05
                );
                building.add(windowFront);

                // Rückseite
                const windowBack = new THREE.Mesh(windowGeometry, windowMaterial);
                windowBack.position.set(
                    -width / 2 + (w + 1) * (width / (windowsPerFloor + 1)),
                    -height / 2 + (floor + 0.5) * (height / floors),
                    -depth / 2 - 0.05
                );
                building.add(windowBack);
            }
        }

        // Roof
        const roofGeometry = new THREE.BoxGeometry(width + 1, 0.5, depth + 1);
        const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x34495e });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.y = height / 2 + 0.25;
        roof.castShadow = true;
        building.add(roof);

        return building;
    }

    createChargingStations() {
        // Ladestationen strategisch an Kreuzungen platzieren
        const stationPositions = [
            // Hauptkreuzungen
            { x: 0, z: 80 },
            { x: 0, z: -80 },
            { x: 80, z: 0 },
            { x: -80, z: 0 },

            // Weitere Positionen im Grid
            { x: 80, z: 80 },
            { x: -80, z: 80 },
            { x: 80, z: -80 },
            { x: -80, z: -80 },

            { x: 160, z: 0 },
            { x: -160, z: 0 },
            { x: 0, z: 160 },
            { x: 0, z: -160 },

            { x: 120, z: 120 },
            { x: -120, z: 120 },
            { x: 120, z: -120 },
            { x: -120, z: -120 },
        ];

        stationPositions.forEach(pos => {
            const station = this.createChargingStation();
            station.position.set(pos.x, 0, pos.z);
            this.scene.add(station);
            this.chargingStations.push(station);
        });
    }

    createChargingStation() {
        const station = new THREE.Group();

        // Basis-Plattform - weniger Segmente
        const baseGeometry = new THREE.CylinderGeometry(3, 3, 0.3, 16);
        const baseMaterial = new THREE.MeshStandardMaterial({
            color: 0x3498db,
            metalness: 0.7,
            roughness: 0.3
        });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.position.y = 0.15;
        base.receiveShadow = true;
        station.add(base);

        // Ladesäule - weniger Segmente
        const poleGeometry = new THREE.CylinderGeometry(0.3, 0.3, 4, 8);
        const poleMaterial = new THREE.MeshStandardMaterial({
            color: 0x2c3e50,
            metalness: 0.8,
            roughness: 0.2
        });
        const pole = new THREE.Mesh(poleGeometry, poleMaterial);
        pole.position.y = 2;
        station.add(pole);

        // Leuchtender Ladekopf
        const headGeometry = new THREE.BoxGeometry(0.8, 1, 0.6);
        const headMaterial = new THREE.MeshStandardMaterial({
            color: 0x2ecc71,
            emissive: 0x2ecc71,
            emissiveIntensity: 0.7,
            metalness: 0.5
        });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.y = 4.5;
        station.add(head);

        // Blitzsymbol auf dem Kopf
        const boltGeometry = new THREE.BoxGeometry(0.3, 0.7, 0.05);
        const boltMaterial = new THREE.MeshStandardMaterial({
            color: 0xf1c40f,
            emissive: 0xf1c40f,
            emissiveIntensity: 1.0
        });
        const bolt = new THREE.Mesh(boltGeometry, boltMaterial);
        bolt.position.set(0, 4.5, 0.35);
        station.add(bolt);

        // Leuchtring um die Basis - weniger Segmente
        const ringGeometry = new THREE.TorusGeometry(3.2, 0.1, 8, 16);
        const ringMaterial = new THREE.MeshStandardMaterial({
            color: 0x3498db,
            emissive: 0x3498db,
            emissiveIntensity: 0.5
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.2;
        station.add(ring);

        // Entfernt: Punktlicht für Performance

        return station;
    }

    createGoal() {
        // Create a visible goal marker
        const goalGroup = new THREE.Group();

        // Base platform - weniger Segmente
        const platformGeometry = new THREE.CylinderGeometry(3, 3, 0.3, 16);
        const platformMaterial = new THREE.MeshStandardMaterial({
            color: 0xf1c40f,
            metalness: 0.5
        });
        const platform = new THREE.Mesh(platformGeometry, platformMaterial);
        platform.receiveShadow = true;
        goalGroup.add(platform);

        // Glowing pillar - weniger Segmente
        const pillarGeometry = new THREE.CylinderGeometry(0.5, 0.5, 8, 8);
        const pillarMaterial = new THREE.MeshStandardMaterial({
            color: 0xf39c12,
            emissive: 0xf39c12,
            emissiveIntensity: 0.5
        });
        const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
        pillar.position.y = 4;
        goalGroup.add(pillar);

        // Top sphere - weniger Segmente
        const sphereGeometry = new THREE.SphereGeometry(1, 16, 16);
        const sphereMaterial = new THREE.MeshStandardMaterial({
            color: 0xf1c40f,
            emissive: 0xf1c40f,
            emissiveIntensity: 0.8
        });
        const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
        sphere.position.y = 8.5;
        goalGroup.add(sphere);

        // Entfernt: Point light für Performance

        this.goalMesh = goalGroup;
        this.moveGoal();
        this.scene.add(goalGroup);
    }

    moveGoal() {
        // Zufällige Position in der großen Welt
        const positions = [];

        // Generiere Positionen entlang der Straßen
        for (let x = -160; x <= 160; x += 40) {
            for (let z = -160; z <= 160; z += 40) {
                // Nicht zu nah am Start
                if (Math.abs(x) > 40 || Math.abs(z) > 40) {
                    positions.push({ x, z });
                }
            }
        }

        const randomPos = positions[Math.floor(Math.random() * positions.length)];
        this.goalPosition.set(randomPos.x, 0, randomPos.z);
        this.goalMesh.position.copy(this.goalPosition);
        this.goalMesh.position.y = 0.15;
    }

    animateGoal() {
        if (this.goalMesh) {
            this.goalMesh.rotation.y += 0.01;

            // Floating animation
            const time = Date.now() * 0.001;
            this.goalMesh.children[2].position.y = 8.5 + Math.sin(time * 2) * 0.5;
        }
    }

    createEnvironment() {
        // Bäume und Büsche auf Wiesen (NICHT auf Straßen!)
        // Straßen sind bei x/z = -120, -80, -40, 0, 40, 80, 120
        // Platziere Vegetation zwischen den Straßen

        const vegetation = [];

        // Bäume in den Wiesen-Bereichen
        for (let x = -110; x <= 110; x += 25) {
            for (let z = -110; z <= 110; z += 25) {
                // Nicht auf Straßen (Straßen-Positionen mit ±5m Puffer)
                const onRoad = this.isNearRoad(x, z, 12);

                // Nicht zu nah am Zentrum (Start)
                const nearCenter = Math.abs(x) < 25 && Math.abs(z) < 25;

                if (!onRoad && !nearCenter) {
                    // 70% Chance für Baum
                    if (Math.random() > 0.3) {
                        const tree = this.createTree();
                        // Kleine Variation in Position
                        tree.position.set(
                            x + (Math.random() - 0.5) * 10,
                            0,
                            z + (Math.random() - 0.5) * 10
                        );
                        this.scene.add(tree);
                        vegetation.push(tree);
                    }
                }
            }
        }

        // Büsche (mehr als Bäume)
        for (let x = -110; x <= 110; x += 15) {
            for (let z = -110; z <= 110; z += 15) {
                const onRoad = this.isNearRoad(x, z, 10);
                const nearCenter = Math.abs(x) < 25 && Math.abs(z) < 25;

                if (!onRoad && !nearCenter && Math.random() > 0.4) {
                    const bush = this.createBush();
                    bush.position.set(
                        x + (Math.random() - 0.5) * 8,
                        0,
                        z + (Math.random() - 0.5) * 8
                    );
                    this.scene.add(bush);
                    vegetation.push(bush);
                }
            }
        }

        // Bunte Blumen auf den Wiesen - reduziert für Performance
        for (let i = 0; i < 50; i++) {
            const x = (Math.random() - 0.5) * 220;
            const z = (Math.random() - 0.5) * 220;

            const onRoad = this.isNearRoad(x, z, 8);
            const nearCenter = Math.abs(x) < 20 && Math.abs(z) < 20;

            if (!onRoad && !nearCenter) {
                const flower = this.createFlower();
                flower.position.set(x, 0, z);
                this.scene.add(flower);
            }
        }

        // Straßenlaternen an Straßenrändern - reduziert für Performance
        for (let i = -100; i <= 100; i += 60) {
            // Entlang horizontaler Straßen - nur jede zweite Straße
            for (let roadZ of [-80, 0, 80]) {
                const lamp = this.createStreetLamp();
                lamp.position.set(i, 0, roadZ + 6);
                this.scene.add(lamp);
            }

            // Entlang vertikaler Straßen - nur jede zweite Straße
            for (let roadX of [-80, 0, 80]) {
                const lamp = this.createStreetLamp();
                lamp.position.set(roadX + 6, 0, i);
                this.scene.add(lamp);
            }
        }

        // Wolken im Himmel
        this.createClouds();

        console.log(`Environment created: ${vegetation.length} vegetation items`);
    }

    // Hilfsfunktion: Prüft ob Position zu nah an Straße ist
    isNearRoad(x, z, buffer) {
        const roadPositions = [-120, -80, -40, 0, 40, 80, 120];

        for (let roadPos of roadPositions) {
            // Horizontale Straßen (z = roadPos)
            if (Math.abs(z - roadPos) < buffer) return true;
            // Vertikale Straßen (x = roadPos)
            if (Math.abs(x - roadPos) < buffer) return true;
        }

        return false;
    }

    createTree() {
        const tree = new THREE.Group();

        // Trunk - weniger Segmente
        const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.4, 3, 6);
        const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3728 });
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.y = 1.5;
        trunk.castShadow = true;
        tree.add(trunk);

        // Foliage - weniger Segmente
        const foliageGeometry = new THREE.SphereGeometry(2, 6, 6);
        const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x2d5016 });
        const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
        foliage.position.y = 4;
        foliage.castShadow = true;
        tree.add(foliage);

        return tree;
    }

    createStreetLamp() {
        const lamp = new THREE.Group();

        // Pole - weniger Segmente
        const poleGeometry = new THREE.CylinderGeometry(0.1, 0.1, 5, 6);
        const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });
        const pole = new THREE.Mesh(poleGeometry, poleMaterial);
        pole.position.y = 2.5;
        // Keine Schatten für kleine Objekte
        lamp.add(pole);

        // Light - weniger Segmente
        const lightGeometry = new THREE.SphereGeometry(0.3, 8, 8);
        const lightMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffcc,
            emissiveIntensity: 0.5
        });
        const light = new THREE.Mesh(lightGeometry, lightMaterial);
        light.position.y = 5;
        lamp.add(light);

        // Entfernt: Point light für Performance

        return lamp;
    }

    createBush() {
        const bush = new THREE.Group();

        // Weniger Kugeln für buschiges Aussehen
        const bushMaterial = new THREE.MeshStandardMaterial({
            color: 0x3a6b1f,
            roughness: 0.9
        });

        for (let i = 0; i < 2; i++) {
            const size = 0.4 + Math.random() * 0.3;
            const bushGeometry = new THREE.SphereGeometry(size, 4, 4);
            const bushPart = new THREE.Mesh(bushGeometry, bushMaterial);
            bushPart.position.set(
                (Math.random() - 0.5) * 0.5,
                size * 0.7,
                (Math.random() - 0.5) * 0.5
            );
            // Keine Schatten für kleine Objekte
            bush.add(bushPart);
        }

        return bush;
    }

    createFlower() {
        const flower = new THREE.Group();

        // Stiel
        const stemGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.4, 3);
        const stemMaterial = new THREE.MeshStandardMaterial({ color: 0x2d5016 });
        const stem = new THREE.Mesh(stemGeometry, stemMaterial);
        stem.position.y = 0.2;
        flower.add(stem);

        // Blüte - bunte Farben - vereinfacht
        const flowerColors = [
            0xff0000, 0xff69b4, 0xffff00, 0xff8c00, 0x9370db, 0xffffff, 0xff1493
        ];

        const color = flowerColors[Math.floor(Math.random() * flowerColors.length)];

        // Einzelne Kugel statt mehrerer Blütenblätter
        const flowerGeometry = new THREE.SphereGeometry(0.12, 4, 4);
        const flowerMaterial = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.2
        });
        const flowerHead = new THREE.Mesh(flowerGeometry, flowerMaterial);
        flowerHead.position.y = 0.4;
        flower.add(flowerHead);

        return flower;
    }

    createClouds() {
        this.clouds = [];

        // 8-10 Wolken im Himmel - reduziert für Performance
        const numClouds = 8 + Math.floor(Math.random() * 3);

        for (let i = 0; i < numClouds; i++) {
            const cloud = this.createCloud();
            cloud.position.set(
                (Math.random() - 0.5) * 400,
                40 + Math.random() * 30,
                (Math.random() - 0.5) * 400
            );
            this.scene.add(cloud);
            this.clouds.push(cloud);
        }
    }

    createCloud() {
        const cloud = new THREE.Group();

        const cloudMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8,
            roughness: 1.0
        });

        // Wolke aus weniger Kugeln mit weniger Segmenten
        const numParts = 3 + Math.floor(Math.random() * 2);

        for (let i = 0; i < numParts; i++) {
            const size = 3 + Math.random() * 4;
            const partGeometry = new THREE.SphereGeometry(size, 5, 5);
            const part = new THREE.Mesh(partGeometry, cloudMaterial);
            part.position.set(
                (Math.random() - 0.5) * 10,
                (Math.random() - 0.5) * 3,
                (Math.random() - 0.5) * 10
            );
            cloud.add(part);
        }

        return cloud;
    }

    // Wolken animieren (langsam bewegen)
    animateClouds() {
        if (this.clouds) {
            this.clouds.forEach(cloud => {
                cloud.position.x += 0.01;
                // Wrap around
                if (cloud.position.x > 200) {
                    cloud.position.x = -200;
                }
            });
        }
    }
}

