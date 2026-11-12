// Enables the tracked .githooks in a git checkout; archives and image builds have no hooks to set.
const inRepo = Bun.spawnSync(["git", "rev-parse", "--git-dir"], { stderr: "ignore" }).success;
if (inRepo) {
  const set = Bun.spawnSync(["git", "config", "core.hooksPath", ".githooks"], {
    stderr: "inherit",
  });
  if (!set.success) process.exit(set.exitCode);
}
