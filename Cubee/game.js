// Each animation lives in animations/<name>/ as its own spritesheet.png,
// 8 frames laid out horizontally. Frame width and height vary per
// animation; values mirror each folder's metadata.json.
const ANIMS = {
  idle:      { frame_w: 56, frame_h: 111, frame_count: 8, fps: 8,  loop: true },
  walk:      { frame_w: 62, frame_h: 111, frame_count: 8, fps: 10, loop: true },
  run:       { frame_w: 90, frame_h: 111, frame_count: 8, fps: 14, loop: true },
  jump_up:   { frame_w: 72, frame_h: 111, frame_count: 8, fps: 12, loop: false },
  jump_down: { frame_w: 72, frame_h: 111, frame_count: 8, fps: 12, loop: false },
  attack:    { frame_w: 79, frame_h: 106, frame_count: 8, fps: 16, loop: false },
  fire:      { frame_w: 41, frame_h: 23,  frame_count: 8, fps: 12, loop: true  },
  crouch:    { frame_w: 56, frame_h: 111, frame_count: 8, fps: 14, loop: false },
  standup:   { frame_w: 69, frame_h: 111, frame_count: 8, fps: 14, loop: false },
  // Enemy walk cycle, its thrown water-drop projectile, and its death anim.
  enemy:     { frame_w: 64, frame_h: 64,  frame_count: 8, fps: 10, loop: true  },
  water:     { frame_w: 32, frame_h: 32,  frame_count: 8, fps: 12, loop: true  },
  enemy_die: { frame_w: 64, frame_h: 64,  frame_count: 8, fps: 10, loop: false },
};

const GAME_W = 800;
const GAME_H = 400;
// Fraction of the background image height where the sidewalk/street surface is
// (the top edge of the pavement curb the buildings sit on). The player's feet
// rest on this line so Cubee walks along the street.
const GROUND_FRAC = 0.84;
const GROUND_Y = Math.round(GAME_H * GROUND_FRAC);   // walking surface, in world px

const WALK_SPEED = 160;         // px / second
const RUN_SPEED = 420;          // px / second

// Parallax scroll factors per layer, back (1) → front (4). The world scroll
// offset (advanced when Cubee walks/runs/dashes) is multiplied by these to get
// each layer's tile scroll, so nearer layers slide faster and give depth.
// Layer 4 == 1.0 moves in lockstep with the player's ground speed.
const PARALLAX = [0.2, 0.45, 0.7, 1.0];
// The pavement Cubee (and the enemy) walk on is the front-most layer (index 3).
// Its on-screen scroll per unit of worldScroll is PARALLAX[3] * tileScale, so a
// sprite "planted" on the pavement must shift by that amount — NOT by the raw
// worldScroll, which is ~1/tileScale too large (that mismatch made the enemy
// appear to double/stall relative to the pavement).
const PAVEMENT_LAYER = 3;
const JUMP_VELOCITY = -520;     // initial upward velocity (px/s)
const GRAVITY = 1400;           // px/s^2
const MAX_JUMPS = 2;            // ground jump + one air (double) jump

const DASH_SPEED = 1000;        // px / second during a dash
const DASH_DURATION = 0.32;     // seconds the dash burst lasts
const DASH_COOLDOWN = 0.35;     // seconds before another dash is allowed
const DASH_GHOST_INTERVAL = 0.02; // seconds between afterimage spawns
const DASH_GHOST_FADE = 0.35;   // seconds each afterimage takes to fade out
const DASH_GHOST_ALPHA = 0.6;  // starting opacity of each afterimage
const DASH_GHOST_DRIFT = 90;    // px each afterimage lags behind as it fades
const FIREBALL_SPEED = 460;     // px / second the fireball travels
const FIREBALL_Y_OFFSET = 60;   // height above feet where it spawns
const FIREBALL_MUZZLE = 34;     // px in front of the player it spawns
// Minimum time between shots when airborne/crouched (where there's no attack
// animation to gate repeats). Matches the fire anim length (8 frames @ 12 fps).
const FIRE_COOLDOWN = 8 / 12;   // seconds

// --- Enemy ----------------------------------------------------------------
// One enemy at a time walks in from the right edge and heads left toward Cubee
// (who is pinned at screen centre). The enemy is PLANTED on the pavement layer
// (see pavementScroll()): it rides the street as the world scrolls and walks
// along it at a constant ground pace, so its speed over the pavement doesn't
// change with the kid's scrolling. It ignores the solid pillars.
const ENEMY_SPEED = 90;            // px / second the enemy walks along the pavement
const ENEMY_SCALE = 1.4;           // scale up the 64px art so it reads at Cubee's size
const ENEMY_HIT_HALF_W = 22;       // half-width of the enemy's collision box
const ENEMY_SPAWN_MIN = 1.5;       // seconds min before (re)spawning an enemy
const ENEMY_SPAWN_MAX = 3.5;       // seconds max before (re)spawning an enemy
const ENEMY_THROW_MIN = 1.2;       // seconds min between water-drop throws
const ENEMY_THROW_MAX = 2.6;       // seconds max between water-drop throws
const ENEMY_DROP_SPEED = 260;      // px / second the water drop flies toward Cubee
const ENEMY_DROP_Y_OFFSET = 40;    // height above the enemy's feet the drop leaves from
const PLAYER_HIT_HALF_W = 18;      // half-width of Cubee's hurt box
const PLAYER_HIT_TOP = 100;        // px above the feet the hurt box reaches
const HIT_INVULN = 1.2;            // seconds of invulnerability after taking a hit

// --- Solid pillars (in the layer-4 background art) ------------------------
// Layer 4 scrolls in lockstep (PARALLAX == 1.0). Its source texture is 2095px
// wide and tiles horizontally, so a source pixel sx shows on screen at
// (sx - worldScroll) * tileScale, wrapping every 2095 source px. Two pillars
// authored in that texture become solid: they block Cubee horizontally, can be
// jumped over, and stood on. Because the texture repeats, the pillars recur
// every tile as the world scrolls.
const SRC_TILE_W = 2095;                 // layer-4 texture width (px) — the repeat period
const PILLAR_TILE_SCALE = GAME_H / 768;  // matches the bgLayers tileScale (0.5208)
// Each pillar in SOURCE px: horizontal span [x0,x1] and top-surface y.
const PILLARS_SRC = [
  { x0: 118,  x1: 186,  topY: 529 },     // left pillar
  { x0: 1854, x1: 1914, topY: 530 },     // right pillar
];
const PLAYER_HALF_W = 20;                // tight ~40px collision box around the fixed x=400

class MainScene extends Phaser.Scene {
  constructor() {
    super('main');
  }

  preload() {
    // Four parallax layers, back (1) to front (4). Layer 1 is the opaque
    // sky/backdrop; 2–4 are transparent overlays composited on top. Each tiles
    // horizontally (repeating pattern) so the world can scroll forever.
    for (let i = 1; i <= 4; i++) {
      this.load.image(`bg${i}`, `background/background-layer${i}.png`);
    }
    for (const [name, cfg] of Object.entries(ANIMS)) {
      this.load.spritesheet(name, `animations/${name}/spritesheet.png`, {
        frameWidth: cfg.frame_w,
        frameHeight: cfg.frame_h,
      });
    }
    // Life icon for the HUD, drawn at its original resolution.
    this.load.image('life', 'img/life.png');
  }

  create() {
    // --- Background (parallax) ------------------------------------------
    // Four tiling layers stacked back→front, each filling the whole world.
    // They never move on screen; instead their tilePositionX scrolls as the
    // world offset advances, so the street streams past while Cubee walks in
    // place. Each layer scrolls at its own PARALLAX factor for depth.
    // The source art is 2095×768 with sidewalk at GROUND_FRAC; we scale each
    // layer's tile so that authored height maps onto GAME_H (keeps the ground
    // line aligned) and fill the 800×400 view fully.
    this.bgLayers = [];
    const srcH = 768;
    const tileScale = GAME_H / srcH;   // fit authored height into the view
    this.tileScale = tileScale;        // saved so world sprites (enemy) can match layer scroll
    for (let i = 1; i <= 4; i++) {
      const layer = this.add.tileSprite(0, 0, GAME_W, GAME_H, `bg${i}`)
        .setOrigin(0, 0)
        .setDepth(i - 1);              // 0..3, all below the player (depth 10)
      layer.setTileScale(tileScale, tileScale);
      this.bgLayers.push(layer);
    }

    // World scroll offset in px; walking/running/dashing advances it and the
    // parallax layers read from it each frame.
    this.worldScroll = 0;

    // --- Animations -----------------------------------------------------
    for (const [name, cfg] of Object.entries(ANIMS)) {
      this.anims.create({
        key: name,
        frames: this.anims.generateFrameNumbers(name, { start: 0, end: cfg.frame_count - 1 }),
        frameRate: cfg.fps,
        repeat: cfg.loop ? -1 : 0,   // looping anims repeat forever; one-shots play once
      });
    }

    // --- Player ---------------------------------------------------------
    this.player = this.add.sprite(GAME_W / 2, GROUND_Y, 'idle');
    this.player.setOrigin(0.5, 1); // feet on the ground line
    this.player.setDepth(10);      // above scenery; dash ghosts sit just below
    this.player.play('idle');

    // --- HUD: lives (top-left) ------------------------------------------
    // Three life icons (life.png) drawn at original resolution, pinned to the
    // top-left corner. setScrollFactor(0) keeps them fixed on screen, and a
    // high depth keeps them above everything. this.lives tracks the count;
    // refreshLives() shows/hides icons to match.
    this.maxLives = 3;
    this.lives = this.maxLives;
    const LIFE_TEX = this.textures.get('life').getSourceImage();
    const LIFE_W = LIFE_TEX.width;            // original resolution
    const LIFE_PAD = 6;                       // gap between icons
    const LIFE_X0 = 10, LIFE_Y0 = 8;          // top-left margin
    this.lifeIcons = [];
    for (let i = 0; i < this.maxLives; i++) {
      const icon = this.add.image(LIFE_X0 + i * (LIFE_W + LIFE_PAD), LIFE_Y0, 'life')
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(1000);
      this.lifeIcons.push(icon);
    }

    // --- HUD: score (top-right) -----------------------------------------
    // Score is awarded for defeating enemies (+100 per kill); shown as a
    // zero-padded number in a pixel font, right-aligned in the top-right
    // corner. Starts at 0 and resets with the game.
    this.score = 0;
    this.scoreText = this.add.text(GAME_W - 10, 10, '', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '16px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    })
      .setOrigin(1, 0)         // right-aligned to the top-right margin
      .setScrollFactor(0)
      .setDepth(1000);
    this.refreshScore();

    // Clear the attacking flag when the (non-looping) attack anim ends.
    // Advance the crouch state machine as its transition anims finish.
    this.player.on('animationcomplete', (anim) => {
      if (anim.key === 'attack') this.isAttacking = false;
      if (anim.key === 'crouch') {
        // Reached the bottom of the crouch: hold crouched if Down is still
        // held, otherwise stand right back up.
        this.crouchState = (this.cursors.down.isDown || this.touch.crouchHeld) ? 'crouched' : 'standing';
        if (this.crouchState === 'standing') this.player.play('standup');
      }
      if (anim.key === 'standup') {
        this.crouchState = 'none'; // fully upright again
      }
    });

    // Jump physics state, handled manually (no arcade physics needed).
    this.velocityY = 0;
    this.isJumping = false;
    this.jumpsUsed = 0;          // how many jumps since last grounded

    // Dash state.
    this.isDashing = false;
    this.dashUsed = false;       // a dash was spent this airborne stretch; blocks re-dashing until landing
    this.dashTimeLeft = 0;       // remaining dash burst time
    this.dashCooldownLeft = 0;   // remaining cooldown before next dash
    this.dashDir = 1;            // -1 left, +1 right
    this.dashGhostTimer = 0;     // countdown to next afterimage spawn
    this.facing = 1;             // last horizontal facing direction

    // Attack state.
    this.isAttacking = false;
    this.fireballs = [];         // active fireball sprites in flight
    this.fireCooldownLeft = 0;   // remaining lockout before next airborne/crouched shot

    // --- Enemy state ----------------------------------------------------
    // At most one enemy exists at a time. `enemy` is the live sprite (or null).
    // The enemy and its water drops are PLANTED on the pavement layer via
    // `worldX` (screen x = worldX - pavementScroll()), so they ride the street
    // as it scrolls and move along it at a constant pace independent of the
    // scrolling the kid causes. `waterDrops` are its in-flight projectiles.
    // Timers drive (re)spawning and throwing; `enemyDying` guards the death anim
    // so it can't be re-triggered.
    this.enemy = null;
    this.enemyDying = false;
    this.waterDrops = [];
    this.enemySpawnTimer = this.randRange(ENEMY_SPAWN_MIN, ENEMY_SPAWN_MAX);
    this.enemyThrowTimer = 0;
    this.hitInvulnLeft = 0;      // invulnerability window after being hit
    this.pendingReset = false;   // set on death; the full reset is applied next frame

    // Crouch state machine: 'none' (upright), 'crouching' (playing crouch),
    // 'crouched' (held down), 'standing' (playing standup). While not 'none'
    // the figure must finish standing up before it can walk/run/jump/etc.
    this.crouchState = 'none';

    // --- Input ----------------------------------------------------------
    this.cursors = this.input.keyboard.createCursorKeys();
    this.shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.dashKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);
    this.attackKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // --- Touch controls (invisible screen-zone D-pad, à la FlashbackJS) --
    // Held state (movement/run) plus one-frame "pressed" edges (jump/dash/
    // attack) that mirror keyboard JustDown. Pointer coords come in already
    // mapped to the 0..GAME_W / 0..GAME_H space under Scale.FIT.
    this.touch = {
      left: false, right: false, running: false, crouchHeld: false,
      jumpPressed: false, dashPressed: false, attackPressed: false, crouchPressed: false,
    };
    this.input.addPointer(3); // allow several simultaneous touches

    const onPointer = (pointer, isDown) => {
      if (isDown) this.handleTouchPress(pointer);
      this.refreshTouchHold();
    };
    this.input.on('pointerdown', (p) => onPointer(p, true));
    this.input.on('pointermove', (p) => onPointer(p, false));
    this.input.on('pointerup', (p) => onPointer(p, false));
    this.input.on('pointerupoutside', (p) => onPointer(p, false));
  }

  // Classify a pointer position into a control zone.
  //   top band            -> jump (shortened)
  //   middle band flanks  -> walk/run (bigger, taller band)
  //   middle band center  -> attack / fire
  //   bottom-left/right    -> dash
  //   bottom-center        -> crouch
  touchZone(x, y) {
    const fx = x / GAME_W, fy = y / GAME_H;
    if (fy < 0.32) return { jump: true };                  // top band = jump (smaller)
    if (fy > 0.80) {                                        // bottom row
      if (fx < 0.30) return { dash: true };                // bottom-left  = dash
      if (fx > 0.70) return { dash: true };                // bottom-right = dash
      return { crouch: true };                             // bottom-middle = crouch
    }
    // wide middle band (0.32–0.80) → movement on the flanks, attack in the center
    if (fx < 0.18) return { left: true, running: true };   // far left = run
    if (fx < 0.38) return { left: true };                  // inner left = walk
    if (fx > 0.82) return { right: true, running: true };  // far right = run
    if (fx > 0.62) return { right: true };                 // inner right = walk
    return { attack: true };                               // center = attack / fire
  }

  // Edge action on a fresh press (jump / dash / attack).
  handleTouchPress(pointer) {
    const z = this.touchZone(pointer.x, pointer.y);
    if (z.jump) this.touch.jumpPressed = true;
    if (z.dash) this.touch.dashPressed = true;
    if (z.attack) this.touch.attackPressed = true;
    if (z.crouch) this.touch.crouchPressed = true;
  }

  // Recompute held movement/run from every currently-down pointer, so a
  // finger held in a walk/run zone keeps Cubee moving (and multi-touch works).
  refreshTouchHold() {
    let left = false, right = false, running = false, crouchHeld = false;
    for (const p of this.input.manager.pointers) {
      if (!p.isDown) continue;
      const z = this.touchZone(p.x, p.y);
      if (z.left) { left = true; if (z.running) running = true; }
      if (z.right) { right = true; if (z.running) running = true; }
      if (z.crouch) crouchHeld = true;
    }
    this.touch.left = left;
    this.touch.right = right;
    this.touch.running = running;
    this.touch.crouchHeld = crouchHeld;
  }

  // Spawn a fading, semi-transparent clone of the player at its current
  // pose/position — the dash "tail". Each ghost tweens its alpha to zero
  // then destroys itself.
  spawnDashGhost() {
    const ghost = this.add.sprite(this.player.x, this.player.y, this.player.texture.key);
    ghost.setOrigin(this.player.originX, this.player.originY);
    ghost.setFrame(this.player.frame.name);
    ghost.setFlipX(this.player.flipX);
    ghost.setAlpha(DASH_GHOST_ALPHA);
    ghost.setTint(0x9fd8ff); // cool tint so the trail reads as motion
    ghost.setDepth(this.player.depth - 1); // behind the real sprite
    // Drift opposite the dash direction so the afterimage lags behind the kid
    // (the kid holds screen center while the world scrolls, so a static ghost
    // would just sit on top of the sprite instead of trailing it).
    this.tweens.add({
      targets: ghost,
      alpha: 0,
      x: ghost.x - this.dashDir * DASH_GHOST_DRIFT,
      duration: DASH_GHOST_FADE * 1000,
      ease: 'Quad.easeOut',
      onComplete: () => ghost.destroy(),
    });
  }

  // Launch a fireball projectile from the player's hands, flying in the
  // facing direction with the looping fire animation. When crouched the muzzle
  // sits lower so the shot leaves the crouched hands rather than mid-air.
  spawnFireball(dir, crouched = false) {
    const x = this.player.x + dir * FIREBALL_MUZZLE;
    const y = this.player.y - (crouched ? FIREBALL_Y_OFFSET * 0.5 : FIREBALL_Y_OFFSET);
    const ball = this.add.sprite(x, y, 'fire');
    ball.setOrigin(0.5, 0.5);
    ball.setDepth(this.player.depth + 1); // in front of the player
    ball.setFlipX(dir < 0);               // point the way it travels
    ball.play('fire');
    ball.vx = FIREBALL_SPEED * dir;
    this.fireballs.push(ball);
  }

  // Random float in [min, max).
  randRange(min, max) {
    return min + Math.random() * (max - min);
  }

  // Screen-space scroll offset of the pavement layer, in screen px. A sprite
  // planted on the pavement at world position worldX appears at
  // worldX - pavementScroll(). This matches how the layer-4 tile art actually
  // moves on screen (tilePositionX is texture-space and drawn at tileScale).
  pavementScroll() {
    return this.worldScroll * PARALLAX[PAVEMENT_LAYER] * this.tileScale;
  }

  // Spawn a single enemy just off the right edge, facing/walking left toward
  // Cubee. The enemy is planted on the PAVEMENT layer: `worldX` is its position
  // along the street, and screen x = worldX - pavementScroll(), so it rides the
  // pavement exactly as it scrolls. On top of that it walks left at a constant
  // ENEMY_SPEED along the pavement — its pace over the street is independent of
  // the scrolling the kid causes.
  spawnEnemy() {
    const spawnScreenX = GAME_W + 60;
    const e = this.add.sprite(spawnScreenX, GROUND_Y, 'enemy');
    e.setOrigin(0.5, 1);          // feet on the ground line, like the player
    e.setDepth(9);                // just below Cubee (depth 10)
    e.setScale(ENEMY_SCALE);
    e.setFlipX(true);             // face left (walking toward the kid)
    e.play('enemy');
    e.worldX = spawnScreenX + this.pavementScroll();   // plant on the pavement at this spot
    this.enemy = e;
    this.enemyDying = false;
    this.enemyThrowTimer = this.randRange(ENEMY_THROW_MIN, ENEMY_THROW_MAX);
  }

  // Enemy hurls a water drop toward Cubee. Like the enemy, the drop is planted
  // on the PAVEMENT layer: `worldX` is its position along the street and screen
  // x = worldX - pavementScroll(), so it rides the pavement as it scrolls. Its
  // velocity is aimed at the kid's world position (screen centre + scroll, torso
  // height) at throw time, so it flies a straight line over the street toward
  // where the kid is standing — independent of the scrolling the kid causes.
  throwWaterDrop() {
    if (!this.enemy || this.enemyDying) return;
    const sx = this.enemy.x;
    const sy = this.enemy.y - ENEMY_DROP_Y_OFFSET;
    const worldX = sx + this.pavementScroll();     // start position on the pavement
    // Target in the same world/pavement frame as worldX.
    const targetWorldX = GAME_W / 2 + this.pavementScroll();
    const targetY = GROUND_Y - 50;                 // aim at Cubee's torso
    const dx = targetWorldX - worldX, dy = targetY - sy;
    const len = Math.hypot(dx, dy) || 1;
    const drop = this.add.sprite(sx, sy, 'water');
    drop.setOrigin(0.5, 0.5);
    drop.setDepth(9);
    drop.play('water');
    drop.vx = (dx / len) * ENEMY_DROP_SPEED;       // pavement-space velocity (px/s)
    drop.vy = (dy / len) * ENEMY_DROP_SPEED;
    drop.worldX = worldX;
    drop.setFlipX(drop.vx < 0);                    // mirror when flying right→left
    this.waterDrops.push(drop);
  }

  // Cubee took a hit: drop a life, start the invulnerability window, and flag a
  // full reset once lives run out. The reset is deferred (applied at the start
  // of the next update) so we never wipe the enemy/projectile arrays while a
  // collision loop is still iterating them.
  loseLife() {
    if (this.hitInvulnLeft > 0 || this.pendingReset) return;  // invulnerable / already resetting
    this.lives -= 1;
    this.refreshLives();
    this.hitInvulnLeft = HIT_INVULN;
    if (this.lives <= 0) {
      this.pendingReset = true;
    }
  }

  // Full reset: destroy enemy/projectiles, restore lives and score, and put the
  // world back to the start. Called when all lives are lost.
  resetGame() {
    if (this.enemy) { this.enemy.destroy(); this.enemy = null; }
    this.enemyDying = false;
    for (const d of this.waterDrops) d.destroy();
    this.waterDrops = [];
    for (const b of this.fireballs) b.destroy();
    this.fireballs = [];
    this.lives = this.maxLives;
    this.refreshLives();
    this.score = 0;
    this.refreshScore();
    this.worldScroll = 0;
    for (let i = 0; i < this.bgLayers.length; i++) {
      this.bgLayers[i].tilePositionX = 0;
    }
    this.hitInvulnLeft = 0;
    this.pendingReset = false;
    // Return Cubee to a clean grounded idle pose — death can occur mid-jump,
    // mid-dash, or crouched, so clear all transient movement/action state and
    // put the feet back on the ground line.
    this.player.setAlpha(1);
    this.player.y = GROUND_Y;
    this.velocityY = 0;
    this.isJumping = false;
    this.jumpsUsed = 0;
    this.isDashing = false;
    this.dashUsed = false;
    this.dashTimeLeft = 0;
    this.dashCooldownLeft = 0;
    this.isAttacking = false;
    this.fireCooldownLeft = 0;
    this.crouchState = 'none';
    this.player.play('idle');
    this.enemySpawnTimer = this.randRange(ENEMY_SPAWN_MIN, ENEMY_SPAWN_MAX);
  }

  // A player fireball hit the enemy: switch to the (non-looping) die animation,
  // stop it moving/attacking, and remove it once the animation finishes. The
  // next enemy is scheduled to spawn after the usual random delay.
  killEnemy() {
    if (!this.enemy || this.enemyDying) return;
    this.enemyDying = true;
    const dying = this.enemy;
    dying.play('enemy_die');
    dying.once('animationcomplete', () => {
      dying.destroy();
      if (this.enemy === dying) this.enemy = null;
      this.enemyDying = false;
      this.enemySpawnTimer = this.randRange(ENEMY_SPAWN_MIN, ENEMY_SPAWN_MAX);
    });
    // Score reward for a kill.
    this.score += 100;
    this.refreshScore();
  }

  // Play an animation only if it isn't already the current one, so loops
  // aren't restarted every frame.
  setAnim(key) {
    if (this.player.anims.currentAnim && this.player.anims.currentAnim.key === key) return;
    this.player.play(key);
  }

  // Show exactly this.lives icons in the HUD (hide the rest). Call after
  // changing this.lives.
  refreshLives() {
    for (let i = 0; i < this.lifeIcons.length; i++) {
      this.lifeIcons[i].setVisible(i < this.lives);
    }
  }

  // Render the current score as a zero-padded number. Call after changing
  // this.score.
  refreshScore() {
    this.scoreText.setText(String(Math.floor(this.score)).padStart(6, '0'));
  }

  // Screen-space rects {left, right, top} for every solid-pillar instance near
  // the view. Pillars are authored in the layer-4 texture (source px) and that
  // texture repeats every SRC_TILE_W, so we scan the tile currently under the
  // view plus its two neighbours to catch a pillar straddling either view edge
  // as it scrolls in or out. worldScroll is unbounded, so we can't scan a fixed
  // window around tile 0 — instead we derive the base tile index from
  // worldScroll (which tile's origin sits nearest the left view edge) and scan
  // baseTile-1..baseTile+1 around it. This makes collision respect ALL repeats,
  // not just the handful near source origin.
  activePillarRects() {
    const s = PILLAR_TILE_SCALE;
    const rects = [];
    // Tile index whose origin (k*SRC_TILE_W) is just left of the view's left
    // edge in source px. worldScroll is in source px (screen = (sx-scroll)*s).
    const baseTile = Math.floor(this.worldScroll / SRC_TILE_W);
    for (let k = baseTile - 1; k <= baseTile + 1; k++) {
      const shift = k * SRC_TILE_W - this.worldScroll;
      for (const p of PILLARS_SRC) {
        const left = (p.x0 + shift) * s;
        const right = (p.x1 + shift) * s;
        if (right >= -40 && left <= GAME_W + 40) {
          rects.push({ left, right, top: p.topY * s });
        }
      }
    }
    return rects;
  }

  update(time, delta) {
    const dt = delta / 1000;
    const left = this.cursors.left.isDown || this.touch.left;
    const right = this.cursors.right.isDown || this.touch.right;
    const running = this.shiftKey.isDown || this.touch.running;

    if (this.dashCooldownLeft > 0) this.dashCooldownLeft -= dt;
    if (this.fireCooldownLeft > 0) this.fireCooldownLeft -= dt;

    // Read each edge trigger exactly once — Phaser's JustDown() consumes the
    // just-pressed flag, so calling it twice in a frame swallows the input.
    const upJust = Phaser.Input.Keyboard.JustDown(this.cursors.up) || this.touch.jumpPressed;
    const downJust = Phaser.Input.Keyboard.JustDown(this.cursors.down) || this.touch.crouchPressed;
    const dashJust = Phaser.Input.Keyboard.JustDown(this.dashKey) || this.touch.dashPressed;
    const attackJust = Phaser.Input.Keyboard.JustDown(this.attackKey) || this.touch.attackPressed;

    // --- Crouch state machine (grounded only) ---------------------------
    const downHeld = this.cursors.down.isDown || this.touch.crouchHeld;
    // Commands that require the figure to be upright first. Shooting (attack)
    // is intentionally excluded: Cubee can fire from a crouch without rising.
    const wantsToMove = left || right || upJust || dashJust;

    if (!this.isJumping) {
      if (this.crouchState === 'none') {
        // Begin crouching on Down press when otherwise idle.
        if (downJust && !this.isAttacking && !this.isDashing) {
          this.crouchState = 'crouching';
          this.player.play('crouch');
        }
      } else if (this.crouchState === 'crouched') {
        // Stand up when Down is released, Up is pressed, or any other action
        // is requested (must stand before walking/running/jumping).
        if (!downHeld || upJust || wantsToMove) {
          this.crouchState = 'standing';
          this.player.play('standup');
        }
      }
    }
    // While crouching/crouched/standing, suppress all other actions & motion.
    const crouchBusy = this.crouchState !== 'none';

    // --- Jump: first jump from ground, one extra jump in mid-air --------
    if (upJust && this.jumpsUsed < MAX_JUMPS && !crouchBusy) {
      this.isJumping = true;
      this.jumpsUsed += 1;
      this.velocityY = JUMP_VELOCITY;
      // Restart jump_up even if already airborne so the double jump reads.
      this.player.play('jump_up');
    }

    // --- Dash: start on Ctrl -------------------------------------------------
    // Allowed either (a) while airborne — one dash per airborne stretch, gated
    // by dashUsed (cleared on touchdown) — or (b) on the ground while moving in
    // a held direction (walking OR running), for a fast forward burst; the
    // ground dash is gated only by the cooldown. A held direction is required so
    // a standing Ctrl press doesn't dash in place.
    const airDashOk = this.isJumping && !this.dashUsed;
    const groundDashOk = !this.isJumping && (left || right);
    if (dashJust && (airDashOk || groundDashOk) && !this.isDashing && this.dashCooldownLeft <= 0 && !crouchBusy) {
      this.isDashing = true;
      if (this.isJumping) this.dashUsed = true;   // consume the single air-dash
      this.dashTimeLeft = DASH_DURATION;
      this.dashCooldownLeft = DASH_COOLDOWN;
      this.dashGhostTimer = 0;
      // Dash in the held direction, else the direction currently faced.
      this.dashDir = (left && !right) ? -1 : (right && !left) ? 1 : this.facing;
      this.player.setFlipX(this.dashDir < 0);
    }

    // --- Attack / shoot: fire on Space --------------------------------------
    // Upright on the ground: play the attack animation and shoot; the animation
    // gates repeats until it finishes. Airborne or crouched: shoot a fireball
    // only, keeping the current pose (jump / crouch) — no attack animation and,
    // for a crouch, no standing up. Since there's no animation to gate repeats
    // in those poses, a fire cooldown enforces the same "wait between shots".
    const airborneOrCrouched = this.isJumping || crouchBusy;
    const canFire = airborneOrCrouched ? this.fireCooldownLeft <= 0 : !this.isAttacking;
    if (attackJust && canFire) {
      // Face the held direction if any, else keep current facing.
      if (left && !right) this.facing = -1;
      else if (right && !left) this.facing = 1;
      this.player.setFlipX(this.facing < 0);
      // Attack pose only when upright and grounded; otherwise start the fire
      // cooldown so the next airborne/crouched shot must wait.
      if (!airborneOrCrouched) this.isAttacking = true;
      else this.fireCooldownLeft = FIRE_COOLDOWN;
      this.spawnFireball(this.facing, crouchBusy);
    }

    // One-frame touch edges are consumed above (mirroring JustDown); clear
    // them now, before any early return, so a tap fires exactly once.
    this.touch.jumpPressed = false;
    this.touch.dashPressed = false;
    this.touch.attackPressed = false;
    this.touch.crouchPressed = false;

    // --- Move any in-flight fireballs, cull off-screen ------------------
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const b = this.fireballs[i];
      b.x += b.vx * dt;
      if (b.x < -b.width || b.x > GAME_W + b.width) {
        b.destroy();
        this.fireballs.splice(i, 1);
      }
    }

    // --- Horizontal movement --------------------------------------------
    // Cubee walks "in place": instead of sliding across the screen, movement
    // advances the world scroll offset and the parallax layers stream past.
    // Positive worldScroll == the world has moved left (Cubee heading right).
    let moving = false;
    let scrollDelta = 0;   // px the world advances this frame (signed by facing)

    if (this.isDashing) {
      // Dash overrides normal horizontal control with a fixed burst.
      scrollDelta = DASH_SPEED * this.dashDir * dt;
      this.dashTimeLeft -= dt;

      // Emit afterimages at a steady interval for the trailing effect.
      this.dashGhostTimer -= dt;
      if (this.dashGhostTimer <= 0) {
        this.spawnDashGhost();
        this.dashGhostTimer = DASH_GHOST_INTERVAL;
      }

      if (this.dashTimeLeft <= 0) this.isDashing = false;
    } else if (this.isAttacking) {
      // While attacking, arrow keys only re-aim (set facing) — no sliding.
      if (left && !right) { this.facing = -1; this.player.setFlipX(true); }
      else if (right && !left) { this.facing = 1; this.player.setFlipX(false); }
    } else if (crouchBusy) {
      // Crouching / standing up — stay put until upright again.
    } else {
      const speed = running ? RUN_SPEED : WALK_SPEED;
      if (left && !right) {
        scrollDelta = -speed * dt;
        this.facing = -1;
        this.player.setFlipX(true);   // face left
        moving = true;
      } else if (right && !left) {
        scrollDelta = speed * dt;
        this.facing = 1;
        this.player.setFlipX(false);  // face right
        moving = true;
      }
    }

    // --- Solid-pillar horizontal blocking -------------------------------
    // Clamp scrollDelta so the world can't advance past the point where the
    // player's fixed screen box would penetrate a pillar's side. A pillar only
    // acts as a WALL when the feet are below its top (player.y > top); once
    // Cubee is up on / over the top it's a floor, not a wall, so it can walk
    // across. scrollDelta > 0 == heading right == pillars slide left on screen
    // by scrollDelta * s, so the max world advance that keeps the box flush is
    // gap / s (gap in screen px). A pillar only blocks motion TOWARD it: one on
    // the player's right blocks rightward travel, one on the left blocks
    // leftward — so turning around and walking away is never blocked.
    if (scrollDelta !== 0) {
      const s = PILLAR_TILE_SCALE;
      const cx = GAME_W / 2;              // player centre (fixed)
      const pLeft = cx - PLAYER_HALF_W;
      const pRight = cx + PLAYER_HALF_W;
      for (const r of this.activePillarRects()) {
        if (this.player.y <= r.top) continue;         // over the top: not a wall
        const pillarCx = (r.left + r.right) / 2;
        if (scrollDelta > 0 && pillarCx > cx && r.right > pLeft) {
          // Pillar to the right: its left edge may not cross the player's right.
          const gap = Math.max(0, r.left - pRight);
          scrollDelta = Math.min(scrollDelta, gap / s);
        } else if (scrollDelta < 0 && pillarCx < cx && r.left < pRight) {
          // Pillar to the left: its right edge may not cross the player's left.
          const gap = Math.max(0, pLeft - r.right);
          scrollDelta = Math.max(scrollDelta, -gap / s);
        }
      }
    }

    // Advance the world and scroll every parallax layer by its own factor.
    if (scrollDelta !== 0) {
      this.worldScroll += scrollDelta;
      for (let i = 0; i < this.bgLayers.length; i++) {
        this.bgLayers[i].tilePositionX = this.worldScroll * PARALLAX[i];
      }
    }

    // --- Enemy: spawn, walk, throw, collide -----------------------------
    // Runs every frame (before the jump early-return below) so enemies keep
    // moving and attacking while Cubee is airborne.
    if (this.pendingReset) {
      // A hit dropped the last life on a previous frame; apply the full reset
      // now, at a safe point, before touching any enemy/projectile arrays.
      this.resetGame();
      return;
    }
    if (this.hitInvulnLeft > 0) this.hitInvulnLeft -= dt;

    if (!this.enemy) {
      // No enemy alive: count down and spawn the next one.
      this.enemySpawnTimer -= dt;
      if (this.enemySpawnTimer <= 0) this.spawnEnemy();
    } else if (!this.enemyDying) {
      // Walk left along the pavement at a constant pace (ENEMY_SPEED), then place
      // the sprite at worldX - pavementScroll() so it rides the pavement layer as
      // it scrolls. Because pavementScroll() uses the layer's real on-screen
      // scroll (PARALLAX * tileScale), the enemy stays glued to the street and
      // its walking pace over the street is independent of the kid's scrolling.
      this.enemy.worldX -= ENEMY_SPEED * dt;
      this.enemy.x = this.enemy.worldX - this.pavementScroll();

      // Throw water drops from time to time — but only when the enemy is on
      // screen AND the kid is IN FRONT of it. The enemy faces left, so "in front"
      // means the kid (screen centre) is to its left, i.e. the enemy is to the
      // right of centre but still within the view. Once the kid slips behind
      // (enemy passes screen centre) it stops shooting rather than firing
      // backwards, and it never shoots from off-screen. The timer still counts
      // down so it throws promptly when a target is back in view.
      this.enemyThrowTimer -= dt;
      const onScreen = this.enemy.x <= GAME_W;
      const kidInFront = this.enemy.x > GAME_W / 2;
      if (this.enemyThrowTimer <= 0 && onScreen && kidInFront) {
        this.throwWaterDrop();
        this.enemyThrowTimer = this.randRange(ENEMY_THROW_MIN, ENEMY_THROW_MAX);
      }

      // Despawn once the enemy leaves the view on EITHER side, then schedule the
      // next spawn. It normally exits left (walking past Cubee), but if the kid
      // travels left fast the pavement scroll can carry the enemy back off the
      // right edge — cull both so it can never get stuck off-screen (which would
      // block new spawns and keep it throwing from out of view).
      if (this.enemy.x < -80 || this.enemy.x > GAME_W + 80) {
        this.enemy.destroy();
        this.enemy = null;
        this.enemySpawnTimer = this.randRange(ENEMY_SPAWN_MIN, ENEMY_SPAWN_MAX);
      } else {
        // Touch damage: enemy box overlapping Cubee's hurt box costs a life.
        // While dashing, Cubee is intangible and passes safely through the
        // enemy (dash is an evasive move); the invulnerability blink after a
        // hit likewise blocks further touch damage until it expires.
        const cx = GAME_W / 2;
        const exOverlap = Math.abs(this.enemy.x - cx) < (ENEMY_HIT_HALF_W + PLAYER_HIT_HALF_W);
        const feetClose = Math.abs(this.enemy.y - this.player.y) < PLAYER_HIT_TOP;
        if (exOverlap && feetClose && !this.isDashing) this.loseLife();

        // Fireball hit: a player fireball reaching the enemy kills it (die anim).
        for (let i = this.fireballs.length - 1; i >= 0; i--) {
          const b = this.fireballs[i];
          if (Math.abs(b.x - this.enemy.x) < ENEMY_HIT_HALF_W &&
              Math.abs(b.y - (this.enemy.y - this.enemy.displayHeight / 2)) < this.enemy.displayHeight / 2) {
            b.destroy();
            this.fireballs.splice(i, 1);
            this.killEnemy();
            break;
          }
        }
      }
    } else {
      // Dying: keep the corpse riding the pavement while the death anim plays.
      this.enemy.x = this.enemy.worldX - this.pavementScroll();
    }

    // --- Water drops: fly toward target, cull, and hit Cubee ------------
    for (let i = this.waterDrops.length - 1; i >= 0; i--) {
      const d = this.waterDrops[i];
      // Advance along the pavement, then place on screen relative to the layer's
      // scroll so the drop rides the pavement exactly like the enemy that threw
      // it (its flight over the street is independent of the kid's scrolling).
      d.worldX += d.vx * dt;
      d.y += d.vy * dt;
      d.x = d.worldX - this.pavementScroll();
      const cx = GAME_W / 2;
      // Dashing makes Cubee intangible — a water drop passes through without a
      // hit (but keeps flying so it can still be dodged/expire normally).
      const hitKid = !this.isDashing &&
        Math.abs(d.x - cx) < (PLAYER_HIT_HALF_W + 12) &&
        d.y > this.player.y - PLAYER_HIT_TOP && d.y < this.player.y;
      const offscreen = d.x < -40 || d.x > GAME_W + 40 || d.y > GAME_H + 40;
      if (hitKid) {
        d.destroy();
        this.waterDrops.splice(i, 1);
        this.loseLife();
        if (this.pendingReset) break;  // resetGame() will clear the array next frame
      } else if (offscreen) {
        d.destroy();
        this.waterDrops.splice(i, 1);
      }
    }

    // Blink Cubee during the invulnerability window as a hit indicator.
    this.player.setAlpha(this.hitInvulnLeft > 0 && Math.floor(this.hitInvulnLeft * 12) % 2 === 0 ? 0.4 : 1);

    // Pillar rects in their post-scroll positions, reused by the vertical
    // (landing / walk-off) logic below.
    const pillars = this.activePillarRects();
    const overlapsX = (r) =>
      (GAME_W / 2 + PLAYER_HALF_W) > r.left && (GAME_W / 2 - PLAYER_HALF_W) < r.right;

    // --- Vertical movement / jump arc -----------------------------------
    if (this.isJumping) {
      const prevY = this.player.y;  // for the anti-tunneling landing test

      // While air-dashing, freeze the fall so the dash reads as a clean
      // forward burst instead of a diagonal drop; gravity resumes after.
      if (this.isDashing) {
        this.velocityY = 0;
      } else {
        this.velocityY += GRAVITY * dt;
        this.player.y += this.velocityY * dt;
      }

      // Switch to the descent animation once we start falling.
      if (this.velocityY >= 0) {
        this.setAnim('jump_down');
      }

      // Landing surface: the ground by default, or a pillar top the feet
      // crossed while descending (highest such top wins). The crossing test
      // (prevY above the top, new y at/below it) prevents tunneling through a
      // thin pillar at speed and handles landing from a double jump too.
      let landY = GROUND_Y;
      let landed = this.player.y >= GROUND_Y;
      if (this.velocityY >= 0) {
        for (const r of pillars) {
          if (overlapsX(r) && prevY <= r.top && this.player.y >= r.top) {
            landY = Math.min(landY, r.top);
            landed = true;
          }
        }
      }

      if (landed) {
        this.player.y = landY;
        this.velocityY = 0;
        this.isJumping = false;
        this.jumpsUsed = 0; // refill jumps on touchdown
        this.dashUsed = false; // allow a fresh dash on the next jump
      }
      return; // jump animations take priority over walk/run/idle
    }

    // --- Walk off a pillar edge -----------------------------------------
    // Grounded and standing on a pillar top: if the world scrolled far enough
    // that no pillar is under the feet anymore, Cubee has stepped off the edge
    // — start falling. (The ground line is infinite, so standing on it never
    // triggers this.) jumpsUsed = 1 so the fall grants one air-jump, not two.
    if (this.player.y < GROUND_Y - 0.5) {
      const stillSupported = pillars.some(
        (r) => overlapsX(r) && Math.abs(this.player.y - r.top) < 1,
      );
      if (!stillSupported) {
        this.isJumping = true;
        this.velocityY = 0;
        this.jumpsUsed = 1;
        this.setAnim('jump_down');
        return;
      }
    }

    // --- Grounded locomotion / action state -----------------------------
    // Crouch transitions own the sprite while active (crouch/standup anims
    // play once, and the final crouch frame is held while crouched), so leave
    // the animation untouched. Otherwise: attack → dash → walk/run → idle.
    if (crouchBusy) {
      // no-op: crouch/standup animation is already driving the sprite
    } else if (this.isAttacking) {
      this.setAnim('attack');
    } else if (this.isDashing) {
      this.setAnim('run');
    } else if (moving) {
      this.setAnim(running ? 'run' : 'walk');
    } else {
      this.setAnim('idle');
    }
  }
}

// Boot Phaser once the pixel font is loaded so HUD text renders in it from the
// first frame (falls back to a timeout if the Font Loading API is unavailable).
function bootGame() {
  window.__game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    pixelArt: true,
    backgroundColor: '#87ceeb',
    // Scale the fixed 800×400 world to fit any screen (desktop or mobile),
    // centered, letterboxed as needed. Pointer coords stay in world space.
    // Fill the whole screen while preserving the 800×400 aspect ratio (letterbox
    // as needed), matching FlashbackJS. Scale.FIT measures the parent — which CSS
    // pins to the full viewport — so expandParent is off to stop Phaser shrinking
    // it back to the game's own size.
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      parent: 'game',
      expandParent: false,
      width: GAME_W,
      height: GAME_H,
    },
    scene: MainScene,
  });
}

if (document.fonts && document.fonts.load) {
  // Kick off the load, then boot on ready (with a safety timeout).
  document.fonts.load('16px "Press Start 2P"').catch(() => {});
  Promise.race([
    document.fonts.ready,
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]).then(bootGame);
} else {
  bootGame();
}
