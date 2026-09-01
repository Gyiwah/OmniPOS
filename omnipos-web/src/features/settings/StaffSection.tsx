import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { useSession } from "@/state/session";

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

/**
 * Who works here, and who may do what.
 *
 * The server holds the rules that matter — a manager cannot mint an admin, and
 * the last admin cannot be removed or demoted. Those are enforced there and only
 * reflected here, because a shop must not be able to lock itself out by clicking
 * a button on a device with a stale idea of who else is an admin.
 */
export function StaffSection() {
  const can = useSession((s) => s.can);
  const currentUserId = useSession((s) => s.user?.id);
  const storeId = useSession((s) => s.storeId);
  const queryClient = useQueryClient();

  const [email, setEmail] = useState("");
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

  const fail = (error: unknown) =>
    setNotice({ kind: "error", text: error instanceof Error ? error.message : "That did not work." });

  const invite = useMutation({
    mutationFn: () => api.post<{ message: string }>("/api/store-invites", { email: email.trim(), role }),
    onSuccess: async (res) => {
      setEmail("");
      setNotice({ kind: "ok", text: res.message });
      await refresh();
    },
    onError: fail,
  });

  const changeRole = useMutation({
    mutationFn: (input: { id: string; role: string }) =>
      api.patch(`/api/store-members/${input.id}`, { role: input.role }),
    onSuccess: async () => {
      setNotice({ kind: "ok", text: "Role updated." });
      await refresh();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/store-members/${id}`),
    onSuccess: async () => {
      setNotice({ kind: "ok", text: "Removed from this store." });
      await refresh();
    },
    onError: fail,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/api/store-invites/${id}`),
    onSuccess: async () => {
      setNotice({ kind: "ok", text: "Invite revoked." });
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
                    // A manager can hire cashiers but not create another admin,
                    // so the option they cannot use is not offered. The server
                    // refuses it either way.
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

      <h3 className="settings-subhead">Invite someone</h3>
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

      {/*
        Said plainly because the alternative is a manager assuming an email went
        out and waiting for someone who was never told.
      */}
      <p className="conflict-hint">
        No email is sent yet. The invite is applied automatically the first time that person signs in, so they need
        to be told to do so.
      </p>
    </section>
  );
}
