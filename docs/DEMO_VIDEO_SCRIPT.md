# AgapSense — Demo Video Script

**Target length:** ~7 minutes · **Format:** screen recording + hardware shots + voice-over
**Audience:** panel / evaluators / prospective barangay and BFP users

> Everything shown below is based on `docs/FEATURES.md` and `docs/FIRMWARE_GUIDE.md`. Features that are incomplete or unverified in the repo (e.g. offline data buffering, a GSM data path) are intentionally left out.

---

## Pre-recording checklist

- [ ] Supabase project running, edge functions deployed, `npm run dev` at `http://localhost:5173`
- [ ] Three accounts ready, **each in its own browser profile/window**: Admin, BFP Responder, Resident (device linked to the Resident)
- [ ] One extra **pending** resident registration waiting for approval (for Scene 4)
- [ ] ESP32 node powered **at least a few minutes before the demo** so `sensor_ready` is true (60 s warm-up on the constant-5V build, ~150 s on the duty-cycle build)
- [ ] Phones in frame: one for the **Telegram station chat** (Tier 2 only) and an admin's linked Telegram (Tier 1), one for the **SMS** (resident number and BFP number)
- [ ] Safe way to trigger the sensors: **lower the thresholds first** (Alert Settings or admin Edit device) to just above room readings, then use a hair dryer at a safe distance for the DS18B20 and the smoke of an incense stick held away from the board for the MQ-7. **No open flame near the electronics** (see `HARDWARE_BENCH_TEST.md`).
- [ ] Wait up to 10 minutes after changing thresholds (or reboot the node) so it picks them up
- [ ] Admin → Settings: save the session timeouts once (none apply until saved), so the idle-timeout claim in Scene 4 holds
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
| Phone: connect to the password-protected **AgapSense-Setup** portal, pick Wi-Fi, enter its password (and, on a new unit, the device ID and key). | "Setup is simple: the node opens its own password-protected Wi-Fi portal, the installer chooses the home network, and the node remembers it." |
| Blue LED turns solid. | "Solid blue means it is online. Blinking blue means Wi-Fi is up but the backend is unreachable." |
| Dashboard shows "Warming up" | "The CO sensor needs to warm up, so for about the first minute the app shows 'Warming up' instead of unreliable numbers." |

---

## Scene 4 — Account registration & approval workflow (2:00 – 3:00)

| Visual | Voice-over |
|---|---|
| Browser (logged out): **Register as a resident** (`/register/resident`). Fill in the form, submit. | "A new resident signs up publicly. Responders can too — but admin accounts can only be created by an admin." |
| Lands on the **Pending Approval** screen. | "Until approved, the user only sees a pending screen. This is a safeguard so that nobody gets access to fire data without being verified." |
| Switch to **Admin** window → **Users** → pending request → **Approve** and assign the device. | "The administrator reviews the request, approves it and assigns the resident's device. Admins can also create pre-approved users directly." |
| Show the login lockout briefly: enter a wrong password 3 times, see the lockout timer. | "Login is protected by progressive lockouts after failed attempts, and idle sessions time out automatically per role." |
| Log in as the new resident → **mandatory first-login setup** (mobile number, then the install address and map pin). | "On first login the resident gives their mobile number, which is where SMS evacuation alerts will go, and pins where the device is installed, so responders can find it even without GPS." |

---

## Scene 5 — Resident experience (3:00 – 3:50)

| Visual | Voice-over |
|---|---|
| **Resident Dashboard**: status panel, live CO and temperature with the 24-reading chart, Device Health (Power: Mains / On battery). | "The resident home page shows live readings streamed in real time, the device status, and whether the node is on mains or backup battery." |
| Point out the connectivity badge: Online / Reconnecting / Offline. | "A connectivity badge shows whether the device is online, reconnecting, or offline, with the last-seen time." |
| **Alert Settings**: adjust the CO and temperature levels, SMS number, push notifications, link Telegram. | "Residents tune their own alert thresholds, enable push notifications, and link Telegram — and the node picks up the new values within minutes, without re-flashing." |
| Briefly show **Device Information** and **Alert History**. | "Every alert the device has raised is listed here, with what was sent and when it was resolved." |

---

## Scene 6 — Live fire scenario (3:50 – 5:30) ⭐ *main event*

Use a **split-screen**: Resident dashboard · Admin dashboard (for Tier 1) / Responder dashboard (for Tier 2) · Node close-up · Phones (Telegram + SMS).

### 6a. Tier 1 — Warning (3:50 – 4:30)

| Visual | Voice-over |
|---|---|
| Expose the node to **one** trigger only (CO *or* heat). Readings climb past the threshold. | "AgapSense uses a two-tier alert system. Let's raise just one factor — carbon monoxide." |
| Yellow LED lights. Push pops up in the Admin window and the admin's linked Telegram gets a warning; the resident dashboard turns amber. The responder dashboard stays quiet. | "One sensor over its limit is a **Tier 1 warning**. The yellow LED lights and the administrators are notified so someone can check the site. The fire station isn't called out and no SMS is sent yet, to avoid false alarms." |
| Callout: "3 consecutive readings required". | "To prevent false triggers, a reading must stay over threshold for three consecutive checks before an alert is raised." |

### 6b. Tier 2 — Fire alert (4:30 – 5:30)

| Visual | Voice-over |
|---|---|
| Now expose the node to the **second** trigger. Both values cross their thresholds. | "Now the temperature rises too. Both sensors are over their limits." |
| Red LED + buzzer on the node. Cut to the two SMS arriving on phones. | "That is a **Tier 2 fire alert**. The red LED and buzzer sound locally, and the node sends two SMS messages — a plain-language evacuation message to the resident, and a technical one to the BFP with the device, time, GPS coordinates, address and a Google Maps link." |
| Responder window: audible alarm, new incident at the top of the dashboard; map pin turns **red**. | "On the responder dashboard an alarm sounds, the incident appears instantly, and the device pin turns red on the live map." |
| Show the station-chat Telegram message with address + map link; tap the link to open navigation. Push arrives on the resident's browser too. | "The station's Telegram message includes a reverse-geocoded address and a navigation link, so responders know exactly where to go. The resident also gets a push notification." |
| Brief overlay: backend recomputes the tier. | "Importantly, the backend re-checks the thresholds itself — the device can't just claim a fire. And there is only ever one open incident per device, so repeated reports never create duplicates." |

---

## Scene 7 — Responder workflow: handling the incident (5:30 – 6:20)

| Visual | Voice-over |
|---|---|
| Responder dashboard → click the incident → **Acknowledge**. Status: `active → acknowledged`. | "The responder acknowledges the incident, which everyone sees immediately." |
| Change status to **Responding**. | "Then marks the team as responding." |
| Change status to **Resolved** (or **False alarm**). The incident leaves the active list. | "Once the situation is under control, they mark it resolved — or a false alarm. A closed incident is locked and can't be edited afterwards, so the audit trail is trustworthy." |
| **Alert Logs** detail (BFP SMS confirmed) and the resident's **Alert History** (SMS / BFP / TG tags). | "The system records which messages went out; for SMS it uses the modem's own confirmation, not a guess." |
| Admin window: **Device Status** → manual close option; mention auto-resolve. | "If readings return to safe levels before anyone has acknowledged it, the system closes the incident itself; once a responder has taken it, only a person closes it. Admins can also close one manually." |

---

## Scene 8 — Admin & monitoring tools (6:20 – 6:50)

| Visual | Voice-over |
|---|---|
| **Admin Dashboard**: totals, active alerts, devices online. | "Administrators get the big picture: total alerts, active devices, system health." |
| **Live Map**: red / amber / green / blue / grey / black pins, click a pin. | "The live map shows every device: red is fire, amber is a warning, green is online, blue is reconnecting, grey is offline and black is switched off by an admin." |
| **Devices** page: **Register Device** (generated `AGS-NNN` code and API key), edit, confirm a resident's pin, enable/disable, firmware version. | "Devices are registered here; each gets its own code and secret key. Admins confirm where each one is installed, can regenerate the key, and push firmware updates over the air." |
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
- **Not covered on purpose:** data buffering while offline (readings taken without Wi-Fi are lost) and a GSM data path (GSM carries SMS only). Open issues are listed in `docs/system-specification.md` §5.15. If a panelist asks, answer honestly.

## Suggested shot list (for editors)

| # | Shot | Source |
|---|---|---|
| 1 | Hardware node close-ups (all sensors, LEDs, buzzer) | Camera |
| 2 | Captive portal Wi-Fi setup | Phone screen record |
| 3 | Registration → pending → admin approval | Screen record (2 windows) |
| 4 | Resident home + alert settings | Screen record |
| 5 | Tier 1 trigger: node + admin push/Telegram | Camera + phone + screen |
| 6 | Tier 2 trigger: node + 2 SMS + responder alarm + map | Camera + phones + screen |
| 7 | Incident lifecycle and delivery log | Screen record |
| 8 | Admin dashboard, map, devices, logs | Screen record |
| 9 | Architecture diagram and recap cards | Slides/Figma |
