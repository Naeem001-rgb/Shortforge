import "@fontsource-variable/inter";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./shell/App";
import "./theme/app.css";
import "./theme/tokens.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
