import "@fontsource-variable/inter";
import React from "react";
import ReactDOM from "react-dom/client";
import "./theme/tokens.css";
import "./theme/app.css";
import "./theme/workspace.css";
import "./theme/editor.css";
import { App } from "./shell/App";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
