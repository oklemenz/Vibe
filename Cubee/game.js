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
    this.dashTimeLeft = 0;       // remaining dash burst time
    this.dashCooldownLeft = 0;   // remaining cooldown before next dash
    this.dashDir = 1;            // -1 left, +1 right
    this.dashGhostTimer = 0;     // countdown to next afterimage spawn
    this.facing = 1;             // last horizontal facing direction

    // Attack state.
    this.isAttacking = false;
    this.fireballs = [];         // active fireball sprites in flight
    this.fireCooldownLeft = 0;   // remaining lockout before next airborne/crouched shot

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

  // Play an animation only if it isn't already the current one, so loops
  // aren't restarted every frame.
  setAnim(key) {
    if (this.player.anims.currentAnim && this.player.anims.currentAnim.key === key) return;
    this.player.play(key);
  }

  // Screen-space rects {left, right, top} for every solid-pillar instance near
  // the view. Pillars are authored in the layer-4 texture (source px) and that
  // texture repeats every SRC_TILE_W, so we scan the current tile plus its two
  // neighbours (k = -1,0,1) to catch a pillar straddling either view edge as it
  // scrolls in or out. worldScroll is unbounded; the ±1 tile scan handles it
  // without pre-reducing it modulo the period.
  activePillarRects() {
    const s = PILLAR_TILE_SCALE;
    const rects = [];
    for (let k = -1; k <= 1; k++) {
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

    // --- Dash: start on Ctrl, only while airborne (jumping), off cooldown --
    if (dashJust && this.isJumping && !this.isDashing && this.dashCooldownLeft <= 0 && !crouchBusy) {
      this.isDashing = true;
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
