# AgapSense — Demo Video Script

**Target length:** ~7 minutes · **Format:** screen recording + hardware shots + voice-over
**Audience:** panel / evaluators / prospective barangay and BFP users

> Everything shown below is based on `docs/FEATURES.md` and `docs/FIRMWARE_GUIDE.md`. Features marked *(not shown)* are intentionally left out because they are incomplete or unverified in the repo (e.g. per-user Telegram, placeholder metrics like "System Uptime").

---

## Pre-recording checklist

- [ ] Supabase project running, edge functions deployed, `npm run dev` at `http://localhost:5173`
- [ ] Three accounts ready, **each in its own browser profile/window**: Admin, BFP Responder, Resident (device linked to the Resident)
- [ ] One extra **pending** resident registration waiting for approval (for Scene 5)
- [ ] ESP32 node powered **at least ~150 s before the demo** so `sensor_ready` is true (60 s heat + 90 s measure)
- [ ] Phones in frame: one for the **Telegram station chat**, one for the **SMS** (resident number and BFP number)
- [ ] Safe way to trigger the sensors: lighter/incense near the MQ-7 for CO, hair dryer/heat gun (at a safe distance) for the DS18B20. **Do not use open flame near the electronics.**
- [ ] Optional fallback: lower the thresholds in Alert Settings so the demo trips quickly and safely
- [ ] Browser zoom 110–125 %, notifications muted except for the demo ones, dark mode off for readability

---

## Scene 1 — Cold open / the problem (0:00 – 0:30)

| Visual | Voice-over |
|---|---|
| Quick montage: news-style stock/B-roll of a house fire, then a close-up of the AgapSense node. Title card: **AgapSense — IoT Fire Detection & Response**. | "Every minute counts in a fire. By the time smoke is noticed and someone calls for help, the fire has often already spread. AgapSense is an IoT fire-detection system that senses danger early, alerts the household and the Bureau of Fire Protection at the same time, and tells responders exactly where to go." |

---

## Scene 2 — System overview (0:30 – 1:15)

| Visual | Voice-over |
|---|---|
| Animated architecture diagram (build one slide): **Sensor node → Supabase Edge Functions → Database/Realtime → Web app + Telegram + Web Push + SMS**. | "Each home gets an ESP32-based node with a CO sensor, a temperature sensor, GPS and a GSM modem. The node reports to a Supabase backend over HTTPS. The backend decides how serious the situation is, records an incident, and notifies people through Telegram, web push, and SMS. Residents, BFP responders and administrators each get their own dashboard." |
| Highlight the three role icons: Resident / BFP Responder / Admin. | "Access is role-based and enforced in the database with Row Level Security — a resident only ever sees their own device." |

---

## Scene 3 — The hardware node (1:15 – 2:00)

| Visual | Voice-over |
|---|---|
| Close-up, labelled overlays: **ESP32**, **MQ-7 (CO)**, **DS18B20 (temperature)**, **NEO-6M GPS**, **SIM800L GSM**, **LEDs + buzzer**. | "The node pairs an MQ-7 carbon-monoxide sensor with a DS18B20 temperature sensor. A NEO-6M GPS gives its location, and a SIM800L modem sends SMS even if Wi-Fi is down." |
| Power on the board: boot blink sequence (yellow → red → blue → beep). | "On boot it blinks every indicator so installers can confirm the wiring." |
| Phone: connect to the **AgapSense-Setup** captive portal, pick Wi-Fi, enter password. | "Setup is simple: the node opens a Wi-Fi portal, you choose your network, and it remembers it." |
| Blue LED turns solid. | "Solid blue means it is online. Blinking blue means Wi-Fi is up but the backend is unreachable." |
| Dashboard shows "Initializing sensors…" | "The MQ-7 needs a warm-up cycle, so for the first couple of minutes the app shows 'Initializing sensors' instead of unreliable numbers." |

---

## Scene 4 — Account registration & approval workflow (2:00 – 3:00)

| Visual | Voice-over |
|---|---|
| Browser (logged out): `/register` as a **Resident**. Fill in the form, submit. | "A new resident signs up publicly. Responders can too — but admin accounts can only be created by an admin." |
| Lands on the **Pending Approval** screen. | "Until approved, the user only sees a pending screen. This is a safeguard so that nobody gets access to fire data without being verified." |
| Switch to **Admin** window → **Users** → pending request → **Approve** and assign the device. | "The administrator reviews the request, approves it and assigns the resident's device. Admins can also create pre-approved users directly." |
| Show the login lockout briefly: enter a wrong password 3 times, see the lockout timer. | "Login is protected by progressive lockouts after failed attempts, and idle sessions time out automatically per role." |
| Log in as the new resident → **mandatory first-login setup** (mobile number). | "On first login the resident gives their mobile number, which is where SMS evacuation alerts will go." |

---

## Scene 5 — Resident experience (3:00 – 3:50)

| Visual | Voice-over |
|---|---|
| **Resident Home**: live CO and temperature, status card, Power card (Mains/Battery), last 24 readings. | "The resident home page shows live readings streamed in real time, the device status, and whether the node is on mains or backup battery." |
| Point out the connectivity badge: Online / Reconnecting / Offline. | "A connectivity badge shows whether the device is online, reconnecting, or offline, with the last-seen time." |
| **Alert Settings**: adjust the CO and temperature thresholds, enable Web Push, link Telegram. | "Residents tune their own alert thresholds, enable push notifications, and link Telegram — and the node picks up the new values within minutes, without re-flashing." |
| Briefly show **Device Info** and **System Log**. | "Everything the device has reported is available in the log." |

---

## Scene 6 — Live fire scenario (3:50 – 5:30) ⭐ *main event*

Use a **split-screen**: Resident dashboard · Responder dashboard · Node close-up · Phones (Telegram + SMS).

### 6a. Tier 1 — Warning (3:50 – 4:30)

| Visual | Voice-over |
|---|---|
| Expose the node to **one** trigger only (CO *or* heat). Readings climb past the threshold. | "AgapSense uses a two-tier alert system. Let's raise just one factor — carbon monoxide." |
| Yellow LED lights. Telegram message appears on the phone; web push pops up on the Admin and Responder windows. | "One sensor over its limit is a **Tier 1 warning**. The yellow LED lights, a Telegram message goes to the station chat, and responders get a push notification. No SMS is sent yet, to avoid false alarms." |
| Callout: "3 consecutive readings required". | "To prevent false triggers, a reading must stay over threshold for three consecutive checks before an alert is raised." |

### 6b. Tier 2 — Fire alert (4:30 – 5:30)

| Visual | Voice-over |
|---|---|
| Now expose the node to the **second** trigger. Both values cross their thresholds. | "Now the temperature rises too. Both sensors are over their limits." |
| Red LED + buzzer on the node. Cut to the two SMS arriving on phones. | "That is a **Tier 2 fire alert**. The red LED and buzzer sound locally, and the node sends two SMS messages — a plain-language evacuation message to the resident, and a technical one to the BFP with the device, time, GPS coordinates, address and a Google Maps link." |
| Responder window: audible alarm, new incident at the top of the dashboard; map pin turns **red**. | "On the responder dashboard an alarm sounds, the incident appears instantly, and the device pin turns red on the live map." |
| Show Telegram message with address + map link; tap the link to open navigation. | "The message includes a reverse-geocoded address and a navigation link, so responders know exactly where to go." |
| Brief overlay: backend recomputes the tier. | "Importantly, the backend re-checks the thresholds itself — the device can't just claim a fire. And there is only ever one open incident per device, so repeated reports never create duplicates." |

---

## Scene 7 — Responder workflow: handling the incident (5:30 – 6:20)

| Visual | Voice-over |
|---|---|
| Responder dashboard → click the incident → **Acknowledge**. Status: `active → acknowledged`. | "The responder acknowledges the incident, which everyone sees immediately." |
| Change status to **Responding**. | "Then marks the team as responding." |
| Change status to **Resolved** (or **False alarm**). Pin turns back to green. | "Once the situation is under control, they mark it resolved — or a false alarm. A closed incident is locked and can't be edited afterwards, so the audit trail is trustworthy." |
| **Alert Logs** page: delivery status for Telegram, SMS-owner, SMS-BFP. | "The log records whether each Telegram and SMS message was actually delivered, based on the modem's real result." |
| Admin window: **Device Status** → manual close option; mention auto-resolve. | "If readings return to safe levels, the system can resolve the incident automatically, and admins can also close one manually." |

---

## Scene 8 — Admin & monitoring tools (6:20 – 6:50)

| Visual | Voice-over |
|---|---|
| **Admin Dashboard**: totals, active alerts, devices online. | "Administrators get the big picture: total alerts, active devices, system health." |
| **Interactive Map**: green / amber / red / grey pins, click a pin. | "The live map shows every device: green is normal, amber is a pre-alert or fault, red is fire, and grey is offline." |
| **Devices** page: add a device, show the generated API key, rename, power toggle, firmware version. | "Devices are registered here, each with its own secret key. Admins can regenerate the key, and push firmware updates over the air." |
| **System Log** → export. **Support Requests** inbox. | "Every action is logged and exportable, and users can send support requests straight from the app." |

---

## Scene 9 — Reliability & security recap (6:50 – 7:15)

| Visual | Voice-over |
|---|---|
| Fast bullet-point cards over B-roll: |  |
| • SMS works without Wi-Fi (SIM800L) | "Because alerts must work when things go wrong, SMS works even if the internet is down." |
| • Alert retry with backoff, 30 s watchdog, OTA updates | "The node retries failed alerts, recovers from freezes with a hardware watchdog, and updates itself over the air." |
| • Backup battery with power status | "A backup battery keeps it watching during a power cut." |
| • Row Level Security, device keys, lockouts, idle timeouts | "And security is enforced in the database, not just the interface." |

---

## Scene 10 — Closing (7:15 – 7:30)

| Visual | Voice-over |
|---|---|
| Logo + tagline over the node and the responder map. Team names, school/organization, repo link. | "AgapSense: from the first whiff of smoke to the responder at the door — faster detection, clearer alerts, safer communities. Thank you." |

---

## Production notes

- **Pacing:** speak slowly; the live scenario in Scene 6 is the highlight, so keep cuts tight everywhere else. If the physical trigger takes too long, speed up the ramp-up footage ×4 with an on-screen "time-lapse" label.
- **Backup plan:** pre-record Scene 6 as a take-two in case the sensors or the GSM network don't cooperate on camera. Keep the real SMS screenshots/screen-recording ready as an insert.
- **Privacy:** blur real phone numbers, API keys, Supabase URL/anon key, and any real addresses.
- **Captions:** add subtitles — the Telegram/SMS shots are small and easy to miss.
- **Audio:** record voice-over separately after picture lock; leave 1 s of silence at the start of each scene for easier editing.
- **Not covered on purpose:** per-user Telegram alerts, uptime/latency metrics, and data buffering while offline are incomplete or placeholders today (see Known defects in `docs/FEATURES.md`). If a panelist asks, answer honestly that they are on the roadmap.

## Suggested shot list (for editors)

| # | Shot | Source |
|---|---|---|
| 1 | Hardware node close-ups (all sensors, LEDs, buzzer) | Camera |
| 2 | Captive portal Wi-Fi setup | Phone screen record |
| 3 | Registration → pending → admin approval | Screen record (2 windows) |
| 4 | Resident home + alert settings | Screen record |
| 5 | Tier 1 trigger: node + Telegram + push | Camera + phone + screen |
| 6 | Tier 2 trigger: node + 2 SMS + responder alarm + map | Camera + phones + screen |
| 7 | Incident lifecycle and delivery log | Screen record |
| 8 | Admin dashboard, map, devices, logs | Screen record |
| 9 | Architecture diagram and recap cards | Slides/Figma |
