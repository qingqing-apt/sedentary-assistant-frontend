import { useState } from "react";
import { clearSession, getToken, getUser } from "./api";
import { AgentChat } from "./components/AgentChat";
import { Assistant } from "./components/Assistant";
import { Login } from "./components/Login";

export default function App() {
  const [token, setToken] = useState(getToken());

  if (!token) {
    return <Login onDone={() => setToken(getToken())} />;
  }

  return (
    <AgentChat token={token}>
      <Assistant
        user={getUser()}
        onLogout={() => {
          clearSession();
          setToken("");
        }}
      />
    </AgentChat>
  );
}
