// Runs a test command under a total deadline. `bun test --timeout` cannot stop a worker that
// spins without returning to JavaScript (bun 1.4.4 missing a child's exit), so a hang would
// otherwise run until someone notices. Usage: bun scripts/test-deadline.mjs <seconds> <cmd...>
const [seconds, ...command] = process.argv.slice(2);
const limit = Number(seconds);
if (!(limit > 0) || command.length === 0)
  throw new Error("用法：bun scripts/test-deadline.mjs <秒数> <命令...>");

const child = Bun.spawn(command, { stdio: ["inherit", "inherit", "inherit"] });
const timer = setTimeout(() => {
  console.error(`\n测试超过 ${limit} 秒仍未结束，判定为卡死并终止：${command.join(" ")}`);
  child.kill("SIGINT");
  setTimeout(() => child.kill("SIGKILL"), 3000).unref();
}, limit * 1000);
const code = await child.exited;
clearTimeout(timer);
process.exit(child.signalCode ? 1 : code);
