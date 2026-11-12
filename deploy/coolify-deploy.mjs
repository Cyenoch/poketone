export async function deploy(env, { request = fetch, wait = Bun.sleep, log = console.log } = {}) {
  for (const key of [
    "COOLIFY_URL",
    "COOLIFY_WEB_UUID",
    "COOLIFY_HARBOR_UUID",
    "COOLIFY_TOKEN",
    "COOLIFY_IMAGE",
    "COOLIFY_IMAGE_TAG",
  ]) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  const base = new URL(env.COOLIFY_URL);
  if (base.protocol !== "https:" || base.username || base.password) {
    throw new Error("COOLIFY_URL must be an HTTPS URL without credentials");
  }

  async function api(method, path, body, { missing } = {}) {
    const response = await request(new URL(`/api/v1${path}`, base), {
      method,
      headers: {
        Authorization: `Bearer ${env.COOLIFY_TOKEN}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404 && missing !== undefined) return missing;
    if (!response.ok) throw new Error(`Coolify ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  }

  if (env.COOLIFY_WEB_UUID === env.COOLIFY_HARBOR_UUID) {
    throw new Error("Web and Harbor must be separate Coolify applications");
  }

  async function deployImage(uuid, image) {
    const app = encodeURIComponent(uuid);
    // Coolify deploys each additional server as its own deployment, created only after the primary
    // finishes; success means every origin runs the new image, not just the first one.
    const { additional_servers_count: extra = 0 } = await api("GET", `/applications/${app}`);
    await api("PATCH", `/applications/${app}`, {
      docker_registry_image_name: image,
      docker_registry_image_tag: env.COOLIFY_IMAGE_TAG,
    });
    const queued = await api("POST", "/deploy", { uuid });
    const started = queued.deployments?.filter((item) => item.resource_uuid === uuid);
    if (!started?.length || started.some((item) => !item.deployment_uuid)) {
      throw new Error("Coolify did not return a deployment UUID");
    }
    const ids = new Set(started.map((item) => item.deployment_uuid));
    const servers = 1 + extra;
    log(`Coolify ${uuid}: deploying ${image}:${env.COOLIFY_IMAGE_TAG} to ${servers} server(s)`);
    let state = "pending";
    for (let attempt = 0; attempt < 90; attempt++) {
      const { deployments = [] } = await api(
        "GET",
        `/deployments/applications/${app}?skip=0&take=20`,
      );
      const first = deployments.find((item) => ids.has(item.deployment_uuid));
      // Ours: the deployments this call started, then the follow-ups Coolify creates after them.
      const ours = first
        ? deployments.filter(
            (item) => ids.has(item.deployment_uuid) || item.created_at >= first.created_at,
          )
        : [];
      const failed = ours.find((item) =>
        ["failed", "cancelled", "cancelled-by-user"].includes(item.status),
      );
      if (failed) {
        throw new Error(
          `Coolify deployment ${failed.deployment_uuid} (${failed.server_name ?? "server"}): ${failed.status}`,
        );
      }
      const finished = ours.filter((item) => item.status === "finished").length;
      state = `${finished}/${servers} server(s) finished`;
      if (ours.length >= servers && finished === ours.length) {
        const application = await api("GET", `/applications/${app}`);
        state = `${state}; application ${application.status}`;
        if (application.status === "running:healthy") {
          log(`Coolify ${uuid}: ${state}`);
          return;
        }
      }
      await wait(10_000);
    }
    throw new Error(`Coolify ${uuid} timed out: ${state}`);
  }

  const web = encodeURIComponent(env.COOLIFY_WEB_UUID);
  const variables = await api("GET", `/applications/${web}/envs`);
  const upstream = variables.find((item) => item.key === "HARBOR_UPSTREAM" && !item.is_preview);
  // Existing values are operator-owned; a hidden value is still configured.
  const needsUpstream = !upstream || (!upstream.is_shown_once && !upstream.value);
  if (needsUpstream) {
    if (!env.HARBOR_UPSTREAM) throw new Error("Missing HARBOR_UPSTREAM for web application");
    const url = new URL(env.HARBOR_UPSTREAM);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      /\s/.test(env.HARBOR_UPSTREAM)
    )
      throw new Error("HARBOR_UPSTREAM must be an HTTP(S) origin without credentials or path");
  }
  await deployImage(env.COOLIFY_HARBOR_UUID, `${env.COOLIFY_IMAGE}-harbor`);
  if (needsUpstream) {
    await api("PATCH", `/applications/${web}/envs`, {
      key: "HARBOR_UPSTREAM",
      value: new URL(env.HARBOR_UPSTREAM).origin,
      is_preview: false,
      is_literal: true,
    });
  }
  await deployImage(env.COOLIFY_WEB_UUID, env.COOLIFY_IMAGE);
}

if (import.meta.main) {
  await deploy(process.env);
}
