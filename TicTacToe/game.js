// Game State
let board = Array(9).fill(null);
let currentPlayer = 'X';
let gameOver = false;
let cells = [];
let isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// Three.js Setup
const container = document.getElementById('game-container');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for performance
renderer.setClearColor(0x000000, 0);
container.appendChild(renderer.domElement);

// Camera Position - adjust for mobile
function updateCameraForScreenSize() {
    if (window.innerWidth < 768) {
        camera.position.set(0, 7, 9);
        camera.fov = 65;
    } else {
        camera.position.set(0, 5, 7);
        camera.fov = 75;
    }
    camera.updateProjectionMatrix();
}
updateCameraForScreenSize();
camera.lookAt(0, 0, 0);

// Orbit Controls
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 5;
controls.maxDistance = 15;
controls.enablePan = false; // Disable pan for cleaner mobile experience
controls.rotateSpeed = isMobile ? 0.5 : 1; // Slower rotation on mobile
controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_ROTATE
};

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 5);
scene.add(directionalLight);

const pointLight = new THREE.PointLight(0x667eea, 0.5, 20);
pointLight.position.set(0, 5, 0);
scene.add(pointLight);

// Materials
const gridMaterial = new THREE.MeshStandardMaterial({
    color: 0x444466,
    metalness: 0.3,
    roughness: 0.7
});

const cellMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a2e,
    metalness: 0.2,
    roughness: 0.8,
    transparent: true,
    opacity: 0.8
});

const hoverMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a3a5e,
    metalness: 0.2,
    roughness: 0.8,
    transparent: true,
    opacity: 0.9
});

const xMaterial = new THREE.MeshStandardMaterial({
    color: 0xff6b6b,
    metalness: 0.4,
    roughness: 0.3,
    emissive: 0xff6b6b,
    emissiveIntensity: 0.2
});

const oMaterial = new THREE.MeshStandardMaterial({
    color: 0x4ecdc4,
    metalness: 0.4,
    roughness: 0.3,
    emissive: 0x4ecdc4,
    emissiveIntensity: 0.2
});

const winMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd93d,
    metalness: 0.5,
    roughness: 0.2,
    emissive: 0xffd93d,
    emissiveIntensity: 0.5
});

// Create Grid Lines
function createGrid() {
    const gridGroup = new THREE.Group();
    const lineGeometry = new THREE.BoxGeometry(0.1, 0.2, 6.2);

    // Vertical lines
    const line1 = new THREE.Mesh(lineGeometry, gridMaterial);
    line1.position.set(-1, 0, 0);
    gridGroup.add(line1);

    const line2 = new THREE.Mesh(lineGeometry, gridMaterial);
    line2.position.set(1, 0, 0);
    gridGroup.add(line2);

    // Horizontal lines
    const line3 = new THREE.Mesh(lineGeometry, gridMaterial);
    line3.rotation.y = Math.PI / 2;
    line3.position.set(0, 0, -1);
    gridGroup.add(line3);

    const line4 = new THREE.Mesh(lineGeometry, gridMaterial);
    line4.rotation.y = Math.PI / 2;
    line4.position.set(0, 0, 1);
    gridGroup.add(line4);

    scene.add(gridGroup);
}

// Create Cell Planes (clickable areas)
function createCells() {
    const cellGeometry = new THREE.BoxGeometry(1.8, 0.1, 1.8);

    for (let i = 0; i < 9; i++) {
        const row = Math.floor(i / 3);
        const col = i % 3;
        const x = (col - 1) * 2;
        const z = (row - 1) * 2;

        const cell = new THREE.Mesh(cellGeometry, cellMaterial.clone());
        cell.position.set(x, -0.1, z);
        cell.userData = { index: i, originalMaterial: cell.material };
        cells.push(cell);
        scene.add(cell);
    }
}

// Create X Mark
function createX(position) {
    const group = new THREE.Group();
    const barGeometry = new THREE.BoxGeometry(0.2, 0.3, 1.4);

    const bar1 = new THREE.Mesh(barGeometry, xMaterial);
    bar1.rotation.y = Math.PI / 4;
    group.add(bar1);

    const bar2 = new THREE.Mesh(barGeometry, xMaterial);
    bar2.rotation.y = -Math.PI / 4;
    group.add(bar2);

    group.position.copy(position);
    group.position.y = 0.2;
    group.scale.set(0, 0, 0);

    scene.add(group);
    animateScale(group, 1);

    return group;
}

// Create O Mark
function createO(position) {
    const torusGeometry = new THREE.TorusGeometry(0.5, 0.12, 16, 32);
    const torus = new THREE.Mesh(torusGeometry, oMaterial);

    torus.position.copy(position);
    torus.position.y = 0.2;
    torus.rotation.x = Math.PI / 2;
    torus.scale.set(0, 0, 0);

    scene.add(torus);
    animateScale(torus, 1);

    return torus;
}

// Animation for scaling marks
function animateScale(object, targetScale) {
    const startTime = Date.now();
    const duration = 300;

    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeProgress = 1 - Math.pow(1 - progress, 3);

        const scale = easeProgress * targetScale;
        object.scale.set(scale, scale, scale);

        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }
    animate();
}

// Check for Winner
function checkWinner() {
    const winPatterns = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
        [0, 4, 8], [2, 4, 6]              // Diagonals
    ];

    for (const pattern of winPatterns) {
        const [a, b, c] = pattern;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return { winner: board[a], pattern };
        }
    }

    if (board.every(cell => cell !== null)) {
        return { winner: 'draw', pattern: null };
    }

    return null;
}

// Highlight winning cells
function highlightWin(pattern) {
    pattern.forEach(index => {
        const cell = cells[index];
        cell.material = winMaterial.clone();

        // Animate winning cells
        const startY = cell.position.y;
        const startTime = Date.now();

        function pulseAnimate() {
            if (!gameOver) return;
            const elapsed = Date.now() - startTime;
            cell.position.y = startY + Math.sin(elapsed * 0.005) * 0.1;
            cell.material.emissiveIntensity = 0.3 + Math.sin(elapsed * 0.003) * 0.2;
            requestAnimationFrame(pulseAnimate);
        }
        pulseAnimate();
    });
}

// Handle Cell Click
function handleClick(index) {
    if (gameOver || board[index] !== null) return;

    board[index] = currentPlayer;
    const cell = cells[index];
    const position = cell.position.clone();

    if (currentPlayer === 'X') {
        cell.userData.mark = createX(position);
    } else {
        cell.userData.mark = createO(position);
    }

    const result = checkWinner();

    if (result) {
        gameOver = true;
        if (result.winner === 'draw') {
            updateStatus("It's a Draw!");
        } else {
            updateStatus(`Player ${result.winner} Wins!`);
            highlightWin(result.pattern);
        }
    } else {
        currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
        updateStatus(`Player ${currentPlayer}'s Turn`);
    }
}

// Update Status Display
function updateStatus(message) {
    document.getElementById('status').textContent = message;
}

// Reset Game
function resetGame() {
    board = Array(9).fill(null);
    currentPlayer = 'X';
    gameOver = false;

    cells.forEach(cell => {
        if (cell.userData.mark) {
            scene.remove(cell.userData.mark);
            cell.userData.mark = null;
        }
        cell.material = cellMaterial.clone();
        cell.userData.originalMaterial = cell.material;
        cell.position.y = -0.1;
    });

    updateStatus("Player X's Turn");
}

// Raycaster for mouse/touch interaction
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredCell = null;
let touchStartTime = 0;
let touchStartPos = { x: 0, y: 0 };
const TAP_THRESHOLD = 200; // ms
const MOVE_THRESHOLD = 10; // pixels

function getPointerPosition(event) {
    let clientX, clientY;

    if (event.touches && event.touches.length > 0) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
    } else if (event.changedTouches && event.changedTouches.length > 0) {
        clientX = event.changedTouches[0].clientX;
        clientY = event.changedTouches[0].clientY;
    } else {
        clientX = event.clientX;
        clientY = event.clientY;
    }

    return {
        x: (clientX / window.innerWidth) * 2 - 1,
        y: -(clientY / window.innerHeight) * 2 + 1,
        clientX,
        clientY
    };
}

function onMouseMove(event) {
    if (isMobile) return; // Skip hover effects on mobile

    const pos = getPointerPosition(event);
    mouse.x = pos.x;
    mouse.y = pos.y;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(cells);

    // Reset previous hover
    if (hoveredCell && !gameOver) {
        hoveredCell.material = hoveredCell.userData.originalMaterial;
    }

    if (intersects.length > 0 && !gameOver) {
        const cell = intersects[0].object;
        if (board[cell.userData.index] === null) {
            hoveredCell = cell;
            cell.material = hoverMaterial;
            container.style.cursor = 'pointer';
        } else {
            hoveredCell = null;
            container.style.cursor = 'default';
        }
    } else {
        hoveredCell = null;
        container.style.cursor = 'default';
    }
}

function onClick(event) {
    const pos = getPointerPosition(event);
    mouse.x = pos.x;
    mouse.y = pos.y;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(cells);

    if (intersects.length > 0) {
        const cell = intersects[0].object;
        handleClick(cell.userData.index);
    }
}

// Touch event handlers
function onTouchStart(event) {
    if (event.touches.length === 1) {
        touchStartTime = Date.now();
        const pos = getPointerPosition(event);
        touchStartPos = { x: pos.clientX, y: pos.clientY };
    }
}

function onTouchEnd(event) {
    const touchDuration = Date.now() - touchStartTime;
    const pos = getPointerPosition(event);
    const moveDistance = Math.sqrt(
        Math.pow(pos.clientX - touchStartPos.x, 2) +
        Math.pow(pos.clientY - touchStartPos.y, 2)
    );

    // Only trigger click if it was a quick tap without much movement
    if (touchDuration < TAP_THRESHOLD && moveDistance < MOVE_THRESHOLD) {
        onClick(event);
    }
}

// Event Listeners
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('click', onClick);

// Touch events for mobile
if (isMobile) {
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchend', onTouchEnd, { passive: false });
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    updateCameraForScreenSize();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Handle orientation change on mobile
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        camera.aspect = window.innerWidth / window.innerHeight;
        updateCameraForScreenSize();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }, 100);
});

document.getElementById('reset-btn').addEventListener('click', resetGame);

// Add floating particles for atmosphere
function createParticles() {
    const particleGeometry = new THREE.BufferGeometry();
    // Fewer particles on mobile for performance
    const particleCount = isMobile ? 50 : 100;
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
        positions[i] = (Math.random() - 0.5) * 20;
        positions[i + 1] = Math.random() * 10;
        positions[i + 2] = (Math.random() - 0.5) * 20;
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const particleMaterial = new THREE.PointsMaterial({
        color: 0x667eea,
        size: 0.05,
        transparent: true,
        opacity: 0.6
    });

    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    return particles;
}

// Initialize
createGrid();
createCells();
const particles = createParticles();

// Animation Loop
function animate() {
    requestAnimationFrame(animate);

    controls.update();

    // Rotate particles slowly
    if (particles) {
        particles.rotation.y += 0.0005;
    }

    renderer.render(scene, camera);
}

animate();
