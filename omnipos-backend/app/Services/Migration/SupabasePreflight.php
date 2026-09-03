<?php

namespace App\Services\Migration;

use App\Models\Payment;
use App\Services\Migration\LegacyStatus;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Facades\DB;

/**
 * What will go wrong, before anything is written.
 *
 * The importer is idempotent and additive, which makes a failed run survivable —
 * but a run that stops two thirds of the way through still leaves someone
 * deciding at midnight whether to carry on or start again. Every problem this
 * finds is one that would otherwise be found then.
 *
 * It reads the source and this database, and writes to neither. Safe to run
 * against production Supabase at any time, and the intended first step of a
 * rehearsal.
 *
 * Findings are graded, and the grade is the useful part:
 *
 *   BLOCKING — the row cannot be inserted. A unique violation, a missing
 *              parent, a value the target's check constraint refuses. The
 *              import will stop or skip, and somebody has to decide which.
 *   ALTERED  — the row will import, but not unchanged. A price that will be
 *              rounded, a status that will be mapped. Nobody is harmed, but a
 *              reconciliation afterwards will show it and should not surprise.
 *   NOTE     — worth knowing before cutover. Data that exists in Supabase and
 *              has nowhere to land.
 */
class SupabasePreflight
{
    public const BLOCKING = 'blocking';
    public const ALTERED = 'altered';
    public const NOTE = 'note';

    /** Types the target's check constraint accepts. */
    private const MOVEMENT_TYPES = [
        'STOCK_IN', 'STOCK_OUT', 'SALE', 'RETURN', 'ADJUSTMENT',
        'DAMAGE', 'EXPIRED', 'AUDIT', 'TRANSFER_IN', 'TRANSFER_OUT',
    ];

    private const ROLES = ['admin', 'manager', 'cashier'];

    /** @var array<int, array{grade: string, area: string, count: int, detail: string, examples: array}> */
    private array $findings = [];

    /*
     * Source tables are named WITHOUT a schema, exactly as SupabaseImporter
     * names them, so the connection's own search_path resolves them: `public,
     * auth` against a real project and `legacy,auth` against the mock schema the
     * tests build. Qualifying them with `legacy.` made this audit work only
     * under test — which is the one place it is not needed.
     *
     * auth.users stays qualified because that is where GoTrue puts it in both.
     */
    private function source(): ConnectionInterface
    {
        return DB::connection('supabase');
    }

    /**
     * @return array<int, array{grade: string, area: string, count: int, detail: string, examples: array}>
     */
    public function run(): array
    {
        $this->findings = [];

        $this->checkUsers();
        $this->checkStores();
        $this->checkMembership();
        $this->checkProducts();
        $this->checkBatches();
        $this->checkStockMovements();
        $this->checkOrders();
        $this->checkOrderItems();
        $this->checkPayments();
        $this->checkReturns();
        $this->checkCollisionsWithTarget();

        return $this->findings;
    }

    public function blocking(array $findings): int
    {
        return count(array_filter($findings, fn ($f) => $f['grade'] === self::BLOCKING));
    }

    private function add(string $grade, string $area, int $count, string $detail, array $examples = []): void
    {
        if ($count === 0) {
            return;
        }

        $this->findings[] = [
            'grade' => $grade,
            'area' => $area,
            'count' => $count,
            'detail' => $detail,
            'examples' => array_slice($examples, 0, 5),
        ];
    }

    /** Rows matching a raw condition, with a few ids to go and look at. */
    /** @see SupabaseImporter::sourceHasTable() — same reasoning. */
    private function sourceHasTable(string $table): bool
    {
        return $this->source()->getSchemaBuilder()->hasTable($table);
    }

    private function scan(string $sql, array $bindings = []): array
    {
        $rows = $this->source()->select($sql, $bindings);

        return [
            'count' => count($rows),
            'examples' => array_map(fn ($r) => (array) $r, array_slice($rows, 0, 5)),
        ];
    }

    /**
     * users.email is unique in the target and Supabase does not guarantee it —
     * GoTrue allows the same address in different providers, and a shop that
     * once used both a password and a magic link can have two rows.
     */
    private function checkUsers(): void
    {
        $dupes = $this->scan(
            "select lower(email) as email, count(*) as n from auth.users
             where email is not null group by lower(email) having count(*) > 1"
        );
        $this->add(self::BLOCKING, 'users', $dupes['count'],
            'Two or more accounts share an email address. The target makes email unique, so one of each pair will not import.',
            $dupes['examples']);

        $noEmail = $this->scan("select id from auth.users where email is null or btrim(email) = ''");
        $this->add(self::BLOCKING, 'users', $noEmail['count'],
            'Accounts with no email address. They cannot be created, and anything they own will lose its owner.',
            $noEmail['examples']);

        /*
         * A hash the target cannot verify is not a failed import — the row lands
         * and the person simply can never sign in, which is discovered on the
         * morning of cutover by the person least able to wait.
         */
        /*
         * An empty string is not a hash in an algorithm we cannot read — it is
         * no password at all, which is the case immediately below and only a
         * note. GoTrue writes '' rather than NULL for an account that signs in
         * by magic link or a provider, and the original test for this used
         * `is not null`, so every one of them was reported as a blocking
         * algorithm problem.
         *
         * That matters at cutover, not in the abstract: blocking findings have
         * to be cleared before the import may run, so a migration would stall
         * while somebody hunted for a hash format that was never there.
         */
        $badHash = $this->scan(
            "select id, email from auth.users
             where encrypted_password is not null
               and encrypted_password <> ''
               and encrypted_password not like '\$2%'"
        );
        $this->add(self::BLOCKING, 'users', $badHash['count'],
            'Password hashes that are not bcrypt. These accounts import but cannot sign in; they need a reset.',
            $badHash['examples']);

        $noHash = $this->scan(
            "select id, email from auth.users where encrypted_password is null or encrypted_password = ''"
        );
        $this->add(self::NOTE, 'users', $noHash['count'],
            'Accounts with no password at all, normally invite-only or a provider sign-in. They import, and will '
            .'need a reset before they can sign in to a system that only has passwords.',
            $noHash['examples']);
    }

    private function checkStores(): void
    {
        $orphan = $this->scan(
            'select s.id, s.name from stores s
             left join auth.users u on u.id = s.owner_user_id
             where s.owner_user_id is null or u.id is null'
        );
        $this->add(self::BLOCKING, 'stores', $orphan['count'],
            'Stores whose owner is missing from auth.users. owner_user_id is a restricted foreign key, so these cannot import.',
            $orphan['examples']);

        $badParent = $this->scan(
            'select s.id, s.name from stores s
             where s.parent_store_id is not null
               and not exists (select 1 from stores p where p.id = s.parent_store_id)'
        );
        $this->add(self::BLOCKING, 'stores', $badParent['count'],
            'Branches pointing at a parent store that does not exist.',
            $badParent['examples']);

        foreach (['tax_rate', 'vat_rate', 'service_rate'] as $column) {
            $range = $this->scan(
                "select id, name, {$column} from stores where {$column} < 0 or {$column} > 100"
            );
            $this->add(self::BLOCKING, 'stores', $range['count'],
                "Stores whose {$column} is outside 0–100, which the target refuses.",
                $range['examples']);
        }
    }

    private function checkMembership(): void
    {
        $roles = $this->scan(
            'select store_id, user_id, role from store_members where role not in (?, ?, ?)',
            self::ROLES
        );
        $this->add(self::BLOCKING, 'store_members', $roles['count'],
            'Memberships with a role the target does not recognise.',
            $roles['examples']);

        $dupes = $this->scan(
            'select store_id, user_id, count(*) as n from store_members
             group by store_id, user_id having count(*) > 1'
        );
        $this->add(self::BLOCKING, 'store_members', $dupes['count'],
            'The same person listed twice in one store. The target allows one membership per person per store.',
            $dupes['examples']);

        /*
         * Not a constraint, but the one that strands a shop: a store nobody can
         * administer needs another admin to repair, and after cutover there may
         * not be one.
         */
        $noAdmin = $this->scan(
            "select s.id, s.name from stores s
             where not exists (
               select 1 from store_members m where m.store_id = s.id and m.role = 'admin'
             )"
        );
        $this->add(self::NOTE, 'store_members', $noAdmin['count'],
            'Stores with no admin. They will import, but nobody will be able to manage staff or settings in them.',
            $noAdmin['examples']);
    }

    private function checkProducts(): void
    {
        $dupes = $this->scan(
            "select store_id, sku, count(*) as n from products
             where sku is not null and btrim(sku) <> ''
             group by store_id, sku having count(*) > 1"
        );
        $this->add(self::BLOCKING, 'products', $dupes['count'],
            'The same SKU used twice in one store. The target makes (store, SKU) unique.',
            $dupes['examples']);

        $noSku = $this->scan("select id, name from products where sku is null or btrim(sku) = ''");
        $this->add(self::BLOCKING, 'products', $noSku['count'],
            'Products with no SKU. The importer cannot invent one that will still match a barcode on a shelf.',
            $noSku['examples']);

        $negative = $this->scan('select id, name, price from products where price < 0');
        $this->add(self::BLOCKING, 'products', $negative['count'],
            'Products priced below zero, which the target refuses.',
            $negative['examples']);

        $orphan = $this->scan(
            'select p.id, p.name from products p
             where not exists (select 1 from stores s where s.id = p.store_id)'
        );
        $this->add(self::BLOCKING, 'products', $orphan['count'],
            'Products belonging to a store that does not exist.',
            $orphan['examples']);
    }

    private function checkBatches(): void
    {
        /*
         * batch_number is NOT NULL in the target and the shop may never have
         * used lot numbers. Flagged rather than silently defaulted, because a
         * generated number that appears in a stock report is worse than one
         * somebody chose.
         */
        $noNumber = $this->scan(
            "select id, product_id from product_batches
             where batch_number is null or btrim(batch_number) = ''"
        );
        $this->add(self::BLOCKING, 'product_batches', $noNumber['count'],
            'Batches with no batch number. The target requires one.',
            $noNumber['examples']);

        $dupes = $this->scan(
            'select store_id, product_id, batch_number, count(*) as n from product_batches
             where batch_number is not null
             group by store_id, product_id, batch_number having count(*) > 1'
        );
        $this->add(self::BLOCKING, 'product_batches', $dupes['count'],
            'The same batch number recorded twice for one product.',
            $dupes['examples']);

        $orphan = $this->scan(
            'select b.id from product_batches b
             where not exists (select 1 from products p where p.id = b.product_id)'
        );
        $this->add(self::BLOCKING, 'product_batches', $orphan['count'],
            'Batches for a product that does not exist.',
            $orphan['examples']);
    }

    private function checkStockMovements(): void
    {
        $placeholders = implode(',', array_fill(0, count(self::MOVEMENT_TYPES), '?'));

        $unknown = $this->scan(
            "select distinct type from stock_movements
             where upper(type) not in ({$placeholders})",
            self::MOVEMENT_TYPES
        );
        $this->add(self::ALTERED, 'stock_movements', $unknown['count'],
            'Movement types the target does not have. The importer maps what it recognises and falls back to ADJUSTMENT; anything here should be checked.',
            $unknown['examples']);

        $orphan = $this->scan(
            'select m.id from stock_movements m
             where not exists (select 1 from products p where p.id = m.product_id)'
        );
        $this->add(self::BLOCKING, 'stock_movements', $orphan['count'],
            'Movements for a product that does not exist. These are ledger rows, so losing them changes a stock figure.',
            $orphan['examples']);
    }

    private function checkOrders(): void
    {
        $dupes = $this->scan(
            'select store_id, order_number, count(*) as n from orders
             group by store_id, order_number having count(*) > 1'
        );
        $this->add(self::BLOCKING, 'orders', $dupes['count'],
            'The same receipt number used twice in one store. The target makes (store, number) unique, and each of these is a sale a customer holds a receipt for.',
            $dupes['examples']);

        $noNumber = $this->scan("select id from orders where order_number is null or btrim(order_number) = ''");
        $this->add(self::BLOCKING, 'orders', $noNumber['count'],
            'Sales with no receipt number.',
            $noNumber['examples']);

        /*
         * Graded against the importer's own mapping rather than a list kept
         * here. The two disagreed once: this said "each will be mapped" for a
         * status the importer passed straight through, and the run it had
         * blessed died on a check constraint part way through the orders step.
         */
        $distinct = $this->source()->select('select distinct status from orders');
        $unmapped = [];
        $remapped = [];

        foreach ($distinct as $row) {
            $status = $row->status;

            if (! LegacyStatus::known($status)) {
                $unmapped[] = ['status' => $status];
            } elseif (LegacyStatus::changes($status)) {
                $remapped[] = ['status' => $status, 'becomes' => LegacyStatus::map($status)];
            }
        }

        $this->add(self::BLOCKING, 'orders', count($unmapped),
            'Order statuses with no equivalent here. The import refuses them rather than guessing, because the mapping decides whether the sale counts towards revenue.',
            $unmapped);

        $this->add(self::ALTERED, 'orders', count($remapped),
            'Order statuses that become a different value. Check the mapping is what you would have chosen.',
            $remapped);

        $orphan = $this->scan(
            'select o.id, o.order_number from orders o
             where not exists (select 1 from stores s where s.id = o.store_id)'
        );
        $this->add(self::BLOCKING, 'orders', $orphan['count'],
            'Sales belonging to a store that does not exist.',
            $orphan['examples']);

        $negative = $this->scan('select id, order_number, total from orders where total < 0 or amount_paid < 0');
        $this->add(self::BLOCKING, 'orders', $negative['count'],
            'Sales with a negative total or amount paid, which the target refuses.',
            $negative['examples']);

        /*
         * Not a constraint, but it is the number a shop will check first after
         * cutover. Better to know now which sales will not add up than to be
         * asked about them.
         */
        $mismatch = $this->scan(
            "select o.id, o.order_number, o.total, coalesce(sum(i.line_total), 0) as lines
             from orders o
             left join order_items i on i.order_id = o.id
             where o.status = 'completed'
             group by o.id, o.order_number, o.total
             having abs(o.total - coalesce(sum(i.line_total), 0) + coalesce(o.discount, 0) - coalesce(o.tax, 0)) > 0.01"
        );
        $this->add(self::NOTE, 'orders', $mismatch['count'],
            'Sales whose total does not equal their lines less discount plus tax. They import as they are; the difference was already in Supabase.',
            $mismatch['examples']);
    }

    private function checkOrderItems(): void
    {
        $orphan = $this->scan(
            'select i.id from order_items i
             where not exists (select 1 from orders o where o.id = i.order_id)'
        );
        $this->add(self::BLOCKING, 'order_items', $orphan['count'],
            'Sale lines whose sale does not exist.',
            $orphan['examples']);

        $quantity = $this->scan('select id, order_id, quantity from order_items where quantity <= 0');
        $this->add(self::BLOCKING, 'order_items', $quantity['count'],
            'Sale lines with a quantity of zero or less, which the target refuses.',
            $quantity['examples']);
    }

    private function checkPayments(): void
    {
        /*
         * Against everything the target accepts, not only what it stores. The
         * legacy 'momo' is imported as mobile_money and loses nothing, so
         * reporting it as data loss would send someone hunting a problem that
         * is not there — and worse, teach them to skim this section.
         */
        $accepted = Payment::acceptedMethodInputs();
        $placeholders = implode(',', array_fill(0, count($accepted), '?'));

        $unknown = $this->scan(
            "select distinct payment_method from orders
             where payment_method is not null and lower(payment_method) not in ({$placeholders})",
            array_map('strtolower', $accepted)
        );
        $this->add(self::ALTERED, 'payments', $unknown['count'],
            "Payment methods the target does not have. These become 'other', which is deliberately excluded from cash drawer reconciliation.",
            $unknown['examples']);

        /*
         * Supabase kept no payment rows — the importer synthesises one per sale
         * from amount_paid. A split sale therefore arrives as a single 'other'
         * tender, and its cash portion is unknown for ever.
         */
        $split = $this->scan(
            "select count(*) as n from orders where lower(coalesce(payment_method, '')) = 'split'"
        );
        $splitCount = (int) ($split['examples'][0]['n'] ?? 0);
        $this->add(self::NOTE, 'payments', $splitCount > 0 ? 1 : 0,
            sprintf(
                "%d %s paid by split tender. Supabase did not record the breakdown, so %s as a single 'other' payment and %s cash portion cannot be recovered.",
                $splitCount,
                $splitCount === 1 ? 'sale was' : 'sales were',
                $splitCount === 1 ? 'it imports' : 'they import',
                $splitCount === 1 ? 'its' : 'their',
            ),
            []);
    }

    private function checkReturns(): void
    {
        $orphan = $this->scan(
            'select r.id from returns r
             where not exists (select 1 from orders o where o.id = r.order_id)'
        );
        $this->add(self::BLOCKING, 'returns', $orphan['count'],
            'Refunds against a sale that does not exist.',
            $orphan['examples']);

        /*
         * The target re-checks eligibility on every refund. Historical data that
         * breaks the rule imports fine — it is inserted directly, not pushed —
         * but it will make the remaining-eligible figure negative for that line,
         * and a cashier will see it.
         */
        /*
         * Some projects have no return_items at all: a refund is one row with an
         * amount and no line detail. Nothing can be checked, and nothing can be
         * migrated either, so it is reported as the loss it is rather than
         * crashing the audit — which is what it did, before any finding at all
         * had been printed.
         */
        if (! $this->sourceHasTable('return_items')) {
            $returns = $this->scan('select count(*) as n from returns');
            $count = (int) ($returns['examples'][0]['n'] ?? 0);

            $this->add(self::ALTERED, 'return_items', $count > 0 ? 1 : 0,
                sprintf(
                    '%d %s recorded without line detail: this source has no return_items table. '
                    .'The refund amount carries over, but which goods came back does not, so nothing is restocked '
                    .'and the sale lines will show as never returned.',
                    $count,
                    $count === 1 ? 'refund is' : 'refunds are',
                ));

            return;
        }

        $over = $this->scan(
            'select ri.order_item_id, oi.quantity as sold, sum(ri.quantity) as returned
             from return_items ri
             join order_items oi on oi.id = ri.order_item_id
             group by ri.order_item_id, oi.quantity
             having sum(ri.quantity) > oi.quantity'
        );
        $this->add(self::NOTE, 'return_items', $over['count'],
            'Sale lines with more returned than was ever sold. They import, but the line will show as over-returned to a cashier.',
            $over['examples']);
    }

    /**
     * What is already here.
     *
     * A rehearsal is run against a database that may not be empty, and a second
     * production run happens at cutover on top of the first. Both need to know
     * that a collision is an existing row rather than a new problem.
     */
    private function checkCollisionsWithTarget(): void
    {
        $emails = $this->source()->select("select lower(email) as email from auth.users where email is not null");
        $addresses = array_column(array_map(fn ($r) => (array) $r, $emails), 'email');

        if ($addresses === []) {
            return;
        }

        $existing = DB::table('users')
            ->whereIn(DB::raw('lower(email)'), $addresses)
            ->pluck('email')
            ->all();

        $this->add(self::NOTE, 'target', count($existing),
            'Accounts already in this database with the same email as a Supabase account. The importer will leave them as they are rather than overwriting.',
            array_map(fn ($e) => ['email' => $e], $existing));

        $stores = DB::table('stores')->count();
        $this->add(self::NOTE, 'target', $stores > 0 ? 1 : 0,
            "This database already holds {$stores} stores. A rehearsal should run against an empty one, or the counts afterwards will not match Supabase.",
            []);
    }
}
