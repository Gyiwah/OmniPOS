import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Mail } from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";
import { toast } from "@/state/toast";

type Member = {
  id: string;
  user_id: string;
  role: string;
  name: string | null;
  email: string | null;
};

type Invite = {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string | null;
};

const ROLES = ["admin", "manager", "cashier"];

export function StaffSection() {
  const can = useSession((s) => s.can);
  const currentUserId = useSession((s) => s.user?.id);
  const storeId = useSession((s) => s.storeId);
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<"direct" | "invite">("direct");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("cashier");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const isAdmin = can(["admin"]);
  const mayManage = can(["admin", "manager"]);

  const members = useQuery({
    queryKey: ["store-members", storeId],
    queryFn: async () => (await api.get<{ data: Member[] }>("/api/store-members")).data ?? [],
    enabled: Boolean(storeId) && mayManage,
  });

  const invites = useQuery({
    queryKey: ["store-invites", storeId],
    queryFn: async () => (await api.get<{ data: Invite[] }>("/api/store-invites")).data ?? [],
    enabled: Boolean(storeId) && mayManage,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["store-members"] });
    await queryClient.invalidateQueries({ queryKey: ["store-invites"] });
  };

  const fail = (error: unknown) => {
    const msg = error instanceof Error ? error.message : "That did not work.";
    setNotice({ kind: "error", text: msg });
    toast.error(msg);
  };

  const addDirect = useMutation({
    mutationFn: () =>
      api.post("/api/store-members", {
        name: name.trim(),
        email: email.trim(),
        password: password.trim(),
        role,
      }),
    onSuccess: async () => {
      const addedName = name.trim();
      setName("");
      setEmail("");
      setPassword("");
      const msg = `Staff member "${addedName}" added successfully.`;
      setNotice({ kind: "ok", text: msg });
      toast.success(msg);
      await refresh();
    },
    onError: fail,
  });

  const invite = useMutation({
    mutationFn: () => api.post<{ message: string }>("/api/store-invites", { email: email.trim(), role }),
    onSuccess: async (res) => {
      setEmail("");
      setNotice({ kind: "ok", text: res.message });
      toast.success(res.message);
      await refresh();
    },
    onError: fail,
  });

  const changeRole = useMutation({
    mutationFn: (input: { id: string; role: string }) =>
      api.patch(`/api/store-members/${input.id}`, { role: input.role }),
    onSuccess: async () => {
      setNotice({ kind: "ok", text: "Role updated." });
      toast.success("Role updated.");
      await refresh();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/store-members/${id}`),
    onSuccess: async () => {
      setNotice({ kind: "ok", text: "Removed from this store." });
      toast.success("Staff member removed.");
      await refresh();
    },
    onError: fail,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/api/store-invites/${id}`),
    onSuccess: async () => {
      setNotice({ kind: "ok", text: "Invite revoked." });
      toast.success("Invite revoked.");
      await refresh();
    },
    onError: fail,
  });

  if (!mayManage) return null;

  const pending = (invites.data ?? []).filter((i) => i.status === "pending");

  return (
    <section className="drawer-card">
      <h2>Staff</h2>

      {notice && <p className={`notice notice-${notice.kind}`} role="status">{notice.text}</p>}

      <table className="table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th /></tr>
        </thead>
        <tbody>
          {(members.data ?? []).map((m) => (
            <tr key={m.id}>
              <td>{m.name ?? "—"}</td>
              <td className="mono">{m.email ?? "—"}</td>
              <td>
                <select
                  value={m.role}
                  aria-label={`Role for ${m.name ?? m.email ?? "member"}`}
                  onChange={(e) => changeRole.mutate({ id: m.id, role: e.target.value })}
                  disabled={changeRole.isPending}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r} disabled={r === "admin" && !isAdmin}>
                      {r}
                    </option>
                  ))}
                </select>
              </td>
              <td className="row-actions">
                {isAdmin && m.user_id !== currentUserId && (
                  <button type="button" className="link danger" onClick={() => remove.mutate(m.id)}>
                    Remove
                  </button>
                )}
                {m.user_id === currentUserId && <span className="muted">you</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {pending.length > 0 && (
        <>
          <h3 className="settings-subhead">Invited, not yet signed in</h3>
          <ul className="tender-list">
            {pending.map((i) => (
              <li key={i.id}>
                <span className="mono">{i.email}</span>
                <span>{i.role}</span>
                <button type="button" className="link danger" onClick={() => revoke.mutate(i.id)}>Revoke</button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div style={{ marginTop: "1.5rem", marginBottom: "0.8rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <h3 className="settings-subhead" style={{ margin: 0 }}>Add Staff Member</h3>
        <div className="segmented-control" style={{ display: "flex", gap: "0.25rem", background: "var(--panel-2)", padding: "2px", borderRadius: "var(--radius-pill)" }}>
          <button
            type="button"
            className={`secondary-button${mode === "direct" ? " active" : ""}`}
            style={{ padding: "0.25rem 0.75rem", fontSize: "0.82rem" }}
            onClick={() => setMode("direct")}
          >
            <UserPlus size={14} style={{ marginRight: 4 }} /> Direct Add
          </button>
          <button
            type="button"
            className={`secondary-button${mode === "invite" ? " active" : ""}`}
            style={{ padding: "0.25rem 0.75rem", fontSize: "0.82rem" }}
            onClick={() => setMode("invite")}
          >
            <Mail size={14} style={{ marginRight: 4 }} /> Send Invite
          </button>
        </div>
      </div>

      {mode === "direct" ? (
        <form
          className="drawer-movement"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
          onSubmit={(e) => {
            e.preventDefault();
            setNotice(null);
            addDirect.mutate();
          }}
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full Name"
            aria-label="Staff full name"
            required
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="staff@email.com"
            aria-label="Staff email"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 8 chars)"
            aria-label="Staff password"
            minLength={8}
            required
          />
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role to grant">
            {ROLES.map((r) => (
              <option key={r} value={r} disabled={r === "admin" && !isAdmin}>{r}</option>
            ))}
          </select>
          <button
            type="submit"
            className="secondary-button"
            disabled={addDirect.isPending || !name.trim() || !email.trim() || password.length < 8}
          >
            {addDirect.isPending ? "Adding…" : "Add Staff"}
          </button>
        </form>
      ) : (
        <form
          className="drawer-movement"
          onSubmit={(e) => {
            e.preventDefault();
            setNotice(null);
            invite.mutate();
          }}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="their@email.com"
            aria-label="Email to invite"
            required
          />
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role to grant">
            {ROLES.map((r) => (
              <option key={r} value={r} disabled={r === "admin" && !isAdmin}>{r}</option>
            ))}
          </select>
          <button type="submit" className="secondary-button" disabled={invite.isPending || !email.trim()}>
            {invite.isPending ? "Inviting…" : "Send invite"}
          </button>
        </form>
      )}

      {mode === "invite" && (
        <p className="conflict-hint">
          The invite is applied automatically the first time that person signs in.
        </p>
      )}
    </section>
  );
}

