# Camera & SD-card field notes (Reolink RLC-823S1)

Hardware/firmware behavior discovered while running this project against a real
Reolink RLC-823S1 — the non-obvious things you'd otherwise rediscover the hard
way. This is about the *camera*, not the app code.

## Unit under test

- **Model:** RLC-823S1
- **Hardware rev:** `IPC_NT18NA68MP`
- **Firmware:** `v3.2.0.5511_25101331` — the latest published for this hardware
  rev as of 2026-07. Note: the public Download Center and the community firmware
  archive only carried older or different-hardware paks, so there is currently
  no newer firmware to flash for this revision.

## SD card: 256 GB is unreliable, 128 GB is stable

**Symptom:** a 256 GB card mounts and records fine *initially*, then drops out —
the camera reports no card / recording silently stops — after minutes-to-hours
under continuous write load. A 128 GB card runs indefinitely under the same load.

**Evidence:**
- SanDisk Extreme Pro **128 GB**: survived **14 h+** of continuous recording with
  no drop.
- Samsung PRO Endurance **256 GB**: dropped repeatedly in the camera, yet passed
  **H2testw** full write+verify on a PC — i.e. the card is physically flawless.
  The fault is the **camera + 256 GB combination**, not the card.

**Likely root cause:** Reolink cameras format the card **FAT32**. FAT32's large
allocation tables on a 256 GB volume appear to stress the firmware's card
handling under sustained writes; smaller cards → smaller FAT structures → stable.
This is a known Reolink issue with larger cards, with **no firmware fix**, and
Reolink's own support recommends using a smaller-capacity card.

**Workarounds:**
- Use a **128 GB (or smaller)** card. Proven stable here.
- Prefer **high-endurance surveillance** cards (Samsung PRO Endurance, WD Purple,
  SanDisk High/Max Endurance) for 24/7 write longevity.
- Optional/unverified: partition a larger card down to ~32–64 GB and format FAT32
  (Windows' built-in tool caps FAT32 at 32 GB — use guiformat/Rufus). This *may*
  work if the camera honors the smaller partition rather than re-reading the
  card's physical capacity — treat it as a coin-flip, untested here.

## Recording length: post-record duration is ignored (firmware bug)

Motion/event recordings are capped to the ~5-second detection window **regardless
of the post-record setting** (confirmed at 30 s and 1 min → still ~5 s), on both
SD event recording and FTP motion upload. This is widely reported for Reolink.

**Continuous recording is unaffected** — it doesn't use post-record — so for
full-length footage, use **continuous mode**: it produces gapless ~5-minute
chunks on the SD card.

## Codec: force H.264

At 4K (3840×2160) this model is **H.265-only**, which browsers and go2rtc's
`stream.mp4` cannot play — so live view and in-browser recording playback break.
Set the main stream to **2560×1440 H.264** for the app to work. (4K H.264 is not
offered on this model.) If you only ever view in the Reolink app, 4K/H.265 is fine.

## FTP vs SD recording (this project's context)

- The camera writes recordings over **plain FTP** — new Hetzner Storage Boxes run
  SFTPGo and are plain-FTP-only (no FTPS); the app reads them back over **SFTP**.
- **FTP continuous recording has ~50–70 s gaps** between chunks: the camera
  records a file, then uploads it serially and does not record during the upload
  (worse on high-RTT links). **SD continuous recording is gapless.**
- Practical split: **SD** for gapless continuous coverage; **FTP** as a
  lightweight offsite motion-clip backup (set it to the main/"Nítido" stream so
  the backup clips are actually usable).
