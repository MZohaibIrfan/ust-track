import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { PlannerProvider } from "./lib/PlannerContext";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <PlannerProvider>
        <App />
      </PlannerProvider>
    </BrowserRouter>
  </StrictMode>,
);
