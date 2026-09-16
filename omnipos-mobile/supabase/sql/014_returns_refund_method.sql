-- OmniPOS Migration: record how a refund was paid back
--
-- A refund is money leaving on a particular channel. Without this column every
-- return looked like cash, so a refund handed back by mobile money still
-- reduced the drawer's expected cash and left an honest till counting over by
-- the refund amount.
--
-- The vocabulary matches the Laravel schema (public.payments.method there), so
-- a shop that migrates keeps the same words. The mobile till's own spelling
-- 'momo' is accepted here as well: its checkout picker has always stored that,
-- and refusing it would lose the refund rather than the label.

alter table public.returns
  add column if not exists refund_method text not null default 'cash'
  check (refund_method in ('cash', 'card', 'transfer', 'mobile_money', 'momo', 'store_credit', 'loyalty', 'other'));
