# Changelog

Notable changes to OmniPOS: the Laravel backend, the web till, and the mobile app.

The three live in one repository and ship together, so they share this file.
Entries are grouped by component where that matters and left ungrouped where a
change spans all three, which the sync protocol usually does.

This is written for whoever is on call at seven in the morning when a shop
cannot take money. Where a bug is listed, the entry says what went wrong for the
shop, not only what changed in the code — the symptom is what someone will be
searching for.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates
are ISO. The project has no released versions yet; everything to date is
Unreleased and pre-production.

---

## [Unreleased]

### Fixed — running on a device

Nothing in this group was visible from a test suite. Each was found by putting
the app on hardware and using it, and several were hiding behind one another —
the database fault had to be fixed before the sync fault could even be reached.

- **The till had no persistent database.** It announced this on every launch and
  nobody had read it: `WMDatabaseBridge missing — using in-memory Loki (data
  resets on reload)`. An offline-first POS was keeping every sale in memory, so
  a sale rung up with no connection did not survive a restart. It also explains
  the slow start people noticed — a till rebuilding its schema and re-pulling
  the entire catalogue each time it opened.

  The cause was a dependency conflict in which the database quietly lost.
  WatermelonDB ships a legacy bridge module, and the New Architecture runs
  bridgeless, where legacy modules are never exposed to JS — so the bridge was
  compiled, linked, listed in `PackageList.java`, and invisible. Turning the New
  Architecture off then failed to build, because Reanimated 4 requires it. That
  turned out to be dead weight: nothing imported it, no babel plugin was
  configured for it, and its only referrer was an optional peer. An animation
  library the app never used was dictating an architecture that broke the local
  database.

- **`npm start` could not run this app at all.** The scripts said `expo start
  --go`, and Expo Go cannot load a project with third-party native modules or
  config plugins at any SDK version. The error it produced advised upgrading to
  SDK 57, which would not have helped.

- **Every sync died on a duplicate key.** A changefeed carries a row per write,
  so a record edited twice arrived twice in one page, and both occurrences took
  the create path into a single batch: `UNIQUE constraint failed: products.id`.
  The pull threw, so nothing synced and the till read "Not synced yet" for ever
  while retrying the identical doomed batch. Only reachable once the database
  persisted — an empty database on every launch had been hiding it.

- **No till had ever registered as a device**, because `registerDevice()` was
  written and never called. The pull sends `device_id` so the server can
  withhold a till's own writes from its own changefeed; an unknown device
  defeats that, and the till pulled back everything it had just pushed.

- **Two tills could not both stay signed in.** The access token is named after
  the device so that re-authenticating replaces its own token, and the server
  deletes any existing token of that name. But auth read the device id straight
  from storage instead of through the function that mints it, and on a fresh
  install that key does not exist yet — sign-in precedes the first sync. Every
  new till authenticated as `mobile:unregistered`, so the second sign-in in a
  shop revoked the first.

### Fixed — money and stock

These are the ones that would have cost a shop real money. Each was found by
pushing to a running server over HTTP rather than by calling a handler directly,
because a handler test is written with a complete, well-formed payload and a real
client is not. Every one of them lived in that gap.

- **Mobile money sales from a phone never reached the books.** The mobile till's
  payment picker says "MoMo" and sends `momo`; the `payments` table has a check
  constraint naming `mobile_money`. Nothing translated between them, so Postgres
  refused the row and failed the entire order push with it. The sale stayed in
  the outbox — in the market where mobile money is how most people pay. Cash and
  card, the two a developer is most likely to test with, went through fine.

  `Payment::canonicalMethod` is now the single place a method string is
  understood. It returns null rather than a fallback so each caller decides what
  an unrecognised method costs: booking a sale it costs `other`, because the
  customer paid and left with the goods and losing the sale is worse than
  recording it imprecisely; recording a settlement it is still a conflict,
  because that is typed deliberately and can be corrected.

- **A refund could pay out and leave the goods off the shelf.** `ReturnHandler`
  took `product_id` from the client's return line and, when it was absent,
  skipped the restock with a bare `continue` — while still refunding. Customer
  paid, stock still down, and nothing recorded that the goods had not come back.
  The inventory is wrong from that moment and the ledger meant to explain it has
  no entry. A shop would find it at stock take, months later, as an unexplained
  shortfall.

  The order line already settles which product was sold, and eligibility loads it
  moments earlier to prove the line belongs to the sale. It is the authority now.
  That also closes the opposite failure: a till with a stale cache naming a
  *different* product would have restocked the wrong one, which is worse than not
  restocking at all — two products wrong instead of one, and neither obviously.

- **Historic mobile money sales imported as an unidentified tender.** The
  Supabase importer matched three methods and defaulted everything else to
  `other`, which drawer reconciliation deliberately ignores. It shares the
  normaliser now, so history arrives as what it was. The pre-flight audit checks
  against everything the target *accepts* rather than only what it *stores*, so
  `momo` is no longer reported as data loss it does not cause — reporting a
  non-problem is not harmless, it teaches people to skim the audit.

- **Sales reached the server with no line items at all.** The order push sent a
  total and nothing else — three consecutive sales on a device all landed with
  `order_items = 0`. So no product had ever appeared in a report, and a refund
  was impossible: the returns screen asks the server which lines are still
  eligible and was told there were none, against a sale the cashier is holding
  the receipt for.

  Sending the lines alone would have been worse than the bug. The server records
  a stock movement per order line, borrowing the line's id so a replay cannot
  decrement twice — while the till pushed its own movement too, under a
  different id. Both survive. Measured before changing the app: one unit sold
  took a product from 90 to 88. The till no longer pushes movements it does not
  own, which is what the code already claimed in a comment and simply was not
  doing.

  The same payload was sending tax and discount *rates* but not the amounts,
  which are separate stored columns. Both defaulted to zero, so a receipt
  reprinted from the server showed no tax on a sale that had charged it.

- **A stock movement did not say which sale caused it.** The server had always
  read `source_type` and `source_id` from the push, and set them on movements it
  derived itself; only the ones a till pushed arrived without. The ledger
  recorded that a unit had left the shelf and not why, which at a stock take is
  a decrement nobody can tie back to a receipt.

  It was an ordering problem rather than a forgotten field: stock moved before
  the order row existed, so there was no id to record. The id is minted at the
  top of checkout now — which is what client-minted UUIDv7 is for — and is
  available to the rollback path too, the moment tracing matters most.

- **`refund_method` went into the constrained column unnormalised**, through
  `$x === 'cash' ? 'cash' : $x` — a ternary whose two arms are the same value, so
  it did nothing while looking like it handled a case. No shipping client refunds
  by a method that fails the constraint today, which is exactly the position the
  sale path was in before someone renamed a picker.

### Fixed — receipts

- **Receipts printed today's tax rates rather than what the sale was charged.**
  The layout took `taxRate`, `vatRate` and `discountValue` and derived the
  subtotal, tax and total itself, so a receipt reprinted after a VAT change
  printed the new rate applied to an old sale, and rounding could differ by a
  penny from what the customer actually paid. The query did not even select the
  stored totals. The charged figures now win on the printed receipt, the
  on-screen one and the PDF alike.

- **The cedi sign printed as `?`.** U+20B5 is in no printer code page, so every
  line of a Ghanaian receipt read `?16.00`. Only the dollar happened to survive,
  which is the worst kind of bug — correct on the one currency a developer is
  most likely to test with. Receipts use the currency code, as the web till
  already did.

- **The tender line always read "Other".** The amount came from `amount_paid` and
  the method was never read, so a cash sale reprinted on a phone showed a tender
  nobody had used. It reads `payment_method` now, and the builder labels both
  `momo` and `mobile_money`: the server stores the till's own spelling on the
  order and the canonical one on the payment, so the same sale reaches a receipt
  under two different names depending on which path fetched it.

- **Reprints are marked as such.** Anything opened from the receipt screen is a
  second copy by definition, the first having printed at the till, and two
  identical receipts is how a refund gets processed twice.

### Fixed — operability

- **`/api/auth/login` returned a bare 500 when `SANCTUM_STATEFUL_DOMAINS` did not
  name the deployed frontend.** No session exists in that case, so
  `session()->regenerate()` threw. That misconfiguration is the first thing to go
  wrong on a deploy to a real domain, and a 500 tells whoever is debugging it
  nothing — not which setting, not which value. It is also the wrong status,
  since nothing on the server is broken. It answers 419 now, naming the setting
  and echoing back the host it saw, which is the value that has to go in the
  list. The web login page surfaces that text verbatim.

- **A cashier-facing message disagreed with its own number** — "1 were
  requested", shown when refusing an over-refund. It is read by someone who has
  just told a customer no.

- **`expo-font` resolved to a version from a much later SDK**, crashing every
  development build on launch with
  `NoSuchMethodError: No static method getDirectConverter`.
  `@expo/vector-icons` declares `expo-font` as a peer with an unbounded
  `>=14.0.4`, and npm's auto-peer-install resolved that to the newest version in
  existence rather than reusing the copy `expo` already provides. The newer one
  won the hoist and got autolinked against an older `expo-modules-core`. Pinned
  through an `overrides` entry to the version the SDK uses, which still satisfies
  the peer range.

### Added

- **ESC/POS receipt printing**, on the web till over Web Serial and Web
  Bluetooth, and on mobile through the native `printRaw` bridge. Bytes are
  written by hand against the Epson specification rather than delegated to a
  library's own job format, because a receipt is a legal document in most places
  this runs and "it looked right on the one printer we had" is not a test. The
  encoder is covered by byte-level assertions.

  The two clients are separate npm packages with no shared workspace, so the
  encoder exists twice — with a test that fails the build if the copies drift. A
  receipt that differs between a phone and a browser till is a shop handing out
  two documents for one sale.

  Never yet sent to a physical printer. `Test print` exists for that, with a
  ruler for checking paper width.

- **Supabase migration tooling**: a pre-flight audit that reports every shape the
  target will refuse — duplicate receipt numbers, duplicate SKUs within a store,
  non-bcrypt password hashes, orphaned stores, out-of-range tax rates — and an
  importer rehearsed end to end against stand-in databases.

- **The web till**, brought to parity with the mobile app: drawer, returns,
  receipts, catalogue writes, settings, staff, reports, void, stock takes,
  statements, categories, images, platform admin, CSV import/export, camera
  scanning, light and dark themes.

- **Standalone PostgreSQL and Laravel backend**, replacing Supabase. Sanctum
  serves both clients — cookie session for the browser, bearer token for devices.
  `EnsureStoreAccess` middleware replaces row-level security.

- **Device Check** on mobile: a diagnostic screen reporting backend, API address,
  reachability, clock, secure storage, local database, sign-in, sync protocol and
  outbox, each failure carrying what to do about it. The whole run can be shared
  as text, so a tester on a shop floor can send it without a screenshot.

- **The till's own ledger records what caused a movement** (local schema 7).
  `source_type` and `source_id` now exist on the device as well as the server,
  so a till can answer "which sale took this unit" without a connection — which
  is the situation it is built for.

  The migration is the part that can destroy money: WatermelonDB resets a
  database it cannot find an upgrade path for, discarding sales a till has not
  yet pushed. A test now asserts that a migration exists for the declared
  version, that the version equals the highest migration, that the path has no
  gaps, and that no version is declared twice.

### Changed

- **Sync is idempotent on `operation_id`**, verified over HTTP: three pushes of
  one operation leave one order, one payment and one stock movement. This is the
  retry-after-a-dropped-response case, which is the one that double-charges a
  customer.

- **Inventory is a ledger.** `stock_movements` is authoritative and
  `products.stock` is a derived cache, reconciled from history rather than
  incremented in place.

- **Refunds are negative payments** in the same ledger, so a drawer reconciles
  against what actually happened rather than against sales alone.

- **Over-refunds are refused across tills**, counted against every return already
  recorded for a line rather than only the ones the pushing till knows about. Two
  tills refunding the same sale while offline is exactly how a shop pays out
  twice.

### Known gaps

Stated plainly, because a changelog that only lists wins is a sales document.

- **ESC/POS has never reached a physical printer**, on either client.
- **Refunds taken on a phone are always booked as cash** — the mobile returns
  flow has no method picker, while the web till has had one throughout. A refund
  booked as cash reduces the drawer's *expected* cash, so if the money actually
  went back by mobile money the till counts **over** by the refund amount, every
  time. *A refund method picker exists in a working branch and has been seen
  working on a device; this entry stands until it lands.*
- **A cash refund makes the drawer look short at closing time.** The till
  computes expected cash by walking its local orders and summing the cash ones;
  it never subtracts refunds, and the device has no local returns table to
  subtract them from. Demonstrated on a device: after one ₵11 cash refund, a
  drawer holding exactly the right money was reported **"Cash Short by
  -₵11.00"**. A cashier is accused of losing money they handed back correctly,
  every time they refund cash. The server's own `computeExpectedCash` sums
  payments including the negative refund, so the two disagree and the *till* is
  the wrong one.

- **A cold start with no network is unproven.** Sales survive a restart — the
  database files are untouched by a force-stop, and a sale rung up offline
  synced exactly once afterwards. But a debug build fetches its JS from a dev
  server, so the app could not be *relaunched* while still offline. A
  production build embeds the bundle; that is the one to test it on.
- **Bluetooth printing, background sync, and iOS** are unexercised on real
  hardware.
- **The Supabase publishable key in `omnipos-mobile/.env.example`** is real and
  already in remote history. The repository is private, but the key should be
  rotated when Supabase is retired.

---

## Notes on this file

Entries are added in the same commit as the change they describe, not swept up
afterwards — a changelog assembled from memory at release time is a changelog of
what someone remembered.

That rule has been broken once already: the device-testing entries were written
in a batch afterwards, reconstructed from commit messages rather than memory.
Recorded here because a rule nobody admits to breaking stops being one.

Prefer the symptom over the mechanism in the first sentence. "Mobile money sales
never reached the books" is findable; "normalise payment method vocabulary" is
not, by anyone who does not already know what went wrong.
