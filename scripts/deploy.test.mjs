import assert from "node:assert/strict";
import test from "node:test";
import { deploy } from "../deploy/coolify-deploy.mjs";

const env = {
  COOLIFY_URL: "https://coolify.example.test",
  COOLIFY_WEB_UUID: "web-1",
  COOLIFY_HARBOR_UUID: "harbor-1",
  COOLIFY_TOKEN: "test-token",
  COOLIFY_IMAGE: "ghcr.io/test/poketone",
  COOLIFY_IMAGE_TAG: "commit-1",
  HARBOR_UPSTREAM: "http://harbor.example.test",
};

/**
 * Coolify as observed in production: POST /deploy returns only the primary server's deployment; each
 * additional server's deployment is created once the primary finishes, and appears in the app's
 * deployment list. An older deployment in the list must never count.
 */
function coolify({
  variables = [],
  status = "finished",
  secondary = "finished",
  health = "running:healthy",
  listedAfter = 0,
} = {}) {
  const calls = [];
  const polls = {};
  const value = (option, arg) => (typeof option === "function" ? option(arg) : option);
  return {
    calls,
    wait: async () => {},
    log: () => {},
    request: async (url, options) => {
      calls.push({ path: url.pathname, ...options });
      const uuid = url.pathname.split("/")[url.pathname.includes("/deployments/") ? 5 : 4];
      if (options.method === "PATCH") return Response.json({});
      if (options.method === "POST") {
        const { uuid: app } = JSON.parse(options.body);
        const id = app === "web-1" ? "web-primary" : "harbor";
        return Response.json({ deployments: [{ resource_uuid: app, deployment_uuid: id }] });
      }
      if (url.pathname.endsWith("/envs")) return Response.json(variables);
      if (url.pathname.includes("/deployments/applications/")) {
        const poll = (polls[uuid] = (polls[uuid] ?? 0) + 1);
        const id = uuid === "web-1" ? "web-primary" : "harbor";
        const primary = value(status, id);
        const deployments = [
          { deployment_uuid: "old", status: "failed", created_at: "2026-01-01T00:00:00Z" },
        ];
        if (poll > listedAfter)
          deployments.unshift({
            deployment_uuid: id,
            status: primary,
            created_at: "2026-01-02T00:00:00Z",
          });
        // The additional origin's deployment exists only from the poll after the primary finished.
        if (uuid === "web-1" && primary === "finished" && poll > listedAfter + 1)
          deployments.unshift({
            deployment_uuid: "web-secondary",
            server_name: "secondary",
            status: poll > listedAfter + 2 ? value(secondary, poll) : "in_progress",
            created_at: "2026-01-02T00:01:00Z",
          });
        return Response.json({ count: deployments.length, deployments });
      }
      return Response.json({
        status: value(health, uuid),
        additional_servers_count: uuid === "web-1" ? 1 : 0,
      });
    },
  };
}

const paths = (api) => api.calls.map(({ method, path }) => `${method} ${path}`);

test("Harbor is healthy before web is configured, and web waits for its additional origin", async () => {
  const api = coolify();
  await deploy(env, api);
  const calls = paths(api);
  const harborHealthy = calls.lastIndexOf("GET /api/v1/applications/harbor-1");
  assert(harborHealthy < calls.indexOf("PATCH /api/v1/applications/web-1/envs"));
  // Primary finished on poll 1, the secondary appears on poll 2 and finishes on poll 3.
  const webPolls = calls.filter((call) =>
    call.startsWith("GET /api/v1/deployments/applications/web-1"),
  );
  assert.equal(webPolls.length, 3);
  assert.equal(calls.at(-1), "GET /api/v1/applications/web-1");
  for (const [app, image] of [
    ["harbor-1", `${env.COOLIFY_IMAGE}-harbor`],
    ["web-1", env.COOLIFY_IMAGE],
  ]) {
    const patch = api.calls.find(
      (call) => call.method === "PATCH" && call.path === `/api/v1/applications/${app}`,
    );
    assert.deepEqual(JSON.parse(patch.body), {
      docker_registry_image_name: image,
      docker_registry_image_tag: env.COOLIFY_IMAGE_TAG,
    });
  }
  const upstream = api.calls.find((call) => call.method === "PATCH" && call.path.endsWith("/envs"));
  assert.deepEqual(JSON.parse(upstream.body), {
    key: "HARBOR_UPSTREAM",
    value: env.HARBOR_UPSTREAM,
    is_preview: false,
    is_literal: true,
  });
});

test("existing production upstream is preserved without requiring a GitHub fallback", async () => {
  for (const entry of [
    { value: "https://operator.example.test" },
    { value: null, is_shown_once: true },
  ]) {
    const api = coolify({ variables: [{ key: "HARBOR_UPSTREAM", is_preview: false, ...entry }] });
    await deploy({ ...env, HARBOR_UPSTREAM: undefined }, api);
    assert(!api.calls.some((call) => call.method === "PATCH" && call.path.endsWith("/envs")));
  }
});

test("preview-only or empty upstream is populated for production", async () => {
  for (const entry of [
    { value: "http://preview", is_preview: true },
    { value: "", is_preview: false },
  ]) {
    const api = coolify({ variables: [{ key: "HARBOR_UPSTREAM", ...entry }] });
    await deploy(env, api);
    assert(api.calls.some((call) => call.method === "PATCH" && call.path.endsWith("/envs")));
  }
});

test("missing or invalid upstream fails before mutating either app", async () => {
  for (const value of [
    undefined,
    "ws://harbor",
    "http://harbor/multiplayer",
    "http://user:pass@harbor",
  ]) {
    const api = coolify();
    await assert.rejects(deploy({ ...env, HARBOR_UPSTREAM: value }, api), /HARBOR_UPSTREAM/);
    assert(api.calls.every((call) => call.method === "GET"));
  }
});

test("API failure aborts without exposing the response body", async () => {
  await assert.rejects(
    deploy(env, { request: async () => new Response("private response", { status: 401 }) }),
    /GET .*HTTP 401$/,
  );
});

test("failed or unhealthy Harbor prevents any web mutation", async () => {
  for (const options of [
    { status: "failed" },
    { status: "cancelled" },
    { status: "cancelled-by-user" },
    { status: "in_progress" },
    { health: "running:unhealthy" },
  ]) {
    const api = coolify(options);
    await assert.rejects(deploy(env, api), /failed|cancelled|timed out/);
    assert(!api.calls.some((call) => call.method === "PATCH" && call.path.includes("web-1")));
  }
});

test("an additional origin's failed deployment fails the release", async () => {
  await assert.rejects(
    deploy(env, coolify({ secondary: "failed" })),
    /web-secondary \(secondary\): failed/,
  );
});

test("finished deployments wait for asynchronous application health", async () => {
  let webReads = 0;
  const health = (uuid) =>
    uuid === "web-1" && ++webReads === 2 ? "running:unhealthy" : "running:healthy";
  await deploy(env, coolify({ health }));
  // Web: the pre-deploy read, one unhealthy check after every origin finished, then healthy.
  assert.equal(webReads, 3);
});

test("a deployment not yet listed is polled again instead of counted", async () => {
  const api = coolify({ listedAfter: 2 });
  await deploy(env, api);
  const harborPolls = paths(api).filter((call) =>
    call.startsWith("GET /api/v1/deployments/applications/harbor-1"),
  );
  assert.equal(harborPolls.length, 3);
});

test("rejects insecure API URLs and accidentally shared app UUIDs", async () => {
  await assert.rejects(deploy({ ...env, COOLIFY_URL: "http://coolify.example.test" }), /HTTPS/);
  await assert.rejects(deploy({ ...env, COOLIFY_HARBOR_UUID: env.COOLIFY_WEB_UUID }), /separate/);
});
