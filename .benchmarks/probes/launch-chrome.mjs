import { spawn } from "node:child_process";

const authFile = await (
  await import("node:fs/promises")
)
  .readdir("/run/user/1000")
  .then((ents) => ents.find((e) => e.startsWith(".mutter-Xwaylandauth")))
  .then((name) => (name ? `/run/user/1000/${name}` : null));

const env = {
  ...process.env,
  LD_LIBRARY_PATH: "",
  DISPLAY: ":0",
  XDG_RUNTIME_DIR: "/run/user/1000",
  DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
  ...(authFile ? { XAUTHORITY: authFile } : {}),
};

const child = spawn(
  "/opt/google/chrome/google-chrome",
  [
    "--remote-debugging-port=9223",
    "--user-data-dir=/tmp/opencode/chrome-headed",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--autoplay-policy=no-user-gesture-required",
    "http://127.0.0.1:3000",
  ],
  { env, detached: true, stdio: "ignore" },
);
child.unref();
console.log(`launched chrome pid=${child.pid} auth=${authFile}`);
