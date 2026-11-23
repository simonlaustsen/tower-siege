# Tower Siege

A two-player, turn-based artillery game for two phones. Each player owns a wooden tower that
**only exists on their own phone**. You can't see the enemy's tower. You aim through the fog and
learn from feedback ("slightly short", "dropped into a gap", "block destroyed"...).

You can play the computer, or a friend on their own phone. Two phones pair directly over Wi-Fi
(WebRTC), with no account and no game server.

```
npm install
npm run dev        # play (also reachable from a phone on your network, but see the note on cameras below)
npm run dev:phone  # same, over https, which phone cameras need to scan QR codes
npm test         # game logic, network layer and balance tests
npm run build
```

## Playing with a friend

Both phones need to be on the same Wi-Fi.

1. One player taps **Host a game**: their phone shows a QR code.
2. The other player points their phone's **normal camera app** at it. It opens the game and joins
   by itself, then shows a QR code of its own.
3. The host taps **Scan their code** and scans that one. You're connected. The host's phone flips a
   coin for who fires first.

When the game ends, **Rematch** starts another on the same connection once both players ask.

The QR code is a *link* (`http://<address>/#join=…`), which is why any camera app opens it. The
code itself sits after the `#`, which browsers never send to a server.

- **Hosting from a computer?** Open the game as `localhost` if you like: a phone can't reach
  "localhost", so the game asks the dev server for the computer's Wi-Fi address and puts that in the
  link. If it can't, or finds the wrong one, there is an address box on the host screen: type the
  `Network:` address that `npm run dev` prints (like `192.168.1.23:5173`).
- **No camera?** Under each code is "send them the link": paste it into any chat app, and tapping it
  on the other phone joins the game. Where you scan, "paste the code instead" accepts a link or a
  bare code, even one wrapped over several lines or with words around it.
- **The host's scan button needs a camera on the host's device.** A computer's webcam works on
  `localhost`. On a phone, cameras only work on https pages: `npm run dev:phone` serves the game over
  https with a self-signed certificate (tap through the browser's warning once). Otherwise paste.
- **Scanned the guest's code with the camera app by mistake?** If the host's game is open in the same
  browser it connects anyway; otherwise a page explains to use **Scan their code** in the game.
- **"Couldn't connect" or timed out?** The guest screen tells you how far it got. Once the two phones
  have found each other it says **"✓ Your phones can see each other"**: the network is fine, and the
  host just has to finish step 3 (tap **Scan their code** and scan the guest's screen, or paste the
  guest's link). Without that tick, the phones are not reaching each other: check you are on the same
  Wi-Fi, not a guest network or VPN. Failures include a **Technical details** section that says what
  each side offered and how far the connection got: include it if you report a problem.
- **Phone can't open the link?** Your computer's firewall may be blocking incoming connections to
  Node (macOS asks the first time: choose Allow). Guest, public and some office Wi-Fi networks also
  stop phones from reaching each other ("client isolation"); a home network or a phone hotspot works.
- **Dropped connection:** the game screen says "Connection lost" within a few seconds and offers
  **Reconnect**, which repeats the two scans. The game carries on exactly where it was: towers,
  turn order and any shot that was in the air. A shot that was sent but not answered is sent
  again, and the defender recognises it and replays its answer rather than applying it twice.

## How it is built

| Folder | What lives there |
|---|---|
| `src/game/` | Pure game logic, no React: physics, towers, materials, feedback, the defender, the bot's planner |
| `src/net/` | `Link` (message pipe), `RtcLink` (WebRTC), pairing codes, `Peer` (one player's side of a match), sessions, `Bot` |
| `src/render/` | Procedural Canvas 2D art: scenery, wooden blocks, cannon, particles (no image files) |
| `src/Root.tsx`, `Game.tsx`, `Pairing.tsx`, `GameCanvas.tsx` | The screens (menu, pairing, game) and the canvas renderer |

**Hidden information.** The attacker sends only `{angle, power}`. The defender's phone resolves the
shot against its own tower and replies with qualitative feedback only. A phone never learns anything
else about the other tower. Tests assert that nothing about the tower leaks into a reply.

**Screen layout.** One scene, always showing your own tower and your own cannon side by side at the
left. The enemy is beyond the fog on the right. Your shots fly right and vanish into the fog; the
enemy's shots emerge from the fog and hit your tower. The shot physics is unchanged (a cannon on the
left, a tower on the right); `src/render/placement.ts` maps it onto the screen, mirroring enemy
shots so they land on the right-hand face of your tower. Tests check that a mirrored hit lands on
exactly the block the physics says was hit.

**Online play.** Everything runs over the small `Link` interface (`src/net/link.ts`). Two things
implement it: a loopback link (used by the bot and the tests) and `RtcLink` (`src/net/rtcLink.ts`),
a WebRTC data channel with a heartbeat so a vanished phone is noticed in seconds.

- `src/net/signaling.ts` squeezes a WebRTC offer or answer into a ~540 character code, and
  `src/net/shareLink.ts` wraps it in a link for the QR code (small enough to scan easily). `src/net/rtc.ts` makes the connection from those codes, using
  only local addresses (no STUN or TURN, nothing leaves the room).
- `src/net/session.ts`: a `RemoteSession` runs the start-of-game handshake (the host says who
  fires first), rematches and reconnects over any `Link`. A `LocalSession` wraps the bot behind the
  same interface so the game screen does not care which it is playing.
- Every message off the wire is validated (`src/net/protocol.ts`); malformed or oversized frames
  are ignored.

**Materials.** Towers are built from a material (`src/game/materials.ts`). Wood is the first
(2 hit points per block). A stone painter is already written (`src/render/stone.ts`) and waiting for
a stone material to be added.

**Peek (dev).** Against the computer, a toggle in the header reveals the enemy tower so you can tune
the feel. It does not exist online: a real opponent's phone could never offer it.

## Balance notes

Tuned with the bot playing itself (see `src/game/botStrategy.test.ts`, which now guards the targets).
Median shots for a bot to bring a tower down, and what moved the needle:

| Setup | Median shots to win | Worst case |
|---|---|---|
| 5x8 tower, 2 hp, falls at 25% left (the first prototype) | 38 | 67 |
| same, but falls at 60% left | 34 | 39 |
| 1 hp per block | 20 | 37 |
| 4x6 tower | 25 | 30 |
| **3x6 tower, 2 hp, falls at 50% left (current)** | **18** | **23** |

Findings:

- **Tower width is the big lever**, then hit points. The collapse threshold and tower height barely
  matter: nothing falls until a whole row is cut, so most of the time goes into digging.
- The current setup gives duels of about 14 rounds (4-5 minutes), a first-mover win rate of about
  55%, and far less luck than the old tower (worst case 23 shots instead of 67).
- Keep 2 hit points: the two-stage "Hit!" then "Block destroyed!" feedback lets a player confirm they
  are on target.
- Ideas if matches should be shorter still: damage that scales with power, splash damage to
  neighbouring planks, or 1 hp blocks. Ideas if the game feels too easy: stone towers with more hp.
