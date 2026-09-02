# Running OmniPOS on a real device

The mobile app has never run on hardware against the Laravel API. Everything to
date was proven against local servers, which does not test the things a phone
does differently.

This is what to do, in order, and what each step is actually checking.

---

## Before you pick up a phone

**Expo Go will not work.** The app uses WatermelonDB with a config plugin, so it
needs a development build:

```bash
cd omnipos-mobile
npx expo run:android      # or: npx expo run:ios
```

Or an EAS development build if you are not set up for local native builds:

```bash
eas build --profile development --platform android
```

**Point it at the machine, not at itself.** In `.env`:

```
EXPO_PUBLIC_BACKEND=laravel
EXPO_PUBLIC_API_URL=http://192.168.1.10:8000
```

That address is your computer's LAN address — `ipconfig` on Windows, `ifconfig`
on macOS. `localhost` on a phone is the phone.

**Serve on the network, not on the loopback.** Laravel's default binds to
127.0.0.1 and is unreachable from anything else:

```bash
php artisan serve --host=0.0.0.0 --port=8000
```

Then allow the port through the firewall. On Windows this is the step people
forget, and it presents exactly like a wrong address.

---

## Plain HTTP, and why it would have wasted your first day

Android 9 and later refuse cleartext HTTP by default. iOS refuses it through App
Transport Security. A Laravel dev server on a LAN address is plain HTTP, so on a
real phone **every request is refused by the operating system before it leaves
the app**.

The client turns that into `ApiError(0)`, which `isUnreachable` reports as
"offline". So the till looks like it is working perfectly — selling, queueing,
showing an Offline badge — and nothing anywhere says why it never syncs.

`app.config.ts` now allows it, narrowly:

- **Android** — `usesCleartextTraffic`, and only when the build profile is not
  `production`.
- **iOS** — `NSAllowsLocalNetworking`, which permits HTTP to LAN addresses while
  leaving ATS enforced for the internet at large. Not `NSAllowsArbitraryLoads`.
- **iOS 14+** also prompts before an app may touch the local network, and will
  not show the prompt without `NSLocalNetworkUsageDescription`. That string is
  there; **accept the prompt when it appears**, or every request fails silently.

A production build gets none of this and should be pointed at an `https://` API.

---

## Step 1: the device check

Settings → **Device Check**. It runs on the phone and reports on:

| Check | What a failure means |
|---|---|
| Backend | The build is still pointed at Supabase |
| API address | Unset, or pointing at the device itself |
| Server reachable | Blocked scheme, wrong address, firewall, or a captive portal |
| Clock | The phone's clock is wrong — see below |
| Secure storage | The keychain refused; usually no screen lock on Android |
| Local database | WatermelonDB is not working, which is a build problem |
| Signed in | No token, or the server refused the one stored |
| Sync protocol | The changefeed answered, and this account may read this store |
| Outbox | Anything stuck, rejected or failed |

Every failure carries what to do about it, and **Share the report** sends the
whole run as text — a tester on a shop floor can send that from the phone
without a screenshot.

Run it before anything else. If it is not all green, nothing below will tell you
anything you can trust.

### The clock check is not a formality

`client_created_at` comes from the device, and every report in the system groups
by it. A phone an hour out files a morning's takings under yesterday, the drawer
reconciles against the wrong day, and nothing anywhere flags it. Turn on
automatic date and time before you start.

---

## Step 2: the money paths, in this order

Each of these has been proven against a local server. What is unproven is
whether they behave the same on a device.

1. **Sign in.** Close the app fully, reopen it. Still signed in? That is the
   keychain working.
2. **A cash sale.** Check the receipt number, the change, and that the Sync
   badge goes from queued to clear.
3. **Turn off Wi-Fi. Ring up two more sales.** They must complete with no
   hesitation. This is the whole point of the app.
4. **Turn Wi-Fi back on.** The queue must drain on its own within a minute.
   Check the server has exactly two new sales, not four.
5. **Force-quit mid-sync** — sell offline, reconnect, kill the app the moment
   the queue starts draining. Reopen. The sale must appear **once**. This is the
   idempotency guarantee, and a phone being killed by the OS is how it gets
   tested for real.
6. **A return** against one of those sales. Stock back up, money out.
7. **Open a drawer, take a sale, close it.** The counted and expected figures
   must agree.
8. **Settle a customer's balance.** The debt must fall on the server too.

## Step 3: two devices

The failure this system is built around only appears with two.

1. Put both phones offline.
2. Sell the same product on both, down past the stock on hand.
3. Bring both back online.
4. Both sales must survive. Stock may go negative — that is deliberate, and the
   Inventory screen surfaces it.
5. If they issued the same receipt number, one raises a conflict. Settle it from
   Settings → **Rejected Sales**, or from a manager's browser.

---

## What to watch for that a simulator never shows

- **Being killed in the background.** Android will kill a backgrounded app under
  memory pressure, often mid-request. Sell, background the app for ten minutes
  while using something heavy, come back.
- **Switching networks mid-sync.** Walk out of Wi-Fi range onto mobile data
  during a queue drain.
- **Aeroplane mode**, which fails differently from a dead server.
- **A screen lock with no PIN**, which is when Android's keychain refuses.
- **Low storage.** WatermelonDB writes fail differently when the disk is full,
  and a till that cannot write locally has no fallback.
- **Date and time set manually**, which is more common on shared shop phones
  than you would expect.

---

## What is already known to be untested

Being honest about the boundary:

- **Nothing in this document has been run.** The device check and the network
  settings were written and unit-tested against the source; the checks
  themselves need a device to execute.
- **Bluetooth receipt printing** has never been exercised against real hardware
  on the Laravel build.
- **Background sync** while the app is not in the foreground.
- **iOS specifically.** The Android path has had more thought here, and the ATS
  and local-network settings are reasoned rather than observed.
