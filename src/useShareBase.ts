import { useCallback, useEffect, useState } from 'react'
import { isLocalHostname, normalizeBase, pickLanAddress } from './net/shareLink'

const STORAGE_KEY = 'tower-siege-address'

export interface ShareBase {
  /** The address to put in a link, so that the link works on another phone. */
  base: string
  /** This page is on "localhost", which no other phone can reach: an address has to be supplied. */
  needsAddress: boolean
  /** What the player typed (or what was found automatically). */
  address: string
  setAddress: (value: string) => void
  /** The address is good enough to build a working link from. */
  valid: boolean
  /** The address came from the dev server rather than being typed. */
  detected: boolean
}

const here = () => `${location.origin}${import.meta.env.BASE_URL}`

function load(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return '' // storage can be blocked (private browsing)
  }
}

/**
 * The address to put in share links. On a real address this is just where the page is. On
 * "localhost" (developing on a computer) a phone could never reach that, so the dev server is asked
 * for the computer's Wi-Fi address, and the player can type one if that fails.
 */
export function useShareBase(): ShareBase {
  const local = isLocalHostname(location.hostname)
  const [address, setAddressState] = useState(() => (local ? load() : ''))
  const [detected, setDetected] = useState(false)

  useEffect(() => {
    if (!local || address) return
    let cancelled = false
    fetch('/__lan', { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ addresses?: string[] }>)
      .then(({ addresses }) => {
        const ip = pickLanAddress(addresses ?? [])
        if (ip && !cancelled) {
          setAddressState(location.port ? `${ip}:${location.port}` : ip)
          setDetected(true)
        }
      })
      .catch(() => {}) // not running under the dev server: the player can type it
    return () => {
      cancelled = true
    }
  }, [local, address])

  const setAddress = useCallback((value: string) => {
    setAddressState(value)
    setDetected(false)
    try {
      localStorage.setItem(STORAGE_KEY, value)
    } catch {
      // not worth worrying about
    }
  }, [])

  if (!local) return { base: here(), needsAddress: false, address: '', setAddress, valid: true, detected: false }
  const normalized = normalizeBase(address, location.protocol, import.meta.env.BASE_URL)
  return { base: normalized ?? here(), needsAddress: true, address, setAddress, valid: normalized !== null, detected }
}
