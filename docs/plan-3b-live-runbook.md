# Plan 3b — Bringing Live View up against the real RLC‑823S1 (runbook)

Everything through Plan 3c is code‑complete and tested against mocks. This is the **hands‑on** step: stand up `neolink + go2rtc + an MQTT broker`, point the backend at them, and smoke‑test real video + PTZ. Nothing here can be verified in the dev sandbox — it needs the physical camera.

> **Schema caveat:** neolink's exact TOML fields / subcommands and its docker image tag vary by version. The bottom‑up verification below surfaces any mismatch immediately — treat "verify" steps as the source of truth, and run `neolink --help` / check the [neolink README](https://github.com/QuantumEntangledAndy/neolink) if a field is rejected.

---

## 0. Prerequisites

- **Camera → H.264** on BOTH streams. In the Reolink app/web: *Settings → Display/Encoding → Video → Stream = H.264* for Clear (main) and Fluent (sub). (Browsers won't play H.265 reliably, and go2rtc's `stream.mp4` needs H.264.)
- **Camera UID** — 16 chars, on the sticker, or Reolink app → *Device Info → UID*.
- **Camera admin password.**
- A host with **Docker + outbound internet** (the relay path dials Reolink's servers — the host does **not** need to be on the camera's LAN, and no port‑forwarding).

---

## 1. Media stack — bring it up and verify bottom‑up (independent of the app)

Create a `live/` dir with these files.

**`live/mosquitto.conf`**
```
listener 1883
allow_anonymous true
```

**`live/neolink.toml`**
```toml
bind = "0.0.0.0"
bind_port = 8554

[mqtt]
broker_addr = "mosquitto"
port = 1883
# credentials = ["user", "pass"]   # only if the broker requires auth

[[cameras]]
name = "cam1"                # RTSP path becomes /cam1 (see §2 for the app: name = the profile UUID)
uid = "YOUR_CAMERA_UID"
username = "admin"
password = "YOUR_CAMERA_PASSWORD"
discovery = "relay"          # UID via Reolink relay — no LAN/port-forward needed
stream = "mainStream"        # H.264 main stream
```

**`live/go2rtc.yaml`**
```yaml
streams:
  cam1: rtsp://neolink:8554/cam1
```

**`docker-compose.live.yml`**
```yaml
services:
  mosquitto:
    image: eclipse-mosquitto:2
    volumes: ["./live/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro"]
    ports: ["1883:1883"]
    restart: unless-stopped
  neolink:
    image: quantumentangledandy/neolink:latest   # verify the current tag
    depends_on: [mosquitto]
    volumes: ["./live/neolink.toml:/etc/neolink.toml:ro"]
    command: ["rtsp", "--config", "/etc/neolink.toml"]
    ports: ["8554:8554"]
    restart: unless-stopped
  go2rtc:
    image: alexxit/go2rtc:latest
    depends_on: [neolink]
    volumes: ["./live/go2rtc.yaml:/config/go2rtc.yaml:ro"]
    ports: ["1984:1984", "8555:8555/tcp", "8555:8555/udp"]
    restart: unless-stopped
```

Bring it up:
```bash
docker compose -f docker-compose.live.yml up -d
```

Now verify **each layer, bottom to top** — do NOT skip; this is how you isolate any failure:

**1a. neolink → camera (RTSP).**
```bash
docker compose -f docker-compose.live.yml logs -f neolink   # expect "connected"/"logged in" to the camera
ffprobe -rtsp_transport tcp rtsp://localhost:8554/cam1        # or open this URL in VLC → live video
```
✅ If you see the stream, neolink↔camera↔relay works. ❌ If not → §4.

**1b. go2rtc → neolink.** Open **`http://<host>:1984`** (go2rtc UI) — `cam1` should list and play. Then test the **exact endpoint the backend proxies**:
```bash
# open in a browser (should play), or:
curl -s http://<host>:1984/api/streams
```
Open `http://<host>:1984/api/stream.mp4?src=cam1` in a browser → video. ✅ go2rtc↔neolink works.

**1c. PTZ over MQTT (the part your camera physically does).**
```bash
docker exec $(docker compose -f docker-compose.live.yml ps -q mosquitto) \
  mosquitto_pub -t 'neolink/cam1/control/ptz' -m 'left 32'    # camera should pan left
docker exec $(docker compose -f docker-compose.live.yml ps -q mosquitto) \
  mosquitto_pub -t 'neolink/cam1/control/ptz' -m 'stop'
```
✅ If the camera moves, neolink's MQTT + PTZ path works (this is exactly what the backend publishes). ❌ If not → §4. (Commands: `up|down|left|right|in|out (amount)`, and `stop`.)

**Once 1a–1c pass, the hard part is done** — the app just consumes these.

---

## 2. Wire the app

The backend proxies `GO2RTC_URL/api/stream.mp4?src=<profile-id>` and publishes PTZ to `neolink/<profile-id>/control/ptz`. So **the neolink camera `name` and the go2rtc stream key must equal the app's camera‑profile UUID.**

1. In the app, create (or open) the camera profile for this camera and copy its **id** (a UUID) — e.g. from the URL `/profiles/<UUID>` or `GET /api/camera-profiles`.
2. In `live/neolink.toml` set `name = "<UUID>"`; in `live/go2rtc.yaml` use `"<UUID>": rtsp://neolink:8554/<UUID>`. Restart:
   ```bash
   docker compose -f docker-compose.live.yml up -d --force-recreate neolink go2rtc
   ```
   (Re‑run the §1c MQTT test with the UUID topic to confirm.)
3. Point the **backend** at the services — set in its env (ESO secret / `.env`):
   ```
   GO2RTC_URL=http://<host>:1984
   MQTT_URL=mqtt://<host>:1883
   ```
   Restart the backend.
4. In the frontend: open the camera → **Live view** → the `<video>` should play the live feed. Click PTZ buttons (as the **owner or a manage‑grantee**) → the camera moves. A **view‑grantee gets a "need manage permission" message** — that's correct.

---

## 3. App‑side follow‑ups to make this permanent (not hand‑wired)

These are tracked gaps from Plan 3a's review — do them so config isn't maintained by hand:

1. **`LiveConfigService.neolinkConfig()`** currently emits only `bind`/`[[cameras]]`. Add per camera: `discovery = "relay"`, `stream = "mainStream"`, and a top‑level **`[mqtt]` block** derived from `MQTT_URL` (host/port). Without the `[mqtt]` block neolink never subscribes, so **PTZ is a no‑op** until this lands. Add a unit test asserting the `[mqtt]` block + `discovery` appear.
2. **Config write + reload:** generate `neolink.toml`/`go2rtc.yaml` to a shared volume and reload the two services when a profile is added/edited/removed (today the service generates strings on demand but nothing writes/reloads them).
3. **Deploy as k8s pods** (kustomize) alongside `api`/`web` for the fleet, or keep this compose for a single host. neolink+go2rtc are internal‑only; only the backend reaches them.
4. Optional: switch the live player from proxied `stream.mp4` (progressive, ~1–2 s latency) to **WebRTC** (go2rtc `/api/webrtc`, sub‑second) — needs go2rtc's media port reachable (its own auth or a tunnel), a bigger change.

---

## 4. Troubleshooting

- **neolink won't connect** (§1a fails): double‑check the UID + password; confirm the host has outbound internet (relay needs it); the RLC‑823 supports relay so `discovery = "relay"` is right; watch `logs -f neolink` for the specific error (bad credentials vs. can't‑reach‑relay).
- **Plays in VLC but not the browser** (§1b or app): codec — the stream is H.265, not H.264. Fix the camera encoding (§0). go2rtc's `stream.mp4` requires H.264.
- **PTZ does nothing** (§1c fails): confirm the MQTT topic's camera name matches neolink's `name`; confirm neolink's `[mqtt]` block points at the broker and neolink logs show the command received; confirm the camera model supports PTZ (823S1 does). Try a bigger amount (`left 64`).
- **App live view blank but §1b works:** the backend can't reach go2rtc — check `GO2RTC_URL` is reachable from the backend process/container; check the backend logs for the proxy fetch error.
- **403 on PTZ in the UI:** you're a view‑grantee; use the owner account or grant yourself `manage`.
- **Session expiry on the `<video>`:** if the live view shows "couldn't load" after a long idle, your login cookie expired — reload the page (the media `src` can't auto‑redirect like the API calls do).

---

**Bottom line:** get §1a–1c green first (that's neolink + your camera + PTZ, fully independent of this app). Everything after that is just pointing the already‑built backend/frontend at `http://host:1984` and `mqtt://host:1883`.
