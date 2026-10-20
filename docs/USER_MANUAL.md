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
| **Tier 1 — Warning** | **One** sensor (CO *or* temperature) is above its limit | Yellow LED and **3 short beeps**, repeated about every 45 seconds while it lasts. Push and Telegram to the resident and to administrators. **No SMS**, and BFP is not notified. The resident can mark it resolved once they have checked the room. |
| **Tier 2 — Fire Alert** | **Both** sensors are above their limits | Red LED **and a continuous buzzer**. Alert to BFP and push notification to the resident. **SMS to the resident and to the BFP station.** |

To avoid false alarms, the device needs **3 readings in a row** above the limit before it raises an alert, and **2 safe readings in a row** before it clears one. A single brief spike will not set it off.

---

## 2. Reading the device lights and buzzer

| Indicator | Meaning | What to do |
|---|---|---|
| **Blue LED — solid** | Online. Wi-Fi works and the system is reachable | Nothing. Normal |
| **Blue LED — blinking** | Wi-Fi is connected but the internet/system is not reachable | Check your router's internet connection |
| **Blue LED — off** | No Wi-Fi | Check the router; see [Troubleshooting](#9-troubleshooting). The device still sounds local alarms and sends SMS |
| **Yellow LED on + 3 short beeps every ~45 s** | **Tier 1 warning**: one reading is above its limit | Check the room for smoke, heat or a gas source. Be ready to evacuate |
| **Red LED on + continuous buzzer** | **Tier 2 fire alert** | **Evacuate immediately and call 911** |
| **Yellow → Red → Blue flash, then one beep** | Normal start-up self-test | Nothing. It means all indicators work |

### Warm-up after power-on

The CO sensor needs about **1 minute** after the device is switched on to stabilise (up to **2½ minutes** on units built with the older heater-cycling firmware). During this time:

- the app shows **"Warming up"** instead of a CO reading, and
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
2. Fill in: **Full name**, **Email address**, **Mobile number** (`09XX XXX XXXX`), and your address: **House/Unit no., street, subdivision**, **Barangay**, **City/Municipality** and **Province**. All are required.
3. *Device code (optional)*: the code that came with your device (for example `AGS-001`). If you don't have it yet, leave it blank; an administrator links your device during review.
4. Choose a **Password** (at least 6 characters) and confirm it, then submit.

**BFP responders**

1. Choose to register as a **Responder**.
2. Fill in: **Full name**, **Email address** (your official BFP email if you have one) and **Fire station** (required). **Mobile number**, **Rank or position** and **BFP ID number** are optional; the ID number helps the administrator verify you faster.
3. Choose a **Password** (at least 6 characters), confirm it, and submit.

### 5.2 Wait for approval

New accounts start as **pending**. You will see a *"pending admin approval"* screen. An administrator reviews and approves the request. After approval, sign in again. If a request is rejected, contact your administrator.

### 5.3 Sign in

Enter your email and password on the login page.

- **Too many wrong passwords locks the account temporarily** (after 3 failures for 10 seconds, after 5 for 30 seconds, after 7 for 15 minutes). Wait for the timer, or ask an administrator to unlock you.
- **Forgot password?** Use the *Forgot password* link and follow the emailed reset link.
- **Automatic sign-out:** for safety you are signed out after a period of inactivity (**60 minutes for residents, 15 minutes for responders** unless your administrator changes it). Sign in again to continue.

---

## 6. Resident guide

Your menu has four pages plus **Account**: **Dashboard**, **Alert History**, **Alert Settings**, **Device Information**.

### 6.1 First sign-in setup

The first time you sign in, you must complete a short setup:

1. **Mobile number** — enter it as `09XXXXXXXXX` and re-enter it to confirm. During a fire alert your device texts this number directly, so make sure it is correct and that your phone can receive texts.
2. **Install location** (only if a device is already linked and its pin is not yet confirmed) — enter the address where the device is installed and place the pin on the map (tap the map, drag the pin, or use **Use my location** while you stand next to the device). Responders are sent to this pin when the device has no GPS signal, so put it on the right building. An administrator checks it afterwards; until then it is shown as *unverified*. You can choose **Skip for now** and do it later from **Device Information**.

**No device linked yet?** Your Dashboard asks for your **device code** (for example `AGS-001`). Enter it to link the device. Only one resident can be linked to a device.

### 6.2 Dashboard

Your home screen answers "is my home OK?" first, then shows the details:

- **Status panel** (top): one of
  - **Fire alert** (red) — temperature and CO are both over their alert levels. It shows the readings, whether **BFP was notified by SMS**, and how far responders have got (*Waiting for a responder*, *A responder has acknowledged*, *Responders are on the way*). It tells you to check your home now and, if you see fire or smoke, to leave the building and stay at a safe distance until responders arrive.
  - **Warning** (amber) — one reading is over its alert level. Check the room for heat, smoke or a gas source.
  - **All clear** (green) — the device is reporting and readings are within your alert levels.
  - **Reconnecting** (blue) — last report 2 to 15 minutes ago; this usually recovers on its own.
  - **Device offline** (grey) — no report for more than 15 minutes. While it is offline, no new readings or fire alerts can reach you or responders, so check its power and Wi-Fi.
  - **Device switched off** — an administrator disabled it; its readings and alerts are ignored until it is enabled again.

  Along the bottom: **Last report**, the number of alerts in the **last 7 days** (and how many are still open), and your **device** code.
- **Readings** — temperature and carbon monoxide (CO) against their alert levels. Press either one to see its last 24 readings in the chart below; the dashed red line is the alert level and bars at or above it are red. Point at (or tab to) a bar to see its value and time. If the device is offline the values are greyed out and dated. *"Warming up"* shows while the CO sensor calibrates.
- **Recent Alerts** — the five newest alerts with their status (*Active*, *Acknowledged*, *Responding*, *Resolved* or *False alarm*); **View all** opens Alert History.
- **Emergency Contacts** — your local fire station's number, once it has been set up. On a phone, tap the number to call it.
- **Notifications** — whether an **SMS** number is set (for fire alerts), **Telegram** is linked, and **push notifications** are on in this browser. **Alert settings** is where you change them.
- **Device Health** — **Sensors**, **GPS** and **Power** (**Mains** or **On battery**). *On battery* means the building has lost mains power and the device is running on its backup. These show *No data* while the device is offline.
- **Install Location** — the address on file and where the position comes from. **View on map** opens Device Information.

**Location mismatch prompt.** If the device's GPS position is more than about 100 m from the address on file, a *"Location Discrepancy Detected"* box appears. Choose **Update** to save the new address, or **Keep Current** to leave it unchanged.

### 6.3 Alert History

Every alert and warning your device has raised, newest first. Each row shows the **tier** (*Tier 1 Warning* or *Tier 2 Alert*), its status (*Active*, *Acknowledged* or *Responding* while open; *Resolved* or *False alarm* once closed), when it was **triggered**, the **temperature** and **CO** readings at that moment, which **notifications** went out (*SMS* to you, *BFP* for the fire station, *TG* for Telegram), and when it was **resolved**.

To narrow the list, pick a **From** and **To** date (the last 30 days by default), a **Tier**, or one of **All / Active / Resolved** (each shows how many alerts it has). **Active alerts always show at the top, whatever dates you pick**, until they are resolved; the dates only limit the resolved ones. If an active alert is older than your From date, a red note under the filters says so. Ten alerts show per page; use the arrows at the bottom of the table to see more. Press **Refresh** to load new alerts. **View all alerts** in the notification bell also opens this page.

### 6.4 Alert Settings

Here you control **when** the device alerts and **where** alerts are sent.

**Alert Levels** (saved together with **Save alert levels**; **Undo changes** puts the saved values back):
- **Temperature** (°C): the temperature at which the heat sensor counts as "over limit".
- **Carbon Monoxide (CO)** (ppm): the CO level at which the gas sensor counts as "over limit". CO readings are approximate: the MQ-7 gas sensor estimates ppm from its datasheet curve rather than measuring it exactly, so treat the number as an alert level, not a precise measurement.

One reading over its level raises a **warning**; both together raise a **fire alert**.

**Where Alerts Are Sent** (each one applies on its own). You receive **warnings (Tier 1)** and **fire alerts (Tier 2)** by push and Telegram on each channel turned on here. SMS is the backup: if your device has no Wi-Fi or internet during a fire alert (Tier 2), it texts you instead. Warnings (Tier 1) are never sent by SMS.
- **SMS**: the mobile number (`09XXXXXXXXX`) your device texts when it can't send a fire alert online (Wi-Fi or internet down). The device sends it itself over the mobile network. When the device is online you get push and Telegram, not SMS. Press **Save number**, then type the number again and press **Confirm number** (typing it twice catches a wrong digit before it is saved). Clearing the box and saving asks you to confirm before the number is removed.
- **Push notifications**: press **Turn on** and allow notifications to get alerts in that browser, even when AgapSense isn't open. Turn it on in each browser you use. *Unavailable* means the browser doesn't support it or notifications are blocked.
- **Telegram**: press **Link Telegram** and follow the prompt. Fire alerts are then also sent to your Telegram through the AgapSense bot.

**Choosing levels.** Use **Suggested levels by room** in the app. Typical suggestions:

| Room | Temperature | Gas (PPM) | Notes |
|---|---|---|---|
| Bedrooms and living areas | 50–54 °C | 80–120 | Most sensitive; early evacuation |
| Kitchens and dining | 58–65 °C | 250–350 | Higher to avoid cooking false alarms |
| Equipment/server closets | 40–45 °C | 50–80 | Heat-sensitive equipment |
| Offices / public halls | 50–55 °C | 150–200 | Balanced for foot traffic |
| Garages and utility areas | 58–60 °C | 250–300 | Tolerates exhaust and equipment heat |

> Temperature ranges follow common heat-detector ratings (NFPA 72). The gas (CO) ranges are AgapSense starting points, not values from a standard.
>
> Lower numbers = more sensitive (earlier warnings, more false alarms). Higher numbers = fewer false alarms but later warnings. When unsure, ask your administrator or BFP before changing.

The device picks up new settings automatically within about **10 minutes**.

### 6.5 Device Information

Shows your device: its **status** (Online, Reconnecting, Offline, or Disabled if an administrator switched it off), **last report**, **alert levels** (with a link to change them), **firmware** version, registration date, and whether a **BFP SMS** number has been set by an administrator. **Recent Readings** lists the latest readings with time, temperature, CO, GPS fix, power and sensor state; values at or over an alert level are red.

**Install Location** shows the address on file, a map, where the position comes from, and the status of your **Install pin** (*Not set*, *Waiting for confirmation*, or *Confirmed* once an administrator has checked it). Use **Set address and pin** / **Edit address or move pin** to change it; any change goes back to an administrator to confirm. If no device is linked yet, the page sends you to the Dashboard to link one with its device code.

### 6.6 Account

Update your **Full name**. Your **mobile number** is shown here and changed in **Alert Settings** (it is where fire alert SMS go); your **email** is used to sign in and is changed by an administrator. The page also shows your role, linked device and member-since date.

**Need Help?** → **Contact administrator** sends a request. Residents choose **Device Link or Change**, **Password Reset**, **Account Access / Permissions** or **Other**. **My Requests** lists what you sent, whether it is still waiting, and the administrator's reply. Use **Logout** from the menu when you are done, especially on shared devices.

### 6.7 What you will receive in a fire (resident)

| Event | You receive |
|---|---|
| Tier 1 warning | Push and Telegram (no SMS). The device's yellow LED lights and it beeps 3 times about every 45 seconds. Check the room, then use **Mark as resolved** on your Dashboard |
| Tier 2 fire alert | Red LED and buzzer at the device, **SMS to your mobile number** with evacuation instructions and a map link, a **push notification** if enabled, and a **Telegram** message if linked |

**If you hear the alarm or receive the SMS: leave immediately, close doors behind you, call 911, and do not return until BFP says it is safe.**

---

## 7. BFP responder guide

Your menu has: **Dashboard**, **Alert Logs**, **Settings**, **Logout**.

### 7.1 Dashboard

You see **fire alerts (Tier 2) only**. Single-sensor warnings (Tier 1) go to the resident and administrators; the household checks the site first.

- **Summary cards**: **Active Fires**, **Not Acknowledged**, **Devices Reporting** (online or reconnecting, out of enabled devices) and **Fire Alerts Today**. A card turns red only when there is something to act on.
- **Alarm sound**: the browser siren plays while any fire is unacknowledged and cannot be muted; it stops only when the fire is acknowledged. Keep the page open and your volume on. Browsers block sound on a page until you tap, click or press a key on it; if the dashboard shows **"The browser is blocking the alarm sound"**, tap anywhere on the page (or **Enable alarm sound**), for example after reloading it. A page in the background or a locked phone cannot play the siren; the push notification is what reaches you then.
- **Fire notifications**: tapping one opens this dashboard with that fire highlighted, ready to acknowledge.
- **Active Fire Alerts** (first on phones), oldest first. Each card shows:
  - the device, the resident's registered **address** and the area named by GPS;
  - how long it has been open, the **temperature** and **smoke/CO** readings;
  - the **resident** linked to the device and a button to **call** them (shown only while the fire is open);
  - the next action (**Acknowledge**, **Unit dispatched**, **Resolved**, **False alarm**);
  - **Directions** and **Show on map**. The line under them says where directions lead: *live GPS at alert*, *last-known GPS position*, or the *registered pin* (confirmed by an admin or not yet confirmed). Anything other than live GPS or a confirmed pin is approximate: check the address on arrival.
- **Device Map**: every device with a known position. Red = fire, green = online, blue = reconnecting, grey = offline, black = disabled by an admin. Devices with no usable position are listed under the map.

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

Every fire alert (Tier 2): when it started, the device, the address, the readings, how long it took to acknowledge, and its status.

- Summary cards: **Open**, **Resolved**, **False Alarms** (tap one to filter) and **Avg. Time to Acknowledge**.
- Filter by status, **date range** (24 hours, 7 days, 30 days, all time) and **device**. Searching a device in the top bar opens its whole history.
- Tap a row for the details: location and directions, acknowledgement and closing times, who closed it, notes, and whether the device confirmed the BFP SMS.
- **Export CSV** downloads the alerts currently shown.

### 7.4 Settings

- **Personal Details**: your name and mobile number (`09XXXXXXXXX`). Your sign-in email is shown read-only.
- **Fire Alert Notifications**: link your **Telegram** account and turn on **browser notifications** for each phone or computer you use. Both are for Tier 2 fires only.
- **Station Information**: station name, address, hotline (mobile or landline with area code) and email. Shared by every responder account.
- **Account**: role and member-since date. Use **Need Help?** to send a request to an administrator.

### 7.5 What responders receive

| Event | Responders receive |
|---|---|
| Tier 1 | Nothing. Warnings go to the resident and administrators only. |
| Tier 2 | Telegram message to the station chat and to your linked Telegram, push notification, plus an **SMS to the station number** assigned to that device with the device ID, time, readings, GPS coordinates, address and a Google Maps link |

Messages include a navigation link of the form `maps.google.com/?q=<latitude>,<longitude>`. If the message says the position is *"estimated — last known"*, GPS had no fresh fix; confirm the address with the resident or the dispatcher.

---

## 8. Understanding alerts

**Why did I get a warning but no SMS?** A Tier 1 warning (one sensor high) does not send SMS. Only a Tier 2 alert (both sensors high) sends SMS.

**Why didn't I get another SMS?** To avoid spamming, the device will not resend SMS for about **5 minutes** while the alert continues. The alarm, LEDs, and app continue to update.

**What if Wi-Fi is down during a fire?** The red LED and buzzer still work, and the device texts you and the BFP through its SIM instead. The device keeps trying to send the online alert and delivers it when Wi-Fi returns, without creating duplicates. However, **readings taken while offline are not stored**.

**When does an alert end?** After 2 consecutive safe readings the device switches off the LEDs and buzzer. There is no button to silence the beeps: marking a warning resolved in the app closes it in the system, but the device keeps beeping until its readings are back to normal. The incident in the system is then closed automatically unless a responder has already taken it over.

---

## 9. Troubleshooting

| Problem | Likely cause | What to do |
|---|---|---|
| App says **Offline** | Power off, router off, or Wi-Fi password changed | Check device power and the router. If the Wi-Fi password changed, reconnect to `AgapSense-Setup` and re-enter it |
| Blue LED **blinking** | Wi-Fi works but no internet | Restart the router; check your internet provider |
| **"Warming up"** | Normal CO sensor warm-up (1–2½ minutes) | Wait. If it lasts more than 10 minutes, power-cycle the device and contact your administrator |
| **Frequent false alarms** | Thresholds too low, or the device is near a stove, shower or vent | Raise thresholds slightly (see [6.4](#64-alert-settings)) or ask your administrator to move the device |
| **Not receiving SMS** | Wrong number, SIM out of credit or no signal | Check your number in Alert Settings; report to your administrator so the SIM can be checked |
| **No push notifications** | Permission blocked in browser | Re-enable notifications for the site in your browser settings, then turn them back on: **Alert Settings → Push notifications → Turn on** (residents) or the **Browser notifications** switch in **Settings** (responders) |
| **Power shows "On battery"** | Mains power lost | Check the power outlet or breaker |
| **"No device linked yet"** | Device not yet linked | Enter your device code on the Dashboard, or ask your administrator to link it |
| **Account locked** | Too many wrong passwords | Wait for the timer or ask an administrator to unlock |
| **Signed out unexpectedly** | Inactivity timeout | Sign in again |
| **Pending approval screen** | Account awaiting administrator | Wait for approval or contact your administrator |
| **Wrong position on map** | GPS has no fix (typical indoors) | Normal; the last-known or registered address is shown |

---

## 10. Frequently asked questions

**Can the device see smoke?** It measures **carbon monoxide gas and temperature**, which rise in most fires. It is not a replacement for a certified smoke detector.

**Does it work in a power outage?** Yes, on its backup battery. The dashboard shows *On battery*.

**Does it work without internet?** Local alarm (LEDs, buzzer) still works, and fire alerts (Tier 2) are sent by SMS instead. Dashboard and push/Telegram alerts need internet.

**Can I silence the buzzer?** The buzzer stops by itself when readings return to safe levels. There is no local mute button. Ask your administrator if the alarm is a false alarm that does not stop.

**Who can see my data?** Residents see only their own device. Responders and administrators see devices across the system.

**How do I change my phone number?** Resident: **Alert Settings → Where Alerts Are Sent → SMS**. Responder: **Settings → Personal Details**.

**Is the setup Wi-Fi 5 GHz?** No. The device supports **2.4 GHz** only.

---

## 11. Getting help

- In the app, open **Account** (residents) or **Settings** (responders) and use **Need Help? → Contact administrator** to send a **support request**. Its reply appears under **My Requests**.
- Include: your **device ID**, a short description of the problem, what the LEDs show, and the time it happened.
- **In an emergency, always call 911 or your nearest BFP station first.**

*This manual describes the AgapSense system as implemented in this repository. Where a feature is incomplete it is noted in the text. For technical details see `docs/FEATURES.md` and `docs/FIRMWARE_GUIDE.md`.*
