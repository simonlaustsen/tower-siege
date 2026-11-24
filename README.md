# Tower Siege

A two-player, turn-based artillery game for two phones. Each player owns a wooden tower that
**only exists on their own phone**. You can't see the enemy's tower, only a pointer to where it is.
You learn from feedback ("slightly short", "dropped into a gap", "block destroyed"...).

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
- **Technical details say "hid their Wi-Fi address behind a '.local' name"?** Browsers hide a phone's
  Wi-Fi address behind a random `.local` name, and some networks don't let phones look those up, so
  the connection never starts. That is why the game asks to use the camera while pairing: with
  camera access browsers share the real address instead (nothing is recorded; the camera is off again
  as soon as the addresses are collected). Allow it on **both** phones.
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

**Screen layout.** One scene, always showing just your own tower and your own cannon side by side.
The enemy is off the right edge of the screen, marked with an "ENEMY" arrow. Your shots fly right and
leave the screen; the enemy's shots arrive from the right edge and hit your tower.

**Teams and turn halo.** The host is **blue**, the guest **red** (against the computer you are blue), so
two screens side by side can be told apart even though both play left to right. Each phone draws its own
tower flag, cannon banner and shot trails in its team colour and the enemy in the other, and a soft halo
around the battlefield glows in the colour of whoever's turn it is: the same colour on both phones.
The halo itself never moves; when the turn changes a blurred glow spreads in from it towards the
middle a short way, mostly just fading out (about 0.8 s), as the signal.

**Callouts.** After each shot a few big words pop up over the battlefield in a bold, playful font
(Lilita One, bundled with the app so it works offline): "Way short!", "A bit short!", "Just over!",
"Hit!", "Smash!", "Timber!"; and for the enemy's shots on you "Phew!", "Close one!", "Ouch!"
(`src/game/shout.ts`). The longer hint ("Add a little power") stays as one line under the battlefield.
There is no shot log any more: the range finder shows where each shot came down, and hovering a mark
shows its angle and power.

**Range finder.** Under the scene, a ruler (metres from your cannon) shows a shaded zone where the
enemy tower can be. It is worked out from the rules (a tower stands 510-780 m away) and what your
shots earned: a hint like "slightly short" or "just over the top" rules distances out
(`src/game/rangeFinder.ts`). It never sees the tower, and a test checks the real tower always stays
inside the zone. Your shots appear on the ruler where they came down (grey short, purple over, gold
hit), and a ▼ shows where your current angle and power would come down, so you can line it up with the
zone. The same metres are marked on the ground in the scene. The shot physics is unchanged (a cannon on the
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
| 3x6 solid tower, 2 hp, falls at 50% left | 18 | 23 |
| **random timber frame (current): 10-18 beams, 3 hp, two rotten 1 hp beams** | **16** | **25** |

**Timber-frame towers.** Every game builds a different tower (`generateTower` in `src/game/tower.ts`):
a 3x6 frame with open bays, every beam held up from the ground, and **two rotten beams** with 1 hit
point where the rest have 3. Rotten beams are picked where more rests on them, so one hit on a soft spot
brings its part of the tower down (but never the whole tower: a rotten beam alone cannot win the game).
They look grey and mossy, so you can see where your own tower is weak. Collapse is judged against how
many beams that tower started with. Tests check the frames always stand, are varied, and that a hit on a
soft spot costs far more than a hit on a sound beam.

Findings:

- **Tower width is the big lever**, then hit points. The collapse threshold and tower height barely
  matter: nothing falls until a whole row is cut, so most of the time goes into digging.
- The current setup gives duels of about 11 rounds (3-4 minutes), a first-mover win rate of about
  51%, and little luck (worst case about 25 shots, best about 4: finding a soft spot is the shortcut).
- Sound beams take 3 hits, and the blocks show three stages (new, cracked, nearly broken), so a player
  can confirm they are on target before it gives way.
- Ideas if matches should be shorter still: damage that scales with power, splash damage to
  neighbouring planks, or 1 hp blocks. Ideas if the game feels too easy: stone towers with more hp.
