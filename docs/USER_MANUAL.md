# AgapSense — User Manual

**For residents (home owners) and BFP responders**

AgapSense is a fire-warning device that watches the air in your building for the signs of a fire. When it detects danger it sounds a buzzer, lights a warning LED, and sends alerts to you and to the Bureau of Fire Protection (BFP). This manual explains what the device does, how to read its lights, and how to use the AgapSense web app.

> **In a real fire, do not wait for the app.** Leave the building, call **911** (or your local BFP station), and use the app afterwards. The app and device are an early-warning aid, not a replacement for fire safety practices.

**Contents**

1. [What the device does](#1-what-the-device-does)
2. [Reading the device lights and buzzer](#2-reading-the-device-lights-and-buzzer)
3. [Placement and care](#3-placement-and-care)
4. [Connecting the device to Wi-Fi (setup)](#4-connecting-the-device-to-wi-fi-setup)
5. [Creating an account and signing in](#5-creating-an-account-and-signing-in)
6. [Resident guide](#6-resident-guide)
7. [BFP responder guide](#7-bfp-responder-guide)
8. [Understanding alerts](#8-understanding-alerts)
9. [Troubleshooting](#9-troubleshooting)
10. [Frequently asked questions](#10-frequently-asked-questions)
11. [Getting help](#11-getting-help)

---

## 1. What the device does

Each AgapSense unit contains:

| Part | What it does |
|---|---|
| **CO (carbon monoxide) sensor** | Detects gas given off by smouldering and burning material |
| **Temperature sensor** | Detects rising heat |
| **GPS module** | Tells BFP where the device is |
| **Wi-Fi** | Sends readings and alerts to the AgapSense system |
| **GSM / SIM module** | Sends **SMS text messages** during a serious alert, even if Wi-Fi is down |
| **Yellow, red and blue LEDs and a buzzer** | Show device status and sound the alarm locally |
| **Backup battery** | Keeps the device working during a power outage |

The device takes readings continuously and reports to the system about every **30 seconds**.

### Two alert levels

| Level | Trigger | What happens |
|---|---|---|
| **Tier 1 — Warning** | **One** sensor (CO *or* temperature) is above its limit | Yellow LED. Alert on the BFP dashboard, Telegram station chat and push notifications to responders. **No SMS.** |
| **Tier 2 — Fire Alert** | **Both** sensors are above their limits | Red LED **and buzzer**. Alert to BFP and push notification to the resident. **SMS to the resident and to the BFP station.** |

To avoid false alarms, the device needs **3 readings in a row** above the limit before it raises an alert, and **2 safe readings in a row** before it clears one. A single brief spike will not set it off.

---

## 2. Reading the device lights and buzzer

| Indicator | Meaning | What to do |
|---|---|---|
| **Blue LED — solid** | Online. Wi-Fi works and the system is reachable | Nothing. Normal |
| **Blue LED — blinking** | Wi-Fi is connected but the internet/system is not reachable | Check your router's internet connection |
| **Blue LED — off** | No Wi-Fi | Check the router; see [Troubleshooting](#9-troubleshooting). The device still sounds local alarms and sends SMS |
| **Yellow LED on** | **Tier 1 warning**: one reading is above its limit | Check the room for smoke, heat or a gas source. Be ready to evacuate |
| **Red LED on + buzzer** | **Tier 2 fire alert** | **Evacuate immediately and call 911** |
| **Yellow → Red → Blue flash, then one beep** | Normal start-up self-test | Nothing. It means all indicators work |

### Warm-up after power-on

The CO sensor needs about **2½ minutes (≈150 seconds)** after the device is switched on to stabilise. During this time:

- the app shows **"Initializing sensors..."** instead of readings, and
- **no alerts can be raised** (this prevents false alarms at start-up).

This is normal. Wait for readings to appear.

---

## 3. Placement and care

- Mount the device on a ceiling or high on a wall, **away from kitchen stoves, bathrooms/steam, vents and fans, and open windows**. Cooking fumes and steam can cause false alerts.
- Do not place it inside a closed cabinet or behind furniture. Air must reach the sensors.
- Keep it **plugged into mains power**; the backup battery is for outages only.
- Keep the **SIM antenna** and **GPS antenna** connected, with a view toward a window or open area if possible.
- Dust the vents gently with a dry cloth. Never spray liquids on the device. Never cover it.
- **Never test with real flame.** To test, ask your administrator or BFP technician.
- Do not open, move or re-wire the device. Report problems to your administrator ([Getting help](#11-getting-help)).

---

## 4. Connecting the device to Wi-Fi (setup)

> This is normally done **once, by the installer or administrator**. Residents only repeat it if the Wi-Fi name or password changes.

1. Power on the device. If it has no saved Wi-Fi it creates its own Wi-Fi network named **`AgapSense-Setup`**.
2. On your phone, open Wi-Fi settings and connect to **`AgapSense-Setup`**. It is password-protected; the installer will give you the setup password.
3. A setup page opens automatically. If it does not, open a browser and go to the address shown by your phone's "sign in to network" prompt.
4. Choose your home/station **2.4 GHz** Wi-Fi network (the device does not support 5 GHz) and enter its password.
5. **New devices only:** also enter the **Device ID** and **Device API key** supplied by your administrator, exactly as given. Residents should not need to change these.
6. Press **Save**. The device restarts. When the **blue LED turns solid** it is online.

If the Wi-Fi password changes later, the device opens `AgapSense-Setup` again after about 30 seconds without a connection. Reconnect to it and re-enter the Wi-Fi details. Your Device ID is kept.

---

## 5. Creating an account and signing in

The web app works in any modern browser on a phone or computer.

### 5.1 Register

**Residents**

1. On the login page choose to register as a **Resident**.
2. Fill in: **Full Name**, **Email**, **Contact Number** (format `09XXXXXXXXX`), **Address**, and **Password** (at least 6 characters; confirm it).
3. *Device ID (optional)*: enter your device code (for example `FA-001`) if you have it. Your administrator will verify and link it.
4. Submit.

**BFP responders**

1. Choose to register as a **Responder**.
2. Fill in: **Full Name**, **Email** (official address, for example `you@bfp.gov.ph`), **Contact Number**, **Organization / Station**, **Position / Rank**, **Badge / ID Number** (used for verification), and **Password**.
3. Submit.

### 5.2 Wait for approval

New accounts start as **pending**. You will see a *"pending admin approval"* screen. An administrator reviews and approves the request. After approval, sign in again. If a request is rejected, contact your administrator.

### 5.3 Sign in

Enter your email and password on the login page.

- **Too many wrong passwords locks the account temporarily** (after 3 failures for 10 seconds, after 5 for 30 seconds, after 7 for 15 minutes). Wait for the timer, or ask an administrator to unlock you.
- **Forgot password?** Use the *Forgot password* link and follow the emailed reset link.
- **Automatic sign-out:** for safety you are signed out after a period of inactivity (about **60 minutes for residents, 15 minutes for responders**; your administrator may change this). Sign in again to continue.

---

## 6. Resident guide

Your menu has four pages plus **Account**: **Dashboard**, **Alert History**, **Alert Settings**, **Device Information**.

### 6.1 First sign-in setup

The first time you sign in, you must complete a short setup:

1. **Mobile number** — enter it as `09XXXXXXXXX` and re-enter it to confirm. This is the number that receives **SMS fire alerts**, so make sure it is correct and that your phone can receive texts.
2. **Link your device** — if no device is linked yet, enter your device code (for example `AGS-001`). Only one resident can be linked to a device.
3. **Install location** — if your device is linked, enter the address where it is installed and place the pin on the map (tap the map, drag the pin, or use **Use my location** while you stand next to the device). Responders are sent to this pin when the device has no GPS signal, so put it on the right building. An administrator checks it afterwards; until then it is shown as *unverified*. You can skip this step and do it later from **Device Information**.

### 6.2 Dashboard

Your home screen shows the live state of your device:

- **Device status**: online, reconnecting or offline.
  - **Online** — heard from the device within the last 2 minutes.
  - **Reconnecting** — last heard 2 to 15 minutes ago ("Last seen X min ago").
  - **Offline** — not heard from for more than 15 minutes.
- **Active alarms** and **alerts today**.
- **Last seen** — when the device last reported.
- **Real-time telemetry** — temperature and gas (CO) readings. You will see *"Initializing sensors..."* during the warm-up period.
- **GPS status, connection and sensor** health cards, and a **Power** card (**Mains** or **Battery**). *Battery* means the building has lost mains power and the device is running on its backup.
- **Recent Activity Log** and a **map** showing where your device is registered.

**Location mismatch prompt.** If the device's GPS position is more than about 100 m from the address on file, a *"Location Discrepancy Detected"* box appears. Choose **Update** to save the new address, or **Keep Current** to leave it unchanged.

### 6.3 Alert History

Every alert and warning your device has raised, newest first. Each row shows the **tier** (*Tier 1 Warning* or *Tier 2 Alert*), whether it is **Active** or **Resolved**, when it was **triggered**, the **temperature** and **CO** readings at that moment, which **notifications** went out (*SMS* to you, *BFP* for the fire station, *TG* for Telegram), and when it was **resolved**.

To narrow the list, pick a **From** and **To** date (the last 30 days by default), a **Tier**, or one of **All / Active / Resolved** (each shows how many alerts it has). Ten alerts show per page; use the arrows at the bottom of the table to see more. Press **Refresh** to load new alerts. **View all alerts** in the notification bell also opens this page.

### 6.4 Alert Settings

Here you control **when** the device alerts and **how** you are notified.

- **Temperature Threshold** (°C): the temperature at which the heat sensor counts as "over limit".
- **Smoke Threshold** (PPM): the gas level at which the gas sensor counts as "over limit". *(The sensor actually measures carbon monoxide; the app calls this "smoke".)*
- **Primary SMS Recipient**: the mobile number that receives Tier 2 SMS alerts (`09XXXXXXXXX`).
- **Web Push Alerts**: press **Enable Push Notifications** and allow notifications in your browser to get alerts on that device. Press **Disable Push Notifications** to stop them.
- **Telegram Alerts**: press **Link Telegram Account** and follow the prompt to link your Telegram. *(Currently, Telegram fire alerts are sent to the shared BFP station chat; personal Telegram alerts are not yet delivered by the system.)*
- **Current Configuration Summary** shows what is active. A banner says **Unsaved Changes** until you press save, then **All Settings Synced**.

**Choosing thresholds.** Use the **Need threshold advice?** guide in the app. Typical suggestions:

| Room | Temperature | Gas (PPM) | Notes |
|---|---|---|---|
| Bedrooms and living areas | 50–54 °C | 80–120 | Most sensitive; early evacuation |
| Kitchens and dining | 58–65 °C | 250–350 | Higher to avoid cooking false alarms |
| Equipment/server closets | 40–45 °C | 50–80 | Heat-sensitive equipment |
| Offices / public halls | 50–55 °C | 150–200 | Balanced for foot traffic |
| Garages and utility areas | 58–60 °C | 250–300 | Tolerates exhaust and equipment heat |

> Lower numbers = more sensitive (earlier warnings, more false alarms). Higher numbers = fewer false alarms but later warnings. When unsure, ask your administrator or BFP before changing.

The device picks up new settings automatically within about **10 minutes**.

### 6.5 Device Information

Shows your device's details: name, **Location** (use the pencil icon, or **Set pin** / **Move pin** under the map, to change the address and map pin), temperature and CO thresholds, **Last Seen**, **Recent Sensor Readings** (table with time and values), a **map** with the status of your install pin (*not set*, *waiting for confirmation* or *confirmed*), and device specs. Any change you make to the address or pin goes back to an administrator to confirm. If you see *"No device registered to your account"*, your device is not linked yet — contact your administrator.

### 6.6 Account

Update your **Full Name** and **Contact Number**. The page also shows your role, assigned unit and registration date. Use **Logout** from the menu when you are done, especially on shared devices.

### 6.7 What you will receive in a fire (resident)

| Event | You receive |
|---|---|
| Tier 1 warning | Nothing is sent to you by SMS. Check your Dashboard; the device's yellow LED lights |
| Tier 2 fire alert | Red LED and buzzer at the device, **SMS to your mobile number** with evacuation instructions and a map link, and a **push notification** if enabled |

**If you hear the alarm or receive the SMS: leave immediately, close doors behind you, call 911, and do not return until BFP says it is safe.**

---

## 7. BFP responder guide

Your menu has: **Dashboard**, **Alert Logs**, **Settings**, **Logout**.

### 7.1 Dashboard

- **Summary cards**: **Active Alarms**, **Pre-Alerts / Warning**, **Monitored Coverage**, **Alerts Today**.
- **Live map** of every device. Pin colours:

  | Colour | Meaning |
  |---|---|
  | **Green** | Normal |
  | **Red** | Fire alert |
  | **Amber** | Warning / fault |
  | **Grey** | Offline |

  Devices with no usable coordinates are not drawn on the map. A pin may show the position as live GPS, *last-known*, or *registered address*. A *last-known* position is **not** a live GPS fix. Treat the address as an estimate.
- **Live Alert Feed**: each active alert with the device, location, **Peak Temp** and **CO Level**. Unacknowledged fire alerts play an **audible alarm** in the browser. Keep the page open and your volume on, and allow the browser to play sound.
- Tap an alert to see its location and navigation link.

### 7.2 Handling an incident

An incident moves through these steps:

```
Active → Acknowledged → Responding → Resolved   (or → False Alarm)
```

1. **Acknowledge Alarm** — tells everyone a responder has seen it and silences the browser alarm.
2. **Responding** — mark when a unit is dispatched.
3. **Resolve** — the fire/danger is handled. **False Alarm** — nothing was wrong.

Rules to remember:

- Only one open incident exists per device. Repeated readings update the same incident rather than creating new ones.
- A tier can only go **up** (Tier 1 → Tier 2), never down, while the incident is open.
- Once **Resolved** or **False Alarm**, the incident is **closed and cannot be changed**. Choose carefully.
- The system may close an incident by itself if the device reports both readings back below their limits. An incident that a responder has already acknowledged should still be closed by a responder.

### 7.3 Alert Logs

A searchable table of past incidents: **Timestamp, Device Name, Location, Telemetry Status, Actions**.

- Filter by **Date Range** (last 24 hours, 7 days, 30 days, all time), **Device Node** and **Status**.
- Click the **eye icon** (*View details*) for the **Alert Detail** window: device, location, status, trigger time, temperature, CO level, and acknowledged/resolved times.
- Use **Export Incident History** to download a record for reporting.

### 7.4 Settings

- **Personal Profile**: your name and contact number (`09XXXXXXXXX`).
- **Telegram Alerts**: link your Telegram account.
- **Browser Push Notifications**: enable to get alerts on this device even when the tab is in the background.
- **Station Information**: station name, address and contact number.
- **Account Details**: role, user ID and join date. Use **Need Admin Help?** to send a support request.

### 7.5 What responders receive

| Event | Responders receive |
|---|---|
| Tier 1 | Telegram message to the station chat and web-push notification |
| Tier 2 | Telegram message and push notification, plus an **SMS to the station number** assigned to that device with the device ID, time, readings, GPS coordinates, address and a Google Maps link |

Messages include a navigation link of the form `maps.google.com/?q=<latitude>,<longitude>`. If the message says the position is *"estimated — last known"*, GPS had no fresh fix; confirm the address with the resident or the dispatcher.

---

## 8. Understanding alerts

**Why did I get a warning but no SMS?** A Tier 1 warning (one sensor high) does not send SMS. Only a Tier 2 alert (both sensors high) sends SMS.

**Why didn't I get another SMS?** To avoid spamming, the device will not resend SMS for about **5 minutes** while the alert continues. The alarm, LEDs, and app continue to update.

**What if Wi-Fi is down during a fire?** The red LED, buzzer and SMS still work through the SIM. The device keeps trying to send the online alert and delivers it when Wi-Fi returns, without creating duplicates. However, **readings taken while offline are not stored**.

**When does an alert end?** After 2 consecutive safe readings the device switches off the LEDs and buzzer. The incident in the system is then closed automatically unless a responder has already taken it over.

---

## 9. Troubleshooting

| Problem | Likely cause | What to do |
|---|---|---|
| App says **Offline** | Power off, router off, or Wi-Fi password changed | Check device power and the router. If the Wi-Fi password changed, reconnect to `AgapSense-Setup` and re-enter it |
| Blue LED **blinking** | Wi-Fi works but no internet | Restart the router; check your internet provider |
| **"Initializing sensors..."** | Normal 2½-minute warm-up | Wait. If it lasts more than 10 minutes, power-cycle the device and contact your administrator |
| **Frequent false alarms** | Thresholds too low, or the device is near a stove, shower or vent | Raise thresholds slightly (see [6.4](#64-alert-settings)) or ask your administrator to move the device |
| **Not receiving SMS** | Wrong number, SIM out of credit or no signal | Check your number in Alert Settings; report to your administrator so the SIM can be checked |
| **No push notifications** | Permission blocked in browser | Re-enable notifications for the site in your browser settings, then press **Enable Push Notifications** |
| **Power card shows "Battery"** | Mains power lost | Check the power outlet or breaker |
| **"No device registered to your account"** | Device not yet linked | Enter your device code in setup, or ask your administrator to link it |
| **Account locked** | Too many wrong passwords | Wait for the timer or ask an administrator to unlock |
| **Signed out unexpectedly** | Inactivity timeout | Sign in again |
| **Pending approval screen** | Account awaiting administrator | Wait for approval or contact your administrator |
| **Wrong position on map** | GPS has no fix (typical indoors) | Normal; the last-known or registered address is shown |

Some figures on the app (for example "System Uptime", responder "connectivity %", and map "Signal / Latency") are placeholders and should not be relied on yet.

---

## 10. Frequently asked questions

**Can the device see smoke?** It measures **carbon monoxide gas and temperature**, which rise in most fires. It is not a replacement for a certified smoke detector.

**Does it work in a power outage?** Yes, on its backup battery. The dashboard shows *Battery*.

**Does it work without internet?** Local alarm (LEDs, buzzer) and Tier 2 SMS still work. Dashboard and push/Telegram alerts need internet.

**Can I silence the buzzer?** The buzzer stops by itself when readings return to safe levels. There is no local mute button. Ask your administrator if the alarm is a false alarm that does not stop.

**Who can see my data?** Residents see only their own device. Responders and administrators see devices across the system.

**How do I change my phone number?** Resident: **Account** or **Alert Settings**. Responder: **Settings → Personal Profile**.

**Is the setup Wi-Fi 5 GHz?** No. The device supports **2.4 GHz** only.

---

## 11. Getting help

- In the app, use **Need Admin Help?** (responders) or contact your administrator to file a **support request**.
- Include: your **device ID**, a short description of the problem, what the LEDs show, and the time it happened.
- **In an emergency, always call 911 or your nearest BFP station first.**

*This manual describes the AgapSense system as implemented in this repository. Where a feature is incomplete it is noted in the text. For technical details see `docs/FEATURES.md` and `docs/FIRMWARE_GUIDE.md`.*
