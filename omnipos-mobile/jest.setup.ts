/**
 * Unit tests exercise pure logic and the local WatermelonDB layer; they must never
 * reach a real backend. The Supabase client module throws at import time when its
 * env vars are absent, so placeholder values are supplied here. Any test that
 * actually performs a network call should mock the client explicitly.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL ||= "http://localhost:54321";
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
