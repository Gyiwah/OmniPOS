# Running OmniPOS on a real device

The mobile app has never run on hardware against the Laravel API. It has now run
on an Android emulator — selling, refunding, surviving being killed mid-sale —
and "What has been verified" near the bottom lists exactly what that settled.

An emulator is not a phone. It has no Bluetooth radio, no real camera, no
battery, no mobile network and no operating system reclaiming memory from a
backgrounded till. Everything a phone does differently is still unproven, and
that is most of what this document is for.

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

**Gradle needs a JDK, and installing Android Studio does not give it one on the
PATH.** The build fails with `JAVA_HOME is not set and no 'java' command could be
found`. Android Studio ships its own runtime; point at that rather than
installing a second JDK:

```bash
export JAVA_HOME="C:\\Program Files\\Android\\Android Studio\\jbr"
```

**Changing app.config.ts does not change an existing native build.** `expo
run:android` only runs a full prebuild when `android/` is absent; when it already
exists your change is compiled into nothing and the rebuild produces an
identical app. Either edit `android/` directly or run `npx expo prebuild
--clean` — but note that `--clean` regenerates `android/gradle.properties` and
will discard the `-Djava.net.preferIPv4Stack=true` in `org.gradle.jvmargs` that
this machine needs to download dependencies at all.

**The New Architecture must stay off.** `newArchEnabled` is false in both
`app.config.ts` and `android/gradle.properties`, and they have to agree.
WatermelonDB 0.28 is a legacy bridge module, and the New Architecture runs
bridgeless, where legacy ReactPackage modules are never exposed to JS. Turning it
on compiles, links and registers `WMDatabaseBridge` and then hides it, so the app
silently falls back to an in-memory database that resets on every launch — an
offline-first till that loses the sales it was built to protect. If you ever
re-enable it, prove the database works by checking the adapter on a device, not
by the app opening.

**Install the NDK from Android Studio before building, not from Gradle.** The
build needs it — `expo-modules-core`, `expo-sqlite` and
`react-native-gesture-handler` all compile C++ through CMake — and Gradle will
offer to fetch it. It is not reliable at that: on this machine the download
stopped twice, at 283MB and at 388MB of 745MB, with no error and no resume. It
prints a clue while it works, which is easy to scroll past:

```
This version only understands SDK XML versions up to 3 but an SDK XML file
of version 4 was encountered.
```

Its own eventual error says the same thing:

> Install the missing components using the SDK manager in Android Studio.

So do that first: **SDK Manager → SDK Tools → NDK (Side by side)**.

If a Gradle attempt has already failed, delete what it left behind before
retrying. An interrupted install leaves `ndk/<version>/` holding only
`.installer`, and Gradle then reads that as installed-but-broken and stops
retrying altogether:

```
[CXX1101] NDK at ...\ndk\27.1.12297006 did not have a source.properties file
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

Steps 1 to 6 have been run on an emulator and pass — see "What has been
verified" below. Run them again anyway: an emulator has no radio to drop, no
battery to die and no operating system deciding to reclaim memory mid-sale, and
those are the conditions this list is really for. Steps 7 and 8 have not been
run at all.

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

## The emulator: what it does and does not settle

An Android Virtual Device is worth running before you find a phone, and worth
not trusting afterwards.

Use `10.0.2.2` as the API address — the emulator's alias for the host machine's
loopback. It is not `localhost` (that is the emulated device itself) and it needs
no LAN address or firewall rule, so it removes the two things most likely to
waste the first hour.

```
EXPO_PUBLIC_BACKEND=laravel
EXPO_PUBLIC_API_URL=http://10.0.2.2:8000
```

**Settled by an emulator**, and since confirmed rather than predicted — the
table under "What has been verified" lists what actually ran: building and
installing, the generated manifest, sign-in, device registration, the device
check, sync in both directions, an offline sale surviving a kill and draining
exactly once, a refund restocking, a schema migration keeping its data, and
anything the till renders.

**Settled without one, and worth doing first**, because it needs only curl and a
bearer token from `/api/auth/token`: the money paths over real HTTP. Pushing the
same `operation_id` three times must leave one order, one payment and one stock
movement. A refund must appear as a negative payment and put the goods back. A
second till refunding a sale the first has already refunded in full must be
refused. Each of those found something the handler tests did not, because a
handler test is written with a complete payload and a real client is not.

**Not settled by one, at all:** Bluetooth and USB printing. An AVD has no radio.
The printer service returns null when the native module is absent, so the app
should degrade to "no printer found" rather than crash — that is worth watching
for, but it is the fallback being tested, not printing.

The camera is a simulated scene rather than a lens, so barcode scanning against
it proves the plumbing and nothing about focus, glare or a creased label.

---

## What has been verified, and on what

**On an Android emulator against a local Laravel server.** An emulator is not a
phone: it has no Bluetooth radio, no real camera, no mobile network, no battery
and no memory pressure. Everything below is real evidence that the software
works; none of it is evidence that it works *on a phone in a shop*. The title of
this document still stands.

Each of these was broken when it was first tried. The value was never in the
green ticks — it was in the six faults found getting there, which are in the
CHANGELOG.

| Verified | Evidence |
|---|---|
| Development build installs and runs | Android 17 x86_64, native libs from `lib/x86_64` |
| Cleartext HTTP permission reaches the artefact | `usesCleartextTraffic="true"` in the generated manifest |
| The local database is real SQLite and persists | `omnipos.db`, `-wal`, `-shm` on disk; survives a force-stop |
| Sign-in against Laravel | Token issued, named after this device |
| The device registers | Row in `devices` whose id matches the token's |
| Catalogue pulls to the till | Products searchable with the network off |
| A sale rings up offline | Receipt issued, server confirmed it had not seen it |
| An offline sale survives being killed | Database byte-identical across a force-stop |
| It then syncs exactly once | One order, one payment, one movement |
| Mobile money reaches the books | `orders.payment_method=momo`, `payments.method=mobile_money` |
| A refund restocks | Payments `11.00` and `-11.00`, net `0.00`, stock 87 → 88 |
| Stock movements name their cause | `source_type=order` against the sale's id |
| A schema migration keeps the data | v6 → v7 in place: `user_version 7`, nothing reset |
| Printing degrades instead of crashing | "No Bluetooth printer is paired", zero errors |

---

## What is still untested

Being honest about the boundary:

- **Everything above was an emulator.** Nothing has run on a phone. Battery,
  memory pressure, a real radio dropping mid-request, a cracked screen in a
  shop — none of it is covered.
- **Printing, entirely.** An AVD has no Bluetooth radio, so only the fallback
  path has been exercised. The byte stream is correct against the ESC/POS
  specification and 36 byte-level tests, but whether a given printer honours
  `ESC t 16` for the code page, whether `GS V` cuts, and whether 48 characters
  fits the paper are all questions only a printer answers. The test slip's
  ruler line exists to settle the last one in seconds.
- **A cold start with no network.** Sales survive a restart, but a debug build
  fetches its JS from a dev server, so the app could not be *relaunched* while
  still offline. A production build embeds the bundle; test it there.
- **Two devices** — step 3 below. The conflict the whole design exists for has
  never been produced.
- **Background sync** while the app is not in the foreground.
- **Closing a drawer.** A shift was opened and sold against; the counted-versus-
  expected reconciliation at close was not exercised.
- **Settling a customer balance** from the till.
- **iOS specifically.** The Android path has had more thought here, and the ATS
  and local-network settings are reasoned rather than observed.
