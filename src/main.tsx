import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initSecureStorage } from "./services/secureStorage";

// Keychain init + legacy localStorage 마이그레이션. 실패해도 앱 시작 진행.
initSecureStorage().finally(() => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    );
});
