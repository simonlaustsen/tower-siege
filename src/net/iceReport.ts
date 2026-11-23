/**
 * A plain-language summary of a WebRTC connection attempt, for when it fails. Pairing problems are
 * almost always about the network between two devices, which nobody can see: so a failure should say
 * what each side offered and how far the connection got.
 */

export interface CandidateSummary {
  total: number
  udp: number
  tcp: number
  /** Addresses hidden behind a `something.local` name (browsers do this for privacy). */
  hidden: number
  /** Real numeric addresses. */
  numeric: number
  ipv6: number
}

/** Counts the connection candidates (the addresses a device offers) in a session description. */
export function summarizeSdp(sdp: string | undefined | null): CandidateSummary {
  const summary: CandidateSummary = { total: 0, udp: 0, tcp: 0, hidden: 0, numeric: 0, ipv6: 0 }
  for (const line of (sdp ?? '').split(/\r?\n/)) {
    const match = /^a=candidate:\S+ \d+ (\S+) \d+ (\S+) \d+ typ /i.exec(line)
    if (!match) continue
    const [, protocol, address] = match
    summary.total++
    if (/^udp$/i.test(protocol)) summary.udp++
    else summary.tcp++
    if (/\.local$/i.test(address)) summary.hidden++
    else summary.numeric++
    if (address.includes(':')) summary.ipv6++
  }
  return summary
}

const describe = (name: string, s: CandidateSummary) =>
  s.total === 0
    ? `${name}: no addresses at all`
    : `${name}: ${s.total} (${s.udp} udp, ${s.hidden} hidden by name, ${s.numeric} numeric${s.ipv6 ? `, ${s.ipv6} ipv6` : ''})`

/** What to show someone (or paste to a developer) after a failed attempt. */
export function describeConnection(pc: Pick<RTCPeerConnection, 'connectionState' | 'iceConnectionState' | 'iceGatheringState' | 'localDescription' | 'remoteDescription'>): string[] {
  const lines = [
    `Connection: ${pc.connectionState}, ICE: ${pc.iceConnectionState}, gathering: ${pc.iceGatheringState}`,
    describe('This device offered', summarizeSdp(pc.localDescription?.sdp)),
    pc.remoteDescription
      ? describe('The other device offered', summarizeSdp(pc.remoteDescription.sdp))
      : "The other device's code was never received",
  ]
  const hint = diagnose(pc)
  return hint ? [...lines, `Likely cause: ${hint}`] : lines
}

/** A best guess at why the attempt failed, from the facts above. */
function diagnose(pc: Pick<RTCPeerConnection, 'iceConnectionState' | 'localDescription' | 'remoteDescription'>): string | null {
  if (!pc.remoteDescription) return 'the other phone never completed its half of the pairing (the second scan or paste).'
  const mine = summarizeSdp(pc.localDescription?.sdp)
  const theirs = summarizeSdp(pc.remoteDescription.sdp)
  if (mine.udp === 0) return 'this device found no network address to offer. Is it connected to Wi-Fi?'
  if (theirs.udp === 0) return 'the other device offered no network address. Is it connected to Wi-Fi?'
  if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
    // The devices found each other; what is missing is the last step of the handshake.
    return "the devices can reach each other, but the connection was never completed. That usually means the host never entered this phone's code (the second scan or paste)."
  }
  if (pc.iceConnectionState === 'checking' || pc.iceConnectionState === 'failed') {
    return 'both sides offered addresses but could not reach each other. Different Wi-Fi networks, a guest network, a VPN, or a firewall are the usual reasons.'
  }
  return null
}
