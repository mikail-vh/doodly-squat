#!/usr/bin/env node
/**
 * NOT the path this project uses — see deploy/runbook.md. Kept for reference,
 * and never run against a live Coolify instance.
 *
 * Creates the Coolify application and its environment variables over the API,
 * so the only thing left to do by hand is the persistent volume (which Coolify
 * does not expose through the API yet — coollabsio/coolify#4084).
 *
 *   node deploy/coolify-setup.mjs            # create app + env vars
 *   node deploy/coolify-setup.mjs --deploy   # ...and trigger the first deploy
 *
 * Configuration comes from deploy/coolify.env (see coolify.env.example).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(here, "coolify.env");

/* ------------------------------------------------------------------ config */

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    fail(
      `Missing ${configPath}\n` +
        `Copy deploy/coolify.env.example to deploy/coolify.env and fill it in.`,
    );
  }

  const config = { ...process.env };
  for (const line of fs.readFileSync(configPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const split = trimmed.indexOf("=");
    if (split === -1) continue;
    config[trimmed.slice(0, split).trim()] = trimmed
      .slice(split + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return config;
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const config = loadConfig();

for (const key of ["COOLIFY_URL", "COOLIFY_TOKEN", "GIT_REPOSITORY", "APP_URL"]) {
  if (!config[key]) fail(`${key} is not set in deploy/coolify.env`);
}

const base = `${config.COOLIFY_URL.replace(/\/+$/, "")}/api/v1`;
const branch = config.GIT_BRANCH || "main";
const appName = config.APP_NAME_SLUG || "doodly-squat";
const projectName = config.PROJECT_NAME || "Doodly Squat";
const environmentName = config.ENVIRONMENT_NAME || "production";

/* --------------------------------------------------------------------- api */

async function api(method, endpoint, body) {
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: {
      authorization: `Bearer ${config.COOLIFY_TOKEN}`,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    fail(
      `${method} ${endpoint} → ${response.status}\n` +
        (typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)),
    );
  }
  return payload;
}

/* ------------------------------------------------------------------- steps */

async function resolveServer() {
  if (config.SERVER_UUID) return config.SERVER_UUID;

  const servers = await api("GET", "/servers");
  if (!Array.isArray(servers) || servers.length === 0) {
    fail("No servers found on this Coolify instance.");
  }
  if (servers.length > 1) {
    const list = servers
      .map((server) => `  ${server.uuid}  ${server.name}`)
      .join("\n");
    fail(`More than one server. Set SERVER_UUID in deploy/coolify.env:\n${list}`);
  }
  console.log(`• server: ${servers[0].name} (${servers[0].uuid})`);
  return servers[0].uuid;
}

async function resolveProject() {
  const projects = await api("GET", "/projects");
  const existing = Array.isArray(projects)
    ? projects.find((project) => project.name === projectName)
    : null;

  if (existing) {
    console.log(`• project: ${existing.name} (${existing.uuid}) — reusing`);
    return existing.uuid;
  }

  const created = await api("POST", "/projects", { name: projectName });
  console.log(`• project: ${projectName} (${created.uuid}) — created`);
  return created.uuid;
}

/** Everything the running container needs; secrets come from coolify.env. */
function applicationEnv() {
  const vars = {
    APP_URL: config.APP_URL,
    APP_NAME: config.APP_NAME || "Doodly Squat",
  };
  for (const key of [
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "STATS_INGEST_TOKEN",
  ]) {
    if (config[key]) vars[key] = config[key];
  }
  return vars;
}

const SECRETS = new Set([
  "DISCORD_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "STATS_INGEST_TOKEN",
]);

async function main() {
  console.log(`\nCoolify: ${config.COOLIFY_URL}`);

  const serverUuid = await resolveServer();
  const projectUuid = await resolveProject();

  const application = await api("POST", "/applications/public", {
    project_uuid: projectUuid,
    server_uuid: serverUuid,
    environment_name: environmentName,
    git_repository: config.GIT_REPOSITORY,
    git_branch: branch,
    build_pack: "dockerfile",
    name: appName,
    domains: config.APP_URL,
    ports_exposes: "3000",
    health_check_enabled: true,
    health_check_path: "/api/health",
    instant_deploy: false,
  });

  const uuid = application.uuid;
  console.log(`• application: ${appName} (${uuid}) — created`);

  for (const [key, value] of Object.entries(applicationEnv())) {
    await api("POST", `/applications/${uuid}/envs`, {
      key,
      value,
      is_literal: true,
      is_shown_once: SECRETS.has(key),
    });
    console.log(`  env ${key}=${SECRETS.has(key) ? "••••••" : value}`);
  }

  console.log(
    [
      "",
      "─".repeat(68),
      "  DO THIS NEXT, BEFORE DEPLOYING — it cannot be done over the API:",
      "",
      `  ${config.COOLIFY_URL}  →  ${projectName} → ${appName} → Storages`,
      "    Add → Volume Mount",
      "      Name:             stash-data",
      "      Destination Path: /data",
      "",
      "  Without it the database lives inside the container and is destroyed",
      "  on every redeploy.",
      "─".repeat(68),
      "",
    ].join("\n"),
  );

  if (process.argv.includes("--deploy")) {
    await api("POST", `/deploy?uuid=${uuid}`);
    console.log("• deploy triggered\n");
  } else {
    console.log(`Then deploy:  node deploy/coolify-setup.mjs --deploy-only ${uuid}\n`);
  }
}

const deployOnly = process.argv.indexOf("--deploy-only");
if (deployOnly !== -1) {
  const uuid = process.argv[deployOnly + 1];
  if (!uuid) fail("--deploy-only needs the application uuid");
  await api("POST", `/deploy?uuid=${uuid}`);
  console.log("• deploy triggered");
} else {
  await main();
}
