// CarModels - ohne ES6 Module für file:// Kompatibilität
// THREE wird global vom CDN geladen

class CarModels {
    constructor() {
        this.carData = [
            {
                name: '🚗 Starter Auto',
                speed: 0.9,
                handling: 2.0,
                value: 1,
                price: 0,
                color: 0x808080
            },
            {
                name: '🚙 Kompaktwagen',
                speed: 1.2,
                handling: 2.3,
                value: 2,
                price: 100,
                color: 0x3498db
            },
            {
                name: '🚕 Limousine',
                speed: 1.5,
                handling: 2.5,
                value: 3,
                price: 250,
                color: 0x2ecc71
            },
            {
                name: '🚗 Sportwagen',
                speed: 2.1,
                handling: 3.0,
                value: 4,
                price: 500,
                color: 0xe74c3c
            },
            {
                name: '🏎️ Rennwagen',
                speed: 2.7,
                handling: 3.5,
                value: 5,
                price: 800,
                color: 0xf39c12
            },
            {
                name: '🚙 SUV Premium',
                speed: 1.8,
                handling: 2.8,
                value: 6,
                price: 1200,
                color: 0x1abc9c
            },
            {
                name: '🏎️ Super Sport',
                speed: 3.3,
                handling: 4.0,
                value: 7,
                price: 1800,
                color: 0x9b59b6
            },
            {
                name: '🚗 Luxus GT',
                speed: 3.0,
                handling: 4.2,
                value: 8,
                price: 2500,
                color: 0x34495e
            },
            {
                name: '🏎️ Hyper Car',
                speed: 4.2,
                handling: 4.5,
                value: 9,
                price: 3500,
                color: 0xe67e22
            },
            {
                name: '🏎️ Formula Racer',
                speed: 5.1,
                handling: 5.0,
                value: 10,
                price: 5000,
                color: 0xc0392b
            }
        ];
    }

    createCar(index) {
        const carData = this.carData[index];
        const car = {
            mesh: new THREE.Group(),
            velocity: new THREE.Vector3(0, 0, 0),
            angularVelocity: 0
        };

        // Create car body based on index (more complex as index increases)
        switch(index) {
            case 0:
                this.createBasicCar(car, carData.color);
                break;
            case 1:
                this.createCompactCar(car, carData.color);
                break;
            case 2:
                this.createSedanCar(car, carData.color);
                break;
            case 3:
                this.createSportsCar(car, carData.color);
                break;
            case 4:
                this.createRaceCar(car, carData.color);
                break;
            case 5:
                this.createSUV(car, carData.color);
                break;
            case 6:
                this.createSuperSport(car, carData.color);
                break;
            case 7:
                this.createLuxuryCar(car, carData.color);
                break;
            case 8:
                this.createHyperCar(car, carData.color);
                break;
            case 9:
                this.createFormulaCar(car, carData.color);
                break;
        }

        car.mesh.castShadow = true;
        car.mesh.receiveShadow = true;

        return car;
    }

    createBasicCar(car, color) {
        // Simple box car - Position auf Räderhöhe
        const bodyGeometry = new THREE.BoxGeometry(2, 1, 4);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.5; // Über den Rädern
        body.castShadow = true;
        car.mesh.add(body);

        // Cabin
        const cabinGeometry = new THREE.BoxGeometry(1.8, 0.8, 2);
        const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
        const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
        cabin.position.set(0, 1.4, -0.3); // Höher positioniert
        cabin.castShadow = true;
        car.mesh.add(cabin);

        // Blaue Windschutzscheibe vorne
        const windshieldGeometry = new THREE.BoxGeometry(1.8, 0.7, 0.1);
        const windshieldMaterial = new THREE.MeshStandardMaterial({
            color: 0x1e90ff,
            transparent: true,
            opacity: 0.6,
            metalness: 0.5,
            roughness: 0.1
        });
        const windshield = new THREE.Mesh(windshieldGeometry, windshieldMaterial);
        windshield.position.set(0, 1.4, 0.7);
        car.mesh.add(windshield);

        // Wheels
        this.addWheels(car.mesh, 4);
        // Bessere Lichter
        this.addBetterLights(car.mesh);
    }

    createCompactCar(car, color) {
        // Rounded body
        const bodyGeometry = new THREE.BoxGeometry(2.2, 1, 3.5);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color, metalness: 0.3 });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.5;
        body.castShadow = true;
        car.mesh.add(body);

        // Cabin with slope
        const cabinGeometry = new THREE.BoxGeometry(2, 0.9, 2);
        const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
        cabin.position.set(0, 1.45, -0.2);
        cabin.castShadow = true;
        car.mesh.add(cabin);

        // Blaue Windschutzscheibe
        const windshieldGeometry = new THREE.BoxGeometry(2, 0.8, 0.1);
        const windshieldMaterial = new THREE.MeshStandardMaterial({
            color: 0x1e90ff,
            transparent: true,
            opacity: 0.6,
            metalness: 0.5,
            roughness: 0.1
        });
        const windshield = new THREE.Mesh(windshieldGeometry, windshieldMaterial);
        windshield.position.set(0, 1.45, 0.8);
        car.mesh.add(windshield);

        // Front
        const frontGeometry = new THREE.BoxGeometry(2, 0.6, 0.8);
        const front = new THREE.Mesh(frontGeometry, bodyMaterial);
        front.position.set(0, 0.8, 1.65);
        front.castShadow = true;
        car.mesh.add(front);

        this.addWheels(car.mesh, 4);
        this.addBetterLights(car.mesh);
    }

    createSedanCar(car, color) {
        // Longer, more elegant body
        const bodyGeometry = new THREE.BoxGeometry(2.3, 0.9, 4.5);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.3 });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.castShadow = true;
        car.mesh.add(body);

        // Cabin
        const cabinGeometry = new THREE.BoxGeometry(2.1, 0.95, 2.5);
        const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
        const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
        cabin.position.set(0, 0.92, -0.3);
        cabin.castShadow = true;
        car.mesh.add(cabin);

        // Hood
        const hoodGeometry = new THREE.BoxGeometry(2.2, 0.5, 1.2);
        const hood = new THREE.Mesh(hoodGeometry, bodyMaterial);
        hood.position.set(0, 0.4, 1.5);
        hood.castShadow = true;
        car.mesh.add(hood);

        // Trunk
        const trunkGeometry = new THREE.BoxGeometry(2.2, 0.6, 1);
        const trunk = new THREE.Mesh(trunkGeometry, bodyMaterial);
        trunk.position.set(0, 0.4, -2);
        trunk.castShadow = true;
        car.mesh.add(trunk);

        this.addWheels(car.mesh, 5);
        this.addLights(car.mesh);
        this.addSpoiler(car.mesh, 0.3, color);
    }

    createSportsCar(car, color) {
        // Low, wide body
        const bodyGeometry = new THREE.BoxGeometry(2.5, 0.7, 4.2);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color,
            metalness: 0.7,
            roughness: 0.2
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.55;
        body.castShadow = true;
        car.mesh.add(body);

        // Low cabin
        const cabinGeometry = new THREE.BoxGeometry(2.2, 0.7, 2);
        const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x111111 });
        const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
        cabin.position.set(0, 1.15, -0.2);
        cabin.castShadow = true;
        car.mesh.add(cabin);

        // Windschutzscheibe
        const windshieldGeometry = new THREE.BoxGeometry(2.2, 0.65, 0.1);
        const windshieldMaterial = new THREE.MeshStandardMaterial({
            color: 0x1e90ff,
            transparent: true,
            opacity: 0.5,
            metalness: 0.5,
            roughness: 0.1
        });
        const windshield = new THREE.Mesh(windshieldGeometry, windshieldMaterial);
        windshield.position.set(0, 1.15, 0.9);
        car.mesh.add(windshield);

        // Front splitter
        const splitterGeometry = new THREE.BoxGeometry(2.5, 0.1, 0.5);
        const splitter = new THREE.Mesh(splitterGeometry, new THREE.MeshStandardMaterial({ color: 0x000000 }));
        splitter.position.set(0, 0.45, 2.2);
        car.mesh.add(splitter);

        this.addWheels(car.mesh, 5);
        this.addLights(car.mesh);
        this.addSpoiler(car.mesh, 0.5, color);
        this.addExhaust(car.mesh, 2);
    }

    createRaceCar(car, color) {
        // Aerodynamic race body
        const bodyGeometry = new THREE.BoxGeometry(2.4, 0.6, 4.5);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color,
            metalness: 0.8,
            roughness: 0.1
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.2;
        body.castShadow = true;
        car.mesh.add(body);

        // Race cabin
        const cabinGeometry = new THREE.BoxGeometry(2, 0.6, 1.5);
        const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
        const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
        cabin.position.set(0, 0.7, 0);
        cabin.castShadow = true;
        car.mesh.add(cabin);

        // Racing stripes
        const stripeGeometry = new THREE.BoxGeometry(0.3, 0.61, 4.6);
        const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
        const stripe = new THREE.Mesh(stripeGeometry, stripeMaterial);
        stripe.position.set(0, 0.2, 0);
        car.mesh.add(stripe);

        // Front wing
        const wingGeometry = new THREE.BoxGeometry(2.8, 0.1, 0.5);
        const wing = new THREE.Mesh(wingGeometry, new THREE.MeshStandardMaterial({ color: 0x000000 }));
        wing.position.set(0, 0.1, 2.5);
        car.mesh.add(wing);

        this.addWheels(car.mesh, 6);
        this.addBetterLights(car.mesh);
        this.addSpoiler(car.mesh, 0.8, color);
        this.addExhaust(car.mesh, 4);
    }

    createSUV(car, color) {
        // Large, tall body
        const bodyGeometry = new THREE.BoxGeometry(2.6, 1.4, 5);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color, metalness: 0.4 });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.3;
        body.castShadow = true;
        car.mesh.add(body);

        // Large cabin
        const cabinGeometry = new THREE.BoxGeometry(2.5, 1.2, 3);
        const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
        cabin.position.set(0, 1.1, -0.5);
        cabin.castShadow = true;
        car.mesh.add(cabin);

        // Roof rack
        const rackGeometry = new THREE.BoxGeometry(2.3, 0.1, 2.5);
        const rack = new THREE.Mesh(rackGeometry, new THREE.MeshStandardMaterial({ color: 0x000000 }));
        rack.position.set(0, 1.8, -0.5);
        car.mesh.add(rack);

        this.addWheels(car.mesh, 6);
        this.addBetterLights(car.mesh);
        this.addExhaust(car.mesh, 2);
    }

    createSuperSport(car, color) {
        // Ultra-low aerodynamic body
        const bodyGeometry = new THREE.BoxGeometry(2.6, 0.5, 4.8);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color,
            metalness: 0.9,
            roughness: 0.1
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.15;
        body.castShadow = true;
        car.mesh.add(body);

        // Cockpit
        const cockpitGeometry = new THREE.BoxGeometry(2.1, 0.55, 1.8);
        const cockpitMaterial = new THREE.MeshStandardMaterial({ color: 0x050505 });
        const cockpit = new THREE.Mesh(cockpitGeometry, cockpitMaterial);
        cockpit.position.set(0, 0.6, -0.3);
        cockpit.castShadow = true;
        car.mesh.add(cockpit);

        // Side vents
        for (let side of [-1, 1]) {
            const ventGeometry = new THREE.BoxGeometry(0.3, 0.4, 1);
            const vent = new THREE.Mesh(ventGeometry, new THREE.MeshStandardMaterial({ color: 0x000000 }));
            vent.position.set(side * 1.3, 0.3, 0.5);
            car.mesh.add(vent);
        }

        // Diffuser
        const diffuserGeometry = new THREE.BoxGeometry(2.4, 0.3, 1);
        const diffuser = new THREE.Mesh(diffuserGeometry, new THREE.MeshStandardMaterial({ color: 0x000000 }));
        diffuser.position.set(0, 0.1, -2.4);
        car.mesh.add(diffuser);

        this.addWheels(car.mesh, 7);
        this.addLights(car.mesh);
        this.addSpoiler(car.mesh, 1.0, color);
        this.addExhaust(car.mesh, 4);
    }

    createLuxuryCar(car, color) {
        // Premium luxury body
        const bodyGeometry = new THREE.BoxGeometry(2.5, 1, 5.2);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color,
            metalness: 0.8,
            roughness: 0.2
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.castShadow = true;
        car.mesh.add(body);

        // Elegant cabin
        const cabinGeometry = new THREE.BoxGeometry(2.3, 0.95, 2.8);
        const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
        const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
        cabin.position.set(0, 0.97, -0.3);
        cabin.castShadow = true;
        car.mesh.add(cabin);

        // Chrome accents
        const accentMaterial = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            metalness: 1.0,
            roughness: 0
        });

        for (let z of [-1.5, 1.5]) {
            const accent = new THREE.Mesh(
                new THREE.BoxGeometry(2.5, 0.1, 0.3),
                accentMaterial
            );
            accent.position.set(0, 0.5, z);
            car.mesh.add(accent);
        }

        this.addWheels(car.mesh, 7);
        this.addLights(car.mesh);
        this.addExhaust(car.mesh, 4);
    }

    createHyperCar(car, color) {
        // Extreme hypercar body
        const bodyGeometry = new THREE.BoxGeometry(2.7, 0.45, 5);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color,
            metalness: 0.95,
            roughness: 0.05
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.12;
        body.castShadow = true;
        car.mesh.add(body);

        // Jet-fighter style cockpit
        const cockpitGeometry = new THREE.BoxGeometry(1.9, 0.5, 1.5);
        const cockpitMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
        const cockpit = new THREE.Mesh(cockpitGeometry, cockpitMaterial);
        cockpit.position.set(0, 0.55, -0.2);
        cockpit.castShadow = true;
        car.mesh.add(cockpit);

        // Active aero elements
        for (let side of [-1, 1]) {
            const aeroGeometry = new THREE.BoxGeometry(0.2, 0.6, 1.5);
            const aero = new THREE.Mesh(aeroGeometry, new THREE.MeshStandardMaterial({ color: 0x000000 }));
            aero.position.set(side * 1.4, 0.3, 0);
            car.mesh.add(aero);
        }

        // Massive diffuser
        const diffuserGeometry = new THREE.BoxGeometry(2.6, 0.4, 1.5);
        const diffuser = new THREE.Mesh(diffuserGeometry, new THREE.MeshStandardMaterial({ color: 0x000000 }));
        diffuser.position.set(0, 0.08, -2.5);
        car.mesh.add(diffuser);

        this.addWheels(car.mesh, 8);
        this.addLights(car.mesh);
        this.addSpoiler(car.mesh, 1.2, color);
        this.addExhaust(car.mesh, 6);
    }

    createFormulaCar(car, color) {
        // Open-wheel formula car
        const bodyGeometry = new THREE.BoxGeometry(1.8, 0.4, 4.5);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color,
            metalness: 1.0,
            roughness: 0
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.3;
        body.castShadow = true;
        car.mesh.add(body);

        // Cockpit opening
        const cockpitGeometry = new THREE.BoxGeometry(1.3, 0.45, 1.2);
        const cockpitMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
        const cockpit = new THREE.Mesh(cockpitGeometry, cockpitMaterial);
        cockpit.position.set(0, 0.42, -0.5);
        cockpit.castShadow = true;
        car.mesh.add(cockpit);

        // Nose cone
        const noseGeometry = new THREE.ConeGeometry(0.3, 1.5, 4);
        const nose = new THREE.Mesh(noseGeometry, bodyMaterial);
        nose.rotation.x = Math.PI / 2;
        nose.position.set(0, 0.3, 3);
        nose.castShadow = true;
        car.mesh.add(nose);

        // Front wing
        const frontWingGeometry = new THREE.BoxGeometry(3, 0.05, 0.6);
        const frontWing = new THREE.Mesh(frontWingGeometry, new THREE.MeshStandardMaterial({ color: 0x000000 }));
        frontWing.position.set(0, 0.15, 2.8);
        car.mesh.add(frontWing);

        // Rear wing supports
        for (let side of [-0.6, 0.6]) {
            const supportGeometry = new THREE.BoxGeometry(0.1, 1, 0.1);
            const support = new THREE.Mesh(supportGeometry, new THREE.MeshStandardMaterial({ color: 0x000000 }));
            support.position.set(side, 0.8, -2.2);
            car.mesh.add(support);
        }

        // Rear wing
        const rearWingGeometry = new THREE.BoxGeometry(3.2, 0.1, 0.8);
        const rearWing = new THREE.Mesh(rearWingGeometry, new THREE.MeshStandardMaterial({ color: color }));
        rearWing.position.set(0, 1.3, -2.2);
        car.mesh.add(rearWing);

        // Exposed wheels (formula style)
        this.addWheels(car.mesh, 8, true);
        this.addBetterLights(car.mesh);
        this.addExhaust(car.mesh, 6);
    }

    addWheels(carMesh, detail, exposed = false) {
        const wheelGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16);
        const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });

        const positions = [
            { x: -1.2, z: 1.5 },  // front left
            { x: 1.2, z: 1.5 },   // front right
            { x: -1.2, z: -1.5 }, // rear left
            { x: 1.2, z: -1.5 }   // rear right
        ];

        positions.forEach(pos => {
            const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(pos.x, 0.4, pos.z);
            wheel.castShadow = true;
            carMesh.add(wheel);

            if (detail >= 5) {
                // Add rim detail
                const rimGeometry = new THREE.CylinderGeometry(0.25, 0.25, 0.31, 8);
                const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8 });
                const rim = new THREE.Mesh(rimGeometry, rimMaterial);
                rim.rotation.z = Math.PI / 2;
                rim.position.set(pos.x, 0.4, pos.z);
                carMesh.add(rim);
            }
        });
    }

    addBetterLights(carMesh) {
        // Hellere, bessere Scheinwerfer
        const lightMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffaa,
            emissiveIntensity: 1.0,
            metalness: 0.8,
            roughness: 0.2
        });

        // Headlights - größer und heller
        for (let x of [-0.7, 0.7]) {
            const light = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.3, 0.15),
                lightMaterial
            );
            light.position.set(x, 0.6, 2.05);
            carMesh.add(light);

            // Spot Light für echte Beleuchtung
            const spotLight = new THREE.SpotLight(0xffffee, 0.5, 20, Math.PI / 6);
            spotLight.position.set(x, 0.6, 2.05);
            spotLight.target.position.set(x, 0, 10);
            carMesh.add(spotLight);
            carMesh.add(spotLight.target);
        }

        // Taillights - heller rot
        const tailMaterial = new THREE.MeshStandardMaterial({
            color: 0xff0000,
            emissive: 0xff0000,
            emissiveIntensity: 0.8
        });
        for (let x of [-0.7, 0.7]) {
            const light = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.25, 0.1),
                tailMaterial
            );
            light.position.set(x, 0.6, -2.05);
            carMesh.add(light);
        }
    }

    addLights(carMesh) {
        const lightMaterial = new THREE.MeshStandardMaterial({
            color: 0xffff00,
            emissive: 0xffff00,
            emissiveIntensity: 0.5
        });

        // Headlights
        for (let x of [-0.6, 0.6]) {
            const light = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.2, 0.1),
                lightMaterial
            );
            light.position.set(x, 0.5, 2.1);
            carMesh.add(light);
        }

        // Taillights
        const tailMaterial = new THREE.MeshStandardMaterial({
            color: 0xff0000,
            emissive: 0xff0000,
            emissiveIntensity: 0.3
        });
        for (let x of [-0.6, 0.6]) {
            const light = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.2, 0.1),
                tailMaterial
            );
            light.position.set(x, 0.5, -2.1);
            carMesh.add(light);
        }
    }

    addSpoiler(carMesh, height, color) {
        // Spoiler supports
        for (let x of [-0.8, 0.8]) {
            const supportGeometry = new THREE.BoxGeometry(0.1, height, 0.1);
            const support = new THREE.Mesh(
                supportGeometry,
                new THREE.MeshStandardMaterial({ color: 0x000000 })
            );
            support.position.set(x, 0.5 + height / 2, -2);
            carMesh.add(support);
        }

        // Spoiler wing
        const wingGeometry = new THREE.BoxGeometry(2, 0.1, 0.5);
        const wing = new THREE.Mesh(
            wingGeometry,
            new THREE.MeshStandardMaterial({ color })
        );
        wing.position.set(0, 0.5 + height, -2);
        carMesh.add(wing);
    }

    addExhaust(carMesh, count) {
        const exhaustGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8);
        const exhaustMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });

        const spacing = 0.4;
        const totalWidth = (count - 1) * spacing;

        for (let i = 0; i < count; i++) {
            const exhaust = new THREE.Mesh(exhaustGeometry, exhaustMaterial);
            exhaust.rotation.x = Math.PI / 2;
            const x = -totalWidth / 2 + i * spacing;
            exhaust.position.set(x, 0.3, -2.3);
            carMesh.add(exhaust);
        }
    }
}

