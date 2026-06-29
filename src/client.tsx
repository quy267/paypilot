import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import App from "./app";

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
