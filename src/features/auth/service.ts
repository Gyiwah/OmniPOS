import { supabase } from "@/src/services/supabase";

export const authService = {
  async signOut() {
    await supabase.auth.signOut();
  },
};
