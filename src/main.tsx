import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initSecureStorage } from "./services/secureStorage";
import { loadUserMemory } from "./services/userMemory";

// Keychain init + legacy localStorage 마이그레이션. 실패해도 앱 시작 진행.
initSecureStorage().finally(() => {
    // #15 사용자 메모리 캐시 preload — render 를 막지 않게 fire-and-forget(실패해도 빈 값).
    void loadUserMemory();
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    );
});
