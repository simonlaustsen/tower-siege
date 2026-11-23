import { CANNON_X, TOWER_WIDTH } from './game/constants'
import { TEAMS, type Team } from './game/teams'
import { RULER_END, RULER_START, type TowerEstimate } from './game/rangeFinder'

/** One of your shots, as a mark on the ruler. */
export interface RangeShot {
  n: number
  /** Where it lands when nothing is in the way (physics x). */
  landing: number
  /** What it did: fell short of the tower, flew over it, touched it, or broke something. */
  result: 'short' | 'over' | 'hit' | 'big'
}

interface Props {
  estimate: TowerEstimate
  shots: RangeShot[]
  /** Where a shot with the current angle and power would land on open ground. */
  aim: number
  /** It is your turn: the aim marker is live. */
  active: boolean
  /** The enemy's colour, for the zone where their tower is. */
  enemy: Team
}

// The ruler is drawn in its own small coordinate space, sized so the text is readable on a phone.
const W = 360
const PAD = 14
const LEFT = PAD
const RIGHT = W - PAD
const LINE_Y = 70
const BAND_TOP = 40
const metres = (x: number) => Math.round(x - CANNON_X)
const SPAN = RULER_END - RULER_START
const at = (x: number) => LEFT + (Math.min(RULER_END, Math.max(RULER_START, x)) - RULER_START) * ((RIGHT - LEFT) / SPAN)

/**
 * "Where is the enemy?", answered without ever seeing the enemy tower. The shaded zone is where its
 * tower can be, worked out from the rules plus what each of your shots earned (see rangeFinder.ts);
 * the numbered marks are where your shots came down; the marker above the ruler is where the shot you
 * are lining up would come down. Put that marker inside the zone.
 */
export default function RangeFinder({ estimate, shots, aim, active, enemy }: Props) {
  const from = at(estimate.lo)
  const to = at(estimate.hi + TOWER_WIDTH)
  const narrow = estimate.hi - estimate.lo
  const lockedOn = narrow <= 30
  const zone = `${metres(estimate.lo)}–${metres(estimate.hi + TOWER_WIDTH)}`
  const ticks: number[] = []
  for (let d = 0; d <= SPAN; d += 100) ticks.push(d)
  const aimX = at(aim)
  const aimInZone = aim >= estimate.lo - 6 && aim <= estimate.hi + TOWER_WIDTH
  const label = lockedOn
    ? `The enemy tower is almost pinned down, about ${metres(estimate.lo)} to ${metres(estimate.hi + TOWER_WIDTH)} metres away.`
    : `The enemy tower is somewhere between ${zone} metres away.`

  return (
    <section
      className="rangefinder"
      aria-label="Range finder"
      style={{ '--enemy-rgb': TEAMS[enemy].rgb, '--enemy-light': TEAMS[enemy].light } as React.CSSProperties}
    >
      <div className="rf-head">
        <h2>Where is {TEAMS[enemy].name}?</h2>
        <span className={`rf-zone${lockedOn ? ' locked' : ''}`}>
          {lockedOn ? '🎯 ' : ''}
          {zone} m away
        </span>
      </div>
      <svg viewBox={`0 0 ${W} 94`} role="img" aria-label={label} className="rf-svg">
        {/* where the enemy tower can be */}
        <rect x={from} y={BAND_TOP} width={Math.max(4, to - from)} height={LINE_Y - BAND_TOP} rx="4" className={`rf-band${lockedOn ? ' locked' : ''}`} />
        <text x={(from + to) / 2} y={BAND_TOP + 17} textAnchor="middle" className="rf-band-text">
          {TEAMS[enemy].name.toUpperCase()}
        </text>

        {/* the ruler */}
        <line x1={LEFT} x2={RIGHT} y1={LINE_Y} y2={LINE_Y} className="rf-line" />
        {ticks.map((d) => (
          <g key={d}>
            <line x1={at(RULER_START + d)} x2={at(RULER_START + d)} y1={LINE_Y} y2={LINE_Y + (d % 200 === 0 ? 7 : 4)} className="rf-line" />
            {d % 200 === 0 && d > 0 && (
              <text x={at(RULER_START + d)} y={LINE_Y + 18} textAnchor="middle" className="rf-tick">
                {d}
              </text>
            )}
          </g>
        ))}
        <text x={LEFT} y={LINE_Y + 18} textAnchor="start" className="rf-tick">
          you
        </text>

        {/* where each of your shots came down */}
        {shots.map((s) => (
          <g key={s.n} className={`rf-shot ${s.result}`}>
            <circle cx={at(s.landing)} cy={LINE_Y} r="7.5" />
            <text x={at(s.landing)} y={LINE_Y + 3.5} textAnchor="middle">
              {s.n}
            </text>
          </g>
        ))}

        {/* where the shot you are lining up would come down */}
        <g className={`rf-aim${active ? '' : ' idle'}${aimInZone ? ' inside' : ''}`}>
          <line x1={aimX} x2={aimX} y1="16" y2={LINE_Y - 9} />
          <path d={`M${aimX - 6} 8 L${aimX + 6} 8 L${aimX} 17 Z`} />
        </g>
      </svg>
      <p className="rf-caption">
        {shots.length === 0
          ? 'The ▼ shows where your current aim would come down. Get it into the enemy zone.'
          : lockedOn
            ? 'Almost pinned down: aim the ▼ at the enemy zone.'
            : 'Aim the ▼ into the enemy zone. Shots that fall short or fly over shrink it.'}
      </p>
      {shots.length > 0 && (
        <p className="rf-legend" aria-hidden="true">
          <span className="short">short</span>
          <span className="over">over</span>
          <span className="hit">hit</span>
        </p>
      )}
    </section>
  )
}
