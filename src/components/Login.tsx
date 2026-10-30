import { useState, type FormEvent } from "react";
import { api, saveSession } from "../api";

export function Login({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("请输入用户名");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(trimmed);
      saveSession(result.token, result.user_id);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <h1>久坐活动助手</h1>
        <p className="login-sub">练习环境登录，输入任意用户名即可</p>

        <label className="field">
          <span>用户名</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如 intern"
            autoFocus
          />
        </label>

        {error ? <p className="form-error">{error}</p> : null}

        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? "登录中…" : "进入"}
        </button>
      </form>
    </div>
  );
}
