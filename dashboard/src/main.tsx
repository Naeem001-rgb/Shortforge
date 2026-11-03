import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import "@fontsource-variable/geist-mono";
import React from "react";
import ReactDOM from "react-dom/client";
import "./theme/tokens.css";
import "./theme/app.css";
import "./theme/workspace.css";
import { App } from "./shell/App";
import { Connection } from "./shell/Connection";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Connection>
      <App />
    </Connection>
  </React.StrictMode>,
);
