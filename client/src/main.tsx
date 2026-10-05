import { createRoot } from "react-dom/client";
import App from "./App";
// Inter is bundled with the app, not fetched from Google Fonts: a kiosk or device network that blocks that host would fall
// back to the device's own fonts, which is how Webex devices ended up rendering "s" as "f".
import "@fontsource-variable/inter";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
