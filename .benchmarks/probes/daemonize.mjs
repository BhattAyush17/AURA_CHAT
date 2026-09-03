import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const script = args[0];
const child = spawn("setsid", ["bash", script], {
  detached: true,
  stdio: "ignore",
});
child.unref();
console.log(`launched ${script} pid=${child.pid}`);
