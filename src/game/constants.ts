// All values are in "world units". y points UP, y = 0 is the ground surface.

export const WORLD_W = 1000
export const WORLD_H = 600
/** Distance (world units) from the bottom of the view up to the ground surface. */
export const GROUND_MARGIN = 60

export const GRAVITY = 420
export const MAX_SPEED = 700// muzzle speed at 100% power
export const SIM_DT = 1 / 240 // fixed physics timestep
export const MAX_SIM_STEPS = 240 * 12 // safety cap: 12 seconds of flight
export const PATH_SAMPLE_EVERY = 2 // keep every n-th step for rendering

/** A 160° sweep: from 70° below the horizon (a dive) up to straight up. */
export const MIN_ANGLE = -70
export const MAX_ANGLE = 90
export const MIN_POWER = 10
export const MAX_POWER = 100

export const SLING_X = 90
/** Height of the slingshot's fork above the ground: where the ball is released from. */
export const SLING_Y = 100
/** Pulling the pouch back this far (world units) is full power. */
export const MAX_PULL = 80
export const PROJECTILE_RADIUS = 6

// Tower shape and the collapse rule were tuned by simulation (bot vs bot, see the
// balance notes in the README): a slim 3x6 tower that falls at half strength gives
// matches of about 14 rounds (~4-5 min), a fair first-mover edge (~54%) and far
// less luck than the old 5x8 tower that fell at 25% (about 38 shots to win, up to 67).
// Block hit points live with the material (see materials.ts).
export const TOWER_COLS = 3
export const TOWER_ROWS = 6
export const BLOCK_SIZE = 30
export const TOWER_WIDTH = TOWER_COLS * BLOCK_SIZE
export const TOWER_HEIGHT = TOWER_ROWS * BLOCK_SIZE
/** The tower is considered collapsed when this fraction (or less) of its blocks remain. */
export const COLLAPSE_REMAINING_FRACTION = 0.5

/** Random tower placement range (left edge of the tower). */
export const TOWER_MIN_X = 600
export const TOWER_MAX_X = 780

/** Landing within this distance before the tower counts as "slightly short". */
export const NEAR_MISS_DISTANCE = 110
/** Clearing the top of the tower by less than this counts as "just over". */
export const NEAR_OVER_CLEARANCE = 45
/** Passing this far above the tower top (or still rising) counts as "too high". */
export const HIGH_CLEARANCE = 150

/** In shot-physics coordinates, a shot of yours leaves your screen (off the right edge) at this x. */
export const VIEW_EDGE_X = 430

// ---- Screen layout ----
// Your own tower stands at the left with your slingshot right beside it; the enemy lies
// beyond the right edge of the screen. Shot physics always runs from a slingshot at SLING_X to a
// tower at its secret `tower.x`; these numbers place that physics onto the screen.
/** Screen x of the left edge of your own tower. */
export const MY_TOWER_X = 30
/** Shift from shot-physics x to screen x for shots you fire. */
export const ATTACK_OFFSET = 120
export const SLING_SCREEN_X = SLING_X + ATTACK_OFFSET
export const VIEW_EDGE_SCREEN_X = VIEW_EDGE_X + ATTACK_OFFSET
/** Width of the screen on a real game: just enough that a shot of yours flies out of the right edge. */
export const VIEW_W = VIEW_EDGE_SCREEN_X + PROJECTILE_RADIUS
